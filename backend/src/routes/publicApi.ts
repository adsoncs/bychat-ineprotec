import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { rejectLeadEntry } from '../services/leadBlocklist.js'
import { requireApiKey, logApiCall } from '../lib/apiKey.js'
import { resolveDefaultTeamId } from '../services/teamRouting.js'
import { flagDuplicate } from '../services/dedup.js'
import { extrairTracking } from '../lib/trackingPayload.js'
import { deriveLeadOrigin } from '../lib/leadOrigin.js'

export async function publicApiRoutes(app: FastifyInstance) {
  // ── Logging hook for all /api/v1 routes ──────
  app.addHook('onResponse', async (req, reply) => {
    if (req.url.startsWith('/api/v1/')) {
      const startTime = (req as any)._apiStartTime || Date.now()
      await logApiCall(req, reply, startTime)
    }
  })

  app.addHook('onRequest', async (req) => {
    if (req.url.startsWith('/api/v1/')) {
      ;(req as any)._apiStartTime = Date.now()
    }
  })

  // ══════════════════════════════════════════════
  // LEADS
  // ══════════════════════════════════════════════

  // GET /api/v1/leads — Listar leads
  app.get('/api/v1/leads', {
    preHandler: requireApiKey('leads:read'),
  }, async (req, reply) => {
    const q = req.query as any
    const limit = Math.min(parseInt(q.limit) || 50, 100)
    const offset = parseInt(q.offset) || 0

    const where: any = {}
    // API pública lista apenas leads qualificados por padrão (?includeUnqualified=1 inclui).
    if (q.includeUnqualified !== '1') where.qualifiedAt = { not: null }
    if (q.status) where.status = q.status
    if (q.funnelId) where.funnelId = parseInt(q.funnelId)
    if (q.source) where.source = q.source
    if (q.search) {
      where.OR = [
        { nome: { contains: q.search } },
        { empresa: { contains: q.search } },
        { email: { contains: q.search } },
        { whatsapp: { contains: q.search } },
      ]
    }
    if (q.createdAfter) where.createdAt = { ...where.createdAt, gte: new Date(q.createdAfter) }
    if (q.createdBefore) where.createdAt = { ...where.createdAt, lte: new Date(q.createdBefore) }

    const [data, total] = await Promise.all([
      prisma.lead.findMany({
        where,
        select: leadSelect,
        orderBy: { createdAt: 'desc' },
        skip: offset,
        take: limit,
      }),
      prisma.lead.count({ where }),
    ])

    return { data, total, limit, offset }
  })

  // GET /api/v1/leads/:id — Detalhe do lead
  app.get('/api/v1/leads/:id', {
    preHandler: requireApiKey('leads:read'),
  }, async (req, reply) => {
    const { id } = req.params as any
    const lead = await prisma.lead.findUnique({
      where: { id: parseInt(id) },
      select: {
        ...leadSelect,
        formData: true,
        analysis: true,
        aiSentiment: true,
        tags: { include: { tag: true } },
        activities: {
          orderBy: { scheduledAt: 'desc' },
          take: 20,
          select: activitySelect,
        },
      },
    })
    if (!lead) return reply.code(404).send({ error: 'Lead not found' })
    return { data: lead }
  })

  // POST /api/v1/leads — Criar lead
  app.post('/api/v1/leads', {
    preHandler: requireApiKey('leads:write'),
  }, async (req, reply) => {
    const body = req.body as any
    if (!body.nome || !body.empresa) {
      return reply.code(400).send({ error: 'Fields nome and empresa are required' })
    }

    // Lista de bloqueio. Aqui quem chama é uma integração do próprio cliente
    // (autenticada por API Key), não o contato bloqueado — então respondemos de
    // forma explícita em vez de silenciosa.
    if (await rejectLeadEntry({ email: body.email, whatsapp: body.whatsapp, ip: req.ip }, 'API pública')) {
      return reply.code(200).send({ ok: true, ignored: 'blocked', message: 'Contato na lista de bloqueio de leads' })
    }

    const teamId = body.teamId ? parseInt(body.teamId) : await resolveDefaultTeamId()

    // Origem: aceita `utm_source`/`utmSource`, gclid, fbclid, ids de campanha —
    // na raiz do corpo ou dentro de `tracking`. Antes isto era ignorado e todo
    // lead da API nascia com `source: 'api'`, sem a campanha que o trouxe.
    const tracking = extrairTracking(body)
    const { source: sourceDeclarado, ...colunasTracking } = tracking
    const source = sourceDeclarado || 'api'

    const lead = await prisma.lead.create({
      data: {
        nome: body.nome,
        empresa: body.empresa,
        whatsapp: body.whatsapp || '',
        email: body.email || '',
        segmento: body.segmento,
        cidade: body.cidade,
        status: body.status || 'NOVO',
        funnelId: body.funnelId ? parseInt(body.funnelId) : null,
        teamId,
        assignedUserId: body.assignedUserId ? parseInt(body.assignedUserId) : null,
        assignedAt: body.assignedUserId || teamId ? new Date() : null,
        source,
        ...colunasTracking,
        originType: deriveLeadOrigin({
          source,
          qualificationSource: 'api',
          utmSource: tracking.utmSource || null,
          gclid: tracking.gclid || null,
          ctwaClid: tracking.ctwaClid || null,
          // 'api' é o meio de entrada, não a origem de marketing: com gclid ou
          // utm no corpo, a atribuição real (google_ads, meta_ctwa, organic…)
          // vence. Sem pista nenhuma, aí sim o lead é "veio pela API".
          explicit: (tracking.gclid || tracking.ctwaClid || tracking.utmSource || sourceDeclarado) ? null : 'api',
        }),
        formData: body.formData || {},
        scores: body.scores || {},
        customFields: body.customFields,
        qualifiedAt: new Date(),
        qualificationSource: 'api',
      },
      select: leadSelect,
    })

    // Fase 24 (Categoria A): detecta possível duplicado (best-effort)
    flagDuplicate({ newLeadId: (lead as any).id, channel: 'publicApi' }).catch((e) => {
      console.error('[publicApi] flagDuplicate error:', (e as any).message)
    })

    return reply.code(201).send({ data: lead })
  })

  // PUT /api/v1/leads/:id — Atualizar lead
  app.put('/api/v1/leads/:id', {
    preHandler: requireApiKey('leads:write'),
  }, async (req, reply) => {
    const { id } = req.params as any
    const body = req.body as any

    const existing = await prisma.lead.findUnique({ where: { id: parseInt(id) } })
    if (!existing) return reply.code(404).send({ error: 'Lead not found' })

    const allowedFields = [
      'nome', 'empresa', 'whatsapp', 'email', 'segmento', 'cidade',
      'status', 'funnelId', 'annotation', 'customFields',
    ]
    const data: any = {}
    for (const f of allowedFields) {
      if (body[f] !== undefined) data[f] = body[f]
    }
    if (data.funnelId) data.funnelId = parseInt(data.funnelId)

    const lead = await prisma.lead.update({
      where: { id: parseInt(id) },
      data,
      select: leadSelect,
    })

    return { data: lead }
  })

  // DELETE /api/v1/leads/:id — Deletar lead
  app.delete('/api/v1/leads/:id', {
    preHandler: requireApiKey('leads:write'),
  }, async (req, reply) => {
    const { id } = req.params as any
    const existing = await prisma.lead.findUnique({ where: { id: parseInt(id) } })
    if (!existing) return reply.code(404).send({ error: 'Lead not found' })

    await prisma.lead.delete({ where: { id: parseInt(id) } })
    return { ok: true, message: 'Lead deleted' }
  })

  // ══════════════════════════════════════════════
  // TAGS
  // ══════════════════════════════════════════════

  // GET /api/v1/tags
  app.get('/api/v1/tags', {
    preHandler: requireApiKey('tags:read'),
  }, async () => {
    const tags = await prisma.tag.findMany({ orderBy: { name: 'asc' } })
    return { data: tags }
  })

  // POST /api/v1/tags
  app.post('/api/v1/tags', {
    preHandler: requireApiKey('tags:write'),
  }, async (req, reply) => {
    const body = req.body as any
    if (!body.name) return reply.code(400).send({ error: 'Field name is required' })

    const tag = await prisma.tag.create({
      data: {
        name: body.name,
        color: body.color || '#6366f1',
        description: body.description,
      },
    })
    return reply.code(201).send({ data: tag })
  })

  // POST /api/v1/leads/:id/tags — Vincular tag ao lead
  app.post('/api/v1/leads/:id/tags', {
    preHandler: requireApiKey('leads:write', 'tags:write'),
  }, async (req, reply) => {
    const { id } = req.params as any
    const { tagId } = req.body as any
    if (!tagId) return reply.code(400).send({ error: 'Field tagId is required' })

    const lead = await prisma.lead.findUnique({ where: { id: parseInt(id) } })
    if (!lead) return reply.code(404).send({ error: 'Lead not found' })

    const existing = await prisma.leadTag.findFirst({
      where: { leadId: parseInt(id), tagId: parseInt(tagId) },
    })
    if (existing) return { data: existing, message: 'Tag already linked' }

    const lt = await prisma.leadTag.create({
      data: { leadId: parseInt(id), tagId: parseInt(tagId) },
      include: { tag: true },
    })
    return reply.code(201).send({ data: lt })
  })

  // DELETE /api/v1/leads/:id/tags/:tagId — Desvincular tag
  app.delete('/api/v1/leads/:id/tags/:tagId', {
    preHandler: requireApiKey('leads:write', 'tags:write'),
  }, async (req, reply) => {
    const { id, tagId } = req.params as any
    const lt = await prisma.leadTag.findFirst({
      where: { leadId: parseInt(id), tagId: parseInt(tagId) },
    })
    if (!lt) return reply.code(404).send({ error: 'Tag not linked to this lead' })
    await prisma.leadTag.delete({ where: { id: lt.id } })
    return { ok: true }
  })

  // ══════════════════════════════════════════════
  // FUNNELS & STAGES
  // ══════════════════════════════════════════════

  // GET /api/v1/funnels
  app.get('/api/v1/funnels', {
    preHandler: requireApiKey('funnels:read'),
  }, async () => {
    const funnels = await prisma.funnel.findMany({
      include: { stages: { orderBy: { position: 'asc' } } },
      orderBy: { name: 'asc' },
    })
    return { data: funnels }
  })

  // GET /api/v1/funnels/:id
  app.get('/api/v1/funnels/:id', {
    preHandler: requireApiKey('funnels:read'),
  }, async (req, reply) => {
    const { id } = req.params as any
    const funnel = await prisma.funnel.findUnique({
      where: { id: parseInt(id) },
      include: { stages: { orderBy: { position: 'asc' } } },
    })
    if (!funnel) return reply.code(404).send({ error: 'Funnel not found' })
    return { data: funnel }
  })

  // GET /api/v1/stages
  app.get('/api/v1/stages', {
    preHandler: requireApiKey('stages:read'),
  }, async (req) => {
    const q = req.query as any
    const where: any = {}
    if (q.funnelId) where.funnelId = parseInt(q.funnelId)

    const stages = await prisma.stage.findMany({
      where,
      orderBy: { position: 'asc' },
    })
    return { data: stages }
  })

  // ══════════════════════════════════════════════
  // ACTIVITIES
  // ══════════════════════════════════════════════

  // GET /api/v1/activities
  app.get('/api/v1/activities', {
    preHandler: requireApiKey('activities:read'),
  }, async (req) => {
    const q = req.query as any
    const limit = Math.min(parseInt(q.limit) || 50, 100)
    const offset = parseInt(q.offset) || 0

    const where: any = {}
    if (q.leadId) where.leadId = parseInt(q.leadId)
    if (q.status) where.status = q.status
    if (q.type) where.type = q.type

    const [data, total] = await Promise.all([
      prisma.activity.findMany({
        where,
        select: activitySelect,
        orderBy: { scheduledAt: 'desc' },
        skip: offset,
        take: limit,
      }),
      prisma.activity.count({ where }),
    ])

    return { data, total, limit, offset }
  })

  // POST /api/v1/activities
  app.post('/api/v1/activities', {
    preHandler: requireApiKey('activities:write'),
  }, async (req, reply) => {
    const body = req.body as any
    if (!body.leadId || !body.type || !body.title || !body.scheduledAt) {
      return reply.code(400).send({
        error: 'Fields leadId, type, title, and scheduledAt are required',
      })
    }

    const lead = await prisma.lead.findUnique({ where: { id: parseInt(body.leadId) } })
    if (!lead) return reply.code(404).send({ error: 'Lead not found' })

    const activity = await prisma.activity.create({
      data: {
        leadId: parseInt(body.leadId),
        type: body.type,
        title: body.title,
        description: body.description,
        scheduledAt: new Date(body.scheduledAt),
        reminderAt: body.reminderAt ? new Date(body.reminderAt) : null,
        status: body.status || 'pending',
      },
      select: activitySelect,
    })

    return reply.code(201).send({ data: activity })
  })

  // PUT /api/v1/activities/:id
  app.put('/api/v1/activities/:id', {
    preHandler: requireApiKey('activities:write'),
  }, async (req, reply) => {
    const { id } = req.params as any
    const body = req.body as any

    const existing = await prisma.activity.findUnique({ where: { id: parseInt(id) } })
    if (!existing) return reply.code(404).send({ error: 'Activity not found' })

    const data: any = {}
    if (body.title !== undefined) data.title = body.title
    if (body.description !== undefined) data.description = body.description
    if (body.status !== undefined) data.status = body.status
    if (body.scheduledAt !== undefined) data.scheduledAt = new Date(body.scheduledAt)
    if (body.completedAt !== undefined) data.completedAt = new Date(body.completedAt)
    if (body.status === 'completed' && !data.completedAt) data.completedAt = new Date()

    const activity = await prisma.activity.update({
      where: { id: parseInt(id) },
      data,
      select: activitySelect,
    })

    return { data: activity }
  })

  // ══════════════════════════════════════════════
  // LEAD EVENTS / HISTORY (read-only)
  // ══════════════════════════════════════════════

  // GET /api/v1/leads/:id/events
  app.get('/api/v1/leads/:id/events', {
    preHandler: requireApiKey('leads:read'),
  }, async (req, reply) => {
    const { id } = req.params as any
    const q = req.query as any
    const limit = Math.min(parseInt(q.limit) || 50, 100)
    const offset = parseInt(q.offset) || 0

    const lead = await prisma.lead.findUnique({ where: { id: parseInt(id) } })
    if (!lead) return reply.code(404).send({ error: 'Lead not found' })

    const [data, total] = await Promise.all([
      prisma.leadEvent.findMany({
        where: { leadId: parseInt(id) },
        orderBy: { createdAt: 'desc' },
        skip: offset,
        take: limit,
      }),
      prisma.leadEvent.count({ where: { leadId: parseInt(id) } }),
    ])

    return { data, total, limit, offset }
  })
}

// ── Select helpers ──────────────────────────────
const leadSelect = {
  id: true,
  uid: true,
  nome: true,
  empresa: true,
  whatsapp: true,
  email: true,
  segmento: true,
  cidade: true,
  status: true,
  funnelId: true,
  source: true,
  scores: true,
  customFields: true,
  annotation: true,
  saleDetected: true,
  saleValue: true,
  saleDetectedAt: true,
  lastMessageAt: true,
  lastActivityAt: true,
  createdAt: true,
  updatedAt: true,
}

const activitySelect = {
  id: true,
  leadId: true,
  type: true,
  title: true,
  description: true,
  status: true,
  scheduledAt: true,
  completedAt: true,
  reminderAt: true,
  userName: true,
  createdAt: true,
  updatedAt: true,
}
