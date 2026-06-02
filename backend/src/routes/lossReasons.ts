// src/routes/lossReasons.ts
// CRUD do catálogo de motivos de perda (Fase 23).
// Listagem: qualquer operador autenticado (UI de "Marcar Perdido" precisa).
// Mutação: adminOnly.

import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { authMiddleware, adminOnly } from '../lib/auth.js'

export async function lossReasonsRoutes(app: FastifyInstance) {

  // GET /api/loss-reasons — lista motivos (com inactives ?active=all)
  app.get('/api/loss-reasons', { preHandler: authMiddleware }, async (req) => {
    const q = req.query as { active?: string }
    const where = q.active === 'all' ? {} : { active: true }
    const rows = await prisma.lossReason.findMany({
      where,
      orderBy: [{ position: 'asc' }, { id: 'asc' }],
    })
    return { data: rows }
  })

  // POST /api/loss-reasons — criar
  app.post('/api/loss-reasons', { preHandler: adminOnly }, async (req, reply) => {
    const body = (req.body || {}) as { name?: string; color?: string | null; position?: number; active?: boolean }
    const name = (body.name || '').trim()
    if (!name) return reply.code(400).send({ error: 'name obrigatório' })
    if (name.length > 100) return reply.code(400).send({ error: 'name muito longo (máx 100)' })

    const row = await prisma.lossReason.create({
      data: {
        name,
        color: body.color ?? null,
        position: Number.isFinite(body.position) ? Number(body.position) : 0,
        active: body.active !== false,
      },
    })
    return reply.code(201).send({ data: row })
  })

  // PUT /api/loss-reasons/:id — editar
  app.put('/api/loss-reasons/:id', { preHandler: adminOnly }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const body = (req.body || {}) as { name?: string; color?: string | null; position?: number; active?: boolean }
    const data: Record<string, any> = {}
    if (body.name !== undefined) {
      const n = (body.name || '').trim()
      if (!n) return reply.code(400).send({ error: 'name não pode ser vazio' })
      if (n.length > 100) return reply.code(400).send({ error: 'name muito longo (máx 100)' })
      data.name = n
    }
    if (body.color !== undefined) data.color = body.color
    if (body.position !== undefined && Number.isFinite(body.position)) data.position = Number(body.position)
    if (body.active !== undefined) data.active = !!body.active

    try {
      const row = await prisma.lossReason.update({ where: { id: parseInt(id) }, data })
      return { data: row }
    } catch {
      return reply.code(404).send({ error: 'motivo não encontrado' })
    }
  })

  // DELETE /api/loss-reasons/:id — soft-delete (active=false) se em uso, hard-delete se zero refs
  app.delete('/api/loss-reasons/:id', { preHandler: adminOnly }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const reasonId = parseInt(id)
    const inUse = await prisma.lead.count({ where: { lostReasonId: reasonId } })
    if (inUse > 0) {
      const row = await prisma.lossReason.update({ where: { id: reasonId }, data: { active: false } })
      return { data: row, softDeleted: true, leadsUsing: inUse }
    }
    try {
      await prisma.lossReason.delete({ where: { id: reasonId } })
      return { ok: true, hardDeleted: true }
    } catch {
      return reply.code(404).send({ error: 'motivo não encontrado' })
    }
  })
}
