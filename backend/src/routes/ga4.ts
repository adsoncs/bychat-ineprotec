import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { adminOnly } from '../lib/auth.js'
import { GA4_AVAILABLE_EVENTS, invalidateGA4Cache } from '../services/ga4Sync.js'

export async function ga4Routes(app: FastifyInstance) {

  // GET /api/admin/google/ga4/config
  app.get('/api/admin/google/ga4/config', { preHandler: adminOnly }, async () => {
    const configs = await prisma.gA4Config.findMany({ orderBy: { createdAt: 'desc' } })
    return { data: configs }
  })

  // GET /api/admin/google/ga4/events — Available events
  app.get('/api/admin/google/ga4/events', { preHandler: adminOnly }, async () => {
    return { data: GA4_AVAILABLE_EVENTS }
  })

  // POST /api/admin/google/ga4/config
  app.post('/api/admin/google/ga4/config', { preHandler: adminOnly }, async (req, reply) => {
    const body = req.body as any
    if (!body.measurementId || !body.apiSecret) {
      return reply.code(400).send({ error: 'measurementId e apiSecret sao obrigatorios' })
    }
    const user = (req as any).user
    const config = await prisma.gA4Config.create({
      data: {
        measurementId: body.measurementId,
        apiSecret: body.apiSecret,
        events: (body.events || ['*']) as any,
        createdBy: user?.userId || null,
      },
    })
    invalidateGA4Cache()
    return reply.code(201).send({ data: config })
  })

  // PUT /api/admin/google/ga4/config/:id
  app.put('/api/admin/google/ga4/config/:id', { preHandler: adminOnly }, async (req, reply) => {
    const { id } = req.params as any
    const body = req.body as any
    const data: any = {}
    if (body.measurementId !== undefined) data.measurementId = body.measurementId
    if (body.apiSecret !== undefined) data.apiSecret = body.apiSecret
    if (body.events !== undefined) data.events = body.events
    if (body.active !== undefined) data.active = body.active
    const updated = await prisma.gA4Config.update({ where: { id: parseInt(id) }, data })
    invalidateGA4Cache()
    return { data: updated }
  })

  // DELETE /api/admin/google/ga4/config/:id
  app.delete('/api/admin/google/ga4/config/:id', { preHandler: adminOnly }, async (req, reply) => {
    const { id } = req.params as any
    await prisma.gA4Config.delete({ where: { id: parseInt(id) } })
    invalidateGA4Cache()
    return { ok: true }
  })

  // POST /api/admin/google/ga4/test — Send test event
  app.post('/api/admin/google/ga4/test', { preHandler: adminOnly }, async (req, reply) => {
    const body = req.body as any
    const configId = body.configId
    const config = await prisma.gA4Config.findUnique({ where: { id: parseInt(configId) } })
    if (!config) return reply.code(404).send({ error: 'Config nao encontrada' })

    try {
      const url = `https://www.google-analytics.com/debug/mp/collect?measurement_id=${config.measurementId}&api_secret=${config.apiSecret}`
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: 'bychat_test_client',
          events: [{ name: 'test_event', params: { source: 'bychat_beyond', test: true } }],
        }),
      })
      const result = await resp.json()
      return { success: true, validationMessages: (result as any).validationMessages || [] }
    } catch (err: any) {
      return reply.code(500).send({ error: err.message })
    }
  })
}
