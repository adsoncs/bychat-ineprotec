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
import { upsertCallPermission } from './cloudApiCalling.js'
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

// ─── Persistência no histórico de chamadas (VoipCall, provider='whatsapp') ──

async function upsertWaCall(input: {
  callId: string
  phone: string
  leadId: number | null
  direction: 'inbound' | 'outbound'
  status: string
  answeredAt?: Date
}): Promise<void> {
  const existing = await prisma.voipCall.findFirst({
    where: { provider: 'whatsapp', providerCallId: input.callId },
    select: { id: true },
  })
  if (existing) {
    await prisma.voipCall.update({
      where: { id: existing.id },
      data: {
        status: input.status,
        ...(input.answeredAt ? { answeredAt: input.answeredAt } : {}),
        ...(input.leadId ? { leadId: input.leadId } : {}),
      },
    })
    return
  }
  await prisma.voipCall.create({
    data: {
      provider: 'whatsapp',
      providerCallId: input.callId,
      phone: input.phone || 'desconhecido',
      direction: input.direction,
      status: input.status,
      leadId: input.leadId,
      source: 'whatsapp_calling',
      ...(input.answeredAt ? { answeredAt: input.answeredAt } : {}),
    },
  })
}

async function finishWaCall(callId: string, status: string, durationSec: number | null): Promise<void> {
  const existing = await prisma.voipCall.findFirst({
    where: { provider: 'whatsapp', providerCallId: callId },
    select: { id: true },
  })
  if (!existing) return
  await prisma.voipCall.update({
    where: { id: existing.id },
    data: {
      status,
      ...(durationSec != null ? { durationSec } : {}),
    },
  })
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

  // Status da chamada (RINGING/ACCEPTED/...) chegam em value.statuses com type='call'.
  const statuses = (value.statuses || []).filter((s: any) => s?.type === 'call')
  for (const st of statuses) {
    try {
      await handleCallStatus(st, conn, app)
    } catch (e: any) {
      app.log.error(`[CloudAPI][calls] call status error: ${e.message}`)
    }
  }
}

/** Status intermediário de uma chamada (ringing/accepted). Atualiza VoipCall + avisa a UI. */
async function handleCallStatus(
  st: any,
  conn: { id: number; phoneNumberId: string; ownerUserId: number | null },
  app: FastifyInstance
): Promise<void> {
  const callId: string = st.id || ''
  const raw: string = String(st.status || '').toUpperCase()
  if (!callId || !raw) return

  const mapped = raw === 'RINGING' ? 'ringing'
    : raw === 'ACCEPTED' ? 'answered'
    : raw === 'REJECTED' ? 'no_answer'
    : raw.toLowerCase()

  // Atualiza o status no histórico (sem sobrescrever um 'completed' já gravado).
  if (mapped === 'ringing' || mapped === 'answered') {
    await prisma.voipCall.updateMany({
      where: { provider: 'whatsapp', providerCallId: callId, status: { notIn: ['completed', 'failed'] } },
      data: { status: mapped, ...(mapped === 'answered' ? { answeredAt: new Date() } : {}) },
    }).catch(() => {})
  }

  await broadcastRealtimeEvent({
    type: 'wa_call:status',
    payload: { callId, status: mapped, phoneNumberId: conn.phoneNumberId, cloudApiConnectionId: conn.id },
  })
  app.log.info(`[CloudAPI][calls] status ${raw} call=${callId}`)
}

async function handleSingleCall(
  call: any,
  conn: { id: number; phoneNumberId: string; ownerUserId: number | null },
  app: FastifyInstance
): Promise<void> {
  const callId: string = call.id || ''
  const event: string = call.event || call.status || ''
  const direction: string = (call.direction || '').toUpperCase()
  const session = call.session || {}

  if (!callId) {
    app.log.warn('[CloudAPI][calls] evento sem call id, ignorado')
    return
  }

  // O CLIENTE é `to` quando a empresa liga (BUSINESS_INITIATED) e `from` quando o
  // cliente liga (USER_INITIATED). `from` na saída é o número da empresa.
  const fromPhone = direction === 'BUSINESS_INITIATED'
    ? normalizePhone(call.to || '')
    : normalizePhone(call.from || '')

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
    const finalStatus = (call.status === 'COMPLETED' || call.duration) ? 'completed' : 'no_answer'
    await finishWaCall(callId, finalStatus, call.duration ?? null).catch(() => {})
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
      // Ainda é "discando" (o atendimento real vem no status ACCEPTED).
      await upsertWaCall({ callId, phone: fromPhone, leadId: lead?.id ?? null, direction: 'outbound', status: 'dialing' }).catch(() => {})
      await broadcastRealtimeEvent({
        type: 'wa_call:answer',
        payload: { ...base, sdpAnswer: sdp },
        scope,
      })
      app.log.info(`[CloudAPI][calls] outbound answer call=${callId} lead=${lead?.id ?? '-'}`)
    } else {
      // Chamada entrante (user-initiated): toca no painel com o SDP offer da Meta.
      await upsertWaCall({ callId, phone: fromPhone, leadId: lead?.id ?? null, direction: 'inbound', status: 'ringing' }).catch(() => {})
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

  // Persiste o opt-in (consultado antes de uma chamada de saída).
  const expiresAt = perm.expiration_timestamp
    ? new Date(Number(perm.expiration_timestamp) * 1000)
    : null
  await upsertCallPermission(fromPhone, conn.phoneNumberId, status || 'no_permission', expiresAt).catch(() => {})

  await broadcastRealtimeEvent({
    type: 'wa_call:permission',
    payload: { from: fromPhone, leadId: lead?.id ?? null, status, phoneNumberId: conn.phoneNumberId },
    scope: lead?.assignedUserId ? { userId: lead.assignedUserId } : undefined,
  })
  app.log.info(`[CloudAPI][calls] permission ${status} from=${fromPhone} lead=${lead?.id ?? '-'}`)
}
