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
    const [rows, total] = await Promise.all([
      prisma.leadStageSuggestion.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take,
        include: {
          lead: { select: { id: true, nome: true, whatsapp: true, status: true, funnelId: true } },
          funnel: { select: { id: true, name: true, stages: { where: { active: true }, select: { key: true, name: true, color: true } } } },
        },
      }),
      prisma.leadStageSuggestion.count({ where }),
    ])

    // Rede de segurança: mesmo com a invalidação nos pontos de movimentação,
    // qualquer caminho novo que escreva `lead.status` direto poderia deixar
    // pendente vencida na tela. Aqui ela nunca é exibida — e some do banco no
    // próximo tick, que roda o mesmo critério.
    if (status !== 'pending') return { data: rows, total }

    const funnelIds = [...new Set(rows.map(r => r.funnelId))]
    const allStages = funnelIds.length
      ? await prisma.stage.findMany({
          where: { funnelId: { in: funnelIds } },
          select: { funnelId: true, key: true, position: true, active: true, terminalKind: true },
        })
      : []
    const byFunnel = new Map<number, Map<string, { key: string; position: number; active: boolean; terminalKind: string | null }>>()
    for (const s of allStages) {
      if (!byFunnel.has(s.funnelId)) byFunnel.set(s.funnelId, new Map())
      byFunnel.get(s.funnelId)!.set(s.key, s)
    }
    const { staleReasonFor } = await import('../services/stageSuggestions.js')
    const data = rows.filter(r => !r.lead || !staleReasonFor(r, r.lead, byFunnel.get(r.funnelId) ?? new Map()))
    return { data, total: total - (rows.length - data.length) }
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
    if (sug.kind !== 'stage' || !sug.suggestedStageKey) {
      return reply.code(400).send({ error: 'Esta sugestão não aponta uma etapa — o lead precisa ser movido de funil manualmente' })
    }

    const lead = await prisma.lead.findUnique({ where: { id: sug.leadId }, select: { id: true, status: true, funnelId: true } })
    if (!lead) return reply.code(404).send({ error: 'Lead não existe mais' })

    // Revalidação no momento do clique. Entre a análise e o "Aplicar" pode ter
    // passado muita coisa (o bot roteou, alguém arrastou no kanban); aplicar às
    // cegas era o que rebaixava lead — havia pendentes de 92% de confiança
    // mandando um lead em Proposta de volta para Visita agendada.
    const { staleReasonFor } = await import('../services/stageSuggestions.js')
    const stages = await prisma.stage.findMany({
      where: { funnelId: sug.funnelId },
      select: { key: true, position: true, active: true, terminalKind: true },
    })
    const stale = staleReasonFor(sug, lead, new Map(stages.map(s => [s.key, s])))
    if (stale) {
      await prisma.leadStageSuggestion.update({
        where: { id: sug.id },
        data: { status: 'superseded', decidedAt: new Date(), decidedById: user?.userId ?? null, decisionNote: `[auto] Não aplicada: ${stale}.` },
      })
      return reply.code(409).send({ error: 'A sugestão não vale mais para o estado atual do lead e foi descartada', reason: stale })
    }

    const previousStatus = lead.status
    // Passa pelo movimento canônico: ele valida a etapa no funil de destino e
    // respeita `forwardOnly`, coisas que o update direto pulava.
    // `moveLeadStage` invalida as pendentes do lead — inclusive ESTA. Por isso o
    // update abaixo é por id e não exige `status: 'pending'`: ele é a última
    // palavra e devolve a sugestão ao estado correto ('applied').
    const { moveLeadStage } = await import('../services/formFlow.js')
    await moveLeadStage(lead.id, sug.funnelId, sug.suggestedStageKey, 'ai_journey', { forwardOnly: true })

    const after = await prisma.lead.findUnique({ where: { id: lead.id }, select: { status: true } })
    if (after?.status !== sug.suggestedStageKey) {
      await prisma.leadStageSuggestion.update({
        where: { id: sug.id },
        data: { status: 'superseded', decidedAt: new Date(), decidedById: user?.userId ?? null, decisionNote: '[auto] Não aplicada: movimentação recusada (etapa inválida ou regressão).' },
      })
      return reply.code(409).send({ error: 'A movimentação foi recusada — o lead já está numa etapa igual ou mais avançada' })
    }

    await prisma.$transaction([
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
