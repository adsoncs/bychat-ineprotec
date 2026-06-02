// Filtros nomeados (públicos do tenant ou privados por operador) e filtro
// CORRENTE aplicado por usuário num scope. O scope 'leads' é compartilhado
// entre /app/leads e /app/kanban (ambas consomem a mesma lista).
//
// Endpoints:
//   GET    /api/saved-filters?scope=leads      → lista (públicos + privados do user)
//   POST   /api/saved-filters                  → cria
//   PUT    /api/saved-filters/:id              → atualiza (só criador)
//   DELETE /api/saved-filters/:id              → deleta (só criador)
//   GET    /api/applied-filter?scope=leads     → retorna { filters } ou null
//   PUT    /api/applied-filter                 → upsert { scope, filters }
//   DELETE /api/applied-filter?scope=leads     → reseta (apaga)

import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { authMiddleware } from '../lib/auth.js'

type Visibility = 'public' | 'private'

function isVisibility(v: unknown): v is Visibility {
  return v === 'public' || v === 'private'
}

function serialize(f: {
  id: number; scope: string; name: string; filters: any; visibility: string;
  createdById: number; createdAt: Date; updatedAt: Date;
  createdBy?: { id: number; name: string | null; email: string } | null;
}) {
  return {
    id: f.id,
    scope: f.scope,
    name: f.name,
    filters: f.filters,
    visibility: f.visibility,
    createdById: f.createdById,
    createdByName: f.createdBy?.name ?? f.createdBy?.email ?? null,
    createdAt: f.createdAt,
    updatedAt: f.updatedAt,
  }
}

export async function savedFiltersRoutes(app: FastifyInstance) {

  // ─── Saved filters (catálogo nomeado) ───────────────────────────────

  app.get('/api/saved-filters', { preHandler: authMiddleware }, async (req, reply) => {
    const user = (req as any).user as { userId: number }
    const q = req.query as { scope?: string }
    const scope = (q.scope || '').trim()
    if (!scope) return reply.code(400).send({ error: 'scope é obrigatório' })

    const rows = await prisma.savedFilter.findMany({
      where: {
        scope,
        OR: [
          { visibility: 'public' },
          { visibility: 'private', createdById: user.userId },
        ],
      },
      include: {
        createdBy: { select: { id: true, name: true, email: true } },
      },
      orderBy: [{ name: 'asc' }],
    })

    return reply.send({ filters: rows.map(serialize) })
  })

  app.post('/api/saved-filters', { preHandler: authMiddleware }, async (req, reply) => {
    const user = (req as any).user as { userId: number }
    const body = (req.body ?? {}) as { scope?: string; name?: string; filters?: any; visibility?: string }
    const scope = (body.scope || '').trim()
    const name = (body.name || '').trim().slice(0, 120)
    const visibility = isVisibility(body.visibility) ? body.visibility : 'private'

    if (!scope) return reply.code(400).send({ error: 'scope é obrigatório' })
    if (!name) return reply.code(400).send({ error: 'name é obrigatório' })
    if (body.filters == null || typeof body.filters !== 'object') {
      return reply.code(400).send({ error: 'filters precisa ser objeto JSON' })
    }

    const created = await prisma.savedFilter.create({
      data: {
        scope, name, visibility,
        filters: body.filters,
        createdById: user.userId,
      },
      include: { createdBy: { select: { id: true, name: true, email: true } } },
    })

    return reply.send({ filter: serialize(created) })
  })

  app.put('/api/saved-filters/:id', { preHandler: authMiddleware }, async (req, reply) => {
    const user = (req as any).user as { userId: number }
    const { id } = req.params as { id: string }
    const filterId = parseInt(id)
    if (!Number.isFinite(filterId)) return reply.code(400).send({ error: 'id inválido' })

    const existing = await prisma.savedFilter.findUnique({ where: { id: filterId } })
    if (!existing) return reply.code(404).send({ error: 'Filtro não encontrado' })
    if (existing.createdById !== user.userId) {
      return reply.code(403).send({ error: 'Só o criador pode editar' })
    }

    const body = (req.body ?? {}) as { name?: string; filters?: any; visibility?: string }
    const data: any = {}
    if (typeof body.name === 'string') {
      const n = body.name.trim().slice(0, 120)
      if (n) data.name = n
    }
    if (body.filters && typeof body.filters === 'object') data.filters = body.filters
    if (isVisibility(body.visibility)) data.visibility = body.visibility

    const updated = await prisma.savedFilter.update({
      where: { id: filterId },
      data,
      include: { createdBy: { select: { id: true, name: true, email: true } } },
    })

    return reply.send({ filter: serialize(updated) })
  })

  app.delete('/api/saved-filters/:id', { preHandler: authMiddleware }, async (req, reply) => {
    const user = (req as any).user as { userId: number }
    const { id } = req.params as { id: string }
    const filterId = parseInt(id)
    if (!Number.isFinite(filterId)) return reply.code(400).send({ error: 'id inválido' })

    const existing = await prisma.savedFilter.findUnique({ where: { id: filterId } })
    if (!existing) return reply.code(404).send({ error: 'Filtro não encontrado' })
    if (existing.createdById !== user.userId) {
      return reply.code(403).send({ error: 'Só o criador pode excluir' })
    }

    await prisma.savedFilter.delete({ where: { id: filterId } })
    return reply.send({ ok: true })
  })

  // ─── Applied filter (estado corrente por usuário+scope) ─────────────

  app.get('/api/applied-filter', { preHandler: authMiddleware }, async (req, reply) => {
    const user = (req as any).user as { userId: number }
    const q = req.query as { scope?: string }
    const scope = (q.scope || '').trim()
    if (!scope) return reply.code(400).send({ error: 'scope é obrigatório' })

    const row = await prisma.userAppliedFilter.findUnique({
      where: { userId_scope: { userId: user.userId, scope } },
    })

    return reply.send({
      filters: row?.filters ?? null,
      updatedAt: row?.updatedAt ?? null,
    })
  })

  app.put('/api/applied-filter', { preHandler: authMiddleware }, async (req, reply) => {
    const user = (req as any).user as { userId: number }
    const body = (req.body ?? {}) as { scope?: string; filters?: any }
    const scope = (body.scope || '').trim()
    if (!scope) return reply.code(400).send({ error: 'scope é obrigatório' })
    if (body.filters == null || typeof body.filters !== 'object') {
      return reply.code(400).send({ error: 'filters precisa ser objeto JSON' })
    }

    await prisma.userAppliedFilter.upsert({
      where: { userId_scope: { userId: user.userId, scope } },
      create: { userId: user.userId, scope, filters: body.filters },
      update: { filters: body.filters },
    })

    return reply.send({ ok: true })
  })

  app.delete('/api/applied-filter', { preHandler: authMiddleware }, async (req, reply) => {
    const user = (req as any).user as { userId: number }
    const q = req.query as { scope?: string }
    const scope = (q.scope || '').trim()
    if (!scope) return reply.code(400).send({ error: 'scope é obrigatório' })

    await prisma.userAppliedFilter.deleteMany({
      where: { userId: user.userId, scope },
    })

    return reply.send({ ok: true })
  })
}
