// src/routes/statusSummaries.ts
// Módulo Resumo: catálogo (resumos + templates de atividade) e aplicação a leads.
//
// Leitura: qualquer operador autenticado — o seletor de Resumo no card do lead
// precisa da lista. Mutação do catálogo: adminOnly. Aplicar resumo a um lead é
// operação de atendimento, então basta authMiddleware.

import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { authMiddleware, adminOnly, type JwtPayload } from '../lib/auth.js'
import {
  applyStatusSummary,
  StatusSummaryError,
  type ApplySource,
} from '../services/statusSummaryEngine.js'

const DUE_MODES = ['immediate', 'hours', 'days', 'business_days', 'lead_defined']
const ASSIGNEE_MODES = ['lead_owner', 'team', 'user', 'round_robin', 'creator']
const OUTCOMES = ['won', 'lost']
const TEMPERATURES = ['quente', 'morno', 'frio']

const summaryInclude = {
  activities: {
    include: { activityTemplate: true },
    orderBy: { order: 'asc' as const },
  },
} as const

export async function statusSummaryRoutes(app: FastifyInstance) {

  // ══════════════════════════════════════════════
  // CATÁLOGO DE RESUMOS
  // ══════════════════════════════════════════════

  // GET /api/status-summaries?funnelId=&active=all
  // Sem funnelId devolve o catálogo inteiro (tela de configuração).
  // Com funnelId devolve o que se aplica àquele funil: os dele + os globais.
  app.get('/api/status-summaries', { preHandler: authMiddleware }, async (req) => {
    const q = req.query as { funnelId?: string; active?: string }
    const where: Record<string, unknown> = {}
    if (q.active !== 'all') where.active = true
    if (q.funnelId) {
      const fid = Number(q.funnelId)
      if (Number.isFinite(fid)) where.OR = [{ funnelId: fid }, { funnelId: null }]
    }
    const rows = await prisma.statusSummary.findMany({
      where,
      include: summaryInclude,
      orderBy: [{ position: 'asc' }, { code: 'asc' }],
    })
    return { data: rows }
  })

  app.get('/api/status-summaries/:id', { preHandler: authMiddleware }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const row = await prisma.statusSummary.findUnique({
      where: { id: Number(id) },
      include: summaryInclude,
    })
    if (!row) return reply.code(404).send({ error: 'Resumo não encontrado' })
    return { data: row }
  })

  app.post('/api/status-summaries', { preHandler: adminOnly }, async (req, reply) => {
    const body = (req.body || {}) as Record<string, any>
    const err = validateSummary(body, true)
    if (err) return reply.code(400).send({ error: err })

    const exists = await prisma.statusSummary.findFirst({
      where: { code: String(body.code).trim().toUpperCase(), funnelId: body.funnelId ?? null },
      select: { id: true },
    })
    if (exists) return reply.code(409).send({ error: 'Já existe um resumo com este código neste funil' })

    const row = await prisma.statusSummary.create({
      data: buildSummaryData(body, true),
      include: summaryInclude,
    })
    return reply.code(201).send({ data: row })
  })

  app.put('/api/status-summaries/:id', { preHandler: adminOnly }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const body = (req.body || {}) as Record<string, any>
    const err = validateSummary(body, false)
    if (err) return reply.code(400).send({ error: err })

    const current = await prisma.statusSummary.findUnique({ where: { id: Number(id) }, select: { id: true } })
    if (!current) return reply.code(404).send({ error: 'Resumo não encontrado' })

    const row = await prisma.statusSummary.update({
      where: { id: Number(id) },
      data: buildSummaryData(body, false),
      include: summaryInclude,
    })
    return { data: row }
  })

  // DELETE — desativa em vez de apagar. Resumo apagado levaria junto o histórico
  // (FK cascade em LeadStatusHistory), e o histórico é o relatório.
  app.delete('/api/status-summaries/:id', { preHandler: adminOnly }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const row = await prisma.statusSummary.findUnique({ where: { id: Number(id) }, select: { id: true } })
    if (!row) return reply.code(404).send({ error: 'Resumo não encontrado' })
    await prisma.statusSummary.update({ where: { id: Number(id) }, data: { active: false } })
    return { ok: true, deactivated: true }
  })

  // PUT /api/status-summaries/:id/activities — define quais atividades o resumo gera
  app.put('/api/status-summaries/:id/activities', { preHandler: adminOnly }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const body = (req.body || {}) as {
      activities?: Array<{
        activityTemplateId: number
        dueOverrideMode?: string | null
        dueOverrideValue?: number | null
        titleOverride?: string | null
        order?: number
      }>
    }
    const list = Array.isArray(body.activities) ? body.activities : []
    for (const a of list) {
      if (!Number.isFinite(a.activityTemplateId)) {
        return reply.code(400).send({ error: 'activityTemplateId inválido' })
      }
      if (a.dueOverrideMode && !DUE_MODES.includes(a.dueOverrideMode)) {
        return reply.code(400).send({ error: `dueOverrideMode inválido: use ${DUE_MODES.join(', ')}` })
      }
    }

    const summaryId = Number(id)
    await prisma.$transaction([
      prisma.statusSummaryActivity.deleteMany({ where: { summaryId } }),
      ...(list.length
        ? [prisma.statusSummaryActivity.createMany({
            data: list.map((a, i) => ({
              summaryId,
              activityTemplateId: Number(a.activityTemplateId),
              dueOverrideMode: a.dueOverrideMode ?? null,
              dueOverrideValue: a.dueOverrideValue ?? null,
              titleOverride: a.titleOverride ?? null,
              order: Number.isFinite(a.order) ? Number(a.order) : i,
            })),
          })]
        : []),
    ])

    const row = await prisma.statusSummary.findUnique({ where: { id: summaryId }, include: summaryInclude })
    return { data: row }
  })

  // ══════════════════════════════════════════════
  // CATÁLOGO DE TEMPLATES DE ATIVIDADE
  // ══════════════════════════════════════════════

  app.get('/api/activity-templates', { preHandler: authMiddleware }, async (req) => {
    const q = req.query as { active?: string }
    const where = q.active === 'all' ? {} : { active: true }
    const rows = await prisma.activityTemplate.findMany({
      where,
      orderBy: [{ code: 'asc' }],
    })
    return { data: rows }
  })

  app.post('/api/activity-templates', { preHandler: adminOnly }, async (req, reply) => {
    const body = (req.body || {}) as Record<string, any>
    const err = validateTemplate(body, true)
    if (err) return reply.code(400).send({ error: err })

    const code = String(body.code).trim().toUpperCase()
    const exists = await prisma.activityTemplate.findUnique({ where: { code }, select: { id: true } })
    if (exists) return reply.code(409).send({ error: 'Já existe um template com este código' })

    const row = await prisma.activityTemplate.create({ data: buildTemplateData(body, true) })
    return reply.code(201).send({ data: row })
  })

  app.put('/api/activity-templates/:id', { preHandler: adminOnly }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const body = (req.body || {}) as Record<string, any>
    const err = validateTemplate(body, false)
    if (err) return reply.code(400).send({ error: err })

    const current = await prisma.activityTemplate.findUnique({ where: { id: Number(id) }, select: { id: true } })
    if (!current) return reply.code(404).send({ error: 'Template não encontrado' })

    const row = await prisma.activityTemplate.update({ where: { id: Number(id) }, data: buildTemplateData(body, false) })
    return { data: row }
  })

  app.delete('/api/activity-templates/:id', { preHandler: adminOnly }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const row = await prisma.activityTemplate.findUnique({ where: { id: Number(id) }, select: { id: true } })
    if (!row) return reply.code(404).send({ error: 'Template não encontrado' })
    await prisma.activityTemplate.update({ where: { id: Number(id) }, data: { active: false } })
    return { ok: true, deactivated: true }
  })

  // ══════════════════════════════════════════════
  // APLICAR RESUMO A UM LEAD
  // ══════════════════════════════════════════════

  // POST /api/leads/:id/status-summary  { code, note?, lossReasonId?, dueAt? }
  app.post('/api/leads/:id/status-summary', { preHandler: authMiddleware }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const body = (req.body || {}) as { code?: string; note?: string; lossReasonId?: number; dueAt?: string }
    const user = (req as any).user as JwtPayload

    if (!body.code) return reply.code(400).send({ error: 'code obrigatório' })

    try {
      const result = await applyStatusSummary({
        leadId: Number(id),
        code: String(body.code).trim().toUpperCase(),
        userId: user?.userId ?? null,
        userName: user?.name || user?.email || null,
        source: 'panel' as ApplySource,
        note: body.note,
        lossReasonId: body.lossReasonId ?? null,
        dueAt: body.dueAt ? new Date(body.dueAt) : null,
      })
      return { data: result }
    } catch (e) {
      if (e instanceof StatusSummaryError) {
        // 404 pro catálogo, 422 pras travas de governança (o painel mostra a
        // mensagem ao operador e ele corrige antes de reenviar).
        const code = e.code === 'SUMMARY_NOT_FOUND' || e.code === 'LEAD_NOT_FOUND' ? 404 : 422
        return reply.code(code).send({ error: e.message, code: e.code, details: e.details })
      }
      req.log.error(e)
      return reply.code(500).send({ error: 'Falha ao aplicar resumo' })
    }
  })

  // ══════════════════════════════════════════════
  // RELATÓRIO POR RESUMO
  // ══════════════════════════════════════════════

  // GET /api/status-summaries/report?funnelId=&from=&to=
  // Para cada resumo: quantas vezes foi aplicado, quantos leads estão nele hoje,
  // tempo médio até sair dele e para onde foram. É o que responde "quantos
  // AT-030 viram AT-200 e quantos morreram em AT-033".
  app.get('/api/status-summaries/report', { preHandler: authMiddleware }, async (req) => {
    const q = req.query as { funnelId?: string; from?: string; to?: string }

    const range: { gte?: Date; lte?: Date } = {}
    if (q.from) range.gte = new Date(q.from)
    if (q.to) {
      const to = new Date(q.to)
      if (q.to.length === 10) to.setHours(23, 59, 59, 999)
      range.lte = to
    }

    const funnelId = q.funnelId ? Number(q.funnelId) : null
    const summaries = await prisma.statusSummary.findMany({
      where: {
        active: true,
        ...(funnelId != null ? { OR: [{ funnelId }, { funnelId: null }] } : {}),
      },
      orderBy: [{ position: 'asc' }, { code: 'asc' }],
      select: { id: true, code: true, name: true, color: true, sector: true, temperature: true },
    })
    const ids = summaries.map((s) => s.id)
    if (ids.length === 0) return { data: [] }

    const historyWhere = {
      toSummaryId: { in: ids },
      ...(range.gte || range.lte ? { changedAt: range } : {}),
    }

    const [applied, current, transitions] = await Promise.all([
      // Quantas vezes cada resumo foi aplicado no período.
      prisma.leadStatusHistory.groupBy({
        by: ['toSummaryId'],
        where: historyWhere,
        _count: { _all: true },
      }),
      // Quantos leads estão parados nele agora.
      prisma.lead.groupBy({
        by: ['statusSummaryId'],
        where: { statusSummaryId: { in: ids } },
        _count: { _all: true },
      }),
      // Para onde foram: cada par (origem → destino) no período.
      prisma.leadStatusHistory.groupBy({
        by: ['fromSummaryId', 'toCode'],
        where: {
          fromSummaryId: { in: ids },
          ...(range.gte || range.lte ? { changedAt: range } : {}),
        },
        _count: { _all: true },
      }),
    ])

    const appliedBy = new Map(applied.map((a) => [a.toSummaryId, a._count._all]))
    const currentBy = new Map(current.map((c) => [c.statusSummaryId, c._count._all]))
    const nextBy = new Map<number, Array<{ code: string; count: number }>>()
    for (const t of transitions) {
      if (t.fromSummaryId == null) continue
      const list = nextBy.get(t.fromSummaryId) ?? []
      list.push({ code: t.toCode, count: t._count._all })
      nextBy.set(t.fromSummaryId, list)
    }

    const data = summaries.map((s) => {
      const appliedCount = appliedBy.get(s.id) ?? 0
      const next = (nextBy.get(s.id) ?? []).sort((a, b) => b.count - a.count)
      const leftCount = next.reduce((sum, n) => sum + n.count, 0)
      return {
        ...s,
        applied: appliedCount,
        currentLeads: currentBy.get(s.id) ?? 0,
        // Ainda no resumo: aplicado no período menos os que já saíram dele.
        // Pode ser negativo quando o recorte de período corta a entrada; nesse
        // caso reportamos 0 em vez de um número sem sentido.
        stillHere: Math.max(0, appliedCount - leftCount),
        nextSummaries: next,
      }
    })

    return { data }
  })

  // GET /api/leads/:id/status-history — timeline de resumos do lead
  app.get('/api/leads/:id/status-history', { preHandler: authMiddleware }, async (req) => {
    const { id } = req.params as { id: string }
    const rows = await prisma.leadStatusHistory.findMany({
      where: { leadId: Number(id) },
      orderBy: { changedAt: 'desc' },
      take: 100,
      include: {
        toSummary: { select: { id: true, code: true, name: true, color: true, sector: true } },
        changedByUser: { select: { id: true, name: true, email: true } },
      },
    })
    return { data: rows }
  })
}

// ─── Validação / normalização ──────────────────────────

function validateSummary(body: Record<string, any>, isCreate: boolean): string | null {
  if (isCreate) {
    if (!body.code || !String(body.code).trim()) return 'code obrigatório'
    if (!body.name || !String(body.name).trim()) return 'name obrigatório'
  }
  if (body.code && String(body.code).trim().length > 20) return 'code muito longo (máx 20)'
  if (body.setOutcome != null && body.setOutcome !== '' && !OUTCOMES.includes(body.setOutcome)) {
    return `setOutcome inválido: use ${OUTCOMES.join(' ou ')}`
  }
  if (body.temperature != null && body.temperature !== '' && !TEMPERATURES.includes(body.temperature)) {
    return `temperature inválida: use ${TEMPERATURES.join(', ')}`
  }
  if (body.allowedFromStages != null && !Array.isArray(body.allowedFromStages)) {
    return 'allowedFromStages deve ser uma lista de chaves de etapa'
  }
  if (body.requiredFields != null && !Array.isArray(body.requiredFields)) {
    return 'requiredFields deve ser uma lista de chaves de campo'
  }
  // Escada: apontar pra si mesmo faria o cron girar em falso.
  if (body.nextSummaryCode && body.code &&
      String(body.nextSummaryCode).trim().toUpperCase() === String(body.code).trim().toUpperCase()) {
    return 'nextSummaryCode não pode ser o próprio resumo'
  }
  return null
}

function buildSummaryData(body: Record<string, any>, isCreate: boolean) {
  const data: Record<string, unknown> = {}
  const setIf = (key: string, value: unknown) => {
    if (body[key] !== undefined) data[key] = value
  }

  if (isCreate || body.code !== undefined) data.code = String(body.code).trim().toUpperCase()
  if (isCreate || body.name !== undefined) data.name = String(body.name).trim()

  setIf('helpText', body.helpText || null)
  setIf('funnelId', body.funnelId ?? null)
  setIf('sector', body.sector || null)
  setIf('color', body.color || null)
  setIf('position', Number.isFinite(body.position) ? Number(body.position) : 0)
  setIf('active', body.active !== false)
  setIf('targetFunnelId', body.targetFunnelId ?? null)
  setIf('targetStageKey', body.targetStageKey || null)
  setIf('setOutcome', body.setOutcome || null)
  setIf('requireLossReason', body.requireLossReason === true)
  setIf('defaultLossReasonId', body.defaultLossReasonId ?? null)
  setIf('temperature', body.temperature || null)
  setIf('closeOpenActivities', body.closeOpenActivities === true)
  setIf('enrollCadenceId', body.enrollCadenceId ?? null)
  setIf('nextSummaryCode', body.nextSummaryCode ? String(body.nextSummaryCode).trim().toUpperCase() : null)
  setIf('autoAdvanceOnDue', body.autoAdvanceOnDue === true)
  setIf('allowedFromStages', body.allowedFromStages ?? null)
  setIf('requiredFields', body.requiredFields ?? null)

  return data as never
}

function validateTemplate(body: Record<string, any>, isCreate: boolean): string | null {
  if (isCreate) {
    if (!body.code || !String(body.code).trim()) return 'code obrigatório'
    if (!body.name || !String(body.name).trim()) return 'name obrigatório'
    if (!body.type) return 'type obrigatório'
  }
  if (body.code && String(body.code).trim().length > 20) return 'code muito longo (máx 20)'
  if (body.dueMode && !DUE_MODES.includes(body.dueMode)) {
    return `dueMode inválido: use ${DUE_MODES.join(', ')}`
  }
  if (body.assigneeMode && !ASSIGNEE_MODES.includes(body.assigneeMode)) {
    return `assigneeMode inválido: use ${ASSIGNEE_MODES.join(', ')}`
  }
  // Sem destino, a atividade nasceria órfã na fila de ninguém.
  if (body.assigneeMode === 'team' && !body.assigneeTeamId) {
    return 'assigneeMode "team" exige assigneeTeamId'
  }
  if (body.assigneeMode === 'user' && !body.assigneeUserId) {
    return 'assigneeMode "user" exige assigneeUserId'
  }
  return null
}

function buildTemplateData(body: Record<string, any>, isCreate: boolean) {
  const data: Record<string, unknown> = {}
  const setIf = (key: string, value: unknown) => {
    if (body[key] !== undefined) data[key] = value
  }

  if (isCreate || body.code !== undefined) data.code = String(body.code).trim().toUpperCase()
  if (isCreate || body.name !== undefined) data.name = String(body.name).trim()
  if (isCreate || body.type !== undefined) data.type = String(body.type)

  setIf('defaultDescription', body.defaultDescription || null)
  setIf('messageTemplateId', body.messageTemplateId ?? null)
  setIf('dueMode', body.dueMode || 'immediate')
  setIf('dueValue', Number.isFinite(body.dueValue) ? Number(body.dueValue) : 0)
  setIf('assigneeMode', body.assigneeMode || 'lead_owner')
  setIf('assigneeTeamId', body.assigneeTeamId ?? null)
  setIf('assigneeUserId', body.assigneeUserId ?? null)
  setIf('active', body.active !== false)

  return data as never
}
