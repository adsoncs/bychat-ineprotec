import { FastifyInstance } from 'fastify'
import crypto from 'crypto'
import { prisma } from '../lib/prisma.js'
import { adminOnly } from '../lib/auth.js'
import { WEBHOOK_EVENTS, WEBHOOK_EVENT_LABELS, invalidateWebhookCache, testWebhook } from '../services/webhookDispatcher.js'

// Validação SSRF — bloqueia URLs apontando para rede interna
function isInternalUrl(urlStr: string): boolean {
  try {
    const u = new URL(urlStr)
    const host = u.hostname.toLowerCase()
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '0.0.0.0') return true
    if (host.endsWith('.local') || host.endsWith('.internal')) return true
    // IPs privados
    const parts = host.split('.').map(Number)
    if (parts.length === 4 && !parts.some(isNaN)) {
      if (parts[0] === 10) return true // 10.0.0.0/8
      if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true // 172.16.0.0/12
      if (parts[0] === 192 && parts[1] === 168) return true // 192.168.0.0/16
      if (parts[0] === 169 && parts[1] === 254) return true // link-local / AWS metadata
      if (parts[0] === 127) return true // 127.0.0.0/8
    }
    // Protocolo inválido
    if (!['http:', 'https:'].includes(u.protocol)) return true
    return false
  } catch { return true }
}

export async function webhooksRoutes(app: FastifyInstance) {

  // GET /api/admin/webhooks — Listar webhooks
  app.get('/api/admin/webhooks', { preHandler: adminOnly }, async () => {
    const webhooks = await prisma.outboundWebhook.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        url: true,
        events: true,
        active: true,
        maxRetries: true,
        timeoutMs: true,
        totalSent: true,
        totalFailed: true,
        lastSentAt: true,
        lastError: true,
        createdAt: true,
      },
    })
    return { data: webhooks }
  })

  // GET /api/admin/webhooks/events — Eventos disponiveis
  app.get('/api/admin/webhooks/events', { preHandler: adminOnly }, async () => {
    return { data: WEBHOOK_EVENTS, labels: WEBHOOK_EVENT_LABELS }
  })

  // POST /api/admin/webhooks — Criar webhook
  app.post('/api/admin/webhooks', { preHandler: adminOnly }, async (req, reply) => {
    const body = req.body as any
    if (!body.name || !body.url) {
      return reply.code(400).send({ error: 'Nome e URL sao obrigatorios' })
    }
    if (isInternalUrl(body.url)) {
      return reply.code(400).send({ error: 'URL nao pode apontar para rede interna ou localhost' })
    }

    const events: string[] = body.events || ['*']
    for (const e of events) {
      if (e !== '*' && !WEBHOOK_EVENTS.includes(e as any)) {
        return reply.code(400).send({ error: `Evento invalido: ${e}`, valid: WEBHOOK_EVENTS })
      }
    }

    const user = (req as any).user
    const secret = body.secret || crypto.randomBytes(32).toString('hex')

    const webhook = await prisma.outboundWebhook.create({
      data: {
        name: body.name,
        url: body.url,
        secret,
        events: events as any,
        headers: body.headers || null,
        maxRetries: body.maxRetries || 5,
        timeoutMs: body.timeoutMs || 30000,
        createdBy: user?.userId || null,
      },
    })

    invalidateWebhookCache()

    return reply.code(201).send({
      data: {
        id: webhook.id,
        name: webhook.name,
        url: webhook.url,
        secret, // shown only once
        events: webhook.events,
        active: webhook.active,
        maxRetries: webhook.maxRetries,
        timeoutMs: webhook.timeoutMs,
        createdAt: webhook.createdAt,
      },
      warning: 'Guarde o secret com seguranca. Ele e usado para validar a assinatura HMAC-SHA256 dos payloads.',
    })
  })

  // PUT /api/admin/webhooks/:id — Atualizar webhook
  app.put('/api/admin/webhooks/:id', { preHandler: adminOnly }, async (req, reply) => {
    const { id } = req.params as any
    const body = req.body as any

    const existing = await prisma.outboundWebhook.findUnique({ where: { id: parseInt(id) } })
    if (!existing) return reply.code(404).send({ error: 'Webhook nao encontrado' })

    const data: any = {}
    if (body.name !== undefined) data.name = body.name
    if (body.url !== undefined) {
      if (isInternalUrl(body.url)) return reply.code(400).send({ error: 'URL nao pode apontar para rede interna ou localhost' })
      data.url = body.url
    }
    if (body.active !== undefined) data.active = body.active
    if (body.maxRetries !== undefined) data.maxRetries = body.maxRetries
    if (body.timeoutMs !== undefined) data.timeoutMs = body.timeoutMs
    if (body.headers !== undefined) data.headers = body.headers

    if (body.events) {
      for (const e of body.events) {
        if (e !== '*' && !WEBHOOK_EVENTS.includes(e as any)) {
          return reply.code(400).send({ error: `Evento invalido: ${e}` })
        }
      }
      data.events = body.events
    }

    const updated = await prisma.outboundWebhook.update({
      where: { id: parseInt(id) },
      data,
      select: {
        id: true, name: true, url: true, events: true, active: true,
        maxRetries: true, timeoutMs: true, totalSent: true, totalFailed: true,
        lastSentAt: true, createdAt: true, updatedAt: true,
      },
    })

    invalidateWebhookCache()
    return { data: updated }
  })

  // DELETE /api/admin/webhooks/:id — Remover webhook
  app.delete('/api/admin/webhooks/:id', { preHandler: adminOnly }, async (req, reply) => {
    const { id } = req.params as any
    const existing = await prisma.outboundWebhook.findUnique({ where: { id: parseInt(id) } })
    if (!existing) return reply.code(404).send({ error: 'Webhook nao encontrado' })

    await prisma.outboundWebhook.delete({ where: { id: parseInt(id) } })
    invalidateWebhookCache()
    return { ok: true }
  })

  // POST /api/admin/webhooks/:id/test — Enviar ping de teste
  app.post('/api/admin/webhooks/:id/test', { preHandler: adminOnly }, async (req, reply) => {
    const { id } = req.params as any
    try {
      const result = await testWebhook(parseInt(id))
      return result
    } catch (err: any) {
      return reply.code(404).send({ error: err.message })
    }
  })

  // GET /api/admin/webhooks/:id/logs — Logs de entrega
  app.get('/api/admin/webhooks/:id/logs', { preHandler: adminOnly }, async (req, reply) => {
    const { id } = req.params as any
    const q = req.query as any
    const limit = Math.min(parseInt(q.limit) || 50, 200)
    const offset = parseInt(q.offset) || 0

    const existing = await prisma.outboundWebhook.findUnique({ where: { id: parseInt(id) } })
    if (!existing) return reply.code(404).send({ error: 'Webhook nao encontrado' })

    const [data, total] = await Promise.all([
      prisma.webhookLog.findMany({
        where: { webhookId: parseInt(id) },
        orderBy: { createdAt: 'desc' },
        skip: offset,
        take: limit,
      }),
      prisma.webhookLog.count({ where: { webhookId: parseInt(id) } }),
    ])

    return { data, total, limit, offset }
  })

  // POST /api/admin/webhooks/:id/regenerate-secret — Regenerar secret
  app.post('/api/admin/webhooks/:id/regenerate-secret', { preHandler: adminOnly }, async (req, reply) => {
    const { id } = req.params as any
    const existing = await prisma.outboundWebhook.findUnique({ where: { id: parseInt(id) } })
    if (!existing) return reply.code(404).send({ error: 'Webhook nao encontrado' })

    const secret = crypto.randomBytes(32).toString('hex')
    await prisma.outboundWebhook.update({ where: { id: parseInt(id) }, data: { secret } })

    return { secret, warning: 'Novo secret gerado. Atualize em todos os sistemas que validam a assinatura.' }
  })
}
