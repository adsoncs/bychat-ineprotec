// src/routes/waCalls.ts
// Rotas do operador para a WhatsApp Business Calling API (WebRTC).
// O navegador (CallWidget) usa estas rotas para:
//   • pegar os ICE servers (TURN efêmero) → GET /api/wa-calls/ice
//   • atender uma chamada entrante  → POST /api/wa-calls/:callId/accept { sdpAnswer, cloudApiConnectionId }
//   • recusar / encerrar            → POST /api/wa-calls/:callId/reject|terminate { cloudApiConnectionId }
//   • iniciar uma chamada de saída  → POST /api/wa-calls/connect { to, sdpOffer, cloudApiConnectionId }
//
// A sinalização inversa (SDP offer entrante / answer da saída) chega ao navegador
// pelo WebSocket /api/ws (eventos wa_call:*), emitidos em services/cloudApiCallsWebhook.ts.

import type { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { authMiddleware, type JwtPayload } from '../lib/auth.js'
import { decryptToken } from '../services/cloudApi.js'
import { saveWaCallRecording } from '../services/waCallRecording.js'
import {
  acceptCall,
  rejectCall,
  terminateCall,
  connectCall,
  sendCallPermissionRequest,
} from '../services/cloudApiCalling.js'
import { getTurnCredentials, isTurnReady } from '../lib/turnCredentials.js'
import { normalizePhone } from '../services/cloudApi.js'

interface ConnResolved {
  phoneNumberId: string
  token: string
}

/**
 * Resolve a conexão Cloud API e o token. Por id ou phoneNumberId; na ausência,
 * cai para a única conexão ativa (tenants com 1 número) — assim o painel só
 * precisa passar o telefone do cliente.
 */
async function resolveConnection(body: any): Promise<ConnResolved | null> {
  const where: any = { active: true }
  if (body?.cloudApiConnectionId) where.id = Number(body.cloudApiConnectionId)
  else if (body?.phoneNumberId) where.phoneNumberId = String(body.phoneNumberId)

  const conn = await prisma.cloudApiConnection.findFirst({ where, orderBy: { id: 'asc' } })
  if (!conn) return null
  return { phoneNumberId: conn.phoneNumberId, token: decryptToken(conn.systemUserToken) }
}

export async function waCallsRoutes(app: FastifyInstance) {
  // ICE servers (STUN + TURN com credencial efêmera) para o RTCPeerConnection.
  app.get('/api/wa-calls/ice', { preHandler: authMiddleware }, async (_req, reply) => {
    const creds = getTurnCredentials()
    if (!creds) {
      return reply.code(503).send({ error: 'TURN não configurado (coturn). Veja docs/WHATSAPP_CALLING.md.' })
    }
    return { iceServers: creds.iceServers, ttl: creds.ttl, expiresAt: creds.expiresAt }
  })

  // Entrante: aceita a chamada respondendo o SDP offer da Meta com nosso answer.
  app.post('/api/wa-calls/:callId/accept', { preHandler: authMiddleware }, async (req, reply) => {
    const { callId } = req.params as { callId: string }
    const body = req.body as { sdpAnswer?: string }
    if (!body?.sdpAnswer) return reply.code(400).send({ error: 'sdpAnswer obrigatório' })

    const conn = await resolveConnection(req.body)
    if (!conn) return reply.code(404).send({ error: 'Conexão Cloud API não encontrada' })

    try {
      const res = await acceptCall(conn.phoneNumberId, conn.token, callId, body.sdpAnswer)
      return { ok: true, callId: res.callId }
    } catch (e: any) {
      app.log.error(`[wa-calls] accept error: ${e.message}`)
      return reply.code(502).send({ error: e.message })
    }
  })

  // Entrante: recusa sem atender.
  app.post('/api/wa-calls/:callId/reject', { preHandler: authMiddleware }, async (req, reply) => {
    const { callId } = req.params as { callId: string }
    const conn = await resolveConnection(req.body)
    if (!conn) return reply.code(404).send({ error: 'Conexão Cloud API não encontrada' })
    try {
      await rejectCall(conn.phoneNumberId, conn.token, callId)
      return { ok: true }
    } catch (e: any) {
      app.log.error(`[wa-calls] reject error: ${e.message}`)
      return reply.code(502).send({ error: e.message })
    }
  })

  // Encerra uma chamada ativa (entrante ou saída).
  app.post('/api/wa-calls/:callId/terminate', { preHandler: authMiddleware }, async (req, reply) => {
    const { callId } = req.params as { callId: string }
    const conn = await resolveConnection(req.body)
    if (!conn) return reply.code(404).send({ error: 'Conexão Cloud API não encontrada' })
    try {
      await terminateCall(conn.phoneNumberId, conn.token, callId)
      return { ok: true }
    } catch (e: any) {
      app.log.error(`[wa-calls] terminate error: ${e.message}`)
      return reply.code(502).send({ error: e.message })
    }
  })

  // Saída: inicia uma chamada para `to` com nosso SDP offer.
  // OBS: o gate por permissão (opt-in) é da Fase 4 — aqui só faz o connect.
  app.post('/api/wa-calls/connect', { preHandler: authMiddleware }, async (req, reply) => {
    const body = req.body as { to?: string; sdpOffer?: string }
    if (!body?.to || !body?.sdpOffer) {
      return reply.code(400).send({ error: 'to e sdpOffer obrigatórios' })
    }
    if (!isTurnReady()) {
      return reply.code(503).send({ error: 'TURN não configurado (coturn).' })
    }
    const conn = await resolveConnection(req.body)
    if (!conn) return reply.code(404).send({ error: 'Conexão Cloud API não encontrada' })

    const to = normalizePhone(body.to)

    // Sem gate local: a Meta é a fonte da verdade da permissão. Tenta conectar;
    // se faltar opt-in do consumidor, a Meta rejeita e mapeamos para no_permission.
    try {
      const res = await connectCall(conn.phoneNumberId, conn.token, to, body.sdpOffer)
      return { ok: true, callId: res.callId }
    } catch (e: any) {
      const msg = e?.message || ''
      app.log.error(`[wa-calls] connect error: ${msg}`)
      if (/permission/i.test(msg) || /not.*allow.*call|call.*not.*allow/i.test(msg)) {
        return reply.code(403).send({
          error: 'no_permission',
          message: 'O cliente ainda não autorizou chamadas. Envie um pedido de permissão e aguarde ele aceitar.',
        })
      }
      return reply.code(502).send({ error: msg })
    }
  })

  // Envia um pedido de permissão de chamada ao consumidor (opt-in).
  app.post('/api/wa-calls/request-permission', { preHandler: authMiddleware }, async (req, reply) => {
    const body = req.body as { to?: string; bodyText?: string }
    if (!body?.to) return reply.code(400).send({ error: 'to obrigatório' })

    const conn = await resolveConnection(req.body)
    if (!conn) return reply.code(404).send({ error: 'Conexão Cloud API não encontrada' })

    try {
      await sendCallPermissionRequest(conn.phoneNumberId, conn.token, normalizePhone(body.to), body.bodyText)
      return { ok: true }
    } catch (e: any) {
      const msg = e?.message || ''
      app.log.error(`[wa-calls] request-permission error: ${msg}`)
      // #138009: limite de pedidos para este par empresa-consumidor.
      if (/138009/.test(msg) || /limit.*call permission/i.test(msg)) {
        return reply.code(429).send({
          error: 'permission_limit',
          message: 'O cliente já recebeu o pedido de permissão (limite de reenvios atingido). Peça para ele tocar em "Permitir" na conversa do WhatsApp e tente ligar de novo — não é preciso reenviar.',
        })
      }
      return reply.code(502).send({ error: msg })
    }
  })

  // Upload da gravação da chamada (áudio gravado no navegador via MediaRecorder).
  // multipart: campo de arquivo único. Salva + vincula Activity + histórico do lead.
  app.post('/api/wa-calls/:callId/recording', { preHandler: authMiddleware }, async (req, reply) => {
    const { callId } = req.params as { callId: string }
    const data = await req.file()
    if (!data) return reply.code(400).send({ error: 'arquivo de áudio obrigatório' })

    const buffer = await data.toBuffer()
    const user = (req as any).user as JwtPayload
    const result = await saveWaCallRecording(callId, buffer, data.mimetype || 'audio/webm', {
      userId: user.userId,
      name: user.name,
      email: user.email,
    })
    if (!result.ok) return reply.code(422).send({ error: result.reason })
    return { ok: true, url: result.url }
  })
}
