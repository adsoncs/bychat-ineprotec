import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { adminOnly } from '../lib/auth.js'

export async function googleCalendarRoutes(app: FastifyInstance) {

  // GET /api/admin/google/calendar/integrations
  app.get('/api/admin/google/calendar/integrations', { preHandler: adminOnly }, async () => {
    const integrations = await prisma.googleCalendarIntegration.findMany({
      orderBy: { createdAt: 'desc' },
      include: { connection: { select: { email: true } } },
    })
    return { data: integrations }
  })

  // POST /api/admin/google/calendar/integrations
  app.post('/api/admin/google/calendar/integrations', { preHandler: adminOnly }, async (req, reply) => {
    const body = req.body as any
    if (!body.name || !body.connectionId) {
      return reply.code(400).send({ error: 'name e connectionId sao obrigatorios' })
    }

    const conn = await prisma.googleConnection.findUnique({ where: { id: parseInt(body.connectionId) } })
    if (!conn || !conn.active) return reply.code(400).send({ error: 'Conexao Google nao encontrada ou inativa' })

    const user = (req as any).user
    const integration = await prisma.googleCalendarIntegration.create({
      data: {
        name: body.name,
        connectionId: parseInt(body.connectionId),
        calendarId: body.calendarId || 'primary',
        activityTypes: (body.activityTypes || ['meeting', 'call']) as any,
        autoMeetLink: body.autoMeetLink !== false,
        notifyLead: body.notifyLead === true,
        createdBy: user?.userId || null,
      },
    })

    return reply.code(201).send({ data: integration })
  })

  // PUT /api/admin/google/calendar/integrations/:id
  app.put('/api/admin/google/calendar/integrations/:id', { preHandler: adminOnly }, async (req, reply) => {
    const { id } = req.params as any
    const body = req.body as any

    const existing = await prisma.googleCalendarIntegration.findUnique({ where: { id: parseInt(id) } })
    if (!existing) return reply.code(404).send({ error: 'Integracao nao encontrada' })

    const data: any = {}
    if (body.name !== undefined) data.name = body.name
    if (body.active !== undefined) data.active = body.active
    if (body.calendarId !== undefined) data.calendarId = body.calendarId
    if (body.activityTypes !== undefined) data.activityTypes = body.activityTypes
    if (body.autoMeetLink !== undefined) data.autoMeetLink = body.autoMeetLink
    if (body.notifyLead !== undefined) data.notifyLead = body.notifyLead

    const updated = await prisma.googleCalendarIntegration.update({ where: { id: parseInt(id) }, data })
    return { data: updated }
  })

  // DELETE /api/admin/google/calendar/integrations/:id
  app.delete('/api/admin/google/calendar/integrations/:id', { preHandler: adminOnly }, async (req, reply) => {
    const { id } = req.params as any
    const existing = await prisma.googleCalendarIntegration.findUnique({ where: { id: parseInt(id) } })
    if (!existing) return reply.code(404).send({ error: 'Integracao nao encontrada' })
    await prisma.googleCalendarIntegration.delete({ where: { id: parseInt(id) } })
    return { ok: true }
  })

  // GET /api/admin/google/calendar/integrations/:id/logs
  app.get('/api/admin/google/calendar/integrations/:id/logs', { preHandler: adminOnly }, async (req, reply) => {
    const { id } = req.params as any
    const q = req.query as any
    const limit = Math.min(parseInt(q.limit) || 50, 200)
    const offset = parseInt(q.offset) || 0

    const [data, total] = await Promise.all([
      prisma.calendarSyncLog.findMany({
        where: { integrationId: parseInt(id) },
        orderBy: { createdAt: 'desc' },
        skip: offset,
        take: limit,
      }),
      prisma.calendarSyncLog.count({ where: { integrationId: parseInt(id) } }),
    ])

    return { data, total, limit, offset }
  })
}
