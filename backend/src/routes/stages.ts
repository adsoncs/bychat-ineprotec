import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { moveToTrash, snapshotEntity } from '../services/trash.js'
import { adminOnly } from '../lib/auth.js'

export async function stagesRoutes(app: FastifyInstance) {

  // ── GET /api/admin/stages — Listar etapas (com filtro de funil opcional) ──
  app.get('/api/admin/stages', { preHandler: adminOnly }, async (req) => {
    const { funnelId } = req.query as any
    const where: any = {}
    if (funnelId) {
      where.funnelId = Number(funnelId)
    } else {
      const defaultFunnel = await prisma.funnel.findFirst({ where: { isDefault: true } })
      if (defaultFunnel) where.funnelId = defaultFunnel.id
    }
    const stages = await prisma.stage.findMany({ where, orderBy: { position: 'asc' } })
    return { stages }
  })

  // ── POST /api/admin/stages — Criar etapa (requer funnelId) ──
  app.post('/api/admin/stages', { preHandler: adminOnly }, async (req, reply) => {
    const { key, name, color, position, funnelId, consumesSlot } = req.body as any
    if (!key || !name || !color) {
      return reply.code(400).send({ error: 'Key, nome e cor são obrigatórios' })
    }

    // Resolve funnel
    let resolvedFunnelId = funnelId ? Number(funnelId) : null
    if (!resolvedFunnelId) {
      const def = await prisma.funnel.findFirst({ where: { isDefault: true } })
      resolvedFunnelId = def?.id || null
    }
    if (!resolvedFunnelId) return reply.code(400).send({ error: 'Funil não encontrado' })

    const cleanKey = key.toUpperCase().replace(/[^A-Z0-9_]/g, '')
    const exists = await prisma.stage.findFirst({ where: { funnelId: resolvedFunnelId, key: cleanKey } })
    if (exists) return reply.code(409).send({ error: 'Já existe uma etapa com esta chave neste funil' })

    const maxPos = await prisma.stage.aggregate({ where: { funnelId: resolvedFunnelId }, _max: { position: true } })
    const stage = await prisma.stage.create({
      data: {
        funnelId: resolvedFunnelId,
        key: cleanKey,
        name: name.trim(),
        color,
        position: position ?? ((maxPos._max.position ?? -1) + 1),
        consumesSlot: !!consumesSlot,
      }
    })
    return stage
  })

  // ── PUT /api/admin/stages/:id ──
  app.put('/api/admin/stages/:id', { preHandler: adminOnly }, async (req, reply) => {
    const { id } = req.params as any
    const { name, color, position, active, consumesSlot } = req.body as any
    const stage = await prisma.stage.findUnique({ where: { id: Number(id) } })
    if (!stage) return reply.code(404).send({ error: 'Etapa não encontrada' })

    const data: any = {}
    if (name !== undefined) data.name = name.trim()
    if (color !== undefined) data.color = color
    if (position !== undefined) data.position = position
    if (active !== undefined) data.active = active
    if (consumesSlot !== undefined) data.consumesSlot = !!consumesSlot

    return prisma.stage.update({ where: { id: Number(id) }, data })
  })

  // ── PUT /api/admin/stages/reorder ──
  app.put('/api/admin/stages/reorder', { preHandler: adminOnly }, async (req, reply) => {
    const { order } = req.body as any
    if (!Array.isArray(order)) return reply.code(400).send({ error: 'Formato inválido' })
    for (const item of order) {
      await prisma.stage.update({ where: { id: item.id }, data: { position: item.position } })
    }
    return { ok: true }
  })

  // ── DELETE /api/admin/stages/:id ──
  app.delete('/api/admin/stages/:id', { preHandler: adminOnly }, async (req, reply) => {
    const { id } = req.params as any
    const stage = await prisma.stage.findUnique({ where: { id: Number(id) } })
    if (!stage) return reply.code(404).send({ error: 'Etapa não encontrada' })

    const count = await prisma.lead.count({ where: { status: stage.key, funnelId: stage.funnelId } })
    if (count > 0) return reply.code(400).send({ error: `Não é possível excluir: ${count} lead(s) estão nesta etapa.` })

    const user = (req as any).user
    await moveToTrash({
      entityType: 'stage', entityId: Number(id), entityLabel: stage.name || stage.key,
      snapshot: stage, deletedBy: user?.userId, deletedByName: user?.name || user?.email,
    })
    await prisma.stage.delete({ where: { id: Number(id) } })
    return { ok: true }
  })
}
