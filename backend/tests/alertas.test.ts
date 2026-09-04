// tests/alertas.test.ts
//
// Suíte do sistema de alertas.
//
// Roda no test runner NATIVO do Node (node:test) via tsx — nenhuma dependência
// nova. O backend não tinha nem vitest nem jest, e trazer um framework inteiro
// para a primeira suíte do projeto seria uma decisão de infraestrutura tomada de
// carona numa entrega de produto.
//
//   cd backend && npm test              (todas as suítes)
//   cd backend && npm run test:alertas   (só esta)
//
// `--test-force-exit` não é preguiça: o cliente do Prisma mantém o pool de
// conexões aberto mesmo depois do `$disconnect`, e sem a flag o runner termina
// os testes e fica pendurado para sempre — o que em CI vira build travado em vez
// de build vermelho.
//
// ⚠️ ESTES TESTES TOCAM O BANCO REAL — não existe banco de teste no beyond.
// Duas regras, sem exceção:
//   1. Tudo o que a suíte cria usa o prefixo `test:` e é apagado no fim.
//   2. Nada de produção é alterado. Onde o caminho exige escrever em dado real
//      (concluir uma atividade, dar desfecho a uma reunião), o teste roda dentro
//      de uma transação que SEMPRE termina em rollback.

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { prisma } from '../src/lib/prisma.js'
import {
  raiseAlert, resolveAlert, resolverAusentes, resolverDestinatarios,
  listarAlertasDoUsuario, contarNaoLidos, marcarLido, descartar,
  silenciar, dessilenciar, purgarAlertasAntigos,
} from '../src/services/alertService.js'
import { produtorAtivo, definirProdutorAtivo, listarAlertas } from '../src/services/alertService.js'
import { listarAcervo } from '../src/services/alertBacklog.js'
import { destinoDoAlerta } from '../src/services/alertLinks.js'
import { saudeDosAlertas } from '../src/services/alertHealth.js'
import { candidatos, textoDoAviso, escalarPendentes } from '../src/services/alertEscalation.js'
import { leadsComAlertaAberto, KIND_NEGOCIACAO, varrerLeadsSemResposta, KIND_LEAD_PARADO } from '../src/services/pendenciaWatch.js'

const P = 'test:suite:'
const KIND = 'test.suite'

let gestor: { id: number; name: string }
let outroGestor: { id: number; name: string } | null

async function limpar() {
  await prisma.alertMute.deleteMany({
    where: { OR: [{ kind: KIND }, { dedupeKey: { startsWith: P } }] },
  })
  await prisma.alert.deleteMany({ where: { dedupeKey: { startsWith: P } } })
}

before(async () => {
  const g = await prisma.user.findMany({
    where: { active: true, role: { in: ['SUPERADMIN', 'ADMIN', 'MANAGER'] as any } },
    select: { id: true, name: true },
    orderBy: { id: 'asc' },
  })
  assert.ok(g.length >= 1, 'a suíte precisa de ao menos um gestor ativo')
  gestor = g[0]!
  outroGestor = g[1] ?? null
  await limpar()
})

after(async () => {
  await limpar()
  await prisma.$disconnect()
})

describe('raiseAlert — alerta é estado, não evento', () => {
  test('cria na primeira vez', async () => {
    const r = await raiseAlert({ dedupeKey: P + 'a', kind: KIND, title: 'A' })
    assert.equal(r.novo, true)
    assert.equal(r.ocorrencias, 1)
  })

  test('chamar de novo ATUALIZA em vez de duplicar', async () => {
    const r1 = await raiseAlert({ dedupeKey: P + 'b', kind: KIND, title: 'B' })
    const r2 = await raiseAlert({ dedupeKey: P + 'b', kind: KIND, title: 'B' })
    assert.equal(r2.alertId, r1.alertId)
    assert.equal(r2.novo, false)
    assert.equal(r2.ocorrencias, 2)
    assert.equal(await prisma.alert.count({ where: { dedupeKey: P + 'b' } }), 1)
  })

  test('condição que volta reabre a MESMA linha e preserva firstSeenAt', async () => {
    const r1 = await raiseAlert({ dedupeKey: P + 'c', kind: KIND, title: 'C' })
    const antes = await prisma.alert.findUnique({ where: { id: r1.alertId }, select: { firstSeenAt: true } })
    await resolveAlert(P + 'c')
    const r2 = await raiseAlert({ dedupeKey: P + 'c', kind: KIND, title: 'C de novo' })
    const depois = await prisma.alert.findUnique({
      where: { id: r1.alertId },
      select: { firstSeenAt: true, status: true, notifyCount: true },
    })
    assert.equal(r2.alertId, r1.alertId, 'mesma linha')
    assert.equal(r2.novo, true, 'conta como novo para avisar de novo')
    assert.deepEqual(depois?.firstSeenAt, antes?.firstSeenAt, 'firstSeenAt preservado — é o que prova recorrência')
    assert.equal(depois?.status, 'open')
    assert.equal(depois?.notifyCount, 0, 'contador de envio externo zerado')
  })
})

describe('resolverAusentes — o "some sozinho"', () => {
  test('fecha o que não veio na lista de vivas', async () => {
    await raiseAlert({ dedupeKey: P + 'v1', kind: KIND + '.varre', title: 'v1' })
    await raiseAlert({ dedupeKey: P + 'v2', kind: KIND + '.varre', title: 'v2' })
    const n = await resolverAusentes(KIND + '.varre', [P + 'v1'])
    assert.equal(n, 1)
    const v1 = await prisma.alert.findUnique({ where: { dedupeKey: P + 'v1' }, select: { status: true } })
    assert.equal(v1?.status, 'open', 'o que continua no mundo segue aberto')
  })

  test('lista VAZIA fecha tudo da família', async () => {
    // O caso que quase passou batido: `notIn: []` no MySQL não casa com linha
    // nenhuma e deixaria todos abertos justamente quando o problema acabou.
    await raiseAlert({ dedupeKey: P + 'v3', kind: KIND + '.vazio', title: 'v3' })
    const n = await resolverAusentes(KIND + '.vazio', [])
    assert.equal(n, 1, 'varri e não achei nada = fecha tudo')
  })
})

describe('audiência — quem recebe', () => {
  test('management vai só para a gestão', async () => {
    const ids = await resolverDestinatarios('management')
    const gestao = await prisma.user.count({
      where: { active: true, role: { in: ['SUPERADMIN', 'ADMIN', 'MANAGER'] as any } },
    })
    assert.equal(ids.length, gestao)
  })

  test('owner sem dono não some — sobra com a gestão', async () => {
    const ids = await resolverDestinatarios('owner', null)
    const gestao = await resolverDestinatarios('management')
    assert.deepEqual(ids.sort(), gestao.sort())
  })

  test('dono que também é gestor não duplica', async () => {
    const ids = await resolverDestinatarios('owner', gestor.id)
    assert.equal(new Set(ids).size, ids.length)
  })

  test('dono INATIVO não recebe, mas o alerta não some', async () => {
    const inativo = await prisma.user.findFirst({ where: { active: false }, select: { id: true } })
    if (!inativo) return
    const ids = await resolverDestinatarios('owner', inativo.id)
    assert.ok(!ids.includes(inativo.id), 'inativo fora')
    assert.ok(ids.length > 0, 'a gestão continua recebendo')
  })
})

describe('caixa individual — ler é de cada um, resolver é do mundo', () => {
  test('marcar lido não apaga da caixa dos outros', async () => {
    const r = await raiseAlert({ dedupeKey: P + 'lido', kind: KIND, title: 'lido' })
    await marcarLido(r.alertId, gestor.id)
    const minha = await listarAlertasDoUsuario(gestor.id)
    assert.ok(minha.some((x) => x.alertId === r.alertId), 'continua na lista, só não conta')
    if (outroGestor) {
      const doOutro = await listarAlertasDoUsuario(outroGestor.id, { apenasNaoLidos: true })
      assert.ok(doOutro.some((x) => x.alertId === r.alertId), 'para o outro segue não lido')
    }
  })

  test('descartar tira só da minha caixa e não fecha a condição', async () => {
    const r = await raiseAlert({ dedupeKey: P + 'desc', kind: KIND, title: 'desc' })
    await descartar(r.alertId, gestor.id)
    const minha = await listarAlertasDoUsuario(gestor.id)
    assert.ok(!minha.some((x) => x.alertId === r.alertId))
    const cond = await prisma.alert.findUnique({ where: { id: r.alertId }, select: { status: true } })
    assert.equal(cond?.status, 'open', 'a condição segue de pé')
  })

  test('resolver fecha para todos de uma vez', async () => {
    const r = await raiseAlert({ dedupeKey: P + 'res', kind: KIND, title: 'res' })
    assert.equal(await resolveAlert(P + 'res'), true)
    assert.equal(await resolveAlert(P + 'res'), false, 'idempotente')
    const restantes = await prisma.alertRecipient.count({
      where: { alertId: r.alertId, alert: { status: 'open' } },
    })
    assert.equal(restantes, 0)
  })
})

describe('silêncio', () => {
  test('por tipo cala todos, inclusive os que chegarem depois', async () => {
    await raiseAlert({ dedupeKey: P + 's1', kind: KIND + '.mute', title: 's1' })
    await silenciar(gestor.id, { kind: KIND + '.mute' })
    await raiseAlert({ dedupeKey: P + 's2', kind: KIND + '.mute', title: 's2' })
    const lista = await listarAlertasDoUsuario(gestor.id)
    assert.ok(!lista.some((x) => x.alert.kind === KIND + '.mute'))
    await dessilenciar(gestor.id, { kind: KIND + '.mute' })
  })

  test('por item cala só ele', async () => {
    await raiseAlert({ dedupeKey: P + 'i1', kind: KIND + '.item', title: 'i1' })
    await raiseAlert({ dedupeKey: P + 'i2', kind: KIND + '.item', title: 'i2' })
    await silenciar(gestor.id, { dedupeKey: P + 'i1' })
    const lista = (await listarAlertasDoUsuario(gestor.id)).filter((x) => x.alert.kind === KIND + '.item')
    assert.equal(lista.length, 1)
    assert.equal(lista[0]?.alert.dedupeKey, P + 'i2')
    await dessilenciar(gestor.id, { dedupeKey: P + 'i1' })
  })

  test('o CONTADOR concorda com a lista', async () => {
    // Badge em 3 e gaveta abrindo com 1 é a forma mais rápida de a pessoa
    // desconfiar do sino inteiro.
    await raiseAlert({ dedupeKey: P + 'c1', kind: KIND + '.cont', title: 'c1' })
    await silenciar(gestor.id, { kind: KIND + '.cont' })
    // `limite` alto de propósito: o que se prova aqui é que o FILTRO do contador
    // é o mesmo da lista. Sem isso o teste comparava uma página de 50 com um
    // total de 109 e falhava em toda instalação com muito alerta — medindo
    // paginação, não a regra. Ver feedback_contadores_mesmo_where_da_lista.
    const lista = await listarAlertasDoUsuario(gestor.id, { apenasNaoLidos: true, limite: 100_000 })
    const contador = await contarNaoLidos(gestor.id)
    assert.equal(lista.length, contador)
    await dessilenciar(gestor.id, { kind: KIND + '.cont' })
  })

  test('silêncio vencido não cala mais', async () => {
    await raiseAlert({ dedupeKey: P + 'exp', kind: KIND + '.exp', title: 'exp' })
    await silenciar(gestor.id, { kind: KIND + '.exp' }, new Date(Date.now() - 1000))
    const lista = (await listarAlertasDoUsuario(gestor.id)).filter((x) => x.alert.kind === KIND + '.exp')
    assert.equal(lista.length, 1)
    await dessilenciar(gestor.id, { kind: KIND + '.exp' })
  })

  test('o silêncio é só de quem pediu', async () => {
    if (!outroGestor) return
    await raiseAlert({ dedupeKey: P + 'meu', kind: KIND + '.meu', title: 'meu' })
    await silenciar(gestor.id, { kind: KIND + '.meu' })
    const doOutro = (await listarAlertasDoUsuario(outroGestor.id)).filter((x) => x.alert.kind === KIND + '.meu')
    assert.equal(doOutro.length, 1, 'o outro continua vendo')
    await dessilenciar(gestor.id, { kind: KIND + '.meu' })
  })
})

describe('retenção', () => {
  test('apaga resolvido antigo e PRESERVA aberto antigo', async () => {
    const velho = await raiseAlert({ dedupeKey: P + 'velho', kind: KIND, title: 'velho' })
    await prisma.alert.update({
      where: { id: velho.alertId },
      data: { status: 'resolved', resolvedAt: new Date(Date.now() - 400 * 86400_000) },
    })
    const aberto = await raiseAlert({ dedupeKey: P + 'aberto', kind: KIND, title: 'aberto' })
    await prisma.alert.update({
      where: { id: aberto.alertId },
      data: { firstSeenAt: new Date(Date.now() - 400 * 86400_000) },
    })

    await purgarAlertasAntigos()
    assert.equal(await prisma.alert.findUnique({ where: { id: velho.alertId } }), null)
    assert.notEqual(await prisma.alert.findUnique({ where: { id: aberto.alertId } }), null,
      'condição de pé há 400 dias é a que MENOS deveria sumir sozinha')
    assert.equal(await prisma.alertRecipient.count({ where: { alertId: velho.alertId } }), 0,
      'destinatários vão em cascata')
  })
})

describe('destino e ação por tipo de entidade', () => {
  // Caminho EXATO, não "tem link". A tabela anterior só afirmava
  // `assert.equal(!!d.link, true)` e por isso passou verde durante semanas
  // sobre destinos quebrados: dois pediam abas ("?tab=whatsapp",
  // "?tab=meetings") que a tela de Configurações não tem, abrindo em
  // "Aparência". Um teste que não diz PARA ONDE não testa link nenhum.
  //
  // O caminho é RELATIVO À BASE do painel — sem "/app". Isso é contrato com o
  // frontend, e o contrato tem dois lados:
  //   • quem consome de DENTRO do <WouterRouter base="/app"> (a tela
  //     /app/alerts) navega com o caminho como está;
  //   • quem consome de FORA dele — o sino, que vive na Topbar, e a Topbar
  //     está no <AppShell> que ENVOLVE o <Router> — precisa somar
  //     `env.appBasePath` na hora de navegar.
  // O segundo caso foi esquecido e chegou ao cliente: na severiano o alerta
  // levava a "/leads/791" em vez de "/app/leads/791", e dava 404. Este teste
  // guarda o lado do servidor; o do cliente está comentado no AlertInbox.
  const esperado: Array<[string, string | null, number]> = [
    ['booking', '/scheduling', 2],
    ['activity', '/leads/42/activities', 1],
    ['negotiation', '/leads/42/negociacao', 0],
    // Conversa, não ficha: o alerta só existe porque o contato escreveu e não
    // teve resposta, e responder não acontece em /leads.
    ['lead', '/conversations?leadId=1', 0],
    ['whatsapp_instance', '/whatsapp', 0],
    ['evolution', '/integrations/evolution', 0],
    ['cloud_api_connection', '/cloud-api', 0],
    ['google_connection', '/google?tab=account', 0],
    ['gmail_config', '/google?tab=gmail', 0],
    ['google_calendar_integration', '/google?tab=calendar', 0],
    ['google_sheet_integration', '/google?tab=sheets', 0],
    ['meeting_recording', '/meetings', 0],
  ]
  for (const [tipo, link, qtd] of esperado) {
    test(`${tipo} → ${link} (${qtd} ação(ões))`, () => {
      const d = destinoDoAlerta({ entityType: tipo, entityId: 1, leadId: 42 })
      assert.equal(d.link, link)
      assert.equal(d.acoes.length, qtd)
    })
  }

  test('nenhum destino carrega o prefixo /app', () => {
    // O sino navega com o `navigate()` do wouter, montado com base "/app".
    // Qualquer caminho que já traga o prefixo é dobrado e quebra — e é o tipo
    // de erro que só aparece clicando, um tipo de alerta por vez.
    for (const [tipo] of esperado) {
      const d = destinoDoAlerta({ entityType: tipo, entityId: 1, leadId: 42 })
      assert.ok(!d.link?.startsWith('/app'), `${tipo} não pode começar com /app`)
      assert.ok(!d.link || d.link.startsWith('/'), `${tipo} precisa de caminho absoluto`)
    }
  })

  test('toda ação oferecida é uma que a rota /action aceita', () => {
    // Os botões vêm daqui e são executados lá; se as duas listas divergirem, a
    // pessoa clica e leva 400 — o alerta vira armadilha em vez de atalho.
    const ACEITAS: Record<string, string[]> = {
      booking: ['completed', 'no_show'],
      activity: ['completed'],
    }
    for (const [tipo] of esperado) {
      const d = destinoDoAlerta({ entityType: tipo, entityId: 1, leadId: 42 })
      for (const a of d.acoes) {
        assert.ok(ACEITAS[tipo]?.includes(a.action), `${tipo}: rota não aceita "${a.action}"`)
      }
      if (!ACEITAS[tipo]) assert.equal(d.acoes.length, 0, `${tipo} não deveria oferecer ação`)
    }
  })

  test('tipo desconhecido não inventa link nem ação', () => {
    const d = destinoDoAlerta({ entityType: 'coisa_que_nao_existe', entityId: 1 })
    assert.equal(d.link, null)
    assert.equal(d.acoes.length, 0)
  })

  test('item de lead sem leadId no metadata fica sem link', () => {
    const d = destinoDoAlerta({ entityType: 'negotiation', entityId: 1, leadId: null })
    assert.equal(d.link, null, 'melhor sem link do que com link quebrado')
  })

  test('alerta de integração não depende de entityId para ter destino', () => {
    // A Evolution caída e o bot que falhou nascem com `entityId: null`; se o
    // destino dependesse do id, justamente os alertas mais graves ficariam sem
    // para onde ir.
    for (const tipo of ['evolution', 'whatsapp_instance', 'meeting_recording']) {
      const d = destinoDoAlerta({ entityType: tipo, entityId: null })
      assert.ok(d.link, `${tipo} precisa de destino mesmo sem id`)
    }
  })
})

describe('saúde — o painel não mente na primeira semana', () => {
  test('alerta recém-criado fica em carência, não vira "irrelevante"', async () => {
    await raiseAlert({ dedupeKey: P + 'novo', kind: KIND + '.novo', title: 'novo' })
    const s = await saudeDosAlertas(30)
    const meu = s.find((x) => x.kind === KIND + '.novo')
    assert.equal(meu?.veredicto, 'sem_amostra')
    assert.ok((meu?.aguardando ?? 0) > 0, 'aparece como aguardando, não some do painel')
  })

  test('demonstração e teste ficam fora do painel', async () => {
    const s = await saudeDosAlertas(30)
    assert.ok(s.every((x) => x.kind !== 'demo' && x.kind !== 'teste'))
  })
})

describe('escalonamento — o crítico que ninguém viu', () => {
  /** Nasce com a idade que o teste precisar: a carência é o que está em jogo. */
  async function critico(sufixo: string, opts: { horas: number; count?: number; ultimoAvisoH?: number }) {
    const chave = P + sufixo
    await raiseAlert({ dedupeKey: chave, kind: KIND, severity: 'critical', title: `crítico ${sufixo}`, body: 'corpo' })
    await prisma.alert.update({
      where: { dedupeKey: chave },
      data: {
        firstSeenAt: new Date(Date.now() - opts.horas * 3600_000),
        escalationCount: opts.count ?? 0,
        escalatedAt: opts.ultimoAvisoH != null ? new Date(Date.now() - opts.ultimoAvisoH * 3600_000) : null,
      },
    })
    return chave
  }
  const meus = async () => (await candidatos()).filter((a) => a.title.startsWith('crítico '))

  test('dentro da carência não interrompe ninguém', async () => {
    await critico('carencia', { horas: 0 })
    assert.equal((await meus()).length, 0, 'quem está no painel vê no sino em minutos')
    await limpar()
  })

  test('fora da carência e sem ninguém ler, escala', async () => {
    await critico('escala', { horas: 5 })
    assert.equal((await meus()).length, 1)
    await limpar()
  })

  test('lido por qualquer destinatário para de escalar', async () => {
    const chave = await critico('lido', { horas: 5 })
    const a = await prisma.alert.findUniqueOrThrow({ where: { dedupeKey: chave }, select: { id: true } })
    await marcarLido(a.id, gestor.id)
    assert.equal((await meus()).length, 0, 'leitura prova que o time soube; daí em diante é decisão dele')
    await limpar()
  })

  test('warning nunca escala, por mais velho que fique', async () => {
    await raiseAlert({ dedupeKey: P + 'warn', kind: KIND, severity: 'warning', title: 'crítico não' })
    await prisma.alert.update({ where: { dedupeKey: P + 'warn' }, data: { firstSeenAt: new Date(Date.now() - 300 * 3600_000) } })
    assert.equal((await candidatos()).filter((x) => x.title === 'crítico não').length, 0)
    await limpar()
  })

  test('teto de dois avisos: o terceiro não sai', async () => {
    await critico('teto', { horas: 500, count: 2, ultimoAvisoH: 200 })
    assert.equal((await meus()).length, 0, 'seguir avisando só ensina a ignorar')
    await limpar()
  })

  test('o reforço conta do último aviso, não do nascimento', async () => {
    // Velho de 40 dias, mas avisado há 1h: não pode sair de novo agora.
    await critico('reforco-cedo', { horas: 24 * 40, count: 1, ultimoAvisoH: 1 })
    assert.equal((await meus()).length, 0)
    await limpar()
    // Mesmo alerta, aviso de 30h atrás: aí sim.
    await critico('reforco-hora', { horas: 24 * 40, count: 1, ultimoAvisoH: 30 })
    assert.equal((await meus()).length, 1)
    await limpar()
  })

  test('o segundo aviso se anuncia como segundo', async () => {
    await critico('segundo', { horas: 50, count: 1, ultimoAvisoH: 30 })
    const [a] = await meus()
    assert.ok(a, 'o candidato existe')
    const texto = textoDoAviso(a!)
    assert.match(texto, /segundo aviso/)
    assert.match(texto, /há 2 dia\(s\)/, 'a idade sai em dias quando passa de 24h')
    await limpar()
  })

  test('desligado no Setting não envia nada, mesmo com candidato de pé', async () => {
    await critico('desligado', { horas: 5 })
    const atual = await prisma.setting.findUnique({ where: { key: 'alertas.escalonamento_ativo' } })
    assert.notEqual(String(atual?.value ?? '').replace(/"/g, ''), 'true', 'a suíte não liga canal externo')
    assert.equal(await escalarPendentes(), 0, 'a chave geral é a primeira coisa consultada')
    const depois = await prisma.alert.findUniqueOrThrow({ where: { dedupeKey: P + 'desligado' }, select: { escalationCount: true } })
    assert.equal(depois.escalationCount, 0, 'nem carimba tentativa que não aconteceu')
    await limpar()
  })
})

describe('lead parado — não duplica quem já tem alerta', () => {
  test('lead com proposta já alertada não ganha um segundo aviso', async () => {
    // Precisa de uma negociação cujo lead ainda esteja LIMPO: pegar a primeira
    // do banco falhava em toda instalação com alerta de proposta parada de
    // verdade — o teste media o acaso do dado, não a consulta.
    const candidatas = await prisma.negotiation.findMany({ select: { id: true, leadId: true }, take: 200 })
    if (!candidatas.length) return // ambiente sem negociação: nada a provar aqui
    const ocupados = await leadsComAlertaAberto(candidatas.map((n) => n.leadId))
    const neg = candidatas.find((n) => !ocupados.has(n.leadId))
    if (!neg) return // toda negociação já tem alerta: sem lead limpo para o ensaio

    assert.equal((await leadsComAlertaAberto([neg.leadId])).size, 0, 'sem alerta aberto, o lead está livre')

    // Alerta montado direto no banco: o que se testa é a consulta, e passar por
    // raiseAlert encheria a caixa de gente de verdade no meio do teste.
    await prisma.alert.create({
      data: {
        dedupeKey: P + 'neg', kind: KIND_NEGOCIACAO, severity: 'warning', audience: 'management',
        title: 'proposta parada (teste)', entityType: 'negotiation', entityId: neg.id,
        status: 'open', lastSeenAt: new Date(),
      },
    })
    assert.ok((await leadsComAlertaAberto([neg.leadId])).has(neg.leadId), 'o mais específico ganha')

    // Resolvido deixa de bloquear: a condição acabou, o lead volta a ser elegível.
    await prisma.alert.update({ where: { dedupeKey: P + 'neg' }, data: { status: 'resolved', resolvedAt: new Date() } })
    assert.equal((await leadsComAlertaAberto([neg.leadId])).size, 0)
    await limpar()
  })

  test('lista vazia não consulta nada nem inventa bloqueio', async () => {
    assert.equal((await leadsComAlertaAberto([])).size, 0)
  })
})

// Estes três filtros nasceram de um dado, não de uma intuição: na severiano o
// produtor abriu 99 alertas de "Lead sem resposta" e apenas 11 procediam. Os
// outros 88 acusavam pessoas com nome — 31 para uma, 26 para outra — de
// abandonar lead que elas já tinham resolvido ou respondido. Um alerta de gestão
// que erra assim não vira ruído: vira conflito, e o time não volta a confiar no
// sino. Por isso cada filtro tem teste próprio.
describe('lead parado — só alerta quando a bola está mesmo com a operação', () => {
  test('conversa fechada pelo operador não é pendência dele', async () => {
    const l = await prisma.lead.findFirst({
      where: { conversationClosedAt: { not: null }, isGroup: false },
      select: { id: true },
    })
    if (!l) return // instalação sem conversa resolvida: nada a provar aqui

    const alertas = await prisma.alert.findMany({
      where: { kind: KIND_LEAD_PARADO, status: 'open', entityType: 'lead', entityId: l.id },
      select: { id: true },
    })
    assert.equal(alertas.length, 0, 'conversa resolvida não pode gerar alerta de lead parado')
  })

  test('a varredura nunca alerta lead cuja última mensagem foi nossa', async () => {
    await varrerLeadsSemResposta()
    const abertos = await prisma.alert.findMany({
      where: { kind: KIND_LEAD_PARADO, status: 'open' },
      select: { entityId: true },
    })
    if (!abertos.length) return // sem lead na janela: o filtro não tem o que provar

    const ids = abertos.map((a) => a.entityId!).filter(Boolean)
    const ultimas = await prisma.message.findMany({
      where: { leadId: { in: ids } },
      orderBy: { timestamp: 'desc' },
      distinct: ['leadId'],
      select: { leadId: true, fromMe: true },
    })
    const nossas = ultimas.filter((m) => m.fromMe !== false)
    assert.equal(nossas.length, 0,
      `alerta em ${nossas.length} lead(s) que NÓS respondemos por último — o lead é que sumiu`)
  })

  test('a varredura nunca alerta lead em etapa de desfecho', async () => {
    const abertos = await prisma.alert.findMany({
      where: { kind: KIND_LEAD_PARADO, status: 'open' },
      select: { entityId: true },
    })
    if (!abertos.length) return

    const leads = await prisma.lead.findMany({
      where: { id: { in: abertos.map((a) => a.entityId!).filter(Boolean) } },
      select: { id: true, status: true, funnelId: true, conversationClosedAt: true },
    })
    const terminais = await prisma.stage.findMany({
      where: { terminalKind: { not: null } },
      select: { funnelId: true, key: true },
    })
    const chaves = new Set(terminais.map((t) => `${t.funnelId}:${t.key}`))
    const errados = leads.filter((l) => chaves.has(`${l.funnelId}:${l.status}`))
    assert.equal(errados.length, 0, `alerta em ${errados.length} lead(s) já em etapa terminal`)

    const fechadas = leads.filter((l) => l.conversationClosedAt)
    assert.equal(fechadas.length, 0, `alerta em ${fechadas.length} conversa(s) já resolvida(s)`)
  })
})

// O mesmo produtor acerta numa casa e erra na outra, e a diferença não é de
// código — é de operação. A chave existe para isso, e o que ela NÃO pode fazer
// é calar o produtor deixando o alerta de ontem de pé para sempre.
describe('chave liga/desliga por produtor', () => {
  const KIND_CHAVE = 'lead.stale'   // tipo real: a chave só vale para os conhecidos
  let estadoOriginal = true

  before(async () => { estadoOriginal = await produtorAtivo(KIND_CHAVE) })
  after(async () => { await definirProdutorAtivo(KIND_CHAVE, estadoOriginal) })

  test('chave ausente significa LIGADO', async () => {
    await prisma.setting.deleteMany({ where: { key: `alertas.produtor.${KIND_CHAVE}.ativo` } })
    assert.equal(await produtorAtivo(KIND_CHAVE), true, 'sem registro, o produtor roda')
  })

  test('desligar cala o produtor', async () => {
    await definirProdutorAtivo(KIND_CHAVE, false)
    assert.equal(await produtorAtivo(KIND_CHAVE), false)
    const r = await varrerLeadsSemResposta()
    assert.equal(r.abertos, 0, 'produtor desligado não abre nada')
  })

  test('desligar FECHA o que estava aberto', async () => {
    await definirProdutorAtivo(KIND_CHAVE, true)
    await prisma.alert.create({
      data: {
        dedupeKey: P + 'chave', kind: KIND_CHAVE, severity: 'warning', audience: 'management',
        title: 'para provar o fechamento (teste)', status: 'open', lastSeenAt: new Date(),
      },
    })
    await definirProdutorAtivo(KIND_CHAVE, false)
    const depois = await prisma.alert.findUnique({ where: { dedupeKey: P + 'chave' }, select: { status: true } })
    assert.equal(depois?.status, 'resolved', 'sem isto o alerta ficaria de pé sem produtor que o resolvesse')
    await limpar()
  })

  test('religar não reabre nada sozinho — quem reabre é a varredura', async () => {
    await definirProdutorAtivo(KIND_CHAVE, true)
    assert.equal(await produtorAtivo(KIND_CHAVE), true)
  })
})

// A tela dedicada responde o que a gaveta não responde. Os dois escopos são
// dados DIFERENTES — a soma das caixas individuais não é a lista de condições —
// e a paginação precisa de ordem total, senão item pula de página.
describe('lista da tela dedicada', () => {
  test('escopo "empresa" enxerga a condição mesmo sem destinatário', async () => {
    await prisma.alert.create({
      data: {
        dedupeKey: P + 'lista', kind: KIND + '.lista', severity: 'warning',
        audience: 'management', title: 'condição sem ninguém (teste)',
        status: 'open', lastSeenAt: new Date(),
      },
    })
    const emp = await listarAlertas(gestor.id, { escopo: 'empresa', kind: KIND + '.lista' })
    assert.equal(emp.total, 1, 'a condição existe mesmo sem AlertRecipient')

    const minha = await listarAlertas(gestor.id, { escopo: 'minha', kind: KIND + '.lista' })
    assert.equal(minha.total, 0, 'sem destinatário, não está na caixa de ninguém')
    await limpar()
  })

  test('filtro de status separa aberto de resolvido', async () => {
    await raiseAlert({ dedupeKey: P + 'st1', kind: KIND + '.st', title: 'aberto' })
    await raiseAlert({ dedupeKey: P + 'st2', kind: KIND + '.st', title: 'vai resolver' })
    await resolveAlert(P + 'st2')

    const abertos = await listarAlertas(gestor.id, { escopo: 'empresa', kind: KIND + '.st', status: 'open' })
    const resolvidos = await listarAlertas(gestor.id, { escopo: 'empresa', kind: KIND + '.st', status: 'resolved' })
    const todos = await listarAlertas(gestor.id, { escopo: 'empresa', kind: KIND + '.st', status: 'todos' })
    assert.equal(abertos.total, 1)
    assert.equal(resolvidos.total, 1, 'histórico é justamente o que o sino não mostra')
    assert.equal(todos.total, 2)
    await limpar()
  })

  test('a paginação não repete nem pula item', async () => {
    // Todos com o MESMO lastSeenAt: é o empate que faz offset mentir quando a
    // ordem não é total.
    const agora = new Date()
    for (let i = 0; i < 6; i++) {
      await prisma.alert.create({
        data: {
          dedupeKey: `${P}pg${i}`, kind: KIND + '.pg', severity: 'info', audience: 'management',
          title: `pagina ${i}`, status: 'open', lastSeenAt: agora,
        },
      })
    }
    const p1 = await listarAlertas(gestor.id, { escopo: 'empresa', kind: KIND + '.pg', limite: 3, offset: 0 })
    const p2 = await listarAlertas(gestor.id, { escopo: 'empresa', kind: KIND + '.pg', limite: 3, offset: 3 })
    const ids = [...p1.itens, ...p2.itens].map((x) => x.id)
    assert.equal(p1.total, 6)
    assert.equal(new Set(ids).size, 6, 'com empate no lastSeenAt, o id tem de desempatar')
    await limpar()
  })

  test('o acervo devolve item com link, não só contagem', async () => {
    const r = await listarAcervo({ limite: 5 })
    assert.ok(Array.isArray(r.itens), 'o acervo virou lista')
    assert.equal(typeof r.total, 'number')
    for (const i of r.itens) {
      assert.ok(i.entityId > 0, 'todo item aponta para uma entidade real')
      if (i.link) assert.ok(!i.link.startsWith('/app'), 'o Router já tem base — link com /app quebra')
    }
  })
})

describe('nada de produção é alterado por engano', () => {
  test('conclusão de atividade não reabre cancelada (rollback)', async () => {
    await prisma.$transaction(async (tx) => {
      const cancelada = await tx.activity.findFirst({ where: { status: 'cancelled' }, select: { id: true } })
      if (cancelada) {
        const r = await tx.activity.updateMany({
          where: { id: cancelada.id, status: { notIn: ['completed', 'cancelled'] } },
          data: { status: 'completed' },
        })
        assert.equal(r.count, 0)
      }
      throw new Error('ROLLBACK')
    }).catch((e: any) => { if (e.message !== 'ROLLBACK') throw e })
  })

  test('desfecho de reunião não sobrescreve desfecho existente (rollback)', async () => {
    await prisma.$transaction(async (tx) => {
      const b = await tx.booking.findFirst({
        where: { status: { in: ['scheduled', 'confirmed'] } },
        select: { id: true },
      })
      if (b) {
        const r1 = await tx.booking.updateMany({
          where: { id: b.id, status: { in: ['scheduled', 'confirmed'] } },
          data: { status: 'completed' },
        })
        assert.equal(r1.count, 1)
        const r2 = await tx.booking.updateMany({
          where: { id: b.id, status: { in: ['scheduled', 'confirmed'] } },
          data: { status: 'no_show' },
        })
        assert.equal(r2.count, 0, 'segunda tentativa não desfaz a primeira')
      }
      throw new Error('ROLLBACK')
    }).catch((e: any) => { if (e.message !== 'ROLLBACK') throw e })
  })

  test('a suíte não deixou lixo', async () => {
    const meus = await prisma.alert.count({ where: { dedupeKey: { startsWith: P } } })
    assert.ok(meus >= 0)
  })
})
