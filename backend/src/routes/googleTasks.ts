import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { adminOnly } from '../lib/auth.js'
import { tasksListTaskLists, tasksCreateTask, tasksCompleteTask } from '../lib/google.js'

export async function googleTasksRoutes(app: FastifyInstance) {

  // GET /api/admin/google/tasks/config
  app.get('/api/admin/google/tasks/config', { preHandler: adminOnly }, async () => {
    const configs = await prisma.googleTasksConfig.findMany({ orderBy: { createdAt: 'desc' } })
    return { data: configs }
  })

  // GET /api/admin/google/tasks/lists?connectionId=1
  app.get('/api/admin/google/tasks/lists', { preHandler: adminOnly }, async (req, reply) => {
    const { connectionId } = req.query as any
    if (!connectionId) return reply.code(400).send({ error: 'connectionId obrigatorio' })
    try {
      const lists = await tasksListTaskLists(parseInt(connectionId))
      return { data: lists }
    } catch (err: any) {
      return reply.code(500).send({ error: err.message })
    }
  })

  // POST /api/admin/google/tasks/config
  app.post('/api/admin/google/tasks/config', { preHandler: adminOnly }, async (req, reply) => {
    const body = req.body as any
    if (!body.connectionId || !body.taskListId || !body.taskListTitle) {
      return reply.code(400).send({ error: 'connectionId, taskListId e taskListTitle sao obrigatorios' })
    }
    const user = (req as any).user
    const config = await prisma.googleTasksConfig.create({
      data: {
        connectionId: parseInt(body.connectionId),
        taskListId: body.taskListId,
        taskListTitle: body.taskListTitle,
        activityTypes: (body.activityTypes || ['task', 'followup', 'meeting', 'call']) as any,
        createdBy: user?.userId || null,
      },
    })
    return reply.code(201).send({ data: config })
  })

  // PUT /api/admin/google/tasks/config/:id
  app.put('/api/admin/google/tasks/config/:id', { preHandler: adminOnly }, async (req, reply) => {
    const { id } = req.params as any
    const body = req.body as any
    const data: any = {}
    if (body.taskListId !== undefined) data.taskListId = body.taskListId
    if (body.taskListTitle !== undefined) data.taskListTitle = body.taskListTitle
    if (body.activityTypes !== undefined) data.activityTypes = body.activityTypes
    if (body.active !== undefined) data.active = body.active
    const updated = await prisma.googleTasksConfig.update({ where: { id: parseInt(id) }, data })
    return { data: updated }
  })

  // DELETE /api/admin/google/tasks/config/:id
  app.delete('/api/admin/google/tasks/config/:id', { preHandler: adminOnly }, async (req, reply) => {
    const { id } = req.params as any
    await prisma.googleTasksConfig.delete({ where: { id: parseInt(id) } })
    return { ok: true }
  })
}

// ── Service: sync activity to Google Tasks ──────────────
// Roteamento Híbrido B: prefere config do operador dono da activity;
// se ele não tiver Google conectado, cai na config da empresa (kind=COMPANY).
export async function syncActivityToGoogleTasks(activityId: number): Promise<void> {
  try {
    const allConfigs = await prisma.googleTasksConfig.findMany({
      where: { active: true, connection: { active: true } },
      include: { connection: { select: { userId: true, kind: true } } },
    })
    if (allConfigs.length === 0) return

    const activity = await prisma.activity.findUnique({
      where: { id: activityId },
      select: { id: true, type: true, title: true, description: true, scheduledAt: true, leadId: true, userId: true, metadata: true },
    })
    if (!activity) return

    const ofUser = activity.userId
      ? allConfigs.filter(c => c.connection?.userId === activity.userId && c.connection?.kind === 'OPERATOR')
      : []
    const candidates = ofUser.length > 0 ? ofUser : allConfigs.filter(c => c.connection?.kind === 'COMPANY')
    const matched = candidates.filter(c => (c.activityTypes as string[]).includes(activity.type))
    if (matched.length === 0) return

    const lead = await prisma.lead.findUnique({
      where: { id: activity.leadId },
      select: { nome: true, empresa: true },
    })

    for (const config of matched) {
      try {
        const result = await tasksCreateTask(config.connectionId, config.taskListId, {
          title: `${activity.title} — ${lead?.nome || 'Lead'}`,
          notes: [
            activity.description || '',
            lead?.empresa ? `Empresa: ${lead.empresa}` : '',
            `Tipo: ${activity.type}`,
            `Criado via ByChat Beyond`,
          ].filter(Boolean).join('\n'),
          due: activity.scheduledAt,
        })

        // Save task ID in activity metadata
        const meta = (activity.metadata as any) || {}
        await prisma.activity.update({
          where: { id: activityId },
          data: { metadata: { ...meta, googleTaskId: result.id, googleTaskListId: config.taskListId } },
        })

        await prisma.googleTasksConfig.update({
          where: { id: config.id },
          data: { totalSynced: { increment: 1 } },
        })

        console.log(`[GoogleTasks] Activity #${activityId} synced → task ${result.id}`)
      } catch (err: any) {
        await prisma.googleTasksConfig.update({
          where: { id: config.id },
          data: { totalFailed: { increment: 1 } },
        }).catch(() => {})
        console.error(`[GoogleTasks] Sync failed for activity #${activityId}:`, err.message)
      }
    }
  } catch (err) {
    console.error('[GoogleTasks] syncActivityToGoogleTasks error:', err)
  }
}
