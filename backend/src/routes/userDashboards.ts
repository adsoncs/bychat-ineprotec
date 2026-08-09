import { FastifyInstance } from 'fastify'
import { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma.js'
import { authMiddleware, adminOnly } from '../lib/auth.js'
import { buildLeadAccessWhere } from '../lib/teamAccess.js'
import { computeHelpdeskReport } from '../services/helpdesk.js'

// Rótulos PT p/ os widgets do helpdesk (espelham a UI do módulo).
const HD_STATUS_LABEL: Record<string, string> = { new: 'Novo', open: 'Aberto', pending: 'Pendente', on_hold: 'Em espera', solved: 'Resolvido', closed: 'Fechado' }
const HD_PRIORITY_LABEL: Record<string, string> = { low: 'Baixa', normal: 'Normal', high: 'Alta', urgent: 'Urgente' }
const HD_CHANNEL_LABEL: Record<string, string> = { email: 'E-mail', web: 'Web', whatsapp: 'WhatsApp', chat: 'Chat', api: 'API', phone: 'Telefone', manual: 'Manual' }

/**
 * Período anterior de mesma duração (pra comparação "vs período anterior"
 * nos KPIs da Visão Geral). Retorna null se o widget não recebeu dateFrom+dateTo.
 */
function previousRange(cfg: any): { gte: Date; lte: Date } | null {
  if (!cfg?.dateFrom || !cfg?.dateTo) return null
  const from = new Date(cfg.dateFrom + 'T00:00:00.000Z')
  const to = new Date(cfg.dateTo + 'T23:59:59.999Z')
  const span = to.getTime() - from.getTime()
  if (!Number.isFinite(span) || span <= 0) return null
  return { gte: new Date(from.getTime() - span - 1), lte: new Date(from.getTime() - 1) }
}

/**
 * Coluna de valor somada nos KPIs de negociação:
 *   valorFinal      = tudo (1º ciclo: pagamento único + 1 × mensalidade)
 *   valorRecorrente = só mensalidade (MRR)
 *   valorUnico      = só o que é cobrado uma vez
 * Separar os três é o que impede um pico de venda avulsa de parecer aumento de
 * recorrência — e vice-versa.
 */
type NegField = 'valorFinal' | 'valorRecorrente' | 'valorUnico'

/**
 * Soma/contagem de negociações de um funil. O funil pertence ao LEAD e
 * `Negotiation` guarda só `leadId` (sem relação declarada), então o recorte sai
 * de um JOIN — mais barato que carregar os ids do funil para um `IN` com
 * dezenas de milhares de leads.
 *
 * `open: true` → negociações em aberto (sem resultado). O período, quando vem,
 * recorta pela ABERTURA (`createdAt`): "quanto entrou na mesa no período e ainda
 * está lá". Sem período, é o estoque inteiro.
 *
 * `count` conta só as negociações que TÊM o componente pedido (> 0) quando o
 * campo não é o total: ticket médio de mensalidade dividido pelas propostas sem
 * mensalidade nenhuma seria um número sem significado.
 */
async function negAggregateByFunnel(
  funnelId: number,
  opts: { open?: boolean; resultado?: 'won' | 'lost'; from?: Date; to?: Date; field?: NegField },
): Promise<{ sum: number; count: number }> {
  const field = opts.field ?? 'valorFinal'
  // Nome de coluna não é parâmetro de bind — vem de um literal do tipo NegField,
  // nunca do request, então Prisma.raw aqui não abre injeção.
  const col = Prisma.raw(`n.\`${field}\``)
  const countCol = field === 'valorFinal' ? Prisma.raw('1') : Prisma.raw(`CASE WHEN COALESCE(${`n.\`${field}\``}, 0) > 0 THEN 1 END`)
  const rows: any[] = opts.open
    ? await prisma.$queryRaw`
        SELECT COALESCE(SUM(${col}), 0) AS sum, COUNT(${countCol}) AS count
        FROM bychat_negotiations n JOIN bychat_leads l ON l.id = n.leadId
        WHERE n.resultado IS NULL AND l.funnelId = ${funnelId}
          AND (${opts.from ?? null} IS NULL OR n.createdAt >= ${opts.from ?? null})
          AND (${opts.to ?? null} IS NULL OR n.createdAt <= ${opts.to ?? null})`
    : await prisma.$queryRaw`
        SELECT COALESCE(SUM(${col}), 0) AS sum, COUNT(${countCol}) AS count
        FROM bychat_negotiations n JOIN bychat_leads l ON l.id = n.leadId
        WHERE n.resultado = ${opts.resultado ?? 'won'} AND l.funnelId = ${funnelId}
          AND (${opts.from ?? null} IS NULL OR n.fechadaEm >= ${opts.from ?? null})
          AND (${opts.to ?? null} IS NULL OR n.fechadaEm <= ${opts.to ?? null})`
  const r = rows[0] ?? {}
  return { sum: Number(r.sum ?? 0), count: Number(r.count ?? 0) }
}

/** Métrica → coluna: `negotiations_mrr_*` soma mensalidade, `*_onetime_*` soma
 * pagamento único, o resto (métricas antigas) continua somando o total. */
function negFieldOf(metric: string): NegField {
  if (metric.startsWith('negotiations_mrr_')) return 'valorRecorrente'
  if (metric.startsWith('negotiations_onetime_')) return 'valorUnico'
  return 'valorFinal'
}

/**
 * Mesma agregação sem recorte de funil (todos os funis), via Prisma. Contrapartida
 * exata de `negAggregateByFunnel`: `count` só conta quem tem o componente.
 */
async function negAggregate(
  where: any,
  field: NegField,
): Promise<{ sum: number; count: number }> {
  const scoped = field === 'valorFinal' ? where : { ...where, [field]: { gt: 0 } }
  const agg = await prisma.negotiation.aggregate({ where: scoped, _sum: { [field]: true } as any, _count: { _all: true } })
  const sum = (agg._sum as any)?.[field]
  return { sum: sum ? Number(sum) : 0, count: agg._count._all }
}

export async function userDashboardsRoutes(app: FastifyInstance) {

  // ── GET /api/admin/user-dashboards?type=dashboard ──
  app.get('/api/admin/user-dashboards', { preHandler: authMiddleware }, async (req) => {
    const { type } = req.query as { type?: string }
    const userId = (req as any).user?.userId
    const where: any = { userId }
    if (type) where.type = type
    const dashboards = await prisma.userDashboard.findMany({
      where,
      orderBy: [{ isDefault: 'desc' }, { position: 'asc' }, { createdAt: 'asc' }],
    })
    return { dashboards }
  })

  // ── POST /api/admin/user-dashboards ──
  app.post('/api/admin/user-dashboards', { preHandler: authMiddleware }, async (req) => {
    const userId = (req as any).user?.userId
    const { name, type, widgets, isDefault } = req.body as any

    if (isDefault) {
      await prisma.userDashboard.updateMany({
        where: { userId, type: type || 'dashboard' },
        data: { isDefault: false },
      })
    }

    const count = await prisma.userDashboard.count({ where: { userId, type: type || 'dashboard' } })
    const dashboard = await prisma.userDashboard.create({
      data: {
        userId,
        name: name || 'Meu Dashboard',
        type: type || 'dashboard',
        widgets: widgets || [],
        isDefault: isDefault || count === 0,
        isSystem: count === 0,
        position: count,
      },
    })
    return dashboard
  })

  // ── PUT /api/admin/user-dashboards/:id ──
  app.put('/api/admin/user-dashboards/:id', { preHandler: authMiddleware }, async (req, reply) => {
    const { id } = req.params as any
    const userId = (req as any).user?.userId
    const { name, widgets, isDefault } = req.body as any

    const existing = await prisma.userDashboard.findFirst({ where: { id: Number(id), userId } })
    if (!existing) return reply.code(404).send({ error: 'Dashboard não encontrado' })

    if (isDefault) {
      await prisma.userDashboard.updateMany({
        where: { userId, type: existing.type },
        data: { isDefault: false },
      })
    }

    const data: any = {}
    if (name !== undefined) data.name = name
    if (widgets !== undefined) data.widgets = widgets
    if (isDefault !== undefined) data.isDefault = isDefault

    return prisma.userDashboard.update({ where: { id: Number(id) }, data })
  })

  // ── DELETE /api/admin/user-dashboards/:id ──
  app.delete('/api/admin/user-dashboards/:id', { preHandler: authMiddleware }, async (req, reply) => {
    const { id } = req.params as any
    const userId = (req as any).user?.userId
    const existing = await prisma.userDashboard.findFirst({ where: { id: Number(id), userId } })
    if (!existing) return reply.code(404).send({ error: 'Dashboard não encontrado' })
    if (existing.isSystem) return reply.code(403).send({ error: 'Dashboard padrão do sistema não pode ser excluído' })
    await prisma.userDashboard.delete({ where: { id: Number(id) } })
    // If deleted was default, make first remaining the default
    if (existing.isDefault) {
      const first = await prisma.userDashboard.findFirst({
        where: { userId, type: existing.type },
        orderBy: { position: 'asc' },
      })
      if (first) await prisma.userDashboard.update({ where: { id: first.id }, data: { isDefault: true } })
    }
    return { ok: true }
  })

  // ── POST /api/admin/widget-data — Fetch data for a widget ──
  app.post('/api/admin/widget-data', { preHandler: authMiddleware }, async (req) => {
    const { metric, config } = req.body as { metric: string; config?: any }
    const cfg = config || {}

    // Build date filter
    const dateFilter: any = {}
    if (cfg.dateFrom) dateFilter.gte = new Date(cfg.dateFrom + 'T00:00:00.000Z')
    if (cfg.dateTo) dateFilter.lte = new Date(cfg.dateTo + 'T23:59:59.999Z')
    const hasDate = cfg.dateFrom || cfg.dateTo
    const leadWhere: any = {}
    if (hasDate) leadWhere.createdAt = dateFilter
    if (cfg.funnelId) leadWhere.funnelId = Number(cfg.funnelId)
    // Recorte por permissão (`scoped`): a Tela Inicial serve o MESMO painel a
    // papéis diferentes, então o número precisa vir pelo scope do módulo leads —
    // agente vê o que é dele, gestor o do setor, admin tudo. Sem a flag, nada
    // muda: os painéis de "Meus Painéis" e a Visão Geral seguem globais.
    if (cfg.scoped) {
      const u = (req as any).user as { userId: number; role: string }
      const access = await buildLeadAccessWhere(u.userId, u.role)
      if (Object.keys(access).length > 0) leadWhere.AND = [...(leadWhere.AND || []), access]
    }

    // Recorte por funil dos KPIs de negociação (a seção tem seletor próprio na
    // Visão Geral). Number inválido/0 = todos os funis.
    const negFunnelId = Number(cfg.funnelId) > 0 ? Number(cfg.funnelId) : null

    // Os widgets do helpdesk nasceram com preset próprio (`cfg.range`). Quando o
    // painel manda um período, ele vence — senão o card ficava preso em 30d e
    // não reagia ao seletor da tela.
    const hdPeriod = hasDate ? { from: dateFilter.gte, to: dateFilter.lte } : undefined

    switch (metric) {
      case 'leads_total': {
        const total = await prisma.lead.count({ where: leadWhere })
        // Com filtro de data, devolve também o período anterior pra UI mostrar Δ%.
        const prevRange = previousRange(cfg)
        if (!prevRange) return { value: total }
        const prev = await prisma.lead.count({ where: { ...leadWhere, createdAt: prevRange } })
        return { value: total, prev }
      }

      // Ganhos, receita e perdidos contam pelo MOMENTO DO CLIQUE nos botões
      // Ganho/Perdido — `outcomeAt` é gravado ali. Não é coorte de captação: o
      // que interessa é o que foi fechado dentro do período, independente de
      // quando o lead entrou.
      case 'leads_won': {
        const where: any = { ...leadWhere, outcome: 'won' }
        if (hasDate) { delete where.createdAt; where.outcomeAt = dateFilter }
        const value = await prisma.lead.count({ where })
        const prevRange = previousRange(cfg)
        const prev = prevRange ? await prisma.lead.count({ where: { ...where, outcomeAt: prevRange } }) : undefined
        return { value, basis: 'outcome', ...(prev === undefined ? {} : { prev }) }
      }

      case 'leads_won_revenue': {
        // Soma de saleValue dos negócios marcados como ganhos no período.
        const where: any = { ...leadWhere, outcome: 'won' }
        if (hasDate) { delete where.createdAt; where.outcomeAt = dateFilter }
        const agg = await prisma.lead.aggregate({ where, _sum: { saleValue: true }, _count: { _all: true } })
        const value = agg._sum.saleValue ? Number(agg._sum.saleValue) : 0
        const count = agg._count._all
        const prevRange = previousRange(cfg)
        if (!prevRange) return { value, count, basis: 'outcome' }
        const p = await prisma.lead.aggregate({ where: { ...where, outcomeAt: prevRange }, _sum: { saleValue: true } })
        const prev = p._sum.saleValue ? Number(p._sum.saleValue) : 0
        return { value, count, prev, basis: 'outcome' }
      }

      case 'leads_lost': {
        // Negócios perdidos no período + maior objeção (contexto acionável no card).
        const where: any = { ...leadWhere, outcome: 'lost' }
        if (hasDate) { delete where.createdAt; where.outcomeAt = dateFilter }
        const value = await prisma.lead.count({ where })
        const prevRange = previousRange(cfg)
        const prev = prevRange ? await prisma.lead.count({ where: { ...where, outcomeAt: prevRange } }) : undefined
        let topReason: string | null = null
        if (value > 0) {
          const grouped = await prisma.lead.groupBy({
            by: ['lostReasonId'],
            where: { ...where, lostReasonId: { not: null } },
            _count: { _all: true },
            orderBy: { _count: { lostReasonId: 'desc' } },
            take: 1,
          })
          const topId = grouped[0]?.lostReasonId
          if (topId != null) {
            const reason = await prisma.lossReason.findUnique({ where: { id: topId }, select: { name: true } })
            topReason = reason?.name ?? null
          }
        }
        return { value, topReason, basis: 'outcome', ...(prev !== undefined ? { prev } : {}) }
      }

      case 'leads_conversion_rate': {
        // Convertidos sobre quem CHEGOU À NEGOCIAÇÃO (decisão do Adson,
        // 2026-08-08): dos leads com proposta e valor lançado, quantos viraram
        // venda. Antes era won/(won+lost) sobre todos os leads.
        //
        // O denominador inclui as negociações ainda em aberto de propósito. A
        // versão "só encerrados" colapsa: no beyond ninguém marca Perdido depois
        // de negociar (0 perdidos entre os que negociaram), então daria 100%
        // fixo — o mesmo defeito que aposentou o card "Aproveitamento".
        //
        // Coorte pela ABERTURA da negociação: a taxa de um período é estável e
        // só sobe conforme aquelas propostas fecham. Recortar numerador por data
        // de ganho e denominador por abertura deixaria a razão passar de 100%.
        const base: any = { ...leadWhere }
        if (hasDate) delete base.createdAt

        const negotiatedLeadIds = async (range: any) => {
          const rows = await prisma.negotiation.findMany({
            where: { valorFinal: { gt: 0 }, ...(range ? { createdAt: range } : {}) },
            select: { leadId: true },
            distinct: ['leadId'],
            take: 20_000,
          })
          return rows.map((r) => r.leadId)
        }
        const rate = async (range: any) => {
          const ids = await negotiatedLeadIds(range)
          if (ids.length === 0) return { value: 0, won: 0, negotiated: 0 }
          // Passa pelo Lead (e não conta os ids direto) para respeitar o recorte
          // por funil e por permissão que já vive em `leadWhere`.
          const scoped: any = { ...base, id: { in: ids } }
          const [negotiated, won] = await Promise.all([
            prisma.lead.count({ where: scoped }),
            prisma.lead.count({ where: { ...scoped, outcome: 'won' } }),
          ])
          return { value: negotiated ? Math.round((won / negotiated) * 100) : 0, won, negotiated }
        }

        // Quem NUNCA abriu negociação não tem denominador — o card viraria uma
        // lacuna permanente. Nesses tenants a taxa continua sendo ganhos sobre
        // encerrados, e o `basis` diz qual conta está em uso (o rótulo no card
        // muda junto, então não há dois números querendo dizer a mesma coisa).
        // O teste é sobre o histórico inteiro, não sobre o período: se fosse
        // por período, trocar de 30d para 7d trocaria a fórmula do card.
        const usaNegociacao = await prisma.negotiation.count({ where: { valorFinal: { gt: 0 } } }) > 0
        if (!usaNegociacao) {
          const rangeWhere = hasDate ? { outcomeAt: dateFilter } : {}
          const [won, lost] = await Promise.all([
            prisma.lead.count({ where: { ...base, ...rangeWhere, outcome: 'won' } }),
            prisma.lead.count({ where: { ...base, ...rangeWhere, outcome: 'lost' } }),
          ])
          const closed = won + lost
          return { value: closed ? Math.round((won / closed) * 100) : 0, won, closed, basis: 'outcome' }
        }

        const curr = await rate(hasDate ? dateFilter : null)
        const prevRange = previousRange(cfg)
        if (!prevRange) return { ...curr, basis: 'negotiation' }
        const p = await rate(prevRange)
        return { ...curr, basis: 'negotiation', ...(p.negotiated > 0 ? { prev: p.value } : {}) }
      }

      // ── Negociações (módulo Negociação) ──────────────────────────
      // O funil é do LEAD, não da negociação — e Negotiation não declara relação
      // com Lead (só leadId escalar), então o recorte por funil sai de um JOIN
      // em SQL. Sem funil escolhido, seguem os agregados do Prisma.
      // Estoque atual: negociações em aberto (sem resultado) e quanto há na mesa.
      // `mrr_` = só mensalidade, `onetime_` = só pagamento único, sem prefixo = tudo.
      case 'negotiations_open':
      case 'negotiations_mrr_open':
      case 'negotiations_onetime_open': {
        const field = negFieldOf(metric)
        if (negFunnelId) {
          const r = await negAggregateByFunnel(negFunnelId, { open: true, from: dateFilter.gte, to: dateFilter.lte, field })
          return { value: r.sum, count: r.count }
        }
        const openWhere: any = { resultado: null }
        if (hasDate) openWhere.createdAt = dateFilter
        const r = await negAggregate(openWhere, field)
        return { value: r.sum, count: r.count }
      }

      // Fechado (ganho) em negociações no período (usa fechadaEm).
      case 'negotiations_won_revenue':
      case 'negotiations_mrr_won':
      case 'negotiations_onetime_won': {
        const field = negFieldOf(metric)
        const prevRange = previousRange(cfg)
        if (negFunnelId) {
          const r = await negAggregateByFunnel(negFunnelId, { resultado: 'won', from: dateFilter.gte, to: dateFilter.lte, field })
          if (!prevRange) return { value: r.sum, count: r.count }
          const p = await negAggregateByFunnel(negFunnelId, { resultado: 'won', from: prevRange.gte, to: prevRange.lte, field })
          return { value: r.sum, count: r.count, prev: p.sum }
        }
        const where: any = { resultado: 'won' }
        if (hasDate) where.fechadaEm = dateFilter
        const r = await negAggregate(where, field)
        if (!prevRange) return { value: r.sum, count: r.count }
        const p = await negAggregate({ resultado: 'won', fechadaEm: prevRange }, field)
        return { value: r.sum, count: r.count, prev: p.sum }
      }

      case 'negotiations_win_rate': {
        // % de negociações ganhas sobre as fechadas (ganhas + perdidas) no período.
        const prevRange = previousRange(cfg)
        if (negFunnelId) {
          const [w, l] = await Promise.all([
            negAggregateByFunnel(negFunnelId, { resultado: 'won', from: dateFilter.gte, to: dateFilter.lte }),
            negAggregateByFunnel(negFunnelId, { resultado: 'lost', from: dateFilter.gte, to: dateFilter.lte }),
          ])
          const closed = w.count + l.count
          const value = closed ? Math.round((w.count / closed) * 100) : 0
          if (!prevRange) return { value, won: w.count, closed }
          const [pw, pl] = await Promise.all([
            negAggregateByFunnel(negFunnelId, { resultado: 'won', from: prevRange.gte, to: prevRange.lte }),
            negAggregateByFunnel(negFunnelId, { resultado: 'lost', from: prevRange.gte, to: prevRange.lte }),
          ])
          const prevClosed = pw.count + pl.count
          return { value, won: w.count, closed, ...(prevClosed > 0 ? { prev: Math.round((pw.count / prevClosed) * 100) } : {}) }
        }
        const range = hasDate ? { fechadaEm: dateFilter } : {}
        const [won, lost] = await Promise.all([
          prisma.negotiation.count({ where: { resultado: 'won', ...range } }),
          prisma.negotiation.count({ where: { resultado: 'lost', ...range } }),
        ])
        const closed = won + lost
        const value = closed ? Math.round((won / closed) * 100) : 0
        if (!prevRange) return { value, won, closed }
        const [pw, pl] = await Promise.all([
          prisma.negotiation.count({ where: { resultado: 'won', fechadaEm: prevRange } }),
          prisma.negotiation.count({ where: { resultado: 'lost', fechadaEm: prevRange } }),
        ])
        const prevClosed = pw + pl
        return { value, won, closed, ...(prevClosed > 0 ? { prev: Math.round((pw / prevClosed) * 100) } : {}) }
      }

      // Ticket médio das negociações ganhas no período (soma ÷ nº ganhas).
      // Honesto: não depende de perdas registradas, ao contrário do antigo win_rate.
      // Nas versões `mrr_`/`onetime_`, o divisor são só as negociações que têm
      // aquele componente — uma proposta sem mensalidade não puxa o ticket mensal
      // para baixo.
      case 'negotiations_avg_ticket':
      case 'negotiations_mrr_avg_ticket':
      case 'negotiations_onetime_avg_ticket': {
        const field = negFieldOf(metric)
        if (negFunnelId) {
          const r = await negAggregateByFunnel(negFunnelId, { resultado: 'won', from: dateFilter.gte, to: dateFilter.lte, field })
          return { value: r.count ? Math.round(r.sum / r.count) : 0, count: r.count }
        }
        const where: any = { resultado: 'won' }
        if (hasDate) where.fechadaEm = dateFilter
        const r = await negAggregate(where, field)
        return { value: r.count ? Math.round(r.sum / r.count) : 0, count: r.count }
      }

      case 'leads_new': {
        const today = new Date(); today.setHours(0, 0, 0, 0)
        const todayCount = await prisma.lead.count({ where: { ...leadWhere, createdAt: { gte: today } } })
        const weekAgo = new Date(Date.now() - 7 * 86400000)
        const weekCount = await prisma.lead.count({ where: { ...leadWhere, createdAt: hasDate ? dateFilter : { gte: weekAgo } } })
        return { today: todayCount, week: weekCount }
      }

      case 'leads_submissions': {
        // Fase 24: total de submissões = todas as criações de Lead (Categoria A + B).
        // Equivalente a leads_total no período, exposto separado pra UI deixar claro
        // que cada submit = 1 evento de aquisição (não pessoa única).
        const value = await prisma.lead.count({ where: leadWhere })
        return { value }
      }

      case 'leads_unique': {
        // Fase 24: pessoas distintas pós-revisão.
        // = inscrições - duplicados pending_review (aguardando decisão humana)
        // Não desconta kept_separate (decisão consciente de tratar como pessoas distintas).
        const [submissions, duplicatesPending] = await Promise.all([
          prisma.lead.count({ where: leadWhere }),
          prisma.lead.count({ where: { ...leadWhere, duplicateStatus: 'pending_review' } }),
        ])
        return { value: Math.max(0, submissions - duplicatesPending), submissions, duplicatesPending }
      }

      case 'leads_duplicates_pending': {
        const value = await prisma.lead.count({ where: { ...leadWhere, duplicateStatus: 'pending_review' } })
        return { value }
      }

      case 'leads_uncontacted': {
        // Leads na primeira stage de cada funil ativo, sem activity executada (concluída) registrada.
        const stageWhere: any = { active: true, position: 0 }
        if (cfg.funnelId) stageWhere.funnelId = Number(cfg.funnelId)
        const firstStages = await prisma.stage.findMany({
          where: stageWhere,
          select: { key: true },
        })
        const firstStageKeys = Array.from(new Set(firstStages.map((s) => s.key)))
        if (firstStageKeys.length === 0) return { value: 0 }
        const candidates = await prisma.lead.findMany({
          where: { ...leadWhere, status: { in: firstStageKeys } },
          select: { id: true, _count: { select: { activities: { where: { status: { in: ['completed', 'sent'] } } } } } },
        })
        const value = candidates.filter((l) => l._count.activities === 0).length
        return { value }
      }

      case 'leads_avg_score': {
        const scores = await prisma.lead.findMany({
          where: leadWhere,
          select: { scores: true },
          take: 2000,
        })
        const vals = scores.map(l => (l.scores as any)?.geral || 0).filter(v => v > 0)
        const avg = vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : 0
        // count = quantos leads têm score IA — sem isso o card engana (média de 3 leads parece geral).
        return { value: avg, count: vals.length, total: scores.length }
      }

      case 'leads_conversion': {
        const sentiments = await prisma.lead.findMany({
          where: leadWhere,
          select: { aiSentiment: true },
          take: 2000,
        })
        const probs = sentiments.map(l => (l.aiSentiment as any)?.probabilidade).filter(v => typeof v === 'number' && v > 0)
        const avg = probs.length ? Math.round(probs.reduce((a, b) => a + b, 0) / probs.length) : 0
        return { value: avg, count: probs.length }
      }

      case 'leads_by_date': {
        const groupBy = cfg.groupBy || 'day'
        const defaultRange = groupBy === 'week' ? 90 : groupBy === 'month' ? 365 : 30
        const range = hasDate ? dateFilter : { gte: new Date(Date.now() - defaultRange * 86400000) }
        const leads = await prisma.lead.findMany({
          where: { ...leadWhere, createdAt: range },
          select: { createdAt: true },
          orderBy: { createdAt: 'asc' },
        })
        const buckets: Record<string, number> = {}
        leads.forEach(l => {
          let key: string
          if (groupBy === 'week') {
            const d = new Date(l.createdAt)
            const day = d.getDay()
            const diff = d.getDate() - day + (day === 0 ? -6 : 1)
            key = new Date(d.setDate(diff)).toISOString().split('T')[0]
          } else if (groupBy === 'month') {
            key = l.createdAt.toISOString().substring(0, 7)
          } else {
            key = l.createdAt.toISOString().split('T')[0]
          }
          buckets[key] = (buckets[key] || 0) + 1
        })
        return { data: Object.entries(buckets).map(([label, value]) => ({ label, value })) }
      }

      case 'leads_by_status': {
        const stages = await prisma.stage.findMany({
          where: cfg.funnelId ? { funnelId: Number(cfg.funnelId), active: true } : { active: true },
          orderBy: { position: 'asc' },
          select: { key: true, name: true, color: true, funnelId: true },
        })
        const counts = await prisma.lead.groupBy({
          by: ['status'],
          where: leadWhere,
          _count: { status: true },
        })
        const countMap: Record<string, number> = {}
        counts.forEach(c => { countMap[c.status] = c._count.status })
        // Deduplicate by key (take first occurrence)
        const seen = new Set<string>()
        const data = stages.filter(s => {
          if (seen.has(s.key)) return false
          seen.add(s.key)
          return true
        }).map(s => ({
          label: s.name,
          value: countMap[s.key] || 0,
          color: s.color,
          key: s.key,
        }))
        return { data }
      }

      case 'leads_by_source': {
        const counts = await prisma.lead.groupBy({
          by: ['source'],
          where: leadWhere,
          _count: { source: true },
        })
        // Resolve rótulos amigáveis (inclui db_connector:<id> → nome do conector).
        const { buildSourceLabeler } = await import('../lib/leadSourceLabel.js')
        const labelOf = await buildSourceLabeler(counts.map(c => c.source))
        const data = counts.map(c => ({
          label: labelOf(c.source),
          value: c._count.source,
          key: c.source || 'direto',
        })).sort((a, b) => b.value - a.value)
        return { data }
      }

      case 'leads_by_segment': {
        const counts = await prisma.lead.groupBy({
          by: ['segmento'],
          where: leadWhere,
          _count: { segmento: true },
        })
        const data = counts
          .filter(c => c.segmento)
          .map(c => ({ label: c.segmento!, value: c._count.segmento }))
          .sort((a, b) => b.value - a.value)
          .slice(0, cfg.limit || 10)
        return { data }
      }

      case 'leads_loss_reasons': {
        // Fase 23.1: distribuição de leads perdidos por objeção (usa outcomeAt p/ período).
        const where: any = { ...leadWhere, outcome: 'lost' }
        if (hasDate) { delete where.createdAt; where.outcomeAt = dateFilter }
        const grouped = await prisma.lead.groupBy({
          by: ['lostReasonId'],
          where,
          _count: { _all: true },
        })
        const reasons = await prisma.lossReason.findMany({ select: { id: true, name: true, color: true } })
        const map = new Map(reasons.map(r => [r.id, r]))
        const data = grouped
          .map(g => {
            const meta = g.lostReasonId != null ? map.get(g.lostReasonId) : null
            return {
              label: meta?.name ?? (g.lostReasonId == null ? 'Sem objeção' : `Objeção #${g.lostReasonId}`),
              value: g._count._all,
              key: g.lostReasonId != null ? String(g.lostReasonId) : 'none',
              color: meta?.color ?? '#94a3b8',
            }
          })
          .sort((a, b) => b.value - a.value)
        return { data }
      }

      case 'leads_lost_revenue_by_reason': {
        // Fase 23.1: soma saleValue agrupada por objeção (lead perdido com valor estimado).
        const where: any = { ...leadWhere, outcome: 'lost' }
        if (hasDate) { delete where.createdAt; where.outcomeAt = dateFilter }
        const grouped = await prisma.lead.groupBy({
          by: ['lostReasonId'],
          where,
          _sum: { saleValue: true },
          _count: { _all: true },
        })
        const reasons = await prisma.lossReason.findMany({ select: { id: true, name: true, color: true } })
        const map = new Map(reasons.map(r => [r.id, r]))
        const data = grouped
          .map(g => {
            const meta = g.lostReasonId != null ? map.get(g.lostReasonId) : null
            const sum = g._sum.saleValue ? Number(g._sum.saleValue) : 0
            return {
              label: meta?.name ?? (g.lostReasonId == null ? 'Sem objeção' : `Objeção #${g.lostReasonId}`),
              value: sum,
              count: g._count._all,
              key: g.lostReasonId != null ? String(g.lostReasonId) : 'none',
              color: meta?.color ?? '#94a3b8',
            }
          })
          .filter(d => d.value > 0)
          .sort((a, b) => b.value - a.value)
        return { data }
      }

      case 'leads_by_funnel': {
        const funnelWhere: any = { active: true }
        if (cfg.funnelId) funnelWhere.id = Number(cfg.funnelId)
        const funnels = await prisma.funnel.findMany({
          where: funnelWhere,
          include: { _count: { select: { leads: true } }, stages: { where: { active: true }, orderBy: { position: 'asc' }, select: { key: true, name: true, color: true } } },
          orderBy: { createdAt: 'asc' },
        })
        const funnelLeadWhere: any = {}
        if (hasDate) funnelLeadWhere.createdAt = dateFilter
        const data = await Promise.all(funnels.map(async f => {
          const stageCounts = await prisma.lead.groupBy({
            by: ['status'],
            where: { funnelId: f.id, ...funnelLeadWhere },
            _count: { status: true },
          })
          const scMap: Record<string, number> = {}
          stageCounts.forEach(s => { scMap[s.status] = s._count.status })
          return {
            id: f.id,
            label: f.name,
            value: f._count.leads,
            isDefault: f.isDefault,
            stages: f.stages.map(s => ({ key: s.key, name: s.name, color: s.color, count: scMap[s.key] || 0 })),
          }
        }))
        return { data }
      }

      case 'leads_by_pillar': {
        const scores = await prisma.lead.findMany({
          where: leadWhere,
          select: { scores: true },
          take: 2000,
        })
        const pillarSums: Record<string, { sum: number; count: number }> = {}
        scores.forEach(l => {
          const sc = (l.scores as any) || {}
          Object.keys(sc).filter(k => k !== 'geral').forEach(k => {
            if (!pillarSums[k]) pillarSums[k] = { sum: 0, count: 0 }
            if (sc[k] > 0) { pillarSums[k].sum += sc[k]; pillarSums[k].count++ }
          })
        })
        const data = Object.entries(pillarSums).map(([key, v]) => ({
          label: key,
          value: v.count > 0 ? Math.round(v.sum / v.count) : 0,
        }))
        return { data }
      }

      case 'leads_maturidade': {
        const scores = await prisma.lead.findMany({
          where: leadWhere,
          select: { scores: true },
          take: 2000,
        })
        const counts = { 'Inicial': 0, 'Estruturação': 0, 'Crescimento': 0, 'Escala': 0 }
        scores.forEach(l => {
          const sc = (l.scores as any)?.geral || 0
          if (sc < 40) counts['Inicial']++
          else if (sc < 55) counts['Estruturação']++
          else if (sc < 72) counts['Crescimento']++
          else counts['Escala']++
        })
        const colors = ['#ea4335', '#f9ab00', '#4285f4', '#34a853']
        const data = Object.entries(counts).map(([label, value], i) => ({ label, value, color: colors[i] }))
        return { data }
      }

      case 'leads_recent': {
        const leads = await prisma.lead.findMany({
          where: leadWhere,
          select: { id: true, nome: true, empresa: true, scores: true, status: true, createdAt: true, source: true, segmento: true, whatsapp: true, solucaoNome: true, funnelId: true },
          orderBy: { createdAt: 'desc' },
          take: cfg.limit || 10,
        })
        return { data: leads }
      }

      case 'activities_summary': {
        // Período aplicado sobre `scheduledAt` (quando a atividade acontece), que
        // é a data que o operador tem em mente ao olhar a agenda — não a data em
        // que a atividade foi cadastrada. "Atrasadas" = vencidas até agora, mas
        // só as agendadas dentro do período escolhido.
        const at = hasDate ? { scheduledAt: dateFilter } : {}
        const overdueAt = hasDate
          ? { scheduledAt: { ...dateFilter, lt: new Date() } }
          : { scheduledAt: { lt: new Date() } }
        const [pending, overdue, completed, total] = await Promise.all([
          prisma.activity.count({ where: { status: 'pending', ...at } }),
          prisma.activity.count({ where: { status: 'pending', ...overdueAt } }),
          prisma.activity.count({ where: { status: 'completed', ...at } }),
          prisma.activity.count({ where: at }),
        ])
        return { pending, overdue, completed, total }
      }

      case 'activities_by_type': {
        const counts = await prisma.activity.groupBy({
          by: ['type'],
          ...(hasDate ? { where: { scheduledAt: dateFilter } } : {}),
          _count: { type: true },
        })
        const typeNames: Record<string, string> = {
          whatsapp: 'WhatsApp', email: 'E-mail', sms: 'SMS', call: 'Ligação',
          meeting: 'Reunião', task: 'Tarefa', note: 'Nota', follow_up: 'Follow-up',
        }
        const data = counts.map(c => ({ label: typeNames[c.type] || c.type, value: c._count.type, key: c.type })).sort((a, b) => b.value - a.value)
        return { data }
      }

      case 'pages_performance': {
        // `views`/`submissions` no LandingPage são contadores acumulados desde
        // sempre — não sabem o que é período. Com filtro de data os números vêm
        // dos eventos (pageview no tracking, submissão no formulário), que têm
        // timestamp; sem filtro, seguem os contadores.
        const pages = await prisma.landingPage.findMany({
          select: { id: true, title: true, slug: true, status: true, views: true, submissions: true },
          orderBy: { views: 'desc' },
          take: cfg.limit || 10,
        })
        const total = await prisma.landingPage.count()
        const published = await prisma.landingPage.count({ where: { status: 'PUBLISHED' } })
        if (!hasDate) {
          const totalViews = pages.reduce((a, p) => a + (p.views || 0), 0)
          const totalConv = pages.reduce((a, p) => a + (p.submissions || 0), 0)
          return { total, published, totalViews, totalConversions: totalConv, data: pages }
        }
        const [pvRows, subs] = await Promise.all([
          // A URL do evento é absoluta; o casamento é pelo último segmento do path.
          prisma.$queryRaw<{ url: string; views: bigint }[]>`
            SELECT url, COUNT(*) AS views FROM bychat_tracking_events
            WHERE type = 'pageview' AND url IS NOT NULL AND url <> ''
              AND timestamp >= ${dateFilter.gte ?? new Date(0)} AND timestamp <= ${dateFilter.lte ?? new Date()}
            GROUP BY url`,
          prisma.formSubmission.groupBy({ by: ['pageSlug'], where: { createdAt: dateFilter }, _count: { _all: true } }),
        ])
        const slugOf = (url: string) => {
          const path = url.split('?')[0]?.split('#')[0] ?? ''
          const parts = path.split('/').filter(Boolean)
          return parts[parts.length - 1] ?? ''
        }
        const viewsBySlug = new Map<string, number>()
        for (const r of pvRows) {
          const s = slugOf(String(r.url))
          if (s) viewsBySlug.set(s, (viewsBySlug.get(s) || 0) + Number(r.views))
        }
        const subsBySlug = new Map(subs.filter(s => s.pageSlug).map(s => [s.pageSlug as string, s._count._all]))
        const data = pages
          .map(p => ({ ...p, views: viewsBySlug.get(p.slug) || 0, submissions: subsBySlug.get(p.slug) || 0 }))
          .sort((a, b) => b.views - a.views)
        return {
          total, published,
          totalViews: data.reduce((a, p) => a + p.views, 0),
          totalConversions: data.reduce((a, p) => a + p.submissions, 0),
          data,
        }
      }

      case 'forms_performance': {
        // Mesma história do `pages_performance`: `Form.submissions` é acumulado.
        // Com período, conta as submissões reais (FormSubmission tem createdAt).
        const forms = await prisma.form.findMany({
          select: { id: true, name: true, active: true, submissions: true },
          orderBy: { submissions: 'desc' },
          take: cfg.limit || 10,
        })
        const total = await prisma.form.count()
        const active = await prisma.form.count({ where: { active: true } })
        if (!hasDate) {
          const totalSub = forms.reduce((a, f) => a + (f.submissions || 0), 0)
          return { total, active, totalSubmissions: totalSub, data: forms }
        }
        const grouped = await prisma.formSubmission.groupBy({
          by: ['formId'], where: { createdAt: dateFilter }, _count: { _all: true },
        })
        const byForm = new Map(grouped.map(g => [g.formId, g._count._all]))
        const data = forms
          .map(f => ({ ...f, submissions: byForm.get(f.id) || 0 }))
          .sort((a, b) => b.submissions - a.submissions)
        return { total, active, totalSubmissions: data.reduce((a, f) => a + f.submissions, 0), data }
      }

      case 'tracking_visitors': {
        // Respeita o período do painel (antes eram totais desde sempre, incoerente
        // com os demais KPIs). Sem filtro de data mantém o comportamento antigo.
        const [total, sessions, pageviews] = await Promise.all([
          prisma.trackingVisitor.count(hasDate ? { where: { lastSeenAt: dateFilter } } : undefined),
          prisma.trackingSession.count(hasDate ? { where: { startedAt: dateFilter } } : undefined),
          prisma.trackingEvent.count({ where: { type: 'pageview', ...(hasDate ? { timestamp: dateFilter } : {}) } }),
        ])
        return { total, sessions, pageviews }
      }

      case 'tracking_by_device': {
        const counts = await prisma.trackingSession.groupBy({
          by: ['deviceType'],
          ...(hasDate ? { where: { startedAt: dateFilter } } : {}),
          _count: { deviceType: true },
        })
        const data = counts.filter(c => c.deviceType).map(c => ({
          label: c.deviceType === 'desktop' ? 'Desktop' : c.deviceType === 'mobile' ? 'Mobile' : 'Tablet',
          value: c._count.deviceType,
        })).sort((a, b) => b.value - a.value)
        return { data }
      }

      case 'tracking_by_source': {
        const counts = await prisma.trackingSession.groupBy({
          by: ['utmSource'],
          ...(hasDate ? { where: { startedAt: dateFilter } } : {}),
          _count: { utmSource: true },
        })
        const data = counts.filter(c => c.utmSource).map(c => ({
          label: c.utmSource!,
          value: c._count.utmSource,
        })).sort((a, b) => b.value - a.value).slice(0, 10)
        return { data }
      }

      case 'meta_leads': {
        const at = hasDate ? { createdAt: dateFilter } : {}
        const [total, processed, failed] = await Promise.all([
          prisma.metaLeadLog.count({ where: at }),
          prisma.metaLeadLog.count({ where: { status: 'processed', ...at } }),
          prisma.metaLeadLog.count({ where: { status: 'failed', ...at } }),
        ])
        return { total, processed, failed }
      }

      case 'messages_volume': {
        const range = hasDate ? dateFilter : { gte: new Date(Date.now() - 30 * 86400000) }
        const msgs = await prisma.message.findMany({
          where: { createdAt: range },
          select: { createdAt: true, fromMe: true },
        })
        const sent = msgs.filter(m => m.fromMe).length
        const received = msgs.filter(m => !m.fromMe).length
        const byDay: Record<string, { sent: number; received: number }> = {}
        msgs.forEach(m => {
          const day = m.createdAt.toISOString().split('T')[0]
          if (!byDay[day]) byDay[day] = { sent: 0, received: 0 }
          if (m.fromMe) byDay[day].sent++; else byDay[day].received++
        })
        return { sent, received, total: msgs.length, data: Object.entries(byDay).sort().map(([label, v]) => ({ label, sent: v.sent, received: v.received })) }
      }

      case 'templates_usage': {
        // ÚNICA métrica que não acompanha o período, e por falta de dado: o uso
        // de template é registrado só como `usageCount` incrementado no envio
        // (routes/activities, workflowActions, cadenceScheduler, services/
        // messageTemplates) — não há linha com data para recortar. Recortar por
        // `Activity.templateId` cobriria só o envio manual e devolveria zero
        // para os automáticos, o que é pior que assumir o acumulado.
        // Para tornar period-scoped: gravar uma linha por uso (templateId + data).
        const templates = await prisma.messageTemplate.findMany({
          select: { id: true, name: true, channel: true, usageCount: true, active: true },
          orderBy: { usageCount: 'desc' },
          take: cfg.limit || 10,
        })
        return { data: templates, periodScoped: false }
      }

      case 'chatbots_summary': {
        const chatbots = await prisma.chatbot.findMany({
          ...(hasDate ? { where: { createdAt: dateFilter } } : {}),
          select: { id: true, name: true, channel: true, active: true },
        })
        const total = chatbots.length
        const byChannel: Record<string, number> = {}
        chatbots.forEach(c => { byChannel[c.channel] = (byChannel[c.channel] || 0) + 1 })
        return { total, data: Object.entries(byChannel).map(([label, value]) => ({ label, value })) }
      }

      case 'system_resources': {
        // Com período: o que foi criado no intervalo. Visitantes seguem
        // `lastSeenAt` (atividade), não a data de cadastro.
        const at = hasDate ? { createdAt: dateFilter } : {}
        const [pages, forms, chatbots, templates, visitors, metaForms] = await Promise.all([
          prisma.landingPage.count({ where: at }),
          prisma.form.count({ where: at }),
          prisma.chatbot.count({ where: at }),
          prisma.messageTemplate.count({ where: at }),
          prisma.trackingVisitor.count({ where: hasDate ? { lastSeenAt: dateFilter } : {} }),
          prisma.metaForm.count({ where: at }),
        ])
        return { pages, forms, chatbots, templates, visitors, metaForms }
      }

      case 'leads_by_tag': {
        // Sem período, o `_count` da relação já dá o total. Com período, conta
        // as marcações feitas no intervalo (LeadTag.createdAt) — a etiqueta pode
        // ser aplicada muito depois da captação do lead.
        const tags = await prisma.tag.findMany({
          where: { active: true },
          orderBy: [{ position: 'asc' }],
          select: { id: true, name: true, color: true, _count: { select: { leads: true } } },
        })
        if (!hasDate) return { data: tags.map(t => ({ label: t.name, value: t._count.leads, color: t.color })) }
        const grouped = await prisma.leadTag.groupBy({
          by: ['tagId'], where: { createdAt: dateFilter }, _count: { _all: true },
        })
        const byTag = new Map(grouped.map(g => [g.tagId, g._count._all]))
        return { data: tags.map(t => ({ label: t.name, value: byTag.get(t.id) || 0, color: t.color })) }
      }

      // ── Matrículas (Portal de Matrículas) ──
      case 'portals_total': {
        // Com período, conta os portais criados no intervalo (quantos portais
        // entraram no ar); sem período, o catálogo inteiro.
        const at = hasDate ? { createdAt: dateFilter } : {}
        const [total, active] = await Promise.all([
          prisma.enrollmentPortal.count({ where: at }),
          prisma.enrollmentPortal.count({ where: { active: true, ...at } }),
        ])
        return { value: active, total, active, inactive: total - active }
      }

      case 'registrations_total': {
        const regWhere: any = {}
        if (hasDate) regWhere.createdAt = dateFilter
        const total = await prisma.enrollmentRegistration.count({ where: regWhere })
        const prevRange = previousRange(cfg)
        if (!prevRange) return { value: total }
        const prev = await prisma.enrollmentRegistration.count({ where: { createdAt: prevRange } })
        return { value: total, prev }
      }

      case 'registrations_paid': {
        const regWhere: any = { paymentStatus: 'paid' }
        if (hasDate) regWhere.createdAt = dateFilter
        const paid = await prisma.enrollmentRegistration.count({ where: regWhere })
        const totalWhere: any = {}
        if (hasDate) totalWhere.createdAt = dateFilter
        const total = await prisma.enrollmentRegistration.count({ where: totalWhere })
        const prevRange = previousRange(cfg)
        if (!prevRange) return { value: paid, paid, total }
        const prev = await prisma.enrollmentRegistration.count({ where: { paymentStatus: 'paid', createdAt: prevRange } })
        return { value: paid, paid, total, prev }
      }

      case 'registrations_revenue': {
        const regWhere: any = { paymentStatus: 'paid' }
        if (hasDate) regWhere.createdAt = dateFilter
        const agg = await prisma.enrollmentRegistration.aggregate({
          where: regWhere,
          _sum: { paymentAmount: true },
        })
        const value = Number(agg._sum.paymentAmount || 0)
        const prevRange = previousRange(cfg)
        if (!prevRange) return { value, format: 'currency' }
        const p = await prisma.enrollmentRegistration.aggregate({
          where: { paymentStatus: 'paid', createdAt: prevRange },
          _sum: { paymentAmount: true },
        })
        return { value, format: 'currency', prev: Number(p._sum.paymentAmount || 0) }
      }

      case 'registrations_conversion_rate': {
        const regWhere: any = {}
        if (hasDate) regWhere.createdAt = dateFilter
        const [total, paid] = await Promise.all([
          prisma.enrollmentRegistration.count({ where: regWhere }),
          prisma.enrollmentRegistration.count({ where: { ...regWhere, paymentStatus: 'paid' } }),
        ])
        const rate = total > 0 ? Math.round((paid / total) * 100) : 0
        return { value: rate, paid, total }
      }

      case 'registrations_by_day': {
        const groupBy = cfg.groupBy || 'day'
        const defaultRange = groupBy === 'week' ? 90 : groupBy === 'month' ? 365 : 30
        const range = hasDate ? dateFilter : { gte: new Date(Date.now() - defaultRange * 86400000) }
        const regs = await prisma.enrollmentRegistration.findMany({
          where: { createdAt: range },
          select: { createdAt: true, paymentStatus: true },
          orderBy: { createdAt: 'asc' },
        })
        const buckets: Record<string, { total: number; paid: number }> = {}
        regs.forEach(r => {
          let key: string
          if (groupBy === 'week') {
            const d = new Date(r.createdAt)
            const day = d.getDay()
            const diff = d.getDate() - day + (day === 0 ? -6 : 1)
            key = new Date(d.setDate(diff)).toISOString().split('T')[0]
          } else if (groupBy === 'month') {
            key = r.createdAt.toISOString().substring(0, 7)
          } else {
            key = r.createdAt.toISOString().split('T')[0]
          }
          if (!buckets[key]) buckets[key] = { total: 0, paid: 0 }
          buckets[key].total++
          if (r.paymentStatus === 'paid') buckets[key].paid++
        })
        return { data: Object.entries(buckets).sort().map(([label, v]) => ({ label, value: v.total, paid: v.paid })) }
      }

      case 'registrations_by_portal': {
        const regWhere: any = {}
        if (hasDate) regWhere.createdAt = dateFilter
        const counts = await prisma.enrollmentRegistration.groupBy({
          by: ['portalId'],
          where: regWhere,
          _count: { _all: true },
        })
        const portals = await prisma.enrollmentPortal.findMany({
          where: { id: { in: counts.map(c => c.portalId) } },
          select: { id: true, nome: true },
        })
        const nameMap = new Map(portals.map(p => [p.id, p.nome]))
        const data = counts
          .map(c => ({ label: nameMap.get(c.portalId) || `Portal #${c.portalId}`, value: c._count._all, key: String(c.portalId) }))
          .sort((a, b) => b.value - a.value)
          .slice(0, cfg.limit || 10)
        return { data }
      }

      case 'registrations_by_status': {
        const regWhere: any = {}
        if (hasDate) regWhere.createdAt = dateFilter
        const counts = await prisma.enrollmentRegistration.groupBy({
          by: ['status'],
          where: regWhere,
          _count: { status: true },
        })
        const statusNames: Record<string, string> = {
          pending: 'Pendente', paid: 'Pago', docs_uploaded: 'Docs enviados', docs_reviewing: 'Em análise',
          docs_approved: 'Docs aprovados', docs_rejected: 'Docs rejeitados', approved: 'Aprovado',
          rejected: 'Rejeitado', enrolled: 'Matriculado', cancelled: 'Cancelado', expired: 'Expirado',
        }
        const statusColors: Record<string, string> = {
          pending: '#f9ab00', paid: '#1a73e8', docs_uploaded: '#00bcd4', docs_reviewing: '#9334e6',
          docs_approved: '#4caf50', docs_rejected: '#ea4335', approved: '#4caf50',
          rejected: '#ea4335', enrolled: '#34a853', cancelled: '#6b7280', expired: '#b0bec5',
        }
        const data = counts.map(c => ({
          label: statusNames[c.status] || c.status,
          value: c._count.status,
          color: statusColors[c.status] || '#1a73e8',
          key: c.status,
        })).sort((a, b) => b.value - a.value)
        return { data }
      }

      case 'registrations_by_source': {
        const regWhere: any = {}
        if (hasDate) regWhere.createdAt = dateFilter
        const counts = await prisma.enrollmentRegistration.groupBy({
          by: ['utmSource'],
          where: regWhere,
          _count: { _all: true },
        })
        const data = counts
          .map(c => ({ label: c.utmSource || '(direto)', value: c._count._all, key: c.utmSource || 'direto' }))
          .sort((a, b) => b.value - a.value)
          .slice(0, cfg.limit || 10)
        return { data }
      }

      case 'registrations_recent': {
        const regWhere: any = {}
        if (hasDate) regWhere.createdAt = dateFilter
        const regs = await prisma.enrollmentRegistration.findMany({
          where: regWhere,
          select: {
            id: true, candidateCode: true, status: true, paymentStatus: true, paymentAmount: true,
            formData: true, createdAt: true,
            portal: { select: { nome: true } },
          },
          orderBy: { createdAt: 'desc' },
          take: cfg.limit || 10,
        })
        const data = regs.map(r => {
          const fd = (r.formData as any) || {}
          return {
            id: r.id,
            candidateCode: r.candidateCode,
            nome: fd.nome || fd.nomeCompleto || '—',
            portal: r.portal?.nome || '—',
            status: r.status,
            paymentStatus: r.paymentStatus,
            paymentAmount: r.paymentAmount ? Number(r.paymentAmount) : null,
            createdAt: r.createdAt,
          }
        })
        return { data }
      }

      // ════════════════════ HELPDESK (F24) ════════════════════
      // Reusa computeHelpdeskReport (mesma fonte do painel de Relatórios).
      // Cada métrica devolve um superset p/ funcionar em vários tipos de widget.
      // O período do painel (dateFrom/dateTo) tem precedência sobre o preset
      // `range` do widget — antes ele era ignorado e o card ficava preso em 30d.
      case 'helpdesk_volume': {
        const rep = await computeHelpdeskReport(cfg.range || '30d', hdPeriod)
        return { ...rep.volume, value: rep.volume.created }
      }
      case 'helpdesk_sla': {
        const rep = await computeHelpdeskReport(cfg.range || '30d', hdPeriod)
        return {
          frPct: rep.sla.frPct, resPct: rep.sla.resPct, value: rep.sla.resPct ?? 0,
          data: [
            { label: '1ª resposta', value: rep.sla.frPct ?? 0 },
            { label: 'Resolução', value: rep.sla.resPct ?? 0 },
          ],
        }
      }
      case 'helpdesk_times': {
        const rep = await computeHelpdeskReport(cfg.range || '30d', hdPeriod)
        return { avgFirstResponseMins: rep.times.avgFirstResponseMins, avgResolutionMins: rep.times.avgResolutionMins }
      }
      case 'helpdesk_csat': {
        const days = cfg.range === '7d' ? 7 : cfg.range === '90d' ? 90 : 30
        const to = hdPeriod?.to ?? new Date()
        const since = hdPeriod?.from ?? new Date(to.getTime() - days * 86_400_000)
        const surveys = await prisma.helpdeskSurvey.findMany({ where: { sentAt: { gte: since, lte: to } }, select: { rating: true, respondedAt: true } })
        const responded = surveys.filter((s) => s.respondedAt && s.rating)
        const avg = responded.length ? Number((responded.reduce((a, s) => a + (s.rating || 0), 0) / responded.length).toFixed(1)) : 0
        return { avg, value: avg, responded: responded.length, sent: surveys.length }
      }
      case 'helpdesk_by_status': {
        const rep = await computeHelpdeskReport(cfg.range || '30d', hdPeriod)
        return { data: rep.byStatus.map((s) => ({ label: HD_STATUS_LABEL[s.key] || s.key, value: s.count })) }
      }
      case 'helpdesk_by_priority': {
        const rep = await computeHelpdeskReport(cfg.range || '30d', hdPeriod)
        return { data: rep.byPriority.map((s) => ({ label: HD_PRIORITY_LABEL[s.key] || s.key, value: s.count })) }
      }
      case 'helpdesk_by_channel': {
        const rep = await computeHelpdeskReport(cfg.range || '30d', hdPeriod)
        return { data: rep.byChannel.map((s) => ({ label: HD_CHANNEL_LABEL[s.key] || s.key, value: s.count })) }
      }
      case 'helpdesk_trend': {
        const rep = await computeHelpdeskReport(cfg.range || '30d', hdPeriod)
        return { data: rep.trend.map((t) => ({ label: t.date.slice(5), created: t.created, solved: t.solved, value: t.created })) }
      }
      case 'helpdesk_by_agent': {
        const rep = await computeHelpdeskReport(cfg.range || '30d', hdPeriod)
        return { data: rep.byAgent }
      }

      default:
        return { error: 'Métrica não reconhecida' }
    }
  })
}
