import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { adminOnly, authMiddleware, type JwtPayload } from '../lib/auth.js'
import { moveToTrash, snapshotFunnel } from '../services/trash.js'
import { logUserAudit, auditActor } from '../services/userAudit.js'

export async function funnelsRoutes(app: FastifyInstance) {

  // GET /api/admin/funnels — List all funnels
  app.get('/api/admin/funnels', { preHandler: authMiddleware }, async () => {
    const funnels = await prisma.funnel.findMany({
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
      include: {
        _count: { select: { stages: true, leads: true, chatbots: true } }
      }
    })
    return { funnels }
  })

  // GET /api/admin/funnels/:id — Get funnel with stages
  app.get('/api/admin/funnels/:id', { preHandler: authMiddleware }, async (req, reply) => {
    const { id } = req.params as any
    const funnel = await prisma.funnel.findUnique({
      where: { id: Number(id) },
      include: {
        stages: { orderBy: { position: 'asc' } },
        chatbots: { select: { id: true, name: true, channel: true } },
        _count: { select: { leads: true } }
      }
    })
    if (!funnel) return reply.code(404).send({ error: 'Funil não encontrado' })
    return funnel
  })

  // GET /api/admin/funnels/default — Get default funnel
  app.get('/api/admin/funnels/default/info', { preHandler: authMiddleware }, async () => {
    const funnel = await prisma.funnel.findFirst({
      where: { isDefault: true },
      include: { stages: { orderBy: { position: 'asc' } } }
    })
    return funnel
  })

  // POST /api/admin/funnels — Create funnel
  app.post('/api/admin/funnels', { preHandler: adminOnly }, async (req) => {
    const { name, description, copyFromId } = req.body as any

    const funnel = await prisma.funnel.create({
      data: { name: name || 'Novo Funil', description: description || '' }
    })

    // Copy stages from another funnel or create defaults
    if (copyFromId) {
      const sourceStages = await prisma.stage.findMany({
        where: { funnelId: Number(copyFromId) },
        orderBy: { position: 'asc' }
      })
      for (const s of sourceStages) {
        await prisma.stage.create({
          data: { funnelId: funnel.id, key: s.key, name: s.name, color: s.color, position: s.position, active: s.active, consumesSlot: s.consumesSlot }
        })
      }
    } else {
      // Create basic default stages
      const defaults = [
        { key: 'NOVO', name: 'Novo', color: '#1a73e8', position: 0 },
        { key: 'CONTATADO', name: 'Contatado', color: '#f9ab00', position: 1 },
        { key: 'FECHADO', name: 'Fechado', color: '#34a853', position: 2 },
        { key: 'PERDIDO', name: 'Perdido', color: '#ea4335', position: 3 },
      ]
      for (const s of defaults) {
        await prisma.stage.create({ data: { funnelId: funnel.id, ...s } })
      }
    }

    return funnel
  })

  // PATCH /api/admin/funnels/:id/default — Elege o funil padrão
  //
  // O padrão é o destino de todo lead que chega sem funil definido: webhook de
  // entrada (inboundWebhooks), criação manual/importação (leads), portais e o
  // fallback do Kanban. Trocar aqui muda para onde essas entradas vão daqui em
  // diante — leads JÁ existentes não se movem.
  //
  // isDefault é único por convenção (não há constraint no banco): a troca
  // desmarca os demais na mesma transação, então nunca fica sem padrão nem com
  // dois. Funil inativo não pode ser padrão — as entradas cairiam num funil que
  // some das listagens.
  app.patch('/api/admin/funnels/:id/default', { preHandler: adminOnly }, async (req, reply) => {
    const { id } = req.params as any
    const idNum = Number(id)
    if (!Number.isFinite(idNum)) return reply.code(400).send({ error: 'ID inválido' })

    const funnel = await prisma.funnel.findUnique({ where: { id: idNum }, select: { id: true, name: true, active: true, isDefault: true } })
    if (!funnel) return reply.code(404).send({ error: 'Funil não encontrado' })
    if (!funnel.active) return reply.code(400).send({ error: 'Funil inativo não pode ser o padrão. Reative-o antes.' })
    if (funnel.isDefault) return { ok: true, funnel, changed: false }

    const previous = await prisma.funnel.findFirst({ where: { isDefault: true }, select: { id: true, name: true } })

    await prisma.$transaction([
      prisma.funnel.updateMany({ where: { isDefault: true, NOT: { id: idNum } }, data: { isDefault: false } }),
      prisma.funnel.update({ where: { id: idNum }, data: { isDefault: true } }),
    ])

    void logUserAudit({
      action: 'funnel.default_changed',
      targetType: 'funnel',
      targetLabel: funnel.name,
      changes: { from: previous ? { id: previous.id, name: previous.name } : null, to: { id: funnel.id, name: funnel.name } },
      ...auditActor(req),
    })

    return { ok: true, funnel: { ...funnel, isDefault: true }, previous, changed: true }
  })

  // PUT /api/admin/funnels/:id — Update funnel
  app.put('/api/admin/funnels/:id', { preHandler: adminOnly }, async (req) => {
    const { id } = req.params as any
    const { name, description, active } = req.body as any
    const data: any = {}
    if (name !== undefined) data.name = name
    if (description !== undefined) data.description = description
    if (active !== undefined) data.active = active
    return prisma.funnel.update({ where: { id: Number(id) }, data })
  })

  // DELETE /api/admin/funnels/:id — Delete funnel (move para lixeira)
  app.delete('/api/admin/funnels/:id', { preHandler: adminOnly }, async (req, reply) => {
    const { id } = req.params as any
    const user = (req as any).user as JwtPayload
    const funnel = await prisma.funnel.findUnique({ where: { id: Number(id) } })
    if (!funnel) return reply.code(404).send({ error: 'Funil não encontrado' })
    if (funnel.isDefault) return reply.code(400).send({ error: 'Não é possível excluir o funil padrão' })

    const leadCount = await prisma.lead.count({ where: { funnelId: Number(id) } })
    if (leadCount > 0) {
      return reply.code(400).send({ error: `Não é possível excluir: ${leadCount} lead(s) estão neste funil. Mova-os antes.` })
    }

    const snapshot = await snapshotFunnel(Number(id))
    await moveToTrash({
      entityType: 'funnel',
      entityId: Number(id),
      entityLabel: funnel.name,
      snapshot,
      deletedBy: user.userId,
      deletedByName: user.name || user.email,
    })

    await prisma.funnel.delete({ where: { id: Number(id) } })
    return { ok: true }
  })

  // ── Funnel-scoped stages ──

  // POST /api/admin/funnels/:id/stages — Create stage within funnel
  app.post('/api/admin/funnels/:id/stages', { preHandler: adminOnly }, async (req, reply) => {
    const { id } = req.params as any
    const { key, name, color, consumesSlot } = req.body as any
    if (!key || !name || !color) return reply.code(400).send({ error: 'Key, nome e cor são obrigatórios' })

    const cleanKey = key.toUpperCase().replace(/[^A-Z0-9_]/g, '')
    const exists = await prisma.stage.findFirst({ where: { funnelId: Number(id), key: cleanKey } })
    if (exists) return reply.code(409).send({ error: 'Já existe uma etapa com esta chave neste funil' })

    const maxPos = await prisma.stage.aggregate({ where: { funnelId: Number(id) }, _max: { position: true } })
    const stage = await prisma.stage.create({
      data: {
        funnelId: Number(id),
        key: cleanKey,
        name: name.trim(),
        color,
        position: (maxPos._max.position ?? -1) + 1,
        consumesSlot: !!consumesSlot,
      }
    })
    return stage
  })
}
