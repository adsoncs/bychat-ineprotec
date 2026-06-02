// src/routes/conversationAudits.ts
// CRUD + agregações para auditorias de conversa por IA.

import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { adminOnly, type JwtPayload } from '../lib/auth.js'
import { queues } from '../lib/queues.js'

function dateRange(q: any): { from: Date; to: Date } {
  const today = new Date()
  const dEnd = q?.dateTo ? new Date(q.dateTo) : today
  const dStart = q?.dateFrom ? new Date(q.dateFrom) : new Date(today.getTime() - 29 * 24 * 60 * 60 * 1000)
  return {
    from: new Date(`${dStart.toISOString().slice(0, 10)}T00:00:00.000Z`),
    to: new Date(`${dEnd.toISOString().slice(0, 10)}T23:59:59.999Z`),
  }
}

export async function conversationAuditsRoutes(app: FastifyInstance) {

  // POST /api/admin/conversation-audits/run/:leadId — enfileira auditoria
  app.post('/api/admin/conversation-audits/run/:leadId', { preHandler: adminOnly }, async (req, reply) => {
    const { leadId } = req.params as any
    const id = parseInt(leadId)
    if (!id) return reply.code(400).send({ error: 'leadId inválido' })

    const lead = await prisma.lead.findUnique({ where: { id }, select: { id: true } })
    if (!lead) return reply.code(404).send({ error: 'Lead não encontrado' })

    const user = (req as any).user as JwtPayload
    await queues.conversationAudit.add('audit', {
      leadId: id,
      triggeredBy: 'manual',
      triggeredById: user?.userId ?? null,
    }, {
      attempts: 2,
      backoff: { type: 'exponential', delay: 30_000 },
    })
    return { ok: true, queued: true }
  })

  // POST /api/admin/conversation-audits/run-bulk — enfileira várias auditorias
  app.post('/api/admin/conversation-audits/run-bulk', { preHandler: adminOnly }, async (req, reply) => {
    const body = (req.body as any) || {}
    const leadIds: number[] = Array.isArray(body.leadIds) ? body.leadIds.slice(0, 500) : []
    if (leadIds.length === 0) return reply.code(400).send({ error: 'leadIds obrigatório' })

    const user = (req as any).user as JwtPayload
    const jobs = leadIds.map(id => ({
      name: 'audit',
      data: { leadId: id, triggeredBy: 'manual', triggeredById: user?.userId ?? null },
      opts: { attempts: 2, backoff: { type: 'exponential' as const, delay: 30_000 } },
    }))
    await queues.conversationAudit.addBulk(jobs as any)
    return { ok: true, queued: leadIds.length }
  })

  // GET /api/admin/conversation-audits — lista paginada com filtros
  app.get('/api/admin/conversation-audits', { preHandler: adminOnly }, async (req) => {
    const q = req.query as any
    const { from, to } = dateRange(q)
    const operatorId = q?.operatorId ? parseInt(q.operatorId) : undefined
    const minScore = q?.minScore !== undefined ? parseInt(q.minScore) : undefined
    const maxScore = q?.maxScore !== undefined ? parseInt(q.maxScore) : undefined
    const tone = typeof q?.tone === 'string' ? q.tone : undefined
    const status = typeof q?.status === 'string' ? q.status : 'done'
    const take = Math.min(200, parseInt(q?.limit || '50') || 50)

    const where: any = { createdAt: { gte: from, lte: to }, status }
    if (operatorId) where.operatorId = operatorId
    if (typeof minScore === 'number' && !Number.isNaN(minScore)) where.score = { ...(where.score || {}), gte: minScore }
    if (typeof maxScore === 'number' && !Number.isNaN(maxScore)) where.score = { ...(where.score || {}), lte: maxScore }
    if (tone) where.tone = tone

    const [data, total] = await Promise.all([
      prisma.conversationAudit.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take,
        include: { lead: { select: { id: true, nome: true, whatsapp: true, email: true } } },
      }),
      prisma.conversationAudit.count({ where }),
    ])
    return { data, total }
  })

  // GET /api/admin/conversation-audits/:id
  app.get('/api/admin/conversation-audits/:id', { preHandler: adminOnly }, async (req, reply) => {
    const { id } = req.params as any
    const audit = await prisma.conversationAudit.findUnique({
      where: { id: parseInt(id) },
      include: { lead: { select: { id: true, nome: true, whatsapp: true, email: true, funnel: { select: { name: true } } } } },
    })
    if (!audit) return reply.code(404).send({ error: 'Auditoria não encontrada' })
    return { data: audit }
  })

  // GET /api/admin/conversation-audits/by-lead/:leadId — histórico do lead
  app.get('/api/admin/conversation-audits/by-lead/:leadId', { preHandler: adminOnly }, async (req) => {
    const { leadId } = req.params as any
    const id = parseInt(leadId)
    const data = await prisma.conversationAudit.findMany({
      where: { leadId: id },
      orderBy: { createdAt: 'desc' },
      take: 20,
    })
    return { data }
  })

  // GET /api/admin/conversation-audits/agg/by-operator
  // Ranking de operadores: score médio, contagem, tom mais comum
  app.get('/api/admin/conversation-audits/agg/by-operator', { preHandler: adminOnly }, async (req) => {
    const q = req.query as any
    const { from, to } = dateRange(q)
    const where: any = {
      createdAt: { gte: from, lte: to },
      status: 'done',
      score: { not: null },
      operatorId: { not: null },
    }

    const grouped = await prisma.conversationAudit.groupBy({
      by: ['operatorId', 'operatorName'],
      where,
      _avg: { score: true, responseTimeAvgSec: true, scriptAdherence: true },
      _count: { _all: true },
      _min: { score: true },
      _max: { score: true },
    })

    // Para tom dominante, faz 1 query extra agregando por operatorId+tone
    const tones = await prisma.conversationAudit.groupBy({
      by: ['operatorId', 'tone'],
      where,
      _count: { _all: true },
    })
    const toneByOp: Record<number, { tone: string; count: number }> = {}
    for (const t of tones) {
      if (t.operatorId == null || !t.tone) continue
      const cur = toneByOp[t.operatorId]
      if (!cur || t._count._all > cur.count) toneByOp[t.operatorId] = { tone: t.tone, count: t._count._all }
    }

    const rows = grouped
      .map(g => ({
        operatorId: g.operatorId!,
        operatorName: g.operatorName,
        audits: g._count._all,
        avgScore: g._avg.score != null ? Math.round(g._avg.score) : null,
        minScore: g._min.score,
        maxScore: g._max.score,
        avgResponseTimeSec: g._avg.responseTimeAvgSec != null ? Math.round(g._avg.responseTimeAvgSec) : null,
        avgScriptAdherence: g._avg.scriptAdherence != null ? Math.round(g._avg.scriptAdherence) : null,
        dominantTone: toneByOp[g.operatorId!]?.tone ?? null,
      }))
      .sort((a, b) => (b.avgScore ?? 0) - (a.avgScore ?? 0))

    return { data: rows, range: { from, to } }
  })

  // GET /api/admin/conversation-audits/agg/overview — KPIs do dashboard
  app.get('/api/admin/conversation-audits/agg/overview', { preHandler: adminOnly }, async (req) => {
    const q = req.query as any
    const { from, to } = dateRange(q)

    const [total, done, failed, scoreAgg, tones] = await Promise.all([
      prisma.conversationAudit.count({ where: { createdAt: { gte: from, lte: to } } }),
      prisma.conversationAudit.count({ where: { createdAt: { gte: from, lte: to }, status: 'done' } }),
      prisma.conversationAudit.count({ where: { createdAt: { gte: from, lte: to }, status: 'failed' } }),
      prisma.conversationAudit.aggregate({
        where: { createdAt: { gte: from, lte: to }, status: 'done', score: { not: null } },
        _avg: { score: true, responseTimeAvgSec: true },
        _count: { _all: true },
      }),
      prisma.conversationAudit.groupBy({
        by: ['tone'],
        where: { createdAt: { gte: from, lte: to }, status: 'done', tone: { not: null } },
        _count: { _all: true },
      }),
    ])

    const lowScoreCount = await prisma.conversationAudit.count({
      where: { createdAt: { gte: from, lte: to }, status: 'done', score: { lt: 60 } },
    })

    return {
      range: { from, to },
      totals: { total, done, failed, lowScore: lowScoreCount },
      averages: {
        score: scoreAgg._avg.score != null ? Math.round(scoreAgg._avg.score) : null,
        responseTimeSec: scoreAgg._avg.responseTimeAvgSec != null ? Math.round(scoreAgg._avg.responseTimeAvgSec) : null,
      },
      toneBreakdown: tones.map(t => ({ tone: t.tone, count: t._count._all })),
    }
  })

  // DELETE /api/admin/conversation-audits/:id
  app.delete('/api/admin/conversation-audits/:id', { preHandler: adminOnly }, async (req, reply) => {
    const { id } = req.params as any
    try {
      await prisma.conversationAudit.delete({ where: { id: parseInt(id) } })
      return { ok: true }
    } catch (e: any) {
      return reply.code(404).send({ error: e.message })
    }
  })
}
