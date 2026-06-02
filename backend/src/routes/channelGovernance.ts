// src/routes/channelGovernance.ts
// Sales Engagement A4: CRUD admin de ChannelGovernance por equipe.
// Configura cap diário por canal, silence window e blacklist por time
// (teamId NULL = configuração global, fallback quando lead não tem teamId).

import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { authMiddleware, adminOnly } from '../lib/auth.js'

const SELECT = {
  id: true,
  teamId: true,
  team: { select: { id: true, name: true, slug: true, color: true } },
  maxPerChannelPerDay: true,
  silenceWindow: true,
  blacklist: true,
  active: true,
  createdAt: true,
  updatedAt: true,
}

interface UpsertBody {
  teamId?: number | null
  maxPerChannelPerDay?: Record<string, number>
  silenceWindow?: { start: string; end: string; weekends: boolean }
  blacklist?: { phones: string[]; emails: string[] }
  active?: boolean
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/

function validate(body: UpsertBody, partial = false): string | null {
  if (!partial) {
    if (!body.maxPerChannelPerDay || typeof body.maxPerChannelPerDay !== 'object') {
      return 'maxPerChannelPerDay obrigatório'
    }
    if (!body.silenceWindow) return 'silenceWindow obrigatório'
    if (!body.blacklist) return 'blacklist obrigatório'
  }
  if (body.maxPerChannelPerDay) {
    for (const [k, v] of Object.entries(body.maxPerChannelPerDay)) {
      if (typeof v !== 'number' || v < 0 || !Number.isFinite(v)) {
        return `maxPerChannelPerDay.${k} deve ser número >= 0`
      }
    }
  }
  if (body.silenceWindow) {
    const sw = body.silenceWindow
    if (!HHMM.test(sw.start) || !HHMM.test(sw.end)) return 'silenceWindow.start/end devem ser HH:MM'
    if (typeof sw.weekends !== 'boolean') return 'silenceWindow.weekends deve ser boolean'
  }
  if (body.blacklist) {
    if (!Array.isArray(body.blacklist.phones) || !Array.isArray(body.blacklist.emails)) {
      return 'blacklist.phones e blacklist.emails devem ser arrays'
    }
  }
  return null
}

export async function channelGovernanceRoutes(app: FastifyInstance) {
  // GET /api/admin/channel-governance — lista (global + por equipe)
  app.get('/api/admin/channel-governance', { preHandler: [authMiddleware, adminOnly] }, async () => {
    const items = await prisma.channelGovernance.findMany({
      orderBy: [{ teamId: 'asc' }],
      select: SELECT,
    })
    return { items }
  })

  // GET /api/admin/channel-governance/:id
  app.get<{ Params: { id: string } }>(
    '/api/admin/channel-governance/:id',
    { preHandler: [authMiddleware, adminOnly] },
    async (req, reply) => {
      const id = Number(req.params.id)
      if (!Number.isFinite(id)) return reply.code(400).send({ error: 'id inválido' })
      const item = await prisma.channelGovernance.findUnique({ where: { id }, select: SELECT })
      if (!item) return reply.code(404).send({ error: 'não encontrado' })
      return item
    },
  )

  // POST /api/admin/channel-governance
  app.post<{ Body: UpsertBody }>(
    '/api/admin/channel-governance',
    { preHandler: [authMiddleware, adminOnly] },
    async (req, reply) => {
      const err = validate(req.body, false)
      if (err) return reply.code(400).send({ error: err })

      const teamId = req.body.teamId ?? null
      if (teamId !== null) {
        const team = await prisma.team.findUnique({ where: { id: teamId }, select: { id: true } })
        if (!team) return reply.code(400).send({ error: 'team não encontrado' })
      }
      // Prisma findUnique não aceita null; usa findFirst para o caso global.
      const exists =
        teamId === null
          ? await prisma.channelGovernance.findFirst({ where: { teamId: null } })
          : await prisma.channelGovernance.findUnique({ where: { teamId } })
      if (exists) return reply.code(409).send({ error: 'já existe configuração para esta equipe' })

      const created = await prisma.channelGovernance.create({
        data: {
          teamId,
          maxPerChannelPerDay: req.body.maxPerChannelPerDay!,
          silenceWindow: req.body.silenceWindow!,
          blacklist: req.body.blacklist!,
          active: req.body.active ?? true,
        },
        select: SELECT,
      })
      return reply.code(201).send(created)
    },
  )

  // PUT /api/admin/channel-governance/:id
  app.put<{ Params: { id: string }; Body: UpsertBody }>(
    '/api/admin/channel-governance/:id',
    { preHandler: [authMiddleware, adminOnly] },
    async (req, reply) => {
      const id = Number(req.params.id)
      if (!Number.isFinite(id)) return reply.code(400).send({ error: 'id inválido' })

      const err = validate(req.body, true)
      if (err) return reply.code(400).send({ error: err })

      const data: Record<string, unknown> = {}
      if (req.body.maxPerChannelPerDay !== undefined) data.maxPerChannelPerDay = req.body.maxPerChannelPerDay
      if (req.body.silenceWindow !== undefined) data.silenceWindow = req.body.silenceWindow
      if (req.body.blacklist !== undefined) data.blacklist = req.body.blacklist
      if (req.body.active !== undefined) data.active = req.body.active

      try {
        const updated = await prisma.channelGovernance.update({ where: { id }, data, select: SELECT })
        return updated
      } catch {
        return reply.code(404).send({ error: 'não encontrado' })
      }
    },
  )

  // DELETE /api/admin/channel-governance/:id
  app.delete<{ Params: { id: string } }>(
    '/api/admin/channel-governance/:id',
    { preHandler: [authMiddleware, adminOnly] },
    async (req, reply) => {
      const id = Number(req.params.id)
      if (!Number.isFinite(id)) return reply.code(400).send({ error: 'id inválido' })
      try {
        await prisma.channelGovernance.delete({ where: { id } })
        return reply.code(204).send()
      } catch {
        return reply.code(404).send({ error: 'não encontrado' })
      }
    },
  )
}
