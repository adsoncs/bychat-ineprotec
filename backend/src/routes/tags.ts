// src/routes/tags.ts
// Tags — CRUD, assignment a leads, bulk operations, stats

import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { authMiddleware, adminOnly, type JwtPayload } from '../lib/auth.js'
import { moveToTrash, snapshotEntity } from '../services/trash.js'
import { logEvent, EVENT_TYPES, getOperator, getIp } from '../services/leadHistory.js'

const TAG_SELECT = { id: true, name: true, color: true, description: true, position: true, active: true, createdAt: true, updatedAt: true }
const TAG_LEAD_SELECT = { tag: { select: { id: true, name: true, color: true } } }

export async function tagsRoutes(app: FastifyInstance) {

  // ── GET /api/tags ─── Listar tags ativas ──
  app.get('/api/tags', { preHandler: authMiddleware }, async () => {
    const tags = await prisma.tag.findMany({
      where: { active: true },
      orderBy: [{ position: 'asc' }, { name: 'asc' }],
      select: TAG_SELECT,
    })
    return { tags }
  })

  // ── GET /api/tags/all ─── Todas incluindo inativas ──
  app.get('/api/tags/all', { preHandler: adminOnly }, async () => {
    const tags = await prisma.tag.findMany({
      orderBy: [{ position: 'asc' }, { name: 'asc' }],
      select: { ...TAG_SELECT, _count: { select: { leads: true } } },
    })
    return { tags }
  })

  // ── POST /api/tags ─── Criar tag ──
  app.post('/api/tags', { preHandler: adminOnly }, async (req, reply) => {
    const body = req.body as any
    if (!body.name || !body.color) return reply.code(400).send({ error: 'Nome e cor obrigatórios' })

    const existing = await prisma.tag.findUnique({ where: { name: body.name } })
    if (existing) return reply.code(409).send({ error: `Tag "${body.name}" já existe` })

    const maxPos = await prisma.tag.aggregate({ _max: { position: true } })
    const tag = await prisma.tag.create({
      data: {
        name: body.name.trim(),
        color: body.color,
        description: body.description || null,
        position: body.position ?? ((maxPos._max.position ?? -1) + 1),
      }
    })
    return reply.code(201).send({ ok: true, tag })
  })

  // ── PUT /api/tags/:id ─── Editar tag ──
  app.put('/api/tags/:id', { preHandler: adminOnly }, async (req, reply) => {
    const { id } = req.params as any
    const body = req.body as any

    const data: any = {}
    if (body.name !== undefined) data.name = body.name.trim()
    if (body.color !== undefined) data.color = body.color
    if (body.description !== undefined) data.description = body.description
    if (body.position !== undefined) data.position = body.position
    if (body.active !== undefined) data.active = body.active

    const tag = await prisma.tag.update({ where: { id: parseInt(id) }, data })
    return { ok: true, tag }
  })

  // ── DELETE /api/tags/:id ─── Deletar tag (move para lixeira) ──
  app.delete('/api/tags/:id', { preHandler: adminOnly }, async (req, reply) => {
    const { id } = req.params as any
    const user = (req as any).user as JwtPayload
    const snapshot = await snapshotEntity('tag', parseInt(id))
    if (snapshot) {
      await moveToTrash({
        entityType: 'tag',
        entityId: parseInt(id),
        entityLabel: (snapshot as any).name,
        snapshot,
        deletedBy: user.userId,
        deletedByName: user.name || user.email,
      })
    }
    await prisma.tag.delete({ where: { id: parseInt(id) } })
    return { ok: true }
  })

  // ── PUT /api/tags/reorder ─── Reordenar tags ──
  app.put('/api/tags/reorder', { preHandler: adminOnly }, async (req, reply) => {
    const { items } = req.body as any // [{id, position}]
    if (!Array.isArray(items)) return reply.code(400).send({ error: 'items obrigatório' })
    for (const item of items) {
      await prisma.tag.update({ where: { id: item.id }, data: { position: item.position } })
    }
    return { ok: true }
  })

  // ── POST /api/leads/:id/tags ─── Adicionar tags a um lead ──
  app.post('/api/leads/:id/tags', { preHandler: authMiddleware }, async (req, reply) => {
    const { id } = req.params as any
    const { tagIds } = req.body as any
    const leadId = parseInt(id)

    if (!Array.isArray(tagIds) || tagIds.length === 0) return reply.code(400).send({ error: 'tagIds obrigatório' })

    const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { id: true } })
    if (!lead) return reply.code(404).send({ error: 'Lead não encontrado' })

    const tags = await prisma.tag.findMany({ where: { id: { in: tagIds.map(Number) }, active: true } })
    if (tags.length === 0) return reply.code(400).send({ error: 'Nenhuma tag válida' })

    // Buscar tags já associadas para não duplicar
    const existing = await prisma.leadTag.findMany({
      where: { leadId, tagId: { in: tags.map(t => t.id) } },
      select: { tagId: true },
    })
    const existingIds = new Set(existing.map(e => e.tagId))
    const toCreate = tags.filter(t => !existingIds.has(t.id))

    for (const tag of toCreate) {
      await prisma.leadTag.create({ data: { leadId, tagId: tag.id } })
    }

    const operator = getOperator(req)
    if (toCreate.length > 0) {
      logEvent({
        leadId,
        type: EVENT_TYPES.TAG_ADDED,
        category: 'operator',
        title: `Tags adicionadas: ${toCreate.map(t => t.name).join(', ')}`,
        source: 'panel',
        ...operator,
        newValue: toCreate.map(t => t.name).join(', '),
        ipAddress: getIp(req),
      })
    }

    const updated = await prisma.leadTag.findMany({
      where: { leadId },
      select: TAG_LEAD_SELECT,
    })
    return { ok: true, tags: updated.map(lt => lt.tag) }
  })

  // ── DELETE /api/leads/:id/tags/:tagId ─── Remover tag de um lead ──
  app.delete('/api/leads/:id/tags/:tagId', { preHandler: authMiddleware }, async (req, reply) => {
    const { id, tagId } = req.params as any
    const leadId = parseInt(id)
    const tId = parseInt(tagId)

    const lt = await prisma.leadTag.findUnique({ where: { leadId_tagId: { leadId, tagId: tId } } })
    if (!lt) return reply.code(404).send({ error: 'Tag não associada a este lead' })

    const tag = await prisma.tag.findUnique({ where: { id: tId }, select: { name: true } })
    await prisma.leadTag.delete({ where: { id: lt.id } })

    const operator = getOperator(req)
    logEvent({
      leadId,
      type: EVENT_TYPES.TAG_REMOVED,
      category: 'operator',
      title: `Tag removida: ${tag?.name || tId}`,
      source: 'panel',
      ...operator,
      oldValue: tag?.name || String(tId),
      ipAddress: getIp(req),
    })

    return { ok: true }
  })

  // ── POST /api/leads/bulk/tags ─── Bulk add/remove tags ──
  app.post('/api/leads/bulk/tags', { preHandler: authMiddleware }, async (req, reply) => {
    const { leadIds, tagIds, action } = req.body as any

    if (!Array.isArray(leadIds) || !Array.isArray(tagIds) || !['add', 'remove'].includes(action)) {
      return reply.code(400).send({ error: 'leadIds, tagIds e action (add/remove) obrigatórios' })
    }
    if (leadIds.length > 100) return reply.code(400).send({ error: 'Máximo 100 leads por operação' })

    const tags = await prisma.tag.findMany({ where: { id: { in: tagIds.map(Number) } }, select: { id: true, name: true } })
    if (tags.length === 0) return reply.code(400).send({ error: 'Nenhuma tag válida' })

    const operator = getOperator(req)
    let affected = 0

    if (action === 'add') {
      for (const leadId of leadIds) {
        const existing = await prisma.leadTag.findMany({
          where: { leadId: Number(leadId), tagId: { in: tags.map(t => t.id) } },
          select: { tagId: true },
        })
        const existingIds = new Set(existing.map(e => e.tagId))
        const toCreate = tags.filter(t => !existingIds.has(t.id))

        for (const tag of toCreate) {
          await prisma.leadTag.create({ data: { leadId: Number(leadId), tagId: tag.id } })
        }
        if (toCreate.length > 0) {
          affected++
          logEvent({
            leadId: Number(leadId),
            type: EVENT_TYPES.TAG_ADDED,
            category: 'operator',
            title: `Tags adicionadas em bulk: ${toCreate.map(t => t.name).join(', ')}`,
            source: 'panel',
            ...operator,
            newValue: toCreate.map(t => t.name).join(', '),
            ipAddress: getIp(req),
          })
        }
      }
    } else {
      for (const leadId of leadIds) {
        const deleted = await prisma.leadTag.deleteMany({
          where: { leadId: Number(leadId), tagId: { in: tags.map(t => t.id) } },
        })
        if (deleted.count > 0) {
          affected++
          logEvent({
            leadId: Number(leadId),
            type: EVENT_TYPES.TAG_REMOVED,
            category: 'operator',
            title: `Tags removidas em bulk: ${tags.map(t => t.name).join(', ')}`,
            source: 'panel',
            ...operator,
            oldValue: tags.map(t => t.name).join(', '),
            ipAddress: getIp(req),
          })
        }
      }
    }

    return { ok: true, affected, total: leadIds.length }
  })

  // ── GET /api/tags/stats ─── Distribuição de tags ──
  app.get('/api/tags/stats', { preHandler: adminOnly }, async () => {
    const tags = await prisma.tag.findMany({
      where: { active: true },
      orderBy: [{ position: 'asc' }],
      select: { id: true, name: true, color: true, _count: { select: { leads: true } } },
    })
    return {
      tags: tags.map(t => ({ id: t.id, name: t.name, color: t.color, count: t._count.leads }))
    }
  })
}
