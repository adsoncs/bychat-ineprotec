// src/services/alertBacklog.ts
//
// O que ficou de fora do sino de propósito.
//
// Toda janela de corte cria um ponto cego. Ela existe por um bom motivo — o
// passivo antigo despejado de uma vez transforma o sino em ruído no primeiro
// dia, e alerta que virou ruído não volta a ser lido —, mas o efeito colateral
// é que dezenas de itens deixaram de existir para quem só olha a caixa.
//
// Não são a mesma coisa e não deveriam ficar no mesmo lugar:
//
//   SINO   — o que mudou e pede ação agora. Chega sozinho, some sozinho.
//   ACERVO — o que está pendente há tempo demais para virar novidade. Precisa
//            de uma decisão humana, uma vez: reconstruir ou aceitar sem dado.
//
// Por isso isto é uma consulta, não um produtor de alerta. Ninguém é
// interrompido por causa do acervo; ele fica disponível para quem for decidir.

import { prisma } from '../lib/prisma.js'

export interface ItemDoAcervo {
  tipo: string
  rotulo: string
  quantidade: number
  /** O mais antigo, em dias — é o que dimensiona a decisão. */
  maisAntigoDias: number | null
  /** Por que não virou alerta. */
  motivo: string
}

function diasDesde(d: Date | null | undefined): number | null {
  if (!d) return null
  return Math.floor((Date.now() - d.getTime()) / 86400_000)
}

/**
 * O que existe, está pendente, e o sino não mostra.
 *
 * As janelas são lidas dos mesmos Settings que os produtores usam: se alguém
 * afrouxar um limiar, o acervo encolhe sozinho e a conta continua batendo.
 */
export async function acervo(): Promise<ItemDoAcervo[]> {
  const agora = Date.now()
  const setting = async (key: string, padrao: number) => {
    const row = await prisma.setting.findUnique({ where: { key } }).catch(() => null)
    const n = Number(String(row?.value ?? '').replace(/"/g, ''))
    return Number.isFinite(n) && n > 0 ? n : padrao
  }

  const janelaAtividade = await setting('alertas.atividade_janela_dias', 7)
  const janelaNegociacao = await setting('alertas.negociacao_janela_dias', 45)
  const janelaLead = await setting('alertas.lead_janela_dias', 10)
  const saida: ItemDoAcervo[] = []

  // ── Atividades atrasadas antigas ──
  const cortAtiv = new Date(agora - janelaAtividade * 86400_000)
  const ativs = await prisma.activity.findMany({
    where: { status: 'overdue', scheduledAt: { lt: cortAtiv } },
    select: { scheduledAt: true },
    orderBy: { scheduledAt: 'asc' },
  })
  if (ativs.length) {
    saida.push({
      tipo: 'activity.overdue',
      rotulo: 'Atividades atrasadas',
      quantidade: ativs.length,
      maisAntigoDias: diasDesde(ativs[0]!.scheduledAt),
      motivo: `venceram há mais de ${janelaAtividade} dias`,
    })
  }

  // ── Reuniões sem desfecho antigas ──
  const cortReuniao = new Date(agora - 7 * 86400_000)
  const reunioes = await prisma.booking.findMany({
    where: { status: { in: ['scheduled', 'confirmed'] }, endAt: { lt: cortReuniao } },
    select: { startAt: true },
    orderBy: { startAt: 'asc' },
  })
  if (reunioes.length) {
    saida.push({
      tipo: 'meeting.no_outcome',
      rotulo: 'Reuniões sem desfecho',
      quantidade: reunioes.length,
      maisAntigoDias: diasDesde(reunioes[0]!.startAt),
      motivo: 'aconteceram há mais de 7 dias',
    })
  }

  // ── Propostas paradas há tempo demais ──
  const cortNeg = new Date(agora - janelaNegociacao * 86400_000)
  const negs = await prisma.negotiation.findMany({
    where: { status: { in: ['enviada', 'em_negociacao'] }, updatedAt: { lt: cortNeg } },
    select: { updatedAt: true },
    orderBy: { updatedAt: 'asc' },
  })
  if (negs.length) {
    saida.push({
      tipo: 'negotiation.stalled',
      rotulo: 'Propostas paradas',
      quantidade: negs.length,
      maisAntigoDias: diasDesde(negs[0]!.updatedAt),
      motivo: `sem movimento há mais de ${janelaNegociacao} dias`,
    })
  }

  // ── Gravações que falharam há mais de 48h ──
  const cortBot = new Date(agora - 48 * 3600_000)
  const bots = await prisma.meetingRecording.findMany({
    where: { status: 'failed', createdAt: { lt: cortBot } },
    select: { createdAt: true },
    orderBy: { createdAt: 'asc' },
  })
  if (bots.length) {
    saida.push({
      tipo: 'meeting.bot_failed',
      rotulo: 'Gravações que falharam',
      quantidade: bots.length,
      maisAntigoDias: diasDesde(bots[0]!.createdAt),
      motivo: 'falharam há mais de 48h',
    })
  }

  // ── Leads parados há tempo demais ──
  const cortLead = new Date(agora - janelaLead * 86400_000)
  const leads = await prisma.lead.findMany({
    where: { lastActivityAt: { not: null, lt: cortLead }, outcome: null, isGroup: false },
    select: { lastActivityAt: true },
    orderBy: { lastActivityAt: 'asc' },
  })
  if (leads.length) {
    saida.push({
      tipo: 'lead.stale',
      rotulo: 'Leads sem resposta',
      quantidade: leads.length,
      maisAntigoDias: diasDesde(leads[0]!.lastActivityAt),
      motivo: `sem interação há mais de ${janelaLead} dias`,
    })
  }

  return saida.sort((a, b) => b.quantidade - a.quantidade)
}

/** Total do acervo — o número que o rodapé do sino mostra. */
export async function totalDoAcervo(): Promise<number> {
  return (await acervo()).reduce((s, i) => s + i.quantidade, 0)
}

// ── O acervo como LISTA ─────────────────────────────────────────────────────
//
// Até aqui o acervo era só um total no rodapé do sino, e era assim de propósito:
// não havia tela onde listá-lo, e contador sem lista pelo menos não finge que
// dá para agir. Com a tela dedicada isso muda — 442 itens que ninguém abre são
// um número morto; 442 itens com filtro e paginação são uma fila que o time
// trabalha aos poucos.
//
// Sem ação em lote, de propósito: alerta se resolve porque a condição acabou,
// não porque alguém marcou. Fechar centenas de uma vez seria varrer para
// debaixo do tapete com aparência de produtividade.

export interface LinhaDoAcervo {
  tipo: string
  rotulo: string
  /** Id da entidade (lead, atividade, reserva…) — acervo não tem alerta. */
  entityId: number
  entityType: string
  titulo: string
  detalhe: string | null
  dias: number | null
  link: string | null
  dono: string | null
}

export async function listarAcervo(opts: {
  tipo?: string
  limite?: number
  offset?: number
} = {}): Promise<{ itens: LinhaDoAcervo[]; total: number; limite: number; offset: number }> {
  const limite = Math.min(200, Math.max(1, opts.limite ?? 50))
  const offset = Math.max(0, opts.offset ?? 0)
  const agora = Date.now()
  const setting = async (key: string, padrao: number) => {
    const row = await prisma.setting.findUnique({ where: { key } }).catch(() => null)
    const n = Number(String(row?.value ?? '').replace(/"/g, ''))
    return Number.isFinite(n) && n > 0 ? n : padrao
  }

  // Booking, Negotiation e MeetingRecording guardam só a CHAVE do dono, sem
  // relação declarada no schema. Um mapa de gente resolvido uma vez evita N
  // consultas e mantém o nome consistente entre os tipos.
  const users = await prisma.user.findMany({ select: { id: true, name: true, email: true } })
  const nomeUser = new Map(users.map((u) => [u.id, u.name || u.email || `#${u.id}`]))

  const itens: LinhaDoAcervo[] = []
  const quer = (t: string) => !opts.tipo || opts.tipo === t

  if (quer('activity.overdue')) {
    const janela = await setting('alertas.atividade_janela_dias', 7)
    const rows = await prisma.activity.findMany({
      where: { status: 'overdue', scheduledAt: { lt: new Date(agora - janela * 86400_000) } },
      select: {
        id: true, title: true, scheduledAt: true, leadId: true, assignedUserId: true,
        lead: { select: { nome: true } },
      },
      orderBy: { scheduledAt: 'asc' },
    })
    for (const a of rows) {
      itens.push({
        tipo: 'activity.overdue', rotulo: 'Atividades atrasadas',
        entityId: a.id, entityType: 'activity',
        titulo: a.title || 'Atividade sem título',
        detalhe: a.lead?.nome ? `Lead: ${a.lead.nome}` : null,
        dias: diasDesde(a.scheduledAt),
        link: a.leadId ? `/leads/${a.leadId}/activities` : null,
        dono: a.assignedUserId ? nomeUser.get(a.assignedUserId) ?? null : null,
      })
    }
  }

  if (quer('meeting.no_outcome')) {
    const rows = await prisma.booking.findMany({
      where: { status: { in: ['scheduled', 'confirmed'] }, endAt: { lt: new Date(agora - 7 * 86400_000) } },
      select: { id: true, startAt: true, leadId: true, operatorUserId: true, lead: { select: { nome: true } } },
      orderBy: { startAt: 'asc' },
    })
    for (const b of rows) {
      itens.push({
        tipo: 'meeting.no_outcome', rotulo: 'Reuniões sem desfecho',
        entityId: b.id, entityType: 'booking',
        titulo: b.lead?.nome ? `Reunião com ${b.lead.nome}` : `Reunião #${b.id}`,
        detalhe: b.startAt ? b.startAt.toISOString().slice(0, 10) : null,
        dias: diasDesde(b.startAt),
        link: '/scheduling',
        dono: b.operatorUserId ? nomeUser.get(b.operatorUserId) ?? null : null,
      })
    }
  }

  if (quer('negotiation.stalled')) {
    const janela = await setting('alertas.negociacao_janela_dias', 45)
    const rows = await prisma.negotiation.findMany({
      where: { status: { in: ['enviada', 'em_negociacao'] }, updatedAt: { lt: new Date(agora - janela * 86400_000) } },
      select: { id: true, titulo: true, updatedAt: true, leadId: true, responsavelUserId: true },
      orderBy: { updatedAt: 'asc' },
    })
    const nomesLead = new Map(
      (rows.length
        ? await prisma.lead.findMany({
            where: { id: { in: rows.map((n) => n.leadId) } },
            select: { id: true, nome: true },
          })
        : []
      ).map((l) => [l.id, l.nome]),
    )
    for (const n of rows) {
      itens.push({
        tipo: 'negotiation.stalled', rotulo: 'Propostas paradas',
        entityId: n.id, entityType: 'negotiation',
        titulo: n.titulo || `Proposta #${n.id}`,
        detalhe: nomesLead.get(n.leadId) ?? null,
        dias: diasDesde(n.updatedAt),
        link: `/leads/${n.leadId}/negociacao`,
        dono: n.responsavelUserId ? nomeUser.get(n.responsavelUserId) ?? null : null,
      })
    }
  }

  if (quer('lead.stale')) {
    const janela = await setting('alertas.lead_janela_dias', 10)
    // MESMOS filtros do produtor, menos a janela. Sem isto o acervo contaria
    // conversa resolvida e lead que sumiu — os falsos positivos que o produtor
    // deixou de abrir seguiriam sendo cobrados aqui, só com outro nome.
    const rows = await prisma.lead.findMany({
      where: {
        lastActivityAt: { not: null, lt: new Date(agora - janela * 86400_000) },
        outcome: null, isGroup: false, conversationClosedAt: null,
      },
      select: { id: true, nome: true, status: true, funnelId: true, lastActivityAt: true, assignedUserId: true },
      orderBy: { lastActivityAt: 'asc' },
      // Teto alto porque o acervo é justamente o passivo grande; sem ele a
      // consulta de mensagens abaixo cresce sem limite.
      take: 2000,
    })
    const ids = rows.map((l) => l.id)
    const ultimaNossa = new Set(
      (ids.length
        ? await prisma.message.findMany({
            where: { leadId: { in: ids } },
            orderBy: { timestamp: 'desc' },
            distinct: ['leadId'],
            select: { leadId: true, fromMe: true },
          }).catch(() => [])
        : []
      ).filter((m) => m.fromMe !== false).map((m) => m.leadId as number),
    )
    const terminais = new Set(
      (await prisma.stage.findMany({
        where: { terminalKind: { not: null } },
        select: { funnelId: true, key: true },
      }).catch(() => [])).map((s) => `${s.funnelId}:${s.key}`),
    )
    for (const l of rows) {
      if (ultimaNossa.has(l.id)) continue
      if (terminais.has(`${l.funnelId}:${l.status}`)) continue
      itens.push({
        tipo: 'lead.stale', rotulo: 'Leads sem resposta',
        entityId: l.id, entityType: 'lead',
        titulo: l.nome || 'Contato sem nome',
        detalhe: null,
        dias: diasDesde(l.lastActivityAt),
        // Mesmo destino do alerta vivo (ver alertLinks.ts): o item é "escreveu
        // e não teve resposta", e responder só acontece em Conversas.
        link: `/conversations?leadId=${l.id}`,
        dono: l.assignedUserId ? nomeUser.get(l.assignedUserId) ?? null : null,
      })
    }
  }

  if (quer('meeting.bot_failed')) {
    const rows = await prisma.meetingRecording.findMany({
      where: { status: 'failed', createdAt: { lt: new Date(agora - 48 * 3600_000) } },
      select: { id: true, title: true, createdAt: true, userId: true, userName: true },
      orderBy: { createdAt: 'asc' },
    })
    for (const r of rows) {
      itens.push({
        tipo: 'meeting.bot_failed', rotulo: 'Gravações que falharam',
        entityId: r.id, entityType: 'meeting_recording',
        titulo: r.title || `Gravação #${r.id}`,
        detalhe: null,
        dias: diasDesde(r.createdAt),
        link: '/meetings',
        dono: r.userName || (r.userId ? nomeUser.get(r.userId) ?? null : null),
      })
    }
  }

  // Mais antigo primeiro: é o que dimensiona a decisão. `entityId` desempata
  // para a ordem ser TOTAL — empate com offset faz item pular de página.
  itens.sort((a, b) => (b.dias ?? 0) - (a.dias ?? 0) || b.entityId - a.entityId)
  return { itens: itens.slice(offset, offset + limite), total: itens.length, limite, offset }
}
