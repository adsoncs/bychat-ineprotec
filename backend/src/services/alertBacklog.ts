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
