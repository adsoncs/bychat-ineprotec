// src/routes/goalsCommissions.ts
// Módulo Metas e Comissões — cadastro das regras/metas, painel de atingimento por
// agente e os lançamentos gerados pelas vendas do módulo Negociações.
//
// Recorte por papel: gestor (SUPERADMIN/ADMIN/MANAGER) vê e configura tudo;
// agente vê só o que é dele. Comissão alheia é informação sensível dentro do time
// — não vaza por um filtro que alguém esqueceu de aplicar na tela.

import { FastifyInstance, FastifyRequest } from 'fastify'
import { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma.js'
import { authMiddleware, adminOnly, type JwtPayload } from '../lib/auth.js'
import { logUserAudit, auditActor } from '../services/userAudit.js'
import {
  GOAL_METRICS, METRIC_LABEL, isMetric, normRateType,
  competenciaOf, monthRange, parseCompetencia, janelaDeFechamento,
  realizadoDoAgente, metaDoAgente, resolveRule, previewNegotiation,
  recalcPeriod, reconcile, type GoalMetric,
  faixasDeBonus, recalcularBonusDaRegra,
} from '../services/commissions.js'

const dec = (v: unknown): number => {
  if (v === null || v === undefined || v === '') return 0
  const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'))
  return Number.isFinite(n) ? n : 0
}
const numOrNull = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'))
  return Number.isFinite(n) ? n : null
}
const idOrNull = (v: unknown): number | null => {
  const n = Number(v)
  return Number.isInteger(n) && n > 0 ? n : null
}

function jwt(req: FastifyRequest): JwtPayload {
  return (req as any).user as JwtPayload
}
/** Gestor vê a operação inteira; agente vê só a própria linha. */
function isManager(req: FastifyRequest): boolean {
  const role = jwt(req)?.role
  return role === 'SUPERADMIN' || role === 'ADMIN' || role === 'MANAGER'
}
/** Escopo de leitura: null = pode ver todos; número = só este agente. */
function scopedUserId(req: FastifyRequest): number | null {
  if (isManager(req)) return null
  return Number(jwt(req)?.userId) || -1
}

/** Competência pedida na query, ou o mês corrente. */
function periodOf(q: any): { competencia: Date; start: Date; end: Date } {
  const competencia = parseCompetencia(q?.period) ?? competenciaOf(new Date())
  return { competencia, ...monthRange(competencia) }
}

const csvEscape = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`

export async function goalsCommissionsRoutes(app: FastifyInstance) {
  // ══ Regras de comissão ═══════════════════════════════════════════════════

  app.get('/api/admin/commissions/rules', { preHandler: [authMiddleware, adminOnly] }, async () => {
    const rules = await prisma.commissionRule.findMany({
      orderBy: [{ active: 'desc' }, { prioridade: 'desc' }, { id: 'desc' }],
      include: { tiers: { orderBy: { atingimentoMin: 'asc' } }, agents: { select: { userId: true } } },
    })
    const funnelIds = Array.from(new Set(rules.map((r) => r.funnelId).filter((v): v is number => !!v)))
    const funnels = funnelIds.length ? await prisma.funnel.findMany({ where: { id: { in: funnelIds } }, select: { id: true, name: true } }) : []
    const fname = new Map(funnels.map((f) => [f.id, f.name]))
    const userIds = Array.from(new Set(rules.flatMap((r) => r.agents.map((a) => a.userId))))
    const users = userIds.length ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }) : []
    const uname = new Map(users.map((u) => [u.id, u.name]))
    const portalIds = Array.from(new Set(rules.map((r) => r.portalId).filter((v): v is number => !!v)))
    const courseIds = Array.from(new Set(rules.map((r) => r.courseId).filter((v): v is number => !!v)))
    const [portais, cursos] = await Promise.all([
      portalIds.length ? prisma.enrollmentPortal.findMany({ where: { id: { in: portalIds } }, select: { id: true, nome: true } }) : [],
      courseIds.length ? prisma.course.findMany({ where: { id: { in: courseIds } }, select: { id: true, nome: true } }) : [],
    ])
    const pname = new Map(portais.map((p) => [p.id, p.nome]))
    const cname = new Map(cursos.map((c) => [c.id, c.nome]))
    return {
      rules: rules.map((r) => ({
        ...r,
        funnelName: r.funnelId ? fname.get(r.funnelId) ?? null : null,
        portalName: r.portalId ? pname.get(r.portalId) ?? null : null,
        courseName: r.courseId ? cname.get(r.courseId) ?? null : null,
        agentIds: r.agents.map((a) => a.userId),
        agentNames: r.agents.map((a) => uname.get(a.userId) ?? `#${a.userId}`),
      })),
    }
  })

  /** Corpo comum de criação/edição — a regra e suas faixas vêm num payload só. */
  function ruleData(b: any) {
    return {
      nome: String(b.nome || 'Regra de comissão').slice(0, 120),
      active: b.active !== false,
      funnelId: idOrNull(b.funnelId),
      portalId: idOrNull(b.portalId),
      courseId: idOrNull(b.courseId),
      prioridade: Math.round(dec(b.prioridade)),
      base: b.base === 'bruto' ? 'bruto' : 'liquido',
      tipoUnico: normRateType(b.tipoUnico),
      taxaUnico: numOrNull(b.taxaUnico),
      tipoRecorrente: normRateType(b.tipoRecorrente),
      taxaRecorrente: numOrNull(b.taxaRecorrente),
      mesesRecorrente: Math.max(1, Math.round(dec(b.mesesRecorrente) || 1)),
      aceleradorAtivo: !!b.aceleradorAtivo,
      aceleradorMetrica: isMetric(b.aceleradorMetrica) ? b.aceleradorMetrica : null,
      observacoes: b.observacoes ? String(b.observacoes).slice(0, 2000) : null,
      // Bônus por faixa: lista vazia grava NULL (regra sem bônus).
      bonusFaixas: (() => { const f = faixasDeBonus(b.bonusFaixas); return f.length ? (f as any) : Prisma.DbNull })(),
    }
  }
  /** Mudou a regra: o bônus do mês corrente acompanha (os meses fechados, só no Recalcular). */
  function refazerBonus(ruleId: number) {
    void recalcularBonusDaRegra(ruleId, competenciaOf(new Date())).catch((e) => console.warn('[Commissions] bônus', (e as Error).message))
  }
  function tierRows(b: any) {
    return (Array.isArray(b.tiers) ? b.tiers : []).map((t: any) => ({
      atingimentoMin: Math.max(0, Math.round(dec(t.atingimentoMin))),
      tipoUnico: normRateType(t.tipoUnico),
      taxaUnico: numOrNull(t.taxaUnico),
      tipoRecorrente: normRateType(t.tipoRecorrente),
      taxaRecorrente: numOrNull(t.taxaRecorrente),
    })).sort((a: any, b2: any) => a.atingimentoMin - b2.atingimentoMin)
  }

  app.post('/api/admin/commissions/rules', { preHandler: [authMiddleware, adminOnly] }, async (req) => {
    const b = (req.body as any) || {}
    const agentIds = (Array.isArray(b.agentIds) ? b.agentIds : []).map((v: any) => idOrNull(v)).filter((v: number | null): v is number => !!v)
    const rule = await prisma.commissionRule.create({
      data: {
        ...ruleData(b),
        tiers: { create: tierRows(b) },
        agents: { create: agentIds.map((userId: number) => ({ userId })) },
      },
      include: { tiers: true, agents: true },
    })
    void logUserAudit({ action: 'commission_rule.created', targetType: 'setting', targetLabel: `Regra de comissão ${rule.nome}`, changes: { id: rule.id }, ...auditActor(req) })
    refazerBonus(rule.id)
    return { rule }
  })

  app.put('/api/admin/commissions/rules/:id', { preHandler: [authMiddleware, adminOnly] }, async (req, reply) => {
    const id = Number((req.params as any).id)
    const b = (req.body as any) || {}
    const cur = await prisma.commissionRule.findUnique({ where: { id } })
    if (!cur) return reply.code(404).send({ error: 'Regra não encontrada' })
    const agentIds = (Array.isArray(b.agentIds) ? b.agentIds : []).map((v: any) => idOrNull(v)).filter((v: number | null): v is number => !!v)
    // Faixas e agentes são substituídos por inteiro: a lista que a tela mandou é
    // a verdade, e casar linha a linha só criaria caminhos de divergência.
    await prisma.commissionTier.deleteMany({ where: { ruleId: id } })
    await prisma.commissionRuleUser.deleteMany({ where: { ruleId: id } })
    const rule = await prisma.commissionRule.update({
      where: { id },
      data: {
        ...ruleData(b),
        tiers: { create: tierRows(b) },
        agents: { create: agentIds.map((userId: number) => ({ userId })) },
      },
      include: { tiers: true, agents: true },
    })
    void logUserAudit({ action: 'commission_rule.updated', targetType: 'setting', targetLabel: `Regra de comissão ${rule.nome}`, changes: { id }, ...auditActor(req) })
    refazerBonus(rule.id)
    return { rule }
  })

  app.delete('/api/admin/commissions/rules/:id', { preHandler: [authMiddleware, adminOnly] }, async (req) => {
    const id = Number((req.params as any).id)
    const rule = await prisma.commissionRule.findUnique({ where: { id }, select: { nome: true } })
    await prisma.commissionRule.delete({ where: { id } }).catch(() => {})
    void logUserAudit({ action: 'commission_rule.deleted', targetType: 'setting', targetLabel: `Regra de comissão ${rule?.nome ?? id}`, changes: { id }, ...auditActor(req) })
    // Lançamentos existentes ficam (ruleId vira null): a comissão já calculada é
    // histórico, não some porque a regra foi apagada.
    return { ok: true }
  })

  // ══ Metas ════════════════════════════════════════════════════════════════

  app.get('/api/admin/goals', { preHandler: authMiddleware }, async (req) => {
    const q = req.query as any
    const scoped = scopedUserId(req)
    const where: any = { active: q.includeInactive === '1' ? undefined : true }
    if (q.period) {
      const { start, end } = periodOf(q)
      where.periodStart = { lte: start }
      where.periodEnd = { gte: end }
    }
    const filtroUser = scoped ?? idOrNull(q.userId)
    if (filtroUser) where.userId = filtroUser
    else if (q.userId === 'none') where.userId = null
    if (idOrNull(q.funnelId)) where.funnelId = idOrNull(q.funnelId)
    const goals = await prisma.goal.findMany({
      where,
      orderBy: [{ periodStart: 'desc' }, { userId: 'asc' }, { metric: 'asc' }],
      include: { user: { select: { id: true, name: true } }, funnel: { select: { id: true, name: true } } },
      take: 1000,
    })
    return { goals, metrics: GOAL_METRICS.map((m) => ({ id: m, label: METRIC_LABEL[m] })) }
  })

  /**
   * Grava metas em lote — a tela edita a grade (agente × indicador) de um mês
   * inteiro de uma vez. `target` vazio APAGA a meta: deixar 0 gravado faria o
   * painel mostrar "0% de uma meta de zero", que não é a mesma coisa que "sem meta".
   */
  app.post('/api/admin/goals/bulk', { preHandler: [authMiddleware, adminOnly] }, async (req, reply) => {
    const b = (req.body as any) || {}
    const competencia = parseCompetencia(b.period)
    if (!competencia) return reply.code(400).send({ error: 'period inválido (use AAAA-MM)' })
    const { start, end } = monthRange(competencia)
    const rows = Array.isArray(b.goals) ? b.goals : []
    let gravadas = 0, apagadas = 0
    for (const row of rows) {
      const metric = isMetric(row.metric) ? (row.metric as GoalMetric) : null
      if (!metric) continue
      const userId = idOrNull(row.userId)
      const funnelId = idOrNull(row.funnelId)
      const target = numOrNull(row.target)
      const existing = await prisma.goal.findFirst({
        where: { userId, funnelId, metric, periodStart: start, periodEnd: end },
      })
      if (target == null || target <= 0) {
        if (existing) { await prisma.goal.delete({ where: { id: existing.id } }); apagadas++ }
        continue
      }
      if (existing) await prisma.goal.update({ where: { id: existing.id }, data: { target, active: true } })
      else await prisma.goal.create({ data: { userId, funnelId, metric, periodStart: start, periodEnd: end, target, active: true } })
      gravadas++
    }
    void logUserAudit({ action: 'goals.bulk_saved', targetType: 'setting', targetLabel: `Metas ${b.period}`, changes: { gravadas, apagadas }, ...auditActor(req) })
    return { ok: true, gravadas, apagadas }
  })

  app.delete('/api/admin/goals/:id', { preHandler: [authMiddleware, adminOnly] }, async (req) => {
    const id = Number((req.params as any).id)
    await prisma.goal.delete({ where: { id } }).catch(() => {})
    return { ok: true }
  })

  /** Copia a grade de metas de um mês para outro — a operação repete o alvo. */
  app.post('/api/admin/goals/copy', { preHandler: [authMiddleware, adminOnly] }, async (req, reply) => {
    const b = (req.body as any) || {}
    const de = parseCompetencia(b.from)
    const para = parseCompetencia(b.to)
    if (!de || !para) return reply.code(400).send({ error: 'from/to inválidos (use AAAA-MM)' })
    const origem = monthRange(de)
    const destino = monthRange(para)
    const goals = await prisma.goal.findMany({ where: { periodStart: origem.start, periodEnd: origem.end, active: true } })
    let copiadas = 0
    for (const g of goals) {
      const existing = await prisma.goal.findFirst({
        where: { userId: g.userId, funnelId: g.funnelId, metric: g.metric, periodStart: destino.start, periodEnd: destino.end },
      })
      if (existing) await prisma.goal.update({ where: { id: existing.id }, data: { target: g.target, active: true } })
      else await prisma.goal.create({ data: { userId: g.userId, funnelId: g.funnelId, metric: g.metric, periodStart: destino.start, periodEnd: destino.end, target: g.target, active: true } })
      copiadas++
    }
    return { ok: true, copiadas }
  })

  // ══ Painel: meta × realizado × comissão, por agente ═══════════════════════

  app.get('/api/admin/commissions/panel', { preHandler: authMiddleware }, async (req) => {
    const q = req.query as any
    const { competencia, start, end } = periodOf(q)
    const funnelId = idOrNull(q.funnelId)
    const scoped = scopedUserId(req)

    // Quem entra no painel: os agentes que podem receber lead (VIEWER nunca
    // recebe) mais quem tem meta ou venda no período — um vendedor desativado no
    // meio do mês ainda tem comissão a acertar.
    const base = await prisma.user.findMany({
      where: { role: { in: ['AGENT', 'MANAGER', 'ADMIN', 'SUPERADMIN'] } },
      select: { id: true, name: true, email: true, active: true, role: true },
      orderBy: { name: 'asc' },
    })
    const comMeta = await prisma.goal.findMany({
      where: { active: true, periodStart: { lte: start }, periodEnd: { gte: end }, userId: { not: null } },
      select: { userId: true },
    })
    const comVenda = await prisma.negotiation.findMany({
      where: { resultado: 'won', fechadaEm: janelaDeFechamento(start, end), responsavelUserId: { not: null } },
      select: { responsavelUserId: true },
    })
    const extraIds = Array.from(new Set([
      ...comMeta.map((g) => g.userId!),
      ...comVenda.map((n) => n.responsavelUserId!),
    ])).filter((id) => !base.some((u) => u.id === id))
    const extras = extraIds.length
      ? await prisma.user.findMany({ where: { id: { in: extraIds } }, select: { id: true, name: true, email: true, active: true, role: true } })
      : []
    let agentes = [...base, ...extras]
    if (scoped) agentes = agentes.filter((u) => u.id === scoped)

    const entries = await prisma.commissionEntry.findMany({
      where: { competencia, ...(funnelId ? { funnelId } : {}), ...(scoped ? { userId: scoped } : {}) },
      select: { userId: true, valorTotal: true, status: true, negotiationId: true },
    })
    // Bônus por faixa do mês (filtrado pelo funil da REGRA quando há filtro de funil).
    const bonusRows = await prisma.commissionBonus.findMany({
      where: { competencia, ...(scoped ? { userId: scoped } : {}), ...(funnelId ? { rule: { funnelId } } : {}) },
      include: { rule: { select: { nome: true } } },
    })
    const bonusDe = (uid: number | null) => {
      const rows = uid == null ? bonusRows : bonusRows.filter((b) => b.userId === uid)
      return {
        prevista: Math.round(rows.filter((b) => b.status === 'prevista').reduce((s, b) => s + dec(b.valor), 0) * 100) / 100,
        paga: Math.round(rows.filter((b) => b.status === 'paga').reduce((s, b) => s + dec(b.valor), 0) * 100) / 100,
        itens: rows.map((b) => ({ id: b.id, regra: b.rule?.nome ?? null, quantidade: b.quantidade, faixaMin: b.faixaMin, valor: dec(b.valor), status: b.status, observacoes: b.observacoes })),
      }
    }

    const linhas = []
    for (const u of agentes) {
      const real = await realizadoDoAgente(u.id, funnelId, start, end)
      const metas: Record<string, { target: number | null; atual: number | null; atingimento: number | null }> = {}
      for (const m of GOAL_METRICS) {
        const meta = await metaDoAgente(u.id, funnelId, m, start, end)
        const atual = m === 'conversion' ? real.conversion : real[m]
        metas[m] = {
          target: meta?.target ?? null,
          atual: atual ?? null,
          atingimento: meta && meta.target > 0 && atual != null ? Math.round((atual / meta.target) * 10000) / 100 : null,
        }
      }
      const meus = entries.filter((e) => e.userId === u.id)
      const bonus = bonusDe(u.id)
      const rule = await resolveRule(u.id, funnelId)
      linhas.push({
        userId: u.id, nome: u.name, email: u.email, active: u.active, role: u.role,
        realizado: real,
        metas,
        regra: rule ? { id: rule.id, nome: rule.nome, aceleradorAtivo: rule.aceleradorAtivo, aceleradorMetrica: rule.aceleradorMetrica } : null,
        // prevista/paga já somam o bônus; `bonus` detalha para a tela explicar.
        comissao: {
          prevista: Math.round((meus.filter((e) => e.status === 'prevista').reduce((s, e) => s + dec(e.valorTotal), 0) + bonus.prevista) * 100) / 100,
          paga: Math.round((meus.filter((e) => e.status === 'paga').reduce((s, e) => s + dec(e.valorTotal), 0) + bonus.paga) * 100) / 100,
          lancamentos: meus.filter((e) => e.status !== 'cancelada').length,
          bonus,
        },
      })
    }

    // Linha da operação: a meta do funil sem agente (userId null) contra o que o
    // time inteiro fez — é a leitura do gestor, não a soma das metas individuais
    // (que quase nunca fecha com a meta da empresa).
    const totalReal = await realizadoDoAgente(null, funnelId, start, end)
    const totalMetas: Record<string, { target: number | null; atual: number | null; atingimento: number | null }> = {}
    for (const m of GOAL_METRICS) {
      const meta = await metaDoAgente(null, funnelId, m, start, end)
      const atual = m === 'conversion' ? totalReal.conversion : totalReal[m]
      totalMetas[m] = {
        target: meta?.target ?? null,
        atual: atual ?? null,
        atingimento: meta && meta.target > 0 && atual != null ? Math.round((atual / meta.target) * 10000) / 100 : null,
      }
    }

    return {
      period: `${competencia.getUTCFullYear()}-${String(competencia.getUTCMonth() + 1).padStart(2, '0')}`,
      funnelId,
      escopoProprio: !!scoped,
      agentes: linhas,
      operacao: {
        realizado: totalReal,
        metas: totalMetas,
        comissao: {
          prevista: Math.round((entries.filter((e) => e.status === 'prevista').reduce((s, e) => s + dec(e.valorTotal), 0) + bonusDe(null).prevista) * 100) / 100,
          paga: Math.round((entries.filter((e) => e.status === 'paga').reduce((s, e) => s + dec(e.valorTotal), 0) + bonusDe(null).paga) * 100) / 100,
          lancamentos: entries.filter((e) => e.status !== 'cancelada').length,
          bonus: bonusDe(null),
        },
      },
      metrics: GOAL_METRICS.map((m) => ({ id: m, label: METRIC_LABEL[m] })),
    }
  })

  // ══ Lançamentos ══════════════════════════════════════════════════════════

  app.get('/api/admin/commissions/entries', { preHandler: authMiddleware }, async (req, reply) => {
    const q = req.query as any
    const scoped = scopedUserId(req)
    const page = Math.max(1, Number(q.page) || 1)
    const limit = Math.min(200, Math.max(1, Number(q.limit) || 50))

    const where: any = {}
    if (q.period) where.competencia = periodOf(q).competencia
    if (q.status && ['prevista', 'paga', 'cancelada'].includes(q.status)) where.status = q.status
    const filtroUser = scoped ?? idOrNull(q.userId)
    if (filtroUser) where.userId = filtroUser
    if (idOrNull(q.funnelId)) where.funnelId = idOrNull(q.funnelId)

    const [rows, total, somas] = await Promise.all([
      prisma.commissionEntry.findMany({
        where, orderBy: [{ fechadaEm: 'desc' }, { id: 'desc' }],
        skip: q.format === 'csv' ? 0 : (page - 1) * limit,
        take: q.format === 'csv' ? 5000 : limit,
      }),
      prisma.commissionEntry.count({ where }),
      prisma.commissionEntry.groupBy({ by: ['status'], where, _sum: { valorTotal: true }, _count: { _all: true } }),
    ])

    const leadIds = Array.from(new Set(rows.map((r) => r.leadId)))
    const leads = leadIds.length ? await prisma.lead.findMany({ where: { id: { in: leadIds } }, select: { id: true, nome: true } }) : []
    const lname = new Map(leads.map((l) => [l.id, l.nome]))
    const userIds = Array.from(new Set(rows.map((r) => r.userId).filter((v): v is number => !!v)))
    const users = userIds.length ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }) : []
    const uname = new Map(users.map((u) => [u.id, u.name]))
    const negIds = rows.map((r) => r.negotiationId)
    const negs = negIds.length ? await prisma.negotiation.findMany({ where: { id: { in: negIds } }, select: { id: true, titulo: true, valorFinal: true } }) : []
    const nmeta = new Map(negs.map((n) => [n.id, n]))
    const ruleIds = Array.from(new Set(rows.map((r) => r.ruleId).filter((v): v is number => !!v)))
    const rules = ruleIds.length ? await prisma.commissionRule.findMany({ where: { id: { in: ruleIds } }, select: { id: true, nome: true } }) : []
    const rname = new Map(rules.map((r) => [r.id, r.nome]))

    const enriched = rows.map((r) => ({
      ...r,
      leadNome: lname.get(r.leadId) ?? `Lead #${r.leadId}`,
      agenteNome: r.userId ? uname.get(r.userId) ?? `#${r.userId}` : null,
      negociacaoTitulo: nmeta.get(r.negotiationId)?.titulo ?? null,
      negociacaoValor: nmeta.get(r.negotiationId)?.valorFinal ?? null,
      regraNome: r.ruleId ? rname.get(r.ruleId) ?? null : null,
    }))

    if (q.format === 'csv') {
      const head = ['Competência', 'Fechada em', 'Agente', 'Lead', 'Proposta', 'Regra', 'Base única', 'Base mensal', 'Comissão única', 'Comissão mensal', 'Comissão total', 'Atingimento (%)', 'Status']
      const linhas = enriched.map((e) => [
        e.competencia.toISOString().slice(0, 7), e.fechadaEm.toISOString().slice(0, 10),
        e.agenteNome ?? '', e.leadNome, e.negociacaoTitulo ?? '', e.regraNome ?? '',
        dec(e.baseUnico).toFixed(2).replace('.', ','), dec(e.baseRecorrente).toFixed(2).replace('.', ','),
        dec(e.valorUnico).toFixed(2).replace('.', ','), dec(e.valorRecorrente).toFixed(2).replace('.', ','),
        dec(e.valorTotal).toFixed(2).replace('.', ','),
        e.atingimento != null ? dec(e.atingimento).toFixed(2).replace('.', ',') : '',
        e.status,
      ].map(csvEscape).join(';'))
      return reply
        .header('Content-Disposition', 'attachment; filename="comissoes.csv"')
        .type('text/csv; charset=utf-8')
        .send('﻿' + [head.map(csvEscape).join(';'), ...linhas].join('\n'))
    }

    const somaDe = (status: string) => {
      const row = somas.find((s) => s.status === status)
      return { valor: dec(row?._sum.valorTotal), count: row?._count._all ?? 0 }
    }
    // Bônus por faixa do mesmo recorte (agente/período/status). Lista curta —
    // um por vendedor e regra no mês —, então vem inteira, fora da paginação.
    const bonusWhere: any = {}
    if (where.competencia) bonusWhere.competencia = where.competencia
    if (where.userId) bonusWhere.userId = where.userId
    if (where.status && where.status !== 'cancelada') bonusWhere.status = where.status
    const bonusRows = where.status === 'cancelada' ? [] : await prisma.commissionBonus.findMany({
      where: bonusWhere, orderBy: [{ competencia: 'desc' }, { valor: 'desc' }], include: { rule: { select: { nome: true } } },
    })
    const bUsers = await prisma.user.findMany({ where: { id: { in: [...new Set(bonusRows.map((b) => b.userId))] } }, select: { id: true, name: true } })
    const bonus = bonusRows.map((b) => ({
      id: b.id, competencia: b.competencia, userId: b.userId, agenteNome: bUsers.find((u) => u.id === b.userId)?.name ?? `#${b.userId}`,
      regraNome: b.rule?.nome ?? null, quantidade: b.quantidade, faixaMin: b.faixaMin, valor: dec(b.valor),
      status: b.status, pagaEm: b.pagaEm, observacoes: b.observacoes,
    }))
    return {
      entries: enriched, total, page, limit,
      kpis: { prevista: somaDe('prevista'), paga: somaDe('paga'), cancelada: somaDe('cancelada') },
      bonus,
    }
  })

  app.post('/api/admin/commissions/entries/:id/pay', { preHandler: [authMiddleware, adminOnly] }, async (req, reply) => {
    const id = Number((req.params as any).id)
    const b = (req.body as any) || {}
    const actor = auditActor(req)
    const entry = await prisma.commissionEntry.findUnique({ where: { id } })
    if (!entry) return reply.code(404).send({ error: 'Lançamento não encontrado' })
    const pagar = b.paga !== false
    const updated = await prisma.commissionEntry.update({
      where: { id },
      data: pagar
        ? { status: 'paga', pagaEm: b.pagaEm ? new Date(b.pagaEm) : new Date(), pagaPor: actor.actorId }
        : { status: 'prevista', pagaEm: null, pagaPor: null },
    })
    void logUserAudit({
      action: pagar ? 'commission.paid' : 'commission.unpaid', targetType: 'user',
      targetUserId: entry.userId, targetLabel: `Comissão #${id}`,
      changes: { valorTotal: entry.valorTotal, negotiationId: entry.negotiationId }, ...actor,
    })
    return { entry: updated }
  })

  app.post('/api/admin/commissions/bonus/:id/pay', { preHandler: [authMiddleware, adminOnly] }, async (req, reply) => {
    const id = Number((req.params as any).id)
    const b = (req.body as any) || {}
    const actor = auditActor(req)
    const bonus = await prisma.commissionBonus.findUnique({ where: { id } })
    if (!bonus) return reply.code(404).send({ error: 'Bônus não encontrado' })
    const pagar = b.paga !== false
    const updated = await prisma.commissionBonus.update({
      where: { id },
      data: pagar
        ? { status: 'paga', pagaEm: b.pagaEm ? new Date(b.pagaEm) : new Date(), pagaPor: actor.actorId }
        : { status: 'prevista', pagaEm: null, pagaPor: null },
    })
    // Voltou para prevista: a contagem atual pode ter mudado desde o pagamento.
    if (!pagar) {
      const { recalcularBonusDoMes } = await import('../services/commissions.js')
      await recalcularBonusDoMes(bonus.userId, bonus.competencia)
    }
    void logUserAudit({
      action: pagar ? 'commission.bonus_paid' : 'commission.bonus_unpaid', targetType: 'user',
      targetUserId: bonus.userId, targetLabel: `Bônus por faixa #${id}`,
      changes: { valor: bonus.valor, quantidade: bonus.quantidade, faixaMin: bonus.faixaMin }, ...actor,
    })
    return { bonus: updated }
  })

  /** Marca em lote — fechamento do mês é uma ação só, não uma por linha. */
  app.post('/api/admin/commissions/entries/pay-batch', { preHandler: [authMiddleware, adminOnly] }, async (req, reply) => {
    const b = (req.body as any) || {}
    const ids = (Array.isArray(b.ids) ? b.ids : []).map((v: any) => Number(v)).filter((n: number) => Number.isInteger(n) && n > 0)
    if (!ids.length) return reply.code(400).send({ error: 'ids é obrigatório' })
    const actor = auditActor(req)
    const pagar = b.paga !== false
    const r = await prisma.commissionEntry.updateMany({
      where: { id: { in: ids }, status: pagar ? 'prevista' : 'paga' },
      data: pagar ? { status: 'paga', pagaEm: new Date(), pagaPor: actor.actorId } : { status: 'prevista', pagaEm: null, pagaPor: null },
    })
    void logUserAudit({ action: pagar ? 'commission.paid_batch' : 'commission.unpaid_batch', targetType: 'setting', targetLabel: `${r.count} comissão(ões)`, changes: { ids }, ...actor })
    return { ok: true, count: r.count }
  })

  // ══ Recálculo e conferência ══════════════════════════════════════════════

  app.post('/api/admin/commissions/recalc', { preHandler: [authMiddleware, adminOnly] }, async (req, reply) => {
    const b = (req.body as any) || {}
    const competencia = parseCompetencia(b.period)
    if (!competencia) return reply.code(400).send({ error: 'period inválido (use AAAA-MM)' })
    const { start, end } = monthRange(competencia)
    const r = await recalcPeriod(start, end, idOrNull(b.userId))
    void logUserAudit({ action: 'commission.recalc', targetType: 'setting', targetLabel: `Recálculo ${b.period}`, changes: r, ...auditActor(req) })
    return { ok: true, ...r }
  })

  // ── Receita única (Fase 4) ───────────────────────────────────────────────
  // Chave que torna o valor de venda do lead derivado das propostas ganhas +
  // inscrições pagas, e a conciliação das divergências antigas.
  app.get('/api/admin/receita/config', { preHandler: [authMiddleware, adminOnly] }, async () => {
    const { configReceita } = await import('../services/receitaUnica.js')
    return configReceita()
  })
  app.put('/api/admin/receita/config', { preHandler: [authMiddleware, adminOnly] }, async (req) => {
    const { salvarConfigReceita } = await import('../services/receitaUnica.js')
    const ligado = (req.body as any)?.ligado === true
    const quem = auditActor(req)
    const c = await salvarConfigReceita(ligado, quem.actorName ?? null)
    void logUserAudit({ action: 'receita.fonte_unica', targetType: 'setting', targetLabel: `Receita única ${ligado ? 'ligada' : 'desligada'}`, changes: { ligado }, ...quem })
    return c
  })
  app.get('/api/admin/receita/conciliacao', { preHandler: [authMiddleware, adminOnly] }, async () => {
    const { conciliacao } = await import('../services/receitaUnica.js')
    const r = await conciliacao()
    const soma = (k: 'atual' | 'novo') => Math.round(r.divergencias.reduce((s, d) => s + (d[k] ?? 0), 0) * 100) / 100
    return { ...r, total: r.divergencias.length, somaAtual: soma('atual'), somaNova: soma('novo') }
  })
  /** Corrige o valor de venda dos leads escolhidos (ou de todos os divergentes). */
  app.post('/api/admin/receita/conciliacao/aplicar', { preHandler: [authMiddleware, adminOnly] }, async (req) => {
    const { conciliacao, sincronizarValorDeVenda } = await import('../services/receitaUnica.js')
    const pedidos = Array.isArray((req.body as any)?.leadIds)
      ? ((req.body as any).leadIds as unknown[]).map(Number).filter((n) => Number.isInteger(n) && n > 0)
      : (await conciliacao()).divergencias.map((d) => d.leadId)
    const quem = auditActor(req)
    const mudancas: { leadId: number; antes: number | null; depois: number | null }[] = []
    for (const leadId of pedidos) {
      const m = await sincronizarValorDeVenda(leadId, { forcar: true, origem: 'conciliacao', userId: quem.actorId ?? null, userName: quem.actorName ?? null })
      if (m) mudancas.push({ leadId, ...m })
    }
    // O antes de cada lead fica na auditoria: é o que permite desfazer.
    void logUserAudit({ action: 'receita.conciliacao_aplicada', targetType: 'setting', targetLabel: `Conciliação de receita: ${mudancas.length} lead(s)`, changes: { mudancas }, ...quem })
    return { corrigidos: mudancas.length }
  })

  app.get('/api/admin/commissions/reconcile', { preHandler: [authMiddleware, adminOnly] }, async (req) => {
    const { start, end } = periodOf(req.query as any)
    const divergencias = await reconcile(start, end)
    return { divergencias, total: divergencias.length }
  })

  /**
   * Comissão que esta proposta pagaria. O editor da negociação mostra o número
   * ANTES de fechar — vendedor negociando desconto vê na hora o que aquilo custa
   * na comissão dele, que é o ponto de "plugado em cada agente".
   */
  app.get('/api/admin/commissions/preview/:negotiationId', { preHandler: authMiddleware }, async (req, reply) => {
    const negotiationId = Number((req.params as any).negotiationId)
    if (!negotiationId) return reply.code(400).send({ error: 'negotiationId inválido' })
    const preview = await previewNegotiation(negotiationId, { hipotetica: true })
    const scoped = scopedUserId(req)
    // Agente só vê a estimativa da própria venda.
    if (scoped && preview.userId && preview.userId !== scoped) {
      return { preview: { aplicavel: false, motivo: 'Comissão de outro agente', valorTotal: 0 } }
    }
    const entry = await prisma.commissionEntry.findUnique({ where: { negotiationId } }).catch(() => null)
    return { preview, entry }
  })
}
