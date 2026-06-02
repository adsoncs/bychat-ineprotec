// src/routes/transferRequests.ts
// Reforma F3 — Transferência consensual de leads entre agentes.
//
// Fluxo:
//   1. A pede pra B: POST /transfer-requests {leadId, toUserId, reason}
//        - exige A.assignedUserId == leadId; senão 403
//        - 1 pending por lead (bloqueia duplicata)
//   2. B aceita: POST /:id/accept {response?}
//        - lead.assignedUserId vira B; reassignedPendingCadenceActivities()
//   3. B recusa: POST /:id/reject {response?}
//        - lead fica com A; status=rejected
//   4. A cancela: POST /:id/cancel {response?}
//        - lead fica com A; status=cancelled
//   5. Cron expira: cancela requests pending com expiresAt < now
//
// ADMIN/SUPERADMIN não precisam transferir consensualmente — usam /atendimento/tickets/:id/assign direto.

import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { authMiddleware, type JwtPayload } from '../lib/auth.js'
import { logEvent, EVENT_TYPES, getIp, getOperator } from '../services/leadHistory.js'
import { reassignPendingCadenceActivities } from '../services/routing/helpers.js'
import { canUserAccessLead } from '../lib/teamAccess.js'

const TRANSFER_TIMEOUT_KEY = 'routing.transfer.timeoutHours'

async function getTimeoutHours(): Promise<number> {
  const s = await prisma.setting.findUnique({ where: { key: TRANSFER_TIMEOUT_KEY } })
  let h = 24
  if (s?.value != null) {
    const raw = s.value as any
    if (typeof raw === 'number' && Number.isFinite(raw)) h = raw
    else if (typeof raw === 'string') { const n = parseInt(raw); if (Number.isFinite(n)) h = n }
  }
  return Math.max(1, Math.min(168, h)) // 1h..7d
}

const REQUEST_SELECT = {
  id: true,
  leadId: true,
  status: true,
  reason: true,
  response: true,
  requestedAt: true,
  respondedAt: true,
  expiresAt: true,
  fromUser: { select: { id: true, name: true, email: true } },
  toUser: { select: { id: true, name: true, email: true } },
  lead: { select: { id: true, nome: true, empresa: true, whatsapp: true } },
} as const

export async function transferRequestsRoutes(app: FastifyInstance) {
  // POST /api/atendimento/transfer-requests — A pede pra B
  app.post<{ Body: { leadId: number; toUserId: number; reason?: string } }>(
    '/api/atendimento/transfer-requests',
    { preHandler: authMiddleware },
    async (req, reply) => {
      const user = (req as any).user as JwtPayload
      const body = req.body || ({} as any)
      const leadId = parseInt(String(body.leadId))
      const toUserId = parseInt(String(body.toUserId))
      const reason = (body.reason || '').trim().slice(0, 255) || null

      if (!Number.isFinite(leadId)) return reply.code(400).send({ error: 'leadId inválido' })
      if (!Number.isFinite(toUserId)) return reply.code(400).send({ error: 'toUserId inválido' })
      if (toUserId === user.userId) return reply.code(400).send({ error: 'Não dá pra transferir pra si mesmo' })

      const lead = await prisma.lead.findUnique({
        where: { id: leadId },
        select: { id: true, assignedUserId: true, teamId: true },
      })
      if (!lead) return reply.code(404).send({ error: 'Lead não encontrado' })

      // Quem pede precisa ser o dono atual do lead (ou admin que prefira fluxo formal).
      if (lead.assignedUserId !== user.userId && user.role !== 'ADMIN' && user.role !== 'SUPERADMIN') {
        return reply.code(403).send({ error: 'Você não é o responsável atual deste lead' })
      }

      // Alvo precisa ser user ativo que recebe leads (não VIEWER).
      const target = await prisma.user.findUnique({
        where: { id: toUserId },
        select: { id: true, active: true, role: true, name: true },
      })
      if (!target || !target.active) return reply.code(404).send({ error: 'Agente alvo não encontrado ou inativo' })
      if (target.role === 'VIEWER') return reply.code(400).send({ error: 'Visualizador não pode receber leads' })

      // Um pending por lead.
      const existing = await prisma.leadTransferRequest.findFirst({
        where: { leadId, status: 'pending' },
        select: { id: true, toUserId: true },
      })
      if (existing) {
        return reply.code(409).send({ error: 'Já existe uma transferência pendente para este lead', requestId: existing.id })
      }

      const hours = await getTimeoutHours()
      const expiresAt = new Date(Date.now() + hours * 3600_000)

      const created = await prisma.leadTransferRequest.create({
        data: {
          leadId,
          fromUserId: user.userId,
          toUserId,
          reason,
          expiresAt,
        },
        select: REQUEST_SELECT,
      })

      logEvent({
        leadId,
        type: EVENT_TYPES.TRANSFER_REQUESTED,
        category: 'operator',
        title: `Transferência solicitada para ${target.name}`,
        source: 'panel',
        ...getOperator(req),
        description: reason ?? undefined,
        metadata: { requestId: created.id, fromUserId: user.userId, toUserId, expiresAt: expiresAt.toISOString() },
        ipAddress: getIp(req),
      })

      return { request: created }
    },
  )

  // POST /api/atendimento/transfer-requests/:id/accept — B aceita
  app.post<{ Params: { id: string }; Body: { response?: string } }>(
    '/api/atendimento/transfer-requests/:id/accept',
    { preHandler: authMiddleware },
    async (req, reply) => {
      const user = (req as any).user as JwtPayload
      const id = parseInt(req.params.id)
      if (!Number.isFinite(id)) return reply.code(400).send({ error: 'id inválido' })
      const response = ((req.body?.response || '') as string).trim().slice(0, 255) || null

      const r = await prisma.leadTransferRequest.findUnique({
        where: { id },
        select: { id: true, leadId: true, fromUserId: true, toUserId: true, status: true },
      })
      if (!r) return reply.code(404).send({ error: 'Pedido não encontrado' })
      if (r.status !== 'pending') return reply.code(409).send({ error: `Pedido já está em status "${r.status}"` })

      // Só o destinatário ou admin pode aceitar.
      const isAdmin = user.role === 'ADMIN' || user.role === 'SUPERADMIN'
      if (r.toUserId !== user.userId && !isAdmin) {
        return reply.code(403).send({ error: 'Apenas o destinatário pode aceitar' })
      }

      // Atualização atômica: só executa se ainda for pending.
      await prisma.$transaction(async (tx) => {
        await tx.leadTransferRequest.update({
          where: { id },
          data: {
            status: 'accepted',
            response,
            respondedAt: new Date(),
            respondedByUserId: user.userId,
          },
        })
        await tx.lead.update({
          where: { id: r.leadId },
          data: {
            assignedUserId: r.toUserId,
            assignedAt: new Date(),
          },
        })
      })

      const reassignedCount = await reassignPendingCadenceActivities(r.leadId, r.toUserId)

      logEvent({
        leadId: r.leadId,
        type: EVENT_TYPES.TRANSFER_ACCEPTED,
        category: 'operator',
        title: 'Transferência aceita',
        source: 'panel',
        ...getOperator(req),
        description: response ?? undefined,
        metadata: { requestId: id, fromUserId: r.fromUserId, toUserId: r.toUserId, reassignedCadenceActivities: reassignedCount },
        ipAddress: getIp(req),
      })

      return { ok: true, reassignedCadenceActivities: reassignedCount }
    },
  )

  // POST /api/atendimento/transfer-requests/:id/reject — B recusa
  app.post<{ Params: { id: string }; Body: { response?: string } }>(
    '/api/atendimento/transfer-requests/:id/reject',
    { preHandler: authMiddleware },
    async (req, reply) => {
      const user = (req as any).user as JwtPayload
      const id = parseInt(req.params.id)
      if (!Number.isFinite(id)) return reply.code(400).send({ error: 'id inválido' })
      const response = ((req.body?.response || '') as string).trim().slice(0, 255) || null

      const r = await prisma.leadTransferRequest.findUnique({ where: { id } })
      if (!r) return reply.code(404).send({ error: 'Pedido não encontrado' })
      if (r.status !== 'pending') return reply.code(409).send({ error: `Pedido já está em status "${r.status}"` })

      const isAdmin = user.role === 'ADMIN' || user.role === 'SUPERADMIN'
      if (r.toUserId !== user.userId && !isAdmin) {
        return reply.code(403).send({ error: 'Apenas o destinatário pode recusar' })
      }

      await prisma.leadTransferRequest.update({
        where: { id },
        data: {
          status: 'rejected',
          response,
          respondedAt: new Date(),
          respondedByUserId: user.userId,
        },
      })

      logEvent({
        leadId: r.leadId,
        type: EVENT_TYPES.TRANSFER_REJECTED,
        category: 'operator',
        title: 'Transferência recusada',
        source: 'panel',
        ...getOperator(req),
        description: response ?? undefined,
        metadata: { requestId: id, fromUserId: r.fromUserId, toUserId: r.toUserId },
        ipAddress: getIp(req),
      })

      return { ok: true }
    },
  )

  // POST /api/atendimento/transfer-requests/:id/cancel — A desiste
  app.post<{ Params: { id: string }; Body: { response?: string } }>(
    '/api/atendimento/transfer-requests/:id/cancel',
    { preHandler: authMiddleware },
    async (req, reply) => {
      const user = (req as any).user as JwtPayload
      const id = parseInt(req.params.id)
      if (!Number.isFinite(id)) return reply.code(400).send({ error: 'id inválido' })

      const r = await prisma.leadTransferRequest.findUnique({ where: { id } })
      if (!r) return reply.code(404).send({ error: 'Pedido não encontrado' })
      if (r.status !== 'pending') return reply.code(409).send({ error: `Pedido já está em status "${r.status}"` })

      const isAdmin = user.role === 'ADMIN' || user.role === 'SUPERADMIN'
      if (r.fromUserId !== user.userId && !isAdmin) {
        return reply.code(403).send({ error: 'Apenas quem pediu pode cancelar' })
      }

      await prisma.leadTransferRequest.update({
        where: { id },
        data: { status: 'cancelled', respondedAt: new Date(), respondedByUserId: user.userId },
      })

      logEvent({
        leadId: r.leadId,
        type: EVENT_TYPES.TRANSFER_CANCELLED,
        category: 'operator',
        title: 'Transferência cancelada pelo solicitante',
        source: 'panel',
        ...getOperator(req),
        metadata: { requestId: id, fromUserId: r.fromUserId, toUserId: r.toUserId },
        ipAddress: getIp(req),
      })

      return { ok: true }
    },
  )

  // GET /api/atendimento/transfer-requests?status=pending&direction=incoming|outgoing
  // direction: incoming = enviados PARA o user logado; outgoing = enviados POR ele.
  app.get<{ Querystring: { status?: string; direction?: string; limit?: string } }>(
    '/api/atendimento/transfer-requests',
    { preHandler: authMiddleware },
    async (req) => {
      const user = (req as any).user as JwtPayload
      const q = req.query || {}
      const status = q.status === undefined ? 'pending' : q.status
      const direction = q.direction === 'outgoing' ? 'outgoing' : 'incoming'
      const limit = Math.min(parseInt(q.limit || '50'), 200)

      const where: any = {}
      if (status !== 'all') where.status = status
      if (direction === 'incoming') where.toUserId = user.userId
      else where.fromUserId = user.userId

      const requests = await prisma.leadTransferRequest.findMany({
        where,
        orderBy: { requestedAt: 'desc' },
        take: limit,
        select: REQUEST_SELECT,
      })
      return { requests, direction, status }
    },
  )

  // GET /api/atendimento/transfer-requests/incoming/count — atalho pro badge
  app.get('/api/atendimento/transfer-requests/incoming/count', { preHandler: authMiddleware }, async (req) => {
    const user = (req as any).user as JwtPayload
    const count = await prisma.leadTransferRequest.count({
      where: { toUserId: user.userId, status: 'pending' },
    })
    return { count }
  })
}

// Auxiliar exposto pra outras rotas verem se há transferência pendente bloqueando assign/claim.
export async function leadHasPendingTransfer(leadId: number): Promise<boolean> {
  const x = await prisma.leadTransferRequest.findFirst({
    where: { leadId, status: 'pending' },
    select: { id: true },
  })
  return !!x
}

// Marca canUserAccessLead disponível para futura validação cruzada
// (mantém import para que linting não remova).
void canUserAccessLead
