// scripts/backfill-responder-assume.ts
//
// Recupera o que o "responder é assumir" não pegou.
//
// O recurso entrou em 01/09 dentro do `ticketMessageSender`, que é o caminho do
// PAINEL. A resposta digitada no aplicativo do celular entra por outro lugar (o
// webhook da Evolution) e nunca passava por lá: gravava a mensagem e parava.
// Resultado medido no kobogo em 03/09 — 181 conversas respondidas pelo celular
// desde 01/09, 123 delas paradas na caixa bruta, sem dono e sem conversa
// aberta, enquanto alguém conversava com a pessoa do outro lado.
//
// A correção no `routes/whatsapp.ts` vale daqui para frente. Este script é o
// para trás, e ele faz DUAS coisas diferentes, porque duas coisas diferentes
// aconteceram:
//
//   A) Respondido pelo PAINEL, sem dono. O `senderName` da mensagem guarda o
//      nome de quem escreveu, então dá para devolver o lead a essa pessoa — é
//      exatamente o que o recurso teria feito na hora.
//
//   B) Respondido pelo CELULAR, sem dono. A mensagem é anônima: o WhatsApp não
//      diz qual pessoa da equipe digitou, e nas linhas compartilhadas não há
//      como saber. Aqui NÃO se inventa dono — chutar faria meta e comissão
//      mentirem com cara de precisão. O que dá para registrar com verdade é que
//      houve atendimento: a conversa abre e sai da caixa bruta.
//
// ⚠️ `assignedUserId` é o responsável no FUNIL inteiro — carteira, metas,
// comissões. Por isso a janela padrão começa em 01/09, o dia em que o recurso
// entrou: o alvo é o que ELE teria feito e não fez. Alargar a janela para trás
// move lead antigo para a carteira de alguém e mexe em comissão fechada; dá
// para fazer com `--desde`, mas é decisão de gestão, não de manutenção.
//
// Uso:
//   npx tsx scripts/backfill-responder-assume.ts                  # simula
//   npx tsx scripts/backfill-responder-assume.ts --aplicar
//   npx tsx scripts/backfill-responder-assume.ts --desde 2026-08-01 --aplicar

import { prisma } from '../src/lib/prisma.js'
import { logEvent, EVENT_TYPES } from '../src/services/leadHistory.js'

const APLICAR = process.argv.includes('--aplicar')
const iDesde = process.argv.indexOf('--desde')
// 01/09/2026: o dia em que "responder é assumir" entrou (commit c6739fb).
const DESDE = new Date(iDesde > -1 ? process.argv[iDesde + 1]! : '2026-09-01T00:00:00Z')

/** Marca que o próprio sistema põe na resposta vinda do aplicativo. */
const CELULAR = 'Equipe (pelo celular)'

async function main() {
  if (Number.isNaN(DESDE.getTime())) {
    console.error('Data inválida em --desde (use AAAA-MM-DD)')
    process.exitCode = 1
    return
  }
  console.log(APLICAR ? 'APLICANDO' : 'SIMULAÇÃO — use --aplicar')
  console.log(`Janela: mensagens nossas desde ${DESDE.toISOString().slice(0, 10)}\n`)

  // Só quem NÃO tem dono. Quem já tem não muda de mãos aqui pela mesma razão do
  // recurso: um supervisor que respondeu uma vez não toma o lead do vendedor.
  const nossas = await prisma.message.findMany({
    where: { fromMe: true, timestamp: { gte: DESDE }, isInternal: false },
    select: { leadId: true, senderName: true, timestamp: true },
    orderBy: { timestamp: 'asc' },
  })
  if (!nossas.length) { console.log('Nenhuma mensagem nossa na janela.'); return }

  const leads = await prisma.lead.findMany({
    where: {
      id: { in: [...new Set(nossas.map((m) => m.leadId))] },
      assignedUserId: null,
      isGroup: false,
    },
    select: {
      id: true, nome: true,
      conversationOpenedAt: true, conversationClosedAt: true, conversationReopenedAt: true,
    },
  })
  const semDono = new Map(leads.map((l) => [l.id, l]))
  console.log(`leads sem responsável tocados na janela: ${semDono.size}`)

  // Índice de gente: o painel grava `user.name || user.email` em senderName, e
  // é só por aí que dá para voltar da string ao usuário.
  const users = await prisma.user.findMany({ select: { id: true, name: true, email: true, active: true } })
  const porNome = new Map<string, number[]>()
  for (const u of users) {
    for (const chave of [u.name, u.email]) {
      if (!chave) continue
      const k = chave.trim().toLowerCase()
      porNome.set(k, [...(porNome.get(k) ?? []), u.id])
    }
  }
  const ativo = new Map(users.map((u) => [u.id, u.active]))
  const nomeDe = new Map(users.map((u) => [u.id, u.name || u.email || `#${u.id}`]))

  // A ÚLTIMA mensagem de cada lead decide: quem falou por último é quem está
  // com o atendimento. Percorrer em ordem crescente e sobrescrever entrega
  // isso sem uma segunda consulta.
  const ultimaDe = new Map<number, string | null>()
  for (const m of nossas) if (semDono.has(m.leadId)) ultimaDe.set(m.leadId, m.senderName)

  const aAtribuir: Array<{ leadId: number; userId: number; nome: string }> = []
  const aAbrir: number[] = []
  const semCasar = new Map<string, number>()

  for (const [leadId, sender] of ultimaDe) {
    const lead = semDono.get(leadId)!
    // Conversa que alguém FECHOU não é reaberta aqui: o encerramento foi uma
    // decisão, e desfazê-la em lote seria pior que o problema original.
    const naCaixaBruta = !lead.conversationOpenedAt && !lead.conversationClosedAt && !lead.conversationReopenedAt

    const s = (sender || '').trim()
    if (!s || s === CELULAR) {
      if (naCaixaBruta) aAbrir.push(leadId)         // (B) atendimento sem dono
      continue
    }
    const casou = porNome.get(s.toLowerCase()) ?? []
    // Nome ambíguo (dois usuários com o mesmo nome) não atribui: errar o dono é
    // pior que deixar sem, porque mexe em carteira e comissão.
    const validos = casou.filter((id) => ativo.get(id) !== false)
    if (validos.length === 1) {
      aAtribuir.push({ leadId, userId: validos[0]!, nome: nomeDe.get(validos[0]!)! })   // (A)
    } else {
      semCasar.set(s, (semCasar.get(s) ?? 0) + 1)
      if (naCaixaBruta) aAbrir.push(leadId)
    }
  }

  console.log(`\n(A) dono recuperável pelo painel : ${aAtribuir.length}`)
  console.log(`(B) atendimento sem dono (celular): ${aAbrir.length}`)
  if (semCasar.size) {
    console.log('\nremetentes que não casaram com nenhum usuário ativo:')
    for (const [k, v] of [...semCasar].sort((a, b) => b[1] - a[1]).slice(0, 8)) console.log(`  ${String(v).padStart(4)}  ${k}`)
  }

  if (aAtribuir.length) {
    const porDono = new Map<string, number>()
    for (const a of aAtribuir) porDono.set(a.nome, (porDono.get(a.nome) ?? 0) + 1)
    console.log('\n(A) para quem os leads voltam:')
    for (const [k, v] of [...porDono].sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(4)}  ${k}`)
  }

  if (!APLICAR) {
    console.log('\nNada foi gravado. Use --aplicar.')
    return
  }

  // (A) — grava dono. `assignedUserId: null` no WHERE mantém a mesma garantia
  // do recurso ao vivo: se alguém assumiu entre a leitura e a escrita, o script
  // não passa por cima.
  let atribuidos = 0
  for (const a of aAtribuir) {
    const r = await prisma.lead.updateMany({
      where: { id: a.leadId, assignedUserId: null },
      data: { assignedUserId: a.userId, assignedAt: new Date() },
    })
    if (!r.count) continue
    atribuidos++
    // `logEvent` é síncrono e engole os próprios erros — não é promessa.
    logEvent({
      leadId: a.leadId,
      type: EVENT_TYPES.OPERATOR_ASSIGNED,
      category: 'lifecycle',
      title: `Assumido por ${a.nome} ao responder`,
      source: 'panel',
      actorType: 'operator',
      userId: a.userId,
      userName: a.nome,
      description: 'Recuperado: a resposta é anterior ao registro automático do responsável.',
    })
  }

  // (B) — abre a conversa, sem dono.
  const { ensureConversationOpen } = await import('../src/services/leadConversation.js')
  let abertos = 0
  for (const leadId of aAbrir) {
    const r = await ensureConversationOpen(leadId, { reason: 'outbound' }).catch(() => null)
    if (r?.opened || r?.reopened) abertos++
  }

  console.log(`\n(A) ${atribuidos} lead(s) com responsável gravado`)
  console.log(`(B) ${abertos} conversa(s) aberta(s) sem dono — atendimento registrado`)
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1 })
  .finally(() => prisma.$disconnect())
