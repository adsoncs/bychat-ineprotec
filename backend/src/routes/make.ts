// src/routes/make.ts
// Make.com (Integromat) app — integração oficial
// Namespace /api/make/* usa a mesma API Key da Fase 8.6 e reaproveita OutboundWebhook da Fase 8.7

import { FastifyInstance } from 'fastify'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { prisma } from '../lib/prisma.js'
import { rejectLeadEntry } from '../services/leadBlocklist.js'
import { requireApiKey, logApiCall } from '../lib/apiKey.js'
import { flagDuplicate } from '../services/dedup.js'
import { authMiddleware } from '../lib/auth.js'
import { invalidateWebhookCache, WEBHOOK_EVENTS } from '../services/webhookDispatcher.js'
import { getProviderForLeadOwner } from '../services/whatsappProvider.js'
import { isInternalUrl } from '../lib/urlSafety.js'
import { resolveDefaultTeamId } from '../services/teamRouting.js'

// Eventos expostos ao Make (subset de WEBHOOK_EVENTS, mais relevantes)
const MAKE_TRIGGER_EVENTS = [
  'lead.created',
  'lead.stage_changed',
  'lead.tag_added',
  'lead.closed',
  'message.received',
  'message.sent',
  'sale.detected',
  'activity.completed',
] as const


const leadSelect = {
  id: true, uid: true, nome: true, empresa: true, whatsapp: true, email: true,
  segmento: true, cidade: true, status: true, funnelId: true, source: true,
  scores: true, customFields: true, annotation: true,
  saleDetected: true, saleValue: true, saleDetectedAt: true,
  lastMessageAt: true, lastActivityAt: true,
  createdAt: true, updatedAt: true,
}

export async function makeRoutes(app: FastifyInstance) {
  // ── Logging hook ──
  app.addHook('onRequest', async (req) => {
    if (req.url.startsWith('/api/make/')) {
      ;(req as any)._apiStartTime = Date.now()
    }
  })
  app.addHook('onResponse', async (req, reply) => {
    if (req.url.startsWith('/api/make/')) {
      const startTime = (req as any)._apiStartTime || Date.now()
      await logApiCall(req, reply, startTime)
    }
  })

  // ══════════════════════════════════════════════
  // CONNECTION TEST — Make valida credencial
  // ══════════════════════════════════════════════
  app.get('/api/make/ping', {
    preHandler: requireApiKey('leads:read'),
  }, async (req) => {
    const payload = (req as any).apiKey
    return {
      ok: true,
      product: 'ByChat Beyond',
      version: '1.0',
      apiKeyName: payload?.name,
      permissions: payload?.permissions,
      serverTime: new Date().toISOString(),
    }
  })

  // ══════════════════════════════════════════════
  // DEVELOPER HUB — Download do app packaging
  // ══════════════════════════════════════════════

  // GET /api/admin/make/app-definition — Retorna o JSON consolidado do app
  // (útil pra colar direto no Developer Hub em um único passo)
  app.get('/api/admin/make/app-definition', { preHandler: authMiddleware }, async (_req, reply) => {
    const dir = path.resolve(process.cwd(), '../installer/make-app')
    try {
      const readJson = (p: string) => JSON.parse(fs.readFileSync(path.join(dir, p), 'utf8'))
      const readDir = (sub: string): Record<string, any> => {
        const out: Record<string, any> = {}
        const full = path.join(dir, sub)
        if (!fs.existsSync(full)) return out
        for (const f of fs.readdirSync(full).filter(f => f.endsWith('.iml.json'))) {
          out[f.replace('.iml.json', '')] = JSON.parse(fs.readFileSync(path.join(full, f), 'utf8'))
        }
        return out
      }
      return reply.send({
        app:        readJson('app.iml.json'),
        base:       readJson('base.iml.json'),
        connection: readJson('connection.iml.json'),
        triggers:   readDir('triggers'),
        actions:    readDir('actions'),
        searches:   readDir('searches'),
      })
    } catch (err: any) {
      return reply.code(500).send({ error: `Falha ao ler definição: ${err.message}` })
    }
  })

  // GET /api/admin/make/app.zip — Download do pacote completo (importável no Developer Hub)
  app.get('/api/admin/make/app.zip', { preHandler: authMiddleware }, async (_req, reply) => {
    const zipPath = path.resolve(process.cwd(), '../installer/make-app/bychat-beyond-make-app.zip')
    if (!fs.existsSync(zipPath)) {
      return reply.code(404).send({ error: 'Pacote não gerado. Execute installer/make-app/pack.sh' })
    }
    const buf = fs.readFileSync(zipPath)
    reply.header('Content-Type', 'application/zip')
    reply.header('Content-Disposition', 'attachment; filename="bychat-beyond-make-app.zip"')
    return reply.send(buf)
  })

  // ══════════════════════════════════════════════
  // METADATA — listas dinâmicas para UI do Make
  // ══════════════════════════════════════════════

  app.get('/api/make/events', {
    preHandler: requireApiKey('leads:read'),
  }, async () => {
    return { data: MAKE_TRIGGER_EVENTS }
  })

  app.get('/api/make/funnels', {
    preHandler: requireApiKey('funnels:read'),
  }, async () => {
    const funnels = await prisma.funnel.findMany({
      include: { stages: { orderBy: { position: 'asc' } } },
      orderBy: { name: 'asc' },
    })
    return { data: funnels }
  })

  app.get('/api/make/tags', {
    preHandler: requireApiKey('tags:read'),
  }, async () => {
    const tags = await prisma.tag.findMany({ orderBy: { name: 'asc' } })
    return { data: tags }
  })

  // ══════════════════════════════════════════════
  // TRIGGERS — webhooks que Make registra/descadastra
  // (reaproveita OutboundWebhook com flag "make:true" em headers)
  // ══════════════════════════════════════════════

  // POST /api/make/hooks — Make inscreve uma URL para receber eventos
  app.post('/api/make/hooks', {
    preHandler: requireApiKey('webhooks:manage'),
  }, async (req, reply) => {
    const body = req.body as any
    const url: string | undefined = body.url
    const event: string | undefined = body.event

    if (!url) return reply.code(400).send({ error: 'Field url is required' })
    if (!event || !(MAKE_TRIGGER_EVENTS as readonly string[]).includes(event)) {
      return reply.code(400).send({ error: 'Invalid or missing event', valid: MAKE_TRIGGER_EVENTS })
    }
    if (isInternalUrl(url)) {
      return reply.code(400).send({ error: 'URL cannot point to internal network' })
    }

    const payload = (req as any).apiKey
    const secret = crypto.randomBytes(32).toString('hex')

    const hook = await prisma.outboundWebhook.create({
      data: {
        name: `make:${event}`,
        url,
        secret,
        events: [event] as any,
        headers: { 'X-Make-Hook': 'true', 'X-Make-ApiKey-Id': String(payload?.apiKeyId || '') } as any,
        maxRetries: 3,
        timeoutMs: 20000,
        createdBy: null,
      },
    })

    invalidateWebhookCache()

    return reply.code(201).send({
      id: hook.id,
      url: hook.url,
      event,
      secret,
      active: hook.active,
    })
  })

  // DELETE /api/make/hooks/:id — Make descadastra
  app.delete('/api/make/hooks/:id', {
    preHandler: requireApiKey('webhooks:manage'),
  }, async (req, reply) => {
    const { id } = req.params as any
    const hook = await prisma.outboundWebhook.findUnique({ where: { id: parseInt(id) } })
    if (!hook) return reply.code(404).send({ error: 'Hook not found' })
    const headers = (hook.headers as any) || {}
    if (headers['X-Make-Hook'] !== 'true') {
      return reply.code(403).send({ error: 'Not a Make hook' })
    }
    await prisma.outboundWebhook.delete({ where: { id: hook.id } })
    invalidateWebhookCache()
    return { ok: true }
  })

  // GET /api/make/hooks — Lista hooks ativos do Make
  app.get('/api/make/hooks', {
    preHandler: requireApiKey('webhooks:manage'),
  }, async () => {
    const rows = await prisma.outboundWebhook.findMany({
      where: { name: { startsWith: 'make:' } },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, name: true, url: true, events: true, active: true,
        totalSent: true, totalFailed: true, lastSentAt: true, lastError: true,
        createdAt: true,
      },
    })
    return { data: rows }
  })

  // ══════════════════════════════════════════════
  // ACTIONS — Make chama esses endpoints
  // ══════════════════════════════════════════════

  // Create Lead
  app.post('/api/make/leads', {
    preHandler: requireApiKey('leads:write'),
  }, async (req, reply) => {
    const body = req.body as any
    if (!body.nome || !body.empresa) {
      return reply.code(400).send({ error: 'Fields nome and empresa are required' })
    }

    if (await rejectLeadEntry({ email: body.email, whatsapp: body.whatsapp, ip: req.ip }, 'Make.com')) {
      return reply.code(200).send({ ok: true, ignored: 'blocked', message: 'Contato na lista de bloqueio de leads' })
    }

    const teamId = body.teamId ? parseInt(body.teamId) : await resolveDefaultTeamId()
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
        source: body.source || 'make',
        originType: 'make',
        formData: body.formData || {},
        scores: body.scores || {},
        customFields: body.customFields || undefined,
        qualifiedAt: new Date(),
        qualificationSource: 'make',
      },
      select: leadSelect,
    })

    // Fase 24 (Categoria A): detecta possível duplicado (best-effort)
    flagDuplicate({ newLeadId: (lead as any).id, channel: 'make' }).catch((e) => {
      console.error('[make] flagDuplicate error:', (e as any).message)
    })

    return reply.code(201).send({ data: lead })
  })

  // Update Lead
  app.patch('/api/make/leads/:id', {
    preHandler: requireApiKey('leads:write'),
  }, async (req, reply) => {
    const { id } = req.params as any
    const body = req.body as any
    const existing = await prisma.lead.findUnique({ where: { id: parseInt(id) } })
    if (!existing) return reply.code(404).send({ error: 'Lead not found' })

    const allowed = ['nome', 'empresa', 'whatsapp', 'email', 'segmento', 'cidade', 'status', 'funnelId', 'annotation', 'customFields']
    const data: any = {}
    for (const f of allowed) if (body[f] !== undefined) data[f] = body[f]
    if (data.funnelId) data.funnelId = parseInt(data.funnelId)

    const lead = await prisma.lead.update({
      where: { id: parseInt(id) }, data, select: leadSelect,
    })
    return { data: lead }
  })

  // Move stage
  app.post('/api/make/leads/:id/move', {
    preHandler: requireApiKey('leads:write'),
  }, async (req, reply) => {
    const { id } = req.params as any
    const { stageId, funnelId } = req.body as any
    if (!stageId) return reply.code(400).send({ error: 'Field stageId is required' })

    const stage = await prisma.stage.findUnique({ where: { id: parseInt(stageId) } })
    if (!stage) return reply.code(404).send({ error: 'Stage not found' })

    const lead = await prisma.lead.update({
      where: { id: parseInt(id) },
      data: {
        status: stage.key,
        funnelId: funnelId ? parseInt(funnelId) : stage.funnelId,
      },
      select: leadSelect,
    })
    return { data: lead }
  })

  // Add tag
  app.post('/api/make/leads/:id/tags', {
    preHandler: requireApiKey('leads:write', 'tags:write'),
  }, async (req, reply) => {
    const { id } = req.params as any
    const body = req.body as any
    let tagId: number | null = body.tagId ? parseInt(body.tagId) : null

    // Suporta criar tag pelo nome se ainda não existe
    if (!tagId && body.tagName) {
      const existing = await prisma.tag.findFirst({ where: { name: body.tagName } })
      if (existing) tagId = existing.id
      else {
        const created = await prisma.tag.create({
          data: { name: body.tagName, color: body.color || '#6366f1' },
        })
        tagId = created.id
      }
    }

    if (!tagId) return reply.code(400).send({ error: 'Field tagId or tagName is required' })

    const lead = await prisma.lead.findUnique({ where: { id: parseInt(id) } })
    if (!lead) return reply.code(404).send({ error: 'Lead not found' })

    const existing = await prisma.leadTag.findFirst({
      where: { leadId: parseInt(id), tagId },
    })
    if (existing) return { data: existing, message: 'Tag already linked' }

    const lt = await prisma.leadTag.create({
      data: { leadId: parseInt(id), tagId },
      include: { tag: true },
    })
    return reply.code(201).send({ data: lt })
  })

  // Send WhatsApp message
  app.post('/api/make/messages/whatsapp', {
    preHandler: requireApiKey('leads:write'),
  }, async (req, reply) => {
    const body = req.body as any
    const leadId = body.leadId ? parseInt(body.leadId) : null
    const text: string | undefined = body.text

    if (!leadId || !text) {
      return reply.code(400).send({ error: 'Fields leadId and text are required' })
    }

    const lead = await prisma.lead.findUnique({
      where: { id: leadId },
      select: { id: true, whatsapp: true },
    })
    if (!lead) return reply.code(404).send({ error: 'Lead not found' })
    if (!lead.whatsapp) return reply.code(400).send({ error: 'Lead has no whatsapp number' })

    try {
      // Envia pela instância do dono do lead (preserva identidade)
      const { provider } = await getProviderForLeadOwner(lead)
      const result = await provider.sendText(lead.whatsapp, text)
      return { ok: true, result }
    } catch (err: any) {
      return reply.code(502).send({ error: 'Send failed', message: err.message })
    }
  })

  // ══════════════════════════════════════════════
  // SEARCH — Find lead
  // ══════════════════════════════════════════════

  app.get('/api/make/leads/search', {
    preHandler: requireApiKey('leads:read'),
  }, async (req) => {
    const q = req.query as any
    const limit = Math.min(parseInt(q.limit) || 25, 100)
    const where: any = {}

    if (q.whatsapp) where.whatsapp = { contains: q.whatsapp }
    if (q.email) where.email = q.email
    if (q.uid) where.uid = q.uid
    if (q.search) {
      where.OR = [
        { nome: { contains: q.search } },
        { empresa: { contains: q.search } },
        { email: { contains: q.search } },
        { whatsapp: { contains: q.search } },
      ]
    }

    const data = await prisma.lead.findMany({
      where,
      select: leadSelect,
      orderBy: { createdAt: 'desc' },
      take: limit,
    })
    return { data, total: data.length }
  })
}
