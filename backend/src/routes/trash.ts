// routes/trash.ts — Lixeira (Trash) — acesso restrito a SUPERADMIN
import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { superadminOnly } from '../lib/auth.js'
import { restoreFromTrash, purgeExpiredTrash } from '../services/trash.js'
import type { JwtPayload } from '../lib/auth.js'

export async function trashRoutes(app: FastifyInstance) {

  // ── GET /api/admin/trash — Listar itens na lixeira ──
  app.get('/api/admin/trash', { preHandler: superadminOnly }, async (req) => {
    const { entityType, search, limit, offset } = req.query as any

    const where: any = {
      restoredAt: null, // só mostrar itens não restaurados
    }

    if (entityType) where.entityType = entityType
    if (search) {
      where.entityLabel = { contains: search }
    }

    const [items, total] = await Promise.all([
      prisma.trashItem.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: parseInt(limit) || 50,
        skip: parseInt(offset) || 0,
        select: {
          id: true,
          entityType: true,
          entityId: true,
          entityLabel: true,
          deletedBy: true,
          deletedByName: true,
          reason: true,
          expiresAt: true,
          createdAt: true,
        },
      }),
      prisma.trashItem.count({ where }),
    ])

    return { ok: true, items, total }
  })

  // ── GET /api/admin/trash/:id — Detalhe com snapshot completo ──
  app.get('/api/admin/trash/:id', { preHandler: superadminOnly }, async (req, reply) => {
    const { id } = req.params as any
    const item = await prisma.trashItem.findUnique({ where: { id: parseInt(id) } })
    if (!item) return reply.code(404).send({ error: 'Item não encontrado' })
    return { ok: true, item }
  })

  // ── POST /api/admin/trash/:id/restore — Restaurar item ──
  app.post('/api/admin/trash/:id/restore', { preHandler: superadminOnly }, async (req, reply) => {
    const { id } = req.params as any
    const user = (req as any).user as JwtPayload

    try {
      const result = await restoreFromTrash(parseInt(id), user.userId)
      console.log(`[Trash] Restored ${result.trashItem.entityType} #${result.trashItem.entityId} ("${result.trashItem.entityLabel}") by ${user.email}`)
      return {
        ok: true,
        entityType: result.trashItem.entityType,
        entityLabel: result.trashItem.entityLabel,
        restoredId: result.restored.id,
      }
    } catch (err: any) {
      return reply.code(400).send({ error: err.message })
    }
  })

  // ── POST /api/admin/trash/restore-bulk — Restaurar múltiplos itens ──
  app.post('/api/admin/trash/restore-bulk', { preHandler: superadminOnly }, async (req, reply) => {
    const { trashIds } = req.body as any
    const user = (req as any).user as JwtPayload

    if (!Array.isArray(trashIds) || trashIds.length === 0) {
      return reply.code(400).send({ error: 'trashIds (array) é obrigatório' })
    }

    if (trashIds.length > 50) {
      return reply.code(400).send({ error: 'Máximo de 50 itens por operação' })
    }

    const results: any[] = []
    const errors: any[] = []

    for (const tid of trashIds) {
      try {
        const result = await restoreFromTrash(parseInt(tid), user.userId)
        results.push({
          trashId: tid,
          entityType: result.trashItem.entityType,
          entityLabel: result.trashItem.entityLabel,
          restoredId: result.restored.id,
        })
      } catch (err: any) {
        errors.push({ trashId: tid, error: err.message })
      }
    }

    console.log(`[Trash] Bulk restore: ${results.length} restored, ${errors.length} errors by ${user.email}`)
    return { ok: true, restored: results.length, failed: errors.length, results, errors }
  })

  // ── DELETE /api/admin/trash/:id — Deletar permanentemente da lixeira ──
  app.delete('/api/admin/trash/:id', { preHandler: superadminOnly }, async (req, reply) => {
    const { id } = req.params as any
    const user = (req as any).user as JwtPayload

    const item = await prisma.trashItem.findUnique({ where: { id: parseInt(id) } })
    if (!item) return reply.code(404).send({ error: 'Item não encontrado' })

    await prisma.trashItem.delete({ where: { id: parseInt(id) } })
    console.log(`[Trash] Permanently deleted ${item.entityType} #${item.entityId} ("${item.entityLabel}") by ${user.email}`)
    return { ok: true }
  })

  // ── DELETE /api/admin/trash/purge — Limpar itens expirados manualmente ──
  app.delete('/api/admin/trash/purge', { preHandler: superadminOnly }, async () => {
    const count = await purgeExpiredTrash()
    return { ok: true, purged: count }
  })

  // ── GET /api/admin/trash/stats — Estatísticas da lixeira ──
  app.get('/api/admin/trash/stats', { preHandler: superadminOnly }, async () => {
    const [total, byType, restored] = await Promise.all([
      prisma.trashItem.count({ where: { restoredAt: null } }),
      prisma.$queryRaw`
        SELECT entityType, COUNT(*) as count
        FROM bychat_trash
        WHERE restoredAt IS NULL
        GROUP BY entityType
        ORDER BY count DESC
      ` as Promise<any[]>,
      prisma.trashItem.count({ where: { restoredAt: { not: null } } }),
    ])

    return {
      ok: true,
      total,
      restored,
      byType: byType.map((r: any) => ({ type: r.entityType, count: Number(r.count) })),
    }
  })

  // ── GET /api/admin/trash/history — Histórico de restaurações ──
  app.get('/api/admin/trash/history', { preHandler: superadminOnly }, async (req) => {
    const { limit, offset } = req.query as any

    const items = await prisma.trashItem.findMany({
      where: { restoredAt: { not: null } },
      orderBy: { restoredAt: 'desc' },
      take: parseInt(limit) || 50,
      skip: parseInt(offset) || 0,
      select: {
        id: true,
        entityType: true,
        entityId: true,
        entityLabel: true,
        deletedBy: true,
        deletedByName: true,
        restoredAt: true,
        restoredBy: true,
        createdAt: true,
      },
    })

    return { ok: true, items }
  })
}
