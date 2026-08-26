// src/services/commissions.ts
// Motor de Metas e Comissões.
//
// A comissão nunca é digitada: ela é DERIVADA da negociação ganha. Daí vêm a base
// (pagamento único e mensalidade, já separados pelo módulo Negociações), o funil
// (do lead) e o agente (o responsável no fechamento). O lançamento guarda só a
// fotografia da taxa aplicada — o valor da venda continua morando num lugar só.
//
// Consequência disso, e é de propósito: mudar uma regra não reescreve sozinha a
// comissão de um mês passado. Quem quer isso pede o recálculo do período.

import { prisma } from '../lib/prisma.js'

// ── Indicadores ──────────────────────────────────────────────────────────────

export type GoalMetric = 'revenue' | 'mrr' | 'count' | 'conversion'
export const GOAL_METRICS: GoalMetric[] = ['revenue', 'mrr', 'count', 'conversion']

export const METRIC_LABEL: Record<GoalMetric, string> = {
  revenue: 'Receita ganha',
  mrr: 'Nova mensalidade (MRR)',
  count: 'Negociações ganhas',
  conversion: 'Taxa de conversão',
}
/** Unidade de cada indicador — a tela e o CSV formatam por ela. */
export const METRIC_UNIT: Record<GoalMetric, 'currency' | 'count' | 'percent'> = {
  revenue: 'currency', mrr: 'currency', count: 'count', conversion: 'percent',
}

export function isMetric(v: unknown): v is GoalMetric {
  return GOAL_METRICS.includes(String(v) as GoalMetric)
}

export type RateType = 'percent' | 'valor' | 'none'
export function normRateType(v: unknown): RateType {
  const s = String(v ?? '').toLowerCase()
  return s === 'valor' ? 'valor' : s === 'none' ? 'none' : 'percent'
}

// ── Utilidades ───────────────────────────────────────────────────────────────

const dec = (v: unknown): number => {
  if (v === null || v === undefined) return 0
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : 0
}
const round2 = (n: number): number => Math.round(n * 100) / 100

/** 1º dia do mês (UTC) da data — é a competência pela qual o painel agrupa. */
export function competenciaOf(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1))
}
/** Intervalo fechado do mês de uma competência. */
export function monthRange(competencia: Date): { start: Date; end: Date } {
  const start = new Date(Date.UTC(competencia.getUTCFullYear(), competencia.getUTCMonth(), 1, 0, 0, 0, 0))
  const end = new Date(Date.UTC(competencia.getUTCFullYear(), competencia.getUTCMonth() + 1, 0, 23, 59, 59, 999))
  return { start, end }
}
/** "2026-08" → competência. Aceita também "2026-08-13". */
export function parseCompetencia(v: unknown): Date | null {
  const s = String(v ?? '').trim()
  const m = /^(\d{4})-(\d{2})/.exec(s)
  if (!m) return null
  const mes = Number(m[2])
  if (mes < 1 || mes > 12) return null
  return new Date(Date.UTC(Number(m[1]), mes - 1, 1))
}

// ── Regra aplicável ──────────────────────────────────────────────────────────

export interface ResolvedRule {
  id: number
  nome: string
  funnelId: number | null
  base: string
  tipoUnico: RateType
  taxaUnico: number | null
  tipoRecorrente: RateType
  taxaRecorrente: number | null
  mesesRecorrente: number
  aceleradorAtivo: boolean
  aceleradorMetrica: GoalMetric | null
  tiers: { id: number; atingimentoMin: number; tipoUnico: RateType; taxaUnico: number | null; tipoRecorrente: RateType; taxaRecorrente: number | null }[]
}

/**
 * Qual regra vale para (agente, funil).
 *
 * Ganha a mais específica: agente+funil > agente > funil > geral. Sem isso o
 * gestor teria que cadastrar uma regra por vendedor mesmo quando o time inteiro
 * usa a mesma taxa — e a exceção de um vendedor não teria como existir.
 * `prioridade` desempata entre regras de mesma especificidade.
 */
export async function resolveRule(userId: number | null, funnelId: number | null): Promise<ResolvedRule | null> {
  const rules = await prisma.commissionRule.findMany({
    where: {
      active: true,
      OR: [{ funnelId: null }, ...(funnelId ? [{ funnelId }] : [])],
    },
    include: { tiers: { orderBy: { atingimentoMin: 'asc' } }, agents: { select: { userId: true } } },
  })

  const candidatas = rules
    .filter((r) => {
      if (!r.agents.length) return true
      return userId != null && r.agents.some((a) => a.userId === userId)
    })
    .map((r) => ({
      r,
      // Agente pesa mais que funil: "a taxa do João" é exceção deliberada e não
      // pode ser derrubada por uma regra genérica de funil.
      score: (r.agents.length ? 2 : 0) + (r.funnelId != null ? 1 : 0),
    }))
    .sort((a, b) => b.score - a.score || b.r.prioridade - a.r.prioridade || b.r.id - a.r.id)

  const chosen = candidatas[0]?.r
  if (!chosen) return null
  return {
    id: chosen.id,
    nome: chosen.nome,
    funnelId: chosen.funnelId,
    base: chosen.base,
    tipoUnico: normRateType(chosen.tipoUnico),
    taxaUnico: chosen.taxaUnico != null ? dec(chosen.taxaUnico) : null,
    tipoRecorrente: normRateType(chosen.tipoRecorrente),
    taxaRecorrente: chosen.taxaRecorrente != null ? dec(chosen.taxaRecorrente) : null,
    mesesRecorrente: Math.max(1, chosen.mesesRecorrente || 1),
    aceleradorAtivo: chosen.aceleradorAtivo,
    aceleradorMetrica: isMetric(chosen.aceleradorMetrica) ? chosen.aceleradorMetrica : null,
    tiers: chosen.tiers.map((t) => ({
      id: t.id,
      atingimentoMin: t.atingimentoMin,
      tipoUnico: normRateType(t.tipoUnico),
      taxaUnico: t.taxaUnico != null ? dec(t.taxaUnico) : null,
      tipoRecorrente: normRateType(t.tipoRecorrente),
      taxaRecorrente: t.taxaRecorrente != null ? dec(t.taxaRecorrente) : null,
    })),
  }
}

// ── Realizado do agente no período ───────────────────────────────────────────

export interface Realizado {
  revenue: number
  mrr: number
  count: number
  conversion: number | null
  wonCount: number
  lostCount: number
}

/**
 * O que o agente fechou no período. `funnelId` null = todos os funis.
 *
 * A negociação fechada congela o responsável no fechamento (o middleware do
 * Prisma só propaga a troca de dono para as EM ABERTO), então o realizado é
 * estável: reatribuir um lead depois não muda a comissão de quem vendeu.
 */
export async function realizadoDoAgente(
  userId: number | null,
  funnelId: number | null,
  start: Date,
  end: Date,
): Promise<Realizado> {
  const negs = await prisma.negotiation.findMany({
    where: {
      ...(userId != null ? { responsavelUserId: userId } : {}),
      resultado: { not: null },
      fechadaEm: { gte: start, lte: end },
    },
    select: { id: true, leadId: true, funnelId: true, resultado: true, valorFinal: true, valorRecorrente: true },
  })
  let rows = negs
  if (funnelId != null) {
    // O funil é o DA NEGOCIAÇÃO, não o do lead.
    //
    // Enquanto o lead cabia num funil só, os dois eram a mesma coisa. Com o
    // lead podendo estar em vários, derivar do lead erra dos dois lados: a
    // venda fechada num processo adicional não apareceria na meta dele, e
    // contá-la em todos os funis do lead pagaria a mesma comissão mais de uma
    // vez. Uma negociação pertence a um processo.
    //
    // Negociação antiga sem funil próprio (anterior à coluna, ou de lead que
    // nunca entrou em funil) continua caindo no funil do lead — é o que ela
    // sempre significou, e mudar isso reescreveria comissão já paga.
    const semFunilProprio = negs.filter((n) => n.funnelId == null).map((n) => n.leadId)
    const doLead = semFunilProprio.length
      ? new Set((await prisma.lead.findMany({
          where: { id: { in: Array.from(new Set(semFunilProprio)) }, funnelId },
          select: { id: true },
        })).map((l) => l.id))
      : new Set<number>()
    rows = negs.filter((n) => (n.funnelId != null ? n.funnelId === funnelId : doLead.has(n.leadId)))
  }
  const won = rows.filter((n) => n.resultado === 'won')
  const lost = rows.filter((n) => n.resultado === 'lost')
  const fechadas = won.length + lost.length
  return {
    revenue: round2(won.reduce((s, n) => s + dec(n.valorFinal), 0)),
    mrr: round2(won.reduce((s, n) => s + dec(n.valorRecorrente), 0)),
    count: won.length,
    // Sem nada fechado no período não existe taxa — 0% diria "ninguém converteu",
    // que é diferente de "não houve fechamento".
    conversion: fechadas > 0 ? round2((won.length / fechadas) * 100) : null,
    wonCount: won.length,
    lostCount: lost.length,
  }
}

/** Meta ativa que cobre o período. A do funil manda; sem ela, vale a do agente sem funil. */
export async function metaDoAgente(
  userId: number | null,
  funnelId: number | null,
  metric: GoalMetric,
  start: Date,
  end: Date,
): Promise<{ id: number; target: number; funnelId: number | null } | null> {
  const goals = await prisma.goal.findMany({
    where: {
      active: true,
      metric,
      userId: userId ?? null,
      periodStart: { lte: start },
      periodEnd: { gte: end },
      ...(funnelId != null ? { OR: [{ funnelId }, { funnelId: null }] } : { funnelId: null }),
    },
    orderBy: [{ funnelId: 'desc' }, { id: 'desc' }],
  })
  // `funnelId desc` põe a meta específica antes da genérica (null ordena por
  // último em DESC no MySQL).
  const g = goals.find((x) => x.funnelId != null) ?? goals[0]
  return g ? { id: g.id, target: dec(g.target), funnelId: g.funnelId } : null
}

// ── Cálculo ──────────────────────────────────────────────────────────────────

function applyRate(base: number, tipo: RateType, taxa: number | null, meses = 1): number {
  if (tipo === 'none' || taxa == null || base <= 0) return 0
  if (tipo === 'valor') return round2(taxa * meses)
  return round2(base * (taxa / 100) * meses)
}

export interface CommissionPreview {
  aplicavel: boolean
  motivo: string | null
  userId: number | null
  funnelId: number | null
  rule: ResolvedRule | null
  tierId: number | null
  tierLabel: string | null
  atingimento: number | null
  metaAlvo: number | null
  realizadoMetrica: number | null
  baseUnico: number
  baseRecorrente: number
  tipoUnico: RateType
  taxaUnico: number | null
  tipoRecorrente: RateType
  taxaRecorrente: number | null
  mesesRecorrente: number
  valorUnico: number
  valorRecorrente: number
  valorTotal: number
}

const semComissao = (motivo: string, extra: Partial<CommissionPreview> = {}): CommissionPreview => ({
  aplicavel: false, motivo, userId: null, funnelId: null, rule: null, tierId: null, tierLabel: null,
  atingimento: null, metaAlvo: null, realizadoMetrica: null,
  baseUnico: 0, baseRecorrente: 0, tipoUnico: 'none', taxaUnico: null,
  tipoRecorrente: 'none', taxaRecorrente: null, mesesRecorrente: 1,
  valorUnico: 0, valorRecorrente: 0, valorTotal: 0, ...extra,
})

/**
 * Quanto esta negociação paga de comissão.
 *
 * Serve tanto para o lançamento (quando ela é ganha) quanto para a estimativa que
 * o editor da proposta mostra ANTES de fechar — é o mesmo cálculo, para o número
 * exibido ao vendedor ser o mesmo que vai ser lançado.
 */
export async function previewNegotiation(
  negotiationId: number,
  opts: { hipotetica?: boolean } = {},
): Promise<CommissionPreview> {
  const neg = await prisma.negotiation.findUnique({
    where: { id: negotiationId },
    select: {
      id: true, leadId: true, funnelId: true, resultado: true, fechadaEm: true, responsavelUserId: true,
      valorUnico: true, valorRecorrente: true, valorFinal: true,
    },
  })
  if (!neg) return semComissao('Negociação não encontrada')
  if (!opts.hipotetica && neg.resultado !== 'won') return semComissao('A negociação ainda não foi ganha')

  const lead = await prisma.lead.findUnique({ where: { id: neg.leadId }, select: { funnelId: true, assignedUserId: true } })
  // O funil desta venda: o dela, e só na falta dele o do lead (negociação
  // anterior à coluna). É por ele que a regra de comissão é escolhida.
  const funnelId = neg.funnelId ?? lead?.funnelId ?? null
  // Fechada congela o responsável; em aberto vale o dono atual do lead.
  const userId = neg.responsavelUserId ?? lead?.assignedUserId ?? null
  if (userId == null) return semComissao('Negociação sem responsável — defina o dono do lead', { funnelId })

  const rule = await resolveRule(userId, funnelId)
  if (!rule) return semComissao('Nenhuma regra de comissão atende este agente/funil', { userId, funnelId })

  // Base bruta = valor de tabela dos itens (antes do desconto). Vale para quem
  // paga comissão sobre o preço cheio e desconta o desconto de outro jeito.
  let baseUnico = dec(neg.valorUnico)
  let baseRecorrente = dec(neg.valorRecorrente)
  if (rule.base === 'bruto') {
    const itens = await prisma.negotiationItem.findMany({
      where: { negotiationId: neg.id },
      select: { subtotal: true, cobranca: true },
    })
    baseUnico = round2(itens.filter((i) => i.cobranca !== 'recorrente').reduce((s, i) => s + dec(i.subtotal), 0))
    baseRecorrente = round2(itens.filter((i) => i.cobranca === 'recorrente').reduce((s, i) => s + dec(i.subtotal), 0))
  }

  // Acelerador: a faixa sai do atingimento do agente no MÊS do fechamento, medido
  // contra a meta do indicador escolhido na regra. A faixa vale para o período
  // inteiro — por isso fechar uma venda nova recalcula o mês todo (recalcAgentMonth).
  let tier: ResolvedRule['tiers'][number] | null = null
  let atingimento: number | null = null
  let metaAlvo: number | null = null
  let realizadoMetrica: number | null = null
  if (rule.aceleradorAtivo && rule.aceleradorMetrica && rule.tiers.length) {
    const ref = neg.fechadaEm ?? new Date()
    const { start, end } = monthRange(competenciaOf(ref))
    const real = await realizadoDoAgente(userId, rule.funnelId ?? null, start, end)
    const meta = await metaDoAgente(userId, rule.funnelId ?? null, rule.aceleradorMetrica, start, end)
    const atual = rule.aceleradorMetrica === 'conversion' ? real.conversion : real[rule.aceleradorMetrica]
    realizadoMetrica = atual ?? null
    metaAlvo = meta?.target ?? null
    if (meta && meta.target > 0 && atual != null) atingimento = round2((atual / meta.target) * 100)
    // Sem meta cadastrada não há como medir atingimento — vale a taxa base da
    // regra, nunca a faixa mais alta (o acelerador precisa ser merecido).
    if (atingimento != null) {
      const elegiveis = rule.tiers.filter((t) => atingimento! >= t.atingimentoMin)
      tier = elegiveis.length ? elegiveis[elegiveis.length - 1] : null
    }
  }

  const tipoUnico = tier ? tier.tipoUnico : rule.tipoUnico
  const taxaUnico = tier ? tier.taxaUnico : rule.taxaUnico
  const tipoRecorrente = tier ? tier.tipoRecorrente : rule.tipoRecorrente
  const taxaRecorrente = tier ? tier.taxaRecorrente : rule.taxaRecorrente

  const valorUnico = applyRate(baseUnico, tipoUnico, taxaUnico)
  const valorRecorrente = applyRate(baseRecorrente, tipoRecorrente, taxaRecorrente, rule.mesesRecorrente)

  return {
    aplicavel: true, motivo: null, userId, funnelId, rule,
    tierId: tier?.id ?? null,
    tierLabel: tier ? `≥ ${tier.atingimentoMin}% da meta` : null,
    atingimento, metaAlvo, realizadoMetrica,
    baseUnico, baseRecorrente,
    tipoUnico, taxaUnico, tipoRecorrente, taxaRecorrente,
    mesesRecorrente: rule.mesesRecorrente,
    valorUnico, valorRecorrente,
    valorTotal: round2(valorUnico + valorRecorrente),
  }
}

// ── Lançamento ───────────────────────────────────────────────────────────────

/**
 * Põe o lançamento desta negociação em dia com a realidade dela.
 *
 * Idempotente de propósito: pode ser chamada quantas vezes for, de qualquer
 * caminho (fechar, editar, reabrir, recálculo em massa), que o resultado é o
 * mesmo. É essa propriedade que impede a comissão de divergir da venda.
 */
export async function syncNegotiationCommission(negotiationId: number): Promise<'created' | 'updated' | 'removed' | 'cancelled' | 'skipped'> {
  const existing = await prisma.commissionEntry.findUnique({ where: { negotiationId } })
  const preview = await previewNegotiation(negotiationId)

  if (!preview.aplicavel) {
    if (!existing) return 'skipped'
    // Comissão já paga não é apagada: some da conta, mas fica o rastro de que um
    // dia foi paga — dinheiro que saiu não pode desaparecer do histórico.
    if (existing.status === 'paga') {
      await prisma.commissionEntry.update({
        where: { negotiationId },
        data: { status: 'cancelada', observacoes: preview.motivo },
      })
      return 'cancelled'
    }
    await prisma.commissionEntry.delete({ where: { negotiationId } })
    return 'removed'
  }

  const neg = await prisma.negotiation.findUnique({
    where: { id: negotiationId },
    select: { leadId: true, fechadaEm: true },
  })
  const fechadaEm = neg?.fechadaEm ?? new Date()
  const data = {
    leadId: neg!.leadId,
    userId: preview.userId,
    funnelId: preview.funnelId,
    ruleId: preview.rule?.id ?? null,
    tierId: preview.tierId,
    competencia: competenciaOf(fechadaEm),
    fechadaEm,
    baseUnico: preview.baseUnico,
    baseRecorrente: preview.baseRecorrente,
    tipoUnico: preview.tipoUnico,
    taxaUnico: preview.taxaUnico,
    tipoRecorrente: preview.tipoRecorrente,
    taxaRecorrente: preview.taxaRecorrente,
    mesesRecorrente: preview.mesesRecorrente,
    valorUnico: preview.valorUnico,
    valorRecorrente: preview.valorRecorrente,
    valorTotal: preview.valorTotal,
    atingimento: preview.atingimento,
  }

  if (!existing) {
    await prisma.commissionEntry.create({ data: { negotiationId, ...data, status: 'prevista' } })
    return 'created'
  }
  // Lançamento já pago não é reescrito por recálculo: o acordo com o agente já
  // foi honrado naquele valor. Divergência aparece na reconciliação.
  if (existing.status === 'paga') return 'skipped'
  await prisma.commissionEntry.update({
    where: { negotiationId },
    data: { ...data, status: 'prevista', observacoes: null },
  })
  return 'updated'
}

/**
 * Recalcula o mês inteiro do agente.
 *
 * Necessário porque a faixa do acelerador é do PERÍODO: a venda que fez o agente
 * bater a meta muda a taxa de todas as outras do mês. Sem isso o painel mostraria
 * o time batendo a meta e as comissões ainda na faixa antiga.
 */
export async function recalcAgentMonth(userId: number | null, competencia: Date): Promise<number> {
  if (userId == null) return 0
  const { start, end } = monthRange(competencia)
  const negs = await prisma.negotiation.findMany({
    where: { responsavelUserId: userId, resultado: 'won', fechadaEm: { gte: start, lte: end } },
    select: { id: true },
  })
  for (const n of negs) await syncNegotiationCommission(n.id)
  return negs.length
}

/**
 * Ponto único chamado pelo módulo Negociações quando uma proposta muda de estado.
 * Best-effort: comissão nunca derruba o fechamento da venda.
 */
export async function onNegotiationChanged(negotiationId: number): Promise<void> {
  try {
    // Quem já estava lançado importa: reabrir/trocar de dono precisa recalcular
    // TAMBÉM o mês do agente anterior, senão a faixa dele fica contando uma venda
    // que saiu.
    const before = await prisma.commissionEntry.findUnique({
      where: { negotiationId },
      select: { userId: true, competencia: true },
    })
    await syncNegotiationCommission(negotiationId)
    const after = await prisma.commissionEntry.findUnique({
      where: { negotiationId },
      select: { userId: true, competencia: true },
    })
    const alvos = new Map<string, { userId: number; competencia: Date }>()
    for (const e of [before, after]) {
      if (e?.userId) alvos.set(`${e.userId}:${e.competencia.toISOString().slice(0, 7)}`, { userId: e.userId, competencia: e.competencia })
    }
    if (!after && before?.userId) {
      // Reabertura apagou o lançamento: o mês do agente ainda precisa reagir.
      alvos.set(`${before.userId}:${before.competencia.toISOString().slice(0, 7)}`, { userId: before.userId, competencia: before.competencia })
    }
    for (const alvo of alvos.values()) await recalcAgentMonth(alvo.userId, alvo.competencia)
  } catch (err) {
    console.error('[Commissions] falha ao sincronizar a negociação', negotiationId, (err as Error).message)
  }
}

/** Recálculo em massa de um período (todos os agentes ou um só). */
export async function recalcPeriod(start: Date, end: Date, userId?: number | null): Promise<{ negociacoes: number; agentes: number }> {
  const negs = await prisma.negotiation.findMany({
    where: {
      resultado: 'won',
      fechadaEm: { gte: start, lte: end },
      ...(userId ? { responsavelUserId: userId } : {}),
    },
    select: { id: true, responsavelUserId: true, fechadaEm: true },
  })
  // Duas passadas: a primeira lança tudo, a segunda reavalia a faixa já com o
  // período completo. Uma passada só deixaria as primeiras vendas na faixa baixa.
  for (const n of negs) await syncNegotiationCommission(n.id)
  const meses = new Map<string, { userId: number; competencia: Date }>()
  for (const n of negs) {
    if (!n.responsavelUserId || !n.fechadaEm) continue
    const comp = competenciaOf(n.fechadaEm)
    meses.set(`${n.responsavelUserId}:${comp.toISOString().slice(0, 7)}`, { userId: n.responsavelUserId, competencia: comp })
  }
  for (const m of meses.values()) await recalcAgentMonth(m.userId, m.competencia)
  return { negociacoes: negs.length, agentes: new Set(Array.from(meses.values()).map((m) => m.userId)).size }
}

// ── Reconciliação ────────────────────────────────────────────────────────────

export interface Divergencia {
  tipo: 'sem_responsavel' | 'sem_regra' | 'valor_divergente' | 'orfa'
  negotiationId: number | null
  leadId: number | null
  titulo: string | null
  detalhe: string
}

/**
 * Confere venda a venda se a comissão bate com a negociação.
 *
 * Existe porque "os dados conectados" só valem se houver como PROVAR que estão:
 * venda ganha sem lançamento (sem dono, sem regra), lançamento com valor diferente
 * do que a regra atual calcularia, ou lançamento de uma venda que não é mais ganha.
 */
export async function reconcile(start: Date, end: Date): Promise<Divergencia[]> {
  const out: Divergencia[] = []
  const won = await prisma.negotiation.findMany({
    where: { resultado: 'won', fechadaEm: { gte: start, lte: end } },
    select: { id: true, leadId: true, titulo: true },
  })
  const entries = await prisma.commissionEntry.findMany({
    where: { competencia: { gte: competenciaOf(start), lte: end } },
    select: { negotiationId: true, valorTotal: true, status: true },
  })
  const byNeg = new Map(entries.map((e) => [e.negotiationId, e]))

  for (const n of won) {
    const entry = byNeg.get(n.id)
    const preview = await previewNegotiation(n.id)
    if (!preview.aplicavel) {
      out.push({
        tipo: preview.motivo?.includes('responsável') ? 'sem_responsavel' : 'sem_regra',
        negotiationId: n.id, leadId: n.leadId, titulo: n.titulo,
        detalhe: preview.motivo ?? 'sem comissão calculável',
      })
      continue
    }
    if (!entry) {
      out.push({ tipo: 'sem_regra', negotiationId: n.id, leadId: n.leadId, titulo: n.titulo, detalhe: 'venda ganha sem lançamento — rode o recálculo do período' })
      continue
    }
    const gravado = dec(entry.valorTotal)
    if (Math.abs(gravado - preview.valorTotal) > 0.01) {
      out.push({
        tipo: 'valor_divergente', negotiationId: n.id, leadId: n.leadId, titulo: n.titulo,
        detalhe: `lançado R$ ${gravado.toFixed(2)} · recalculado R$ ${preview.valorTotal.toFixed(2)}${entry.status === 'paga' ? ' (já paga — não é reescrita automaticamente)' : ''}`,
      })
    }
  }

  // Lançamento cuja venda deixou de ser ganha (reabertura que não passou pelo
  // gancho, importação, alteração direta no banco).
  const wonIds = new Set(won.map((n) => n.id))
  for (const e of entries) {
    if (wonIds.has(e.negotiationId)) continue
    const neg = await prisma.negotiation.findUnique({ where: { id: e.negotiationId }, select: { resultado: true, titulo: true, leadId: true, fechadaEm: true } })
    if (!neg) continue
    if (neg.resultado !== 'won') {
      out.push({ tipo: 'orfa', negotiationId: e.negotiationId, leadId: neg.leadId, titulo: neg.titulo, detalhe: 'lançamento de negociação que não está mais ganha' })
    }
  }
  return out
}
