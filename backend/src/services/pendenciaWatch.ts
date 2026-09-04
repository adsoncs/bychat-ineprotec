// src/services/pendenciaWatch.ts
//
// O trabalho que parou e ninguém viu.
//
// Três condições que o sistema já sabia e guardava para si:
//   - atividade atrasada: `routes/activities.ts` marca `status:'overdue'` a cada
//     minuto e não conta a ninguém. Eram 18 no dia em que isto foi escrito.
//   - negociação parada: 10 propostas em `enviada`/`em_negociacao`, três delas
//     sem um único movimento por 31 dias.
//   - linha de WhatsApp caída: o `evolutionMonitor` detecta e até conserta, mas
//     nunca disse nada a ninguém.
//
// Todos com JANELA DE CORTE. O passivo antigo não vira alerta: 18 atividades e
// 10 negociações despejadas de uma vez transformariam o sino em ruído no
// primeiro dia, e alerta que virou ruído não volta a ser lido. O que está velho
// precisa de decisão humana, não de notificação.
//
// Os limiares moram em Setting desde já, mesmo sem tela: ajustar quantos dias
// contam como "parada" não deveria exigir deploy.

import { prisma } from '../lib/prisma.js'
import { raiseAlert, resolverAusentes } from './alertService.js'

export const KIND_ATIVIDADE = 'activity.overdue'
export const KIND_NEGOCIACAO = 'negotiation.stalled'
export const KIND_CANAL = 'channel.down'
export const KIND_LEAD_PARADO = 'lead.stale'

/** Status de negociação que ainda estão em jogo. */
const EM_JOGO = ['enviada', 'em_negociacao'] as const

/** O status como se diz em voz alta — nunca a chave crua no texto do alerta. */
const STATUS_LEGIVEL: Record<string, string> = {
  enviada: 'enviada e sem resposta',
  em_negociacao: 'em negociação',
}

async function setting(key: string, padrao: number): Promise<number> {
  const row = await prisma.setting.findUnique({ where: { key } }).catch(() => null)
  const n = Number(String(row?.value ?? '').replace(/"/g, ''))
  return Number.isFinite(n) && n > 0 ? n : padrao
}

/**
 * Atividade que passou da hora.
 *
 * Vai para o dono (`owner`) porque é trabalho de alguém, com a gestão junto para
 * ver a fila. Severidade `warning`: é compromisso combinado que não aconteceu,
 * não é apenas informação.
 */
export async function varrerAtividadesAtrasadas(): Promise<{ abertos: number; fechados: number }> {
  const janelaDias = await setting('alertas.atividade_janela_dias', 7)
  const desde = new Date(Date.now() - janelaDias * 86400_000)

  const atrasadas = await prisma.activity.findMany({
    where: { status: 'overdue', scheduledAt: { gte: desde } },
    select: {
      id: true, title: true, type: true, scheduledAt: true, userId: true, leadId: true,
    },
    orderBy: { scheduledAt: 'asc' },
    take: 100,
  })

  const vivas: string[] = []
  if (atrasadas.length) {
    const nomes = new Map(
      (await prisma.lead.findMany({
        where: { id: { in: [...new Set(atrasadas.map((a) => a.leadId))] } },
        select: { id: true, nome: true },
      })).map((l) => [l.id, l.nome]),
    )
    for (const a of atrasadas) {
      const chave = `activity:overdue:${a.id}`
      vivas.push(chave)
      const quando = a.scheduledAt.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
      // O título traz QUEM, não o nome da atividade: o título dela costuma
      // começar com o próprio tipo ("Reunião: Reunião com…") e o prefixo daqui
      // produzia duplicação na cara de quem lê. O nome vai para o corpo.
      await raiseAlert({
        dedupeKey: chave, kind: KIND_ATIVIDADE, severity: 'warning', audience: 'owner',
        ownerUserId: a.userId,
        title: `Atividade atrasada: ${nomes.get(a.leadId) || 'lead sem nome'}`,
        body: `${a.title} — estava marcada para ${quando}. Ninguém registrou o que aconteceu.`,
        entityType: 'activity', entityId: a.id,
        // `leadId` no metadata não é enfeite: é o que permite ao sino montar o
        // caminho de volta (`/leads/{id}/activities`). Sem ele o alerta aponta o
        // problema e não leva a lugar nenhum — ver services/alertLinks.ts.
        metadata: { tipo: a.type, scheduledAt: a.scheduledAt.toISOString(), leadId: a.leadId },
      })
    }
  }
  const fechados = await resolverAusentes(KIND_ATIVIDADE, vivas)
  return { abertos: vivas.length, fechados }
}

/**
 * Negociação que parou de andar.
 *
 * `Negotiation` não tem campo de prazo nenhum — nem data prevista de fechamento
 * —, então o único sinal disponível é `updatedAt`: proposta que ninguém tocou.
 * Não é uma boa medida de "atrasada", mas é uma medida honesta de "esquecida",
 * que é o que 31 dias sem movimento significam.
 */
export async function varrerNegociacoesParadas(): Promise<{ abertos: number; fechados: number }> {
  const diasParada = await setting('alertas.negociacao_parada_dias', 7)
  const janelaDias = await setting('alertas.negociacao_janela_dias', 45)
  const agora = Date.now()

  const paradas = await prisma.negotiation.findMany({
    where: {
      status: { in: EM_JOGO as unknown as string[] },
      updatedAt: {
        lt: new Date(agora - diasParada * 86400_000),
        // Piso da janela: proposta esquecida há meses é passivo, não novidade.
        gte: new Date(agora - janelaDias * 86400_000),
      },
    },
    select: { id: true, titulo: true, status: true, updatedAt: true, valorFinal: true, leadId: true },
    orderBy: { updatedAt: 'asc' },
    take: 100,
  })

  const vivas: string[] = []
  if (paradas.length) {
    const leads = new Map(
      (await prisma.lead.findMany({
        where: { id: { in: [...new Set(paradas.map((n) => n.leadId))] } },
        select: { id: true, nome: true, assignedUserId: true },
      })).map((l) => [l.id, l]),
    )
    for (const n of paradas) {
      const lead = leads.get(n.leadId)
      const parada = Math.floor((agora - n.updatedAt.getTime()) / 86400_000)
      const chave = `negotiation:stalled:${n.id}`
      vivas.push(chave)
      const valor = n.valorFinal ? ` de R$ ${Number(n.valorFinal).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : ''
      // Sem o número de dias no TÍTULO: ele envelhece a cada volta do relógio, e
      // a idade já aparece na linha do sino, calculada do firstSeenAt. O status
      // vai traduzido — "em_negociacao" é nome de coluna, não português.
      await raiseAlert({
        dedupeKey: chave, kind: KIND_NEGOCIACAO, severity: 'warning', audience: 'owner',
        ownerUserId: lead?.assignedUserId ?? null,
        title: `Proposta parada: ${lead?.nome || n.titulo}`,
        body: `${n.titulo}${valor}, ${STATUS_LEGIVEL[n.status] || n.status} há ${parada} dias. Sem retomar, esfria.`,
        entityType: 'negotiation', entityId: n.id,
        metadata: { status: n.status, diasParada: parada, leadId: n.leadId },
      })
    }
  }
  const fechados = await resolverAusentes(KIND_NEGOCIACAO, vivas)
  return { abertos: vivas.length, fechados }
}

/**
 * Linha de WhatsApp fora do ar — e a própria Evolution.
 *
 * O `evolutionMonitor` já sabia de tudo: checa a cada intervalo, guarda o
 * resultado e às vezes até reconecta sozinho. O que faltava era contar. É o
 * alerta mais urgente do conjunto, porque linha caída é conversa que não entra
 * e cliente sem resposta.
 *
 * Lê o último resultado do monitor em vez de consultar a Evolution de novo:
 * duplicar a checagem gastaria chamada externa para chegar à mesma conclusão, e
 * o estado no banco não serve — no beyond a instância nem guarda status, quem
 * sabe é a API ao vivo.
 *
 * Vai para a gestão: reconectar linha não é trabalho de quem atende.
 */
export async function varrerCanaisCaidos(): Promise<{ abertos: number; fechados: number }> {
  const { getLastHealth } = await import('./evolutionMonitor.js')
  const health = getLastHealth()

  // Sem leitura do monitor ainda (servidor acabou de subir) não há o que
  // afirmar. Devolver "nada caído" aqui fecharia alertas legítimos por
  // ignorância — por isso a saída é sem tocar em nada.
  if (!health) return { abertos: 0, fechados: 0 }

  const vivas: string[] = []

  // A API inteira fora do ar: uma linha só, não uma por instância. Vinte avisos
  // dizendo a mesma coisa é o oposto de informar.
  if (health.api.status !== 'online') {
    const chave = 'channel:down:evolution_api'
    vivas.push(chave)
    await raiseAlert({
      dedupeKey: chave, kind: KIND_CANAL, severity: 'critical', audience: 'management',
      title: 'Evolution API fora do ar',
      body: `Nenhuma linha não-oficial envia ou recebe enquanto isto durar.${health.api.error ? ` Erro: ${health.api.error}` : ''}`,
      // Sem `entityType` este alerta — o mais grave do conjunto — não tinha
      // link nenhum: dizia que tudo parou e não levava a lugar nenhum.
      entityType: 'evolution', entityId: null,
      metadata: { url: health.api.url, status: health.api.status },
    })
  } else {
    // Com a API no ar, cada instância é avaliada por si.
    for (const i of health.instances) {
      if (!i.dbActive) continue                    // desligada de propósito
      if (i.connectionState === 'open') continue   // conectada
      const chave = `channel:down:${i.instanceName}`
      vivas.push(chave)
      await raiseAlert({
        dedupeKey: chave, kind: KIND_CANAL, severity: 'critical', audience: 'management',
        title: `Linha de WhatsApp fora do ar: ${i.name || i.instanceName}`,
        body: `Estado "${i.connectionState}"${i.phone ? ` — número ${i.phone}` : ''}. Mensagem não entra nem sai por esta linha.`,
        entityType: 'whatsapp_instance', entityId: null,
        metadata: { instancia: i.instanceName, estado: i.connectionState, erro: i.error },
      })
    }

    // Webhook errado é sutil e caro: a linha aparece conectada e as mensagens
    // simplesmente não chegam ao painel.
    if (health.webhook.status !== 'ok') {
      const chave = 'channel:webhook'
      vivas.push(chave)
      await raiseAlert({
        dedupeKey: chave, kind: KIND_CANAL, severity: 'critical', audience: 'management',
        title: 'Webhook da Evolution fora de lugar',
        body: `A linha pode parecer conectada e as mensagens não chegarem ao painel. Esperado: ${health.webhook.expected}; atual: ${health.webhook.current || '(vazio)'}.`,
        entityType: 'evolution', entityId: null,
        metadata: { status: health.webhook.status },
      })
    }
  }

  const fechados = await resolverAusentes(KIND_CANAL, vivas)
  return { abertos: vivas.length, fechados }
}

/**
 * Lead que parou de responder.
 *
 * O `leadStaleSweep` já enxerga estes leads desde 20/08: marca `_staleSignaledAt`
 * e emite `lead.stale` no barramento para um fluxo do painel decidir a etapa.
 * Só que **nada escuta esse evento no beyond** — 16 sinalizações emitidas, zero
 * consumidores — e a marca no lead faz o aviso sair UMA vez e nunca mais, que é
 * o oposto de um alerta: a condição segue de pé enquanto ninguém falar com a
 * pessoa.
 *
 * Por isso este produtor lê a condição de novo em vez de escutar o evento. E
 * fecha sozinho: no minuto em que alguém responde, `lastActivityAt` sobe, o lead
 * sai da janela e o `resolverAusentes` resolve a linha.
 *
 * Não move etapa nem manda mensagem — organizar o funil continua sendo do sweep;
 * aqui é só o aviso ao dono.
 */
export async function varrerLeadsSemResposta(): Promise<{ abertos: number; fechados: number }> {
  const diasParado = await setting('alertas.lead_parado_dias', 3)
  const janelaDias = await setting('alertas.lead_janela_dias', 10)
  const agora = Date.now()

  const parados = await prisma.lead.findMany({
    where: {
      lastActivityAt: {
        lt: new Date(agora - diasParado * 86400_000),
        // Piso da janela: dos 89 leads parados no dia em que isto foi escrito,
        // 80 estão fora dela. Despejar o acervo de uma vez é exatamente o que
        // transforma o sino em ruído no primeiro dia.
        gte: new Date(agora - janelaDias * 86400_000),
      },
      outcome: null,   // ciclo encerrado (ganho/perdido) não é pendência
      isGroup: false,  // grupo de WhatsApp não é pessoa
    },
    select: { id: true, nome: true, status: true, funnelId: true, lastActivityAt: true, assignedUserId: true },
    orderBy: { lastActivityAt: 'asc' },
    take: 100,
  })

  const vivas: string[] = []
  if (parados.length) {
    const ids = parados.map((l) => l.id)

    // Quem tem reunião marcada no futuro não está parado — está esperando o dia.
    // Mesmo critério do `leadStaleSweep`, para os dois não discordarem sobre o
    // mesmo lead.
    const comReuniao = new Set(
      (await prisma.booking.findMany({
        where: {
          leadId: { in: ids },
          status: { notIn: ['cancelled', 'no_show', 'rescheduled'] },
          startAt: { gt: new Date() },
        },
        select: { leadId: true },
      }).catch(() => [])).map((b) => b.leadId as number),
    )

    // Lead que já tem alerta aberto por outro motivo NÃO ganha um segundo.
    // Quatro dos nove leads desta janela estão em negociação e já aparecem como
    // "Proposta parada"; somar "Lead sem resposta" ao lado seria duas linhas
    // para a mesma pessoa e a mesma providência. O alerta mais específico
    // ganha, porque carrega valor e estágio da proposta.
    const jaAvisados = await leadsComAlertaAberto(ids)

    // A etapa vai pelo nome que aparece no funil: "CONTATADO" é chave de banco,
    // e chave crua no texto do alerta é o que `docs/alertas.md` proíbe.
    const nomeEtapa = new Map(
      (await prisma.stage.findMany({
        where: { funnelId: { in: [...new Set(parados.map((l) => l.funnelId).filter((f): f is number => f != null))] } },
        select: { funnelId: true, key: true, name: true },
      }).catch(() => [])).map((s) => [`${s.funnelId}:${s.key}`, s.name]),
    )

    for (const l of parados) {
      if (comReuniao.has(l.id)) continue
      if (jaAvisados.has(l.id)) continue
      const chave = `lead:stale:${l.id}`
      vivas.push(chave)
      const dias = Math.floor((agora - (l.lastActivityAt as Date).getTime()) / 86400_000)
      const etapa = nomeEtapa.get(`${l.funnelId}:${l.status}`) || l.status
      await raiseAlert({
        dedupeKey: chave, kind: KIND_LEAD_PARADO, severity: 'warning', audience: 'owner',
        ownerUserId: l.assignedUserId ?? null,
        title: `Lead sem resposta: ${l.nome || 'contato sem nome'}`,
        body: `Última interação há ${dias} dias, parado em "${etapa}". Retomar a conversa ou encerrar o ciclo?`,
        entityType: 'lead', entityId: l.id,
        metadata: { dias, etapa, leadId: l.id },
      })
    }
  }
  const fechados = await resolverAusentes(KIND_LEAD_PARADO, vivas)
  return { abertos: vivas.length, fechados }
}

/**
 * Quais destes leads já têm alerta aberto de atividade ou proposta.
 *
 * Resolve pela entidade em vez de filtrar `metadata.leadId` no JSON: o
 * `entityId` é coluna indexada e o caminho não depende de o produtor ter
 * lembrado de gravar o metadata.
 */
export async function leadsComAlertaAberto(ids: number[]): Promise<Set<number>> {
  const abertos = await prisma.alert.findMany({
    where: {
      status: 'open',
      kind: { in: [KIND_ATIVIDADE, KIND_NEGOCIACAO] },
      entityId: { not: null },
    },
    select: { kind: true, entityId: true },
  })
  const ativIds = abertos.filter((a) => a.kind === KIND_ATIVIDADE).map((a) => a.entityId as number)
  const negIds = abertos.filter((a) => a.kind === KIND_NEGOCIACAO).map((a) => a.entityId as number)

  const alvo = new Set(ids)
  const saida = new Set<number>()
  if (ativIds.length) {
    for (const a of await prisma.activity.findMany({ where: { id: { in: ativIds } }, select: { leadId: true } })) {
      if (alvo.has(a.leadId)) saida.add(a.leadId)
    }
  }
  if (negIds.length) {
    for (const n of await prisma.negotiation.findMany({ where: { id: { in: negIds } }, select: { leadId: true } })) {
      if (alvo.has(n.leadId)) saida.add(n.leadId)
    }
  }
  return saida
}

// ── Vigilante ───────────────────────────────────────────────────────────────

let handle: ReturnType<typeof setInterval> | null = null
const INTERVALO_MS = 30 * 60 * 1000

export function startPendenciaWatch(): void {
  setTimeout(async () => {
    await rodar()
    handle = setInterval(rodar, INTERVALO_MS)
    console.log('[pendencias] vigia iniciado — a cada 30min')
  }, 150_000)
}

async function rodar(): Promise<void> {
  // Cada varredura é isolada: uma falhar não pode calar as outras.
  for (const [nome, fn] of [
    ['atividades', varrerAtividadesAtrasadas],
    ['negociações', varrerNegociacoesParadas],
    ['canais', varrerCanaisCaidos],
    ['leads parados', varrerLeadsSemResposta],
  ] as const) {
    try {
      const r = await fn()
      if (r.abertos || r.fechados) {
        console.log(`[pendencias] ${nome}: ${r.abertos} aberto(s), ${r.fechados} fechado(s)`)
      }
    } catch (e: any) {
      console.error(`[pendencias] ${nome} falhou:`, e?.message)
    }
  }
}

export function stopPendenciaWatch(): void {
  if (handle) { clearInterval(handle); handle = null }
}
