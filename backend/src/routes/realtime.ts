import type { FastifyInstance } from 'fastify'
import websocket from '@fastify/websocket'
import { verifyToken } from '../lib/auth.js'
import type { JwtPayload } from '../lib/auth.js'
import { prisma } from '../lib/prisma.js'
import { canUserAccessLead } from '../lib/teamAccess.js'

/**
 * WebSocket /api/ws — broadcast em tempo real para o /app.
 *
 * Eventos suportados:
 *   - lead:created / lead:updated / lead:deleted
 *   - lead:stage_changed
 *   - message:received / message:sent
 *   - ticket:opened / ticket:closed / ticket:claimed
 *   - meta:lead_received
 *
 * Auth: o cliente conecta com query string `?token=<JWT>`. Se inválido,
 * a conexão é fechada com 4401.
 *
 * Para emitir um evento de qualquer rota:
 *   import { broadcastRealtimeEvent } from '../routes/realtime.js'
 *   broadcastRealtimeEvent({ type: 'lead:created', payload: { id, ... } })
 */

interface RealtimeEvent {
  type: string
  payload?: unknown
  // Reforma F4 (2026-05-21): scope filtra recipientes pelo backend.
  // - userId: só esse user recebe (ex: notificação personal)
  // - leadId: só usuários que têm acesso ao lead recebem (resolvido server-side
  //   via canUserAccessLead; cache 5s pra alto volume de mensagens)
  // - tenantId: reservado pra multi-tenant futuro
  scope?: { userId?: number; leadId?: number; tenantId?: number }
}

interface ActiveSocket {
  socket: { send: (data: string) => void; close: (code?: number) => void }
  user: JwtPayload
  joinedAt: number
}

const sockets = new Set<ActiveSocket>()

// Cache de "quem tem acesso ao lead X" — TTL 5s, suficiente pra rajada de
// mensagens consecutivas. Evita N queries Prisma quando 1 lead recebe 20
// mensagens em 1min.
const leadAccessCache = new Map<number, { allowedUserIds: Set<number>; expiresAt: number }>()
const LEAD_ACCESS_TTL_MS = 5_000

async function resolveLeadRecipients(leadId: number): Promise<Set<number>> {
  const cached = leadAccessCache.get(leadId)
  if (cached && cached.expiresAt > Date.now()) return cached.allowedUserIds

  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: { assignedUserId: true, teamId: true },
  })
  const allowed = new Set<number>()
  if (!lead) {
    leadAccessCache.set(leadId, { allowedUserIds: allowed, expiresAt: Date.now() + LEAD_ACCESS_TTL_MS })
    return allowed
  }

  // Otimização: percorre só os sockets conectados e checa permissão de cada.
  // Sockets vazios → set vazio (ninguém vai receber, sem query).
  if (sockets.size === 0) return allowed

  // Coleta userIds únicos conectados.
  const connectedUserIds = new Set<number>()
  for (const s of sockets) connectedUserIds.add(s.user.userId)

  // Avalia cada user. canUserAccessLead já lida com role+scope.
  for (const s of sockets) {
    const u = s.user
    if (allowed.has(u.userId)) continue
    try {
      if (await canUserAccessLead(u.userId, u.role, leadId)) allowed.add(u.userId)
    } catch {
      // Em erro, fail-closed (não inclui)
    }
  }

  leadAccessCache.set(leadId, { allowedUserIds: allowed, expiresAt: Date.now() + LEAD_ACCESS_TTL_MS })
  return allowed
}

export function invalidateLeadAccessCache(leadId?: number) {
  if (leadId) leadAccessCache.delete(leadId)
  else leadAccessCache.clear()
}

export async function broadcastRealtimeEvent(event: RealtimeEvent): Promise<void> {
  const data = JSON.stringify(event)
  // Resolve filtro de leadId (assíncrono) ANTES de enviar.
  let leadAllowed: Set<number> | null = null
  if (event.scope?.leadId) {
    leadAllowed = await resolveLeadRecipients(event.scope.leadId)
  }
  for (const s of sockets) {
    if (event.scope?.userId && event.scope.userId !== s.user.userId) continue
    if (leadAllowed && !leadAllowed.has(s.user.userId)) continue
    try {
      s.socket.send(data)
    } catch {
      // socket morto — será limpo no close handler
    }
  }
}

export function realtimeStats(): { connections: number } {
  return { connections: sockets.size }
}

export async function realtimeRoutes(app: FastifyInstance) {
  await app.register(websocket, {
    options: {
      maxPayload: 1024 * 1024, // 1 MB — eventos são pequenos por design
    },
  })

  app.get('/api/ws', { websocket: true }, (socket, req) => {
    const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`)
    const token = url.searchParams.get('token')
    if (!token) {
      socket.close(4401)
      return
    }

    let user: JwtPayload
    try {
      user = verifyToken(token)
    } catch {
      socket.close(4401)
      return
    }

    const entry: ActiveSocket = {
      socket,
      user,
      joinedAt: Date.now(),
    }
    sockets.add(entry)

    try {
      socket.send(
        JSON.stringify({
          type: 'realtime:hello',
          payload: {
            userId: user.userId,
            connections: sockets.size,
            serverTime: new Date().toISOString(),
          },
        }),
      )
    } catch {
      // ignore
    }

    socket.on('message', (raw: Buffer) => {
      try {
        const data = JSON.parse(raw.toString()) as { type?: string }
        if (data.type === 'ping') {
          socket.send(JSON.stringify({ type: 'pong', payload: { ts: Date.now() } }))
        }
      } catch {
        // payload não-JSON, ignorar
      }
    })

    socket.on('close', () => {
      sockets.delete(entry)
    })

    socket.on('error', () => {
      sockets.delete(entry)
    })
  })

  // Endpoint para o painel admin verificar quantos clientes estão conectados.
  app.get('/api/ws/stats', { preHandler: app.hasDecorator('authenticate') ? undefined : undefined }, async () => {
    return { connections: sockets.size }
  })
}
