// src/services/cloudApiCallsWebhook.ts
//
// Trata o campo de webhook `calls` da WhatsApp Business Calling API.
// Faz a sinalização entre a Meta e o navegador do operador (via WebSocket /api/ws):
//
//   • connect (USER_INITIATED)    → chamada entrante: toca no painel do operador (SDP offer)
//   • connect (BUSINESS_INITIATED)→ resposta da nossa chamada de saída (SDP answer)
//   • terminate                   → encerra a chamada (duração/status)
//   • call_permission_update      → opt-in de chamada de saída por consumidor
//
// A persistência em VoipCall e a UI WebRTC ficam nas Fases 3/5. Aqui só roteamos o
// evento ao operador certo. O payload bruto é logado para inspeção no 1º evento real,
// já que a forma exata pode variar até a feature ser habilitada na WABA.

import type { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { normalizePhone } from './cloudApi.js'
import { broadcastRealtimeEvent } from '../routes/realtime.js'

/** Casa o lead pelo telefone, tolerante ao 9º dígito (mesma regra do webhook de mensagens). */
async function findLeadByPhone(phone: string): Promise<{ id: number; assignedUserId: number | null } | null> {
  let lead = await prisma.lead.findFirst({
    where: { whatsapp: phone },
    orderBy: { createdAt: 'desc' },
    select: { id: true, assignedUserId: true },
  })
  if (!lead && phone.length >= 8) {
    lead = await prisma.lead.findFirst({
      where: { whatsapp: { contains: phone.slice(-8) } },
      orderBy: { createdAt: 'desc' },
      select: { id: true, assignedUserId: true },
    })
  }
  return lead
}

export async function handleCallsWebhook(
  value: any,
  conn: { id: number; phoneNumberId: string; ownerUserId: number | null },
  app: FastifyInstance
): Promise<void> {
  // Log bruto (1x por payload) para capturar a forma real do evento.
  app.log.info(`[CloudAPI][calls] payload: ${JSON.stringify(value).slice(0, 2000)}`)

  // Atualização de permissão de chamada (opt-in business-initiated).
  const permUpdates = value.call_permission_updates || value.call_permissions || []
  for (const perm of permUpdates) {
    await handlePermissionUpdate(perm, conn, app).catch((e) =>
      app.log.error(`[CloudAPI][calls] permission update error: ${e.message}`)
    )
  }

  const calls = value.calls || []
  for (const call of calls) {
    try {
      await handleSingleCall(call, conn, app)
    } catch (e: any) {
      app.log.error(`[CloudAPI][calls] call event error: ${e.message}`)
    }
  }
}

async function handleSingleCall(
  call: any,
  conn: { id: number; phoneNumberId: string; ownerUserId: number | null },
  app: FastifyInstance
): Promise<void> {
  const callId: string = call.id || ''
  const event: string = call.event || call.status || ''
  const fromPhone = normalizePhone(call.from || '')
  const direction: string = (call.direction || '').toUpperCase()
  const session = call.session || {}

  if (!callId) {
    app.log.warn('[CloudAPI][calls] evento sem call id, ignorado')
    return
  }

  const lead = fromPhone ? await findLeadByPhone(fromPhone) : null
  // Operador alvo: dono do lead → dono da conexão. Sem nenhum, vai para todos (scope amplo).
  const targetUserId = lead?.assignedUserId ?? conn.ownerUserId ?? undefined
  const scope = targetUserId ? { userId: targetUserId } : undefined

  const base = {
    callId,
    leadId: lead?.id ?? null,
    from: fromPhone,
    phoneNumberId: conn.phoneNumberId,
    cloudApiConnectionId: conn.id,
    direction,
    timestamp: call.timestamp ?? null,
  }

  // ── Encerramento ──
  if (event === 'terminate' || event === 'TERMINATE' || call.status === 'COMPLETED') {
    await broadcastRealtimeEvent({
      type: 'wa_call:ended',
      payload: {
        ...base,
        status: call.status ?? 'terminated',
        duration: call.duration ?? null,
        startTime: call.start_time ?? null,
        endTime: call.end_time ?? null,
      },
      scope,
    })
    app.log.info(`[CloudAPI][calls] terminate call=${callId} lead=${lead?.id ?? '-'}`)
    return
  }

  // ── Conexão ──
  if (event === 'connect' || event === 'CONNECT') {
    const sdp: string = session.sdp || ''
    const sdpType: string = session.sdp_type || (direction === 'BUSINESS_INITIATED' ? 'answer' : 'offer')

    if (direction === 'BUSINESS_INITIATED' || sdpType === 'answer') {
      // Resposta SDP da nossa chamada de saída → entrega ao navegador que originou.
      await broadcastRealtimeEvent({
        type: 'wa_call:answer',
        payload: { ...base, sdpAnswer: sdp },
        scope,
      })
      app.log.info(`[CloudAPI][calls] outbound answer call=${callId} lead=${lead?.id ?? '-'}`)
    } else {
      // Chamada entrante (user-initiated): toca no painel com o SDP offer da Meta.
      await broadcastRealtimeEvent({
        type: 'wa_call:incoming',
        payload: { ...base, sdpOffer: sdp },
        scope,
      })
      app.log.info(`[CloudAPI][calls] incoming call=${callId} lead=${lead?.id ?? '-'} → user=${targetUserId ?? 'todos'}`)
    }
    return
  }

  // Outros eventos/estados: apenas espelha como status.
  await broadcastRealtimeEvent({
    type: 'wa_call:status',
    payload: { ...base, status: event || call.status || 'unknown' },
    scope,
  })
}

async function handlePermissionUpdate(
  perm: any,
  conn: { phoneNumberId: string },
  app: FastifyInstance
): Promise<void> {
  const fromPhone = normalizePhone(perm.user_wa_id || perm.from || perm.wa_id || '')
  const status: string = perm.status || perm.permission_status || ''
  if (!fromPhone) return

  const lead = await findLeadByPhone(fromPhone)
  // A persistência do opt-in (tabela própria) entra na Fase 4; aqui só roteamos o evento.

  await broadcastRealtimeEvent({
    type: 'wa_call:permission',
    payload: { from: fromPhone, leadId: lead?.id ?? null, status, phoneNumberId: conn.phoneNumberId },
    scope: lead?.assignedUserId ? { userId: lead.assignedUserId } : undefined,
  })
  app.log.info(`[CloudAPI][calls] permission ${status} from=${fromPhone} lead=${lead?.id ?? '-'}`)
}
