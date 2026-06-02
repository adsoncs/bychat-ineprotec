// src/routes/aiJourney.ts
// CRUD e ações da Jornada Automática por IA (Fase 9).

import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { adminOnly, type JwtPayload } from '../lib/auth.js'
import { queues } from '../lib/queues.js'

export async function aiJourneyRoutes(app: FastifyInstance) {

  // GET /api/admin/ai-journey/config/:funnelId — config do funil
  app.get('/api/admin/ai-journey/config/:funnelId', { preHandler: adminOnly }, async (req, reply) => {
    const { funnelId } = req.params as any
    const f = await prisma.funnel.findUnique({
      where: { id: parseInt(funnelId) },
      select: {
        id: true, name: true,
        aiStageEnabled: true, aiStageAutoApply: true, aiStageThreshold: true, aiStagePrompt: true,
        stages: { where: { active: true }, orderBy: { position: 'asc' }, select: { key: true, name: true, position: true } },
      },
    })
    if (!f) return reply.code(404).send({ error: 'Funil não encontrado' })
    return { data: f }
  })

  // PUT /api/admin/ai-journey/config/:funnelId — atualiza config IA do funil
  app.put('/api/admin/ai-journey/config/:funnelId', { preHandler: adminOnly }, async (req, reply) => {
    const { funnelId } = req.params as any
    const body = (req.body as any) || {}
    const threshold = typeof body.aiStageThreshold === 'number'
      ? Math.max(0, Math.min(100, Math.round(body.aiStageThreshold)))
      : undefined
    const data: any = {}
    if (body.aiStageEnabled !== undefined) data.aiStageEnabled = !!body.aiStageEnabled
    if (body.aiStageAutoApply !== undefined) data.aiStageAutoApply = !!body.aiStageAutoApply
    if (threshold !== undefined) data.aiStageThreshold = threshold
    if (body.aiStagePrompt !== undefined) data.aiStagePrompt = typeof body.aiStagePrompt === 'string' ? body.aiStagePrompt.slice(0, 6_000) : null
    try {
      const f = await prisma.funnel.update({ where: { id: parseInt(funnelId) }, data })
      return { ok: true, data: f }
    } catch (e: any) {
      return reply.code(404).send({ error: e.message })
    }
  })

  // POST /api/admin/ai-journey/run/:leadId — enfileira análise
  app.post('/api/admin/ai-journey/run/:leadId', { preHandler: adminOnly }, async (req, reply) => {
    const { leadId } = req.params as any
    const id = parseInt(leadId)
    if (!id) return reply.code(400).send({ error: 'leadId inválido' })
    const lead = await prisma.lead.findUnique({ where: { id }, select: { id: true } })
    if (!lead) return reply.code(404).send({ error: 'Lead não encontrado' })
    await queues.aiJourney.add('analyze', { leadId: id }, { attempts: 2, backoff: { type: 'exponential', delay: 30_000 } })
    return { ok: true, queued: true }
  })

  // POST /api/admin/ai-journey/run-bulk — enfileira várias
  app.post('/api/admin/ai-journey/run-bulk', { preHandler: adminOnly }, async (req, reply) => {
    const body = (req.body as any) || {}
    const leadIds: number[] = Array.isArray(body.leadIds) ? body.leadIds.slice(0, 500) : []
    if (leadIds.length === 0) return reply.code(400).send({ error: 'leadIds obrigatório' })
    const jobs = leadIds.map(id => ({ name: 'analyze', data: { leadId: id }, opts: { attempts: 2 } }))
    await queues.aiJourney.addBulk(jobs as any)
    return { ok: true, queued: leadIds.length }
  })

  // GET /api/admin/ai-journey/suggestions — sugestões pendentes (revisão humana)
  app.get('/api/admin/ai-journey/suggestions', { preHandler: adminOnly }, async (req) => {
    const q = req.query as any
    const status = typeof q?.status === 'string' ? q.status : 'pending'
    const funnelId = q?.funnelId ? parseInt(q.funnelId) : undefined
    const take = Math.min(200, parseInt(q?.limit || '50') || 50)
    const where: any = { status }
    if (funnelId) where.funnelId = funnelId
    const [data, total] = await Promise.all([
      prisma.leadStageSuggestion.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take,
        include: {
          lead: { select: { id: true, nome: true, whatsapp: true, status: true } },
          funnel: { select: { id: true, name: true, stages: { where: { active: true }, select: { key: true, name: true, color: true } } } },
        },
      }),
      prisma.leadStageSuggestion.count({ where }),
    ])
    return { data, total }
  })

  // GET /api/admin/ai-journey/suggestions/by-lead/:leadId
  app.get('/api/admin/ai-journey/suggestions/by-lead/:leadId', { preHandler: adminOnly }, async (req) => {
    const { leadId } = req.params as any
    const data = await prisma.leadStageSuggestion.findMany({
      where: { leadId: parseInt(leadId) },
      orderBy: { createdAt: 'desc' },
      take: 20,
      include: { funnel: { select: { id: true, name: true, stages: { where: { active: true }, select: { key: true, name: true, color: true } } } } },
    })
    return { data }
  })

  // POST /api/admin/ai-journey/suggestions/:id/apply — operador aplica manualmente
  app.post('/api/admin/ai-journey/suggestions/:id/apply', { preHandler: adminOnly }, async (req, reply) => {
    const { id } = req.params as any
    const body = (req.body as any) || {}
    const user = (req as any).user as JwtPayload
    const sug = await prisma.leadStageSuggestion.findUnique({ where: { id: parseInt(id) } })
    if (!sug) return reply.code(404).send({ error: 'Sugestão não encontrada' })
    if (sug.status !== 'pending') return reply.code(400).send({ error: `Sugestão está com status "${sug.status}" e não pode mais ser aplicada` })

    const lead = await prisma.lead.findUnique({ where: { id: sug.leadId }, select: { id: true, status: true } })
    if (!lead) return reply.code(404).send({ error: 'Lead não existe mais' })

    const previousStatus = lead.status
    await prisma.$transaction([
      prisma.lead.update({ where: { id: lead.id }, data: { status: sug.suggestedStageKey } }),
      prisma.leadStageSuggestion.update({
        where: { id: sug.id },
        data: { status: 'applied', appliedAt: new Date(), decidedAt: new Date(), decidedById: user?.userId ?? null, decisionNote: body.note ?? null },
      }),
      prisma.leadStageMovement.create({
        data: {
          leadId: lead.id,
          fromFunnelId: sug.funnelId,
          toFunnelId: sug.funnelId,
          fromStageKey: previousStatus,
          toStageKey: sug.suggestedStageKey,
          movedByUserId: user?.userId ?? null,
          source: 'ai_journey',
          reason: `Sugestão IA aprovada (confidence ${sug.confidence}%)`,
          metadata: { suggestionId: sug.id, modelUsed: sug.modelUsed } as any,
        },
      }),
    ])
    return { ok: true }
  })

  // POST /api/admin/ai-journey/suggestions/:id/reject
  app.post('/api/admin/ai-journey/suggestions/:id/reject', { preHandler: adminOnly }, async (req, reply) => {
    const { id } = req.params as any
    const body = (req.body as any) || {}
    const user = (req as any).user as JwtPayload
    try {
      const s = await prisma.leadStageSuggestion.update({
        where: { id: parseInt(id) },
        data: { status: 'rejected', decidedAt: new Date(), decidedById: user?.userId ?? null, decisionNote: body.note ?? null },
      })
      return { ok: true, data: s }
    } catch (e: any) {
      return reply.code(404).send({ error: e.message })
    }
  })
}
