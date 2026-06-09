// src/services/cloudApiCalling.ts
//
// WhatsApp Business Calling API (Cloud API) — camada de signaling.
// Espelha o padrão de services/cloudApi.ts (cloudApiFetch + Bearer token).
//
// Endpoints Meta (Graph v22):
//   POST /<PHONE_NUMBER_ID>/settings  → habilita/configura chamadas
//   POST /<PHONE_NUMBER_ID>/calls     → connect/pre_accept/accept/reject/terminate
//   GET  /<PHONE_NUMBER_ID>/settings  → lê config atual
//
// Fluxo SDP (WebRTC):
//   Entrante: Meta manda webhook 'connect' com SDP offer → respondemos com accept + SDP answer.
//   Saída:    enviamos connect com SDP offer → Meta devolve answer (síncrono/webhook).
//
// OBS: os payloads seguem a documentação da Cloud API Calling. Como a feature ainda
// não foi habilitada na WABA, validar os nomes de campo no primeiro teste ao vivo.

import { cloudApiFetch } from './cloudApi.js'
import { prisma } from '../lib/prisma.js'

export type CallAction = 'connect' | 'pre_accept' | 'accept' | 'reject' | 'terminate'
export type SdpType = 'offer' | 'answer'

export interface CallSession {
  sdp_type: SdpType
  sdp: string
}

export interface CallApiResult {
  callId: string | null
  raw: any
}

// ─── Settings ───────────────────────────────────────────

export interface CallSettings {
  /** 'ENABLED' | 'DISABLED' */
  status?: 'ENABLED' | 'DISABLED'
  /** Visibilidade do ícone de ligar no chat: 'DEFAULT' | 'DISABLE_ALL' */
  call_icon_visibility?: 'DEFAULT' | 'DISABLE_ALL'
  /** Permite que a empresa solicite permissão para ligar (business-initiated) */
  callback_permission_status?: 'ENABLED' | 'DISABLED'
  /** Horário de atendimento (opcional) */
  call_hours?: Record<string, unknown>
  /** Config SIP (opcional — não usamos no modo WebRTC) */
  sip?: Record<string, unknown>
}

export async function getCallSettings(phoneNumberId: string, token: string): Promise<any> {
  // O recurso settings agrupa várias seções; pedimos a de calling.
  return cloudApiFetch(`/${phoneNumberId}/settings`, token, 'GET')
}

export async function setCallSettings(
  phoneNumberId: string,
  token: string,
  settings: CallSettings
): Promise<any> {
  return cloudApiFetch(`/${phoneNumberId}/settings`, token, 'POST', {
    calling: settings,
  })
}

/** Habilita chamadas WebRTC com defaults sensatos (ícone visível, opt-in de callback). */
export async function enableCalling(phoneNumberId: string, token: string): Promise<any> {
  return setCallSettings(phoneNumberId, token, {
    status: 'ENABLED',
    call_icon_visibility: 'DEFAULT',
    callback_permission_status: 'ENABLED',
  })
}

// ─── Call actions (/calls) ──────────────────────────────

async function callAction(
  phoneNumberId: string,
  token: string,
  body: Record<string, unknown>
): Promise<CallApiResult> {
  const raw = await cloudApiFetch(`/${phoneNumberId}/calls`, token, 'POST', {
    messaging_product: 'whatsapp',
    ...body,
  })
  // a resposta de connect traz o call id; nas demais, ecoa o call_id enviado
  const callId = raw?.calls?.[0]?.id || (body.call_id as string) || null
  return { callId, raw }
}

/**
 * Saída (business-initiated): inicia uma chamada para `to` com nosso SDP offer.
 * Retorna o callId atribuído pela Meta. Requer permissão prévia do usuário.
 */
export async function connectCall(
  phoneNumberId: string,
  token: string,
  to: string,
  sdpOffer: string
): Promise<CallApiResult> {
  return callAction(phoneNumberId, token, {
    to,
    action: 'connect',
    session: { sdp_type: 'offer', sdp: sdpOffer } satisfies CallSession,
  })
}

/**
 * Entrante: pré-aceita a chamada (early media / "tocando") antes do accept final.
 * O SDP answer é opcional aqui dependendo do fluxo.
 */
export async function preAcceptCall(
  phoneNumberId: string,
  token: string,
  callId: string,
  sdpAnswer?: string
): Promise<CallApiResult> {
  const body: Record<string, unknown> = { call_id: callId, action: 'pre_accept' }
  if (sdpAnswer) body.session = { sdp_type: 'answer', sdp: sdpAnswer } satisfies CallSession
  return callAction(phoneNumberId, token, body)
}

/**
 * Entrante: aceita a chamada respondendo o SDP offer da Meta com nosso SDP answer.
 */
export async function acceptCall(
  phoneNumberId: string,
  token: string,
  callId: string,
  sdpAnswer: string
): Promise<CallApiResult> {
  return callAction(phoneNumberId, token, {
    call_id: callId,
    action: 'accept',
    session: { sdp_type: 'answer', sdp: sdpAnswer } satisfies CallSession,
  })
}

/** Entrante: recusa a chamada sem atender. */
export async function rejectCall(
  phoneNumberId: string,
  token: string,
  callId: string
): Promise<CallApiResult> {
  return callAction(phoneNumberId, token, { call_id: callId, action: 'reject' })
}

/** Encerra uma chamada ativa (qualquer sentido). */
export async function terminateCall(
  phoneNumberId: string,
  token: string,
  callId: string
): Promise<CallApiResult> {
  return callAction(phoneNumberId, token, { call_id: callId, action: 'terminate' })
}

// ─── Permissões (opt-in business-initiated) ─────────────

/**
 * Consulta o estado da permissão de chamada de um consumidor (wa_id).
 * Estados típicos: 'no_permission' | 'temporary' | 'permanent'.
 */
export async function getCallPermissions(
  phoneNumberId: string,
  token: string,
  consumerWaId: string
): Promise<any> {
  return cloudApiFetch(
    `/${phoneNumberId}/call_permissions?user_wa_id=${encodeURIComponent(consumerWaId)}`,
    token,
    'GET'
  )
}

/**
 * Envia um pedido de permissão de chamada (call permission request) ao consumidor.
 * Necessário antes de uma chamada business-initiated quando ainda não há permissão.
 * OBS: forma do payload (interactive call_permission_request) a confirmar no 1º teste.
 */
export async function sendCallPermissionRequest(
  phoneNumberId: string,
  token: string,
  to: string,
  bodyText = 'Podemos te ligar pelo WhatsApp para falar sobre seu atendimento?'
): Promise<any> {
  return cloudApiFetch(`/${phoneNumberId}/messages`, token, 'POST', {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'interactive',
    interactive: {
      type: 'call_permission_request',
      body: { text: bodyText },
      action: { name: 'call_permission_request' },
    },
  })
}

// ─── Persistência de permissão (opt-in) ─────────────────

/** Grava/atualiza o estado de permissão de chamada de um consumidor. */
export async function upsertCallPermission(
  phone: string,
  phoneNumberId: string,
  status: string,
  expiresAt?: Date | null
): Promise<void> {
  await prisma.waCallPermission.upsert({
    where: { phone_phoneNumberId: { phone, phoneNumberId } },
    create: { phone, phoneNumberId, status, expiresAt: expiresAt ?? null },
    update: { status, expiresAt: expiresAt ?? null },
  })
}

/** True se o consumidor concedeu permissão válida (temporary/permanent não expirada). */
export async function hasCallPermission(phone: string, phoneNumberId: string): Promise<boolean> {
  const perm = await prisma.waCallPermission.findUnique({
    where: { phone_phoneNumberId: { phone, phoneNumberId } },
  })
  if (!perm) return false
  const granted = perm.status === 'temporary' || perm.status === 'permanent'
  if (!granted) return false
  if (perm.expiresAt && perm.expiresAt.getTime() < Date.now()) return false
  return true
}

// ─── Readiness ──────────────────────────────────────────

/**
 * A Calling API exige tier de mensagens ≥ 2.000 conversas/24h.
 * `messagingLimit` vem da CloudApiConnection ('1K' | '10K' | '100K' | 'UNLIMITED' | 'TIER_*').
 */
export function isCallingTierOk(messagingLimit?: string | null): boolean {
  if (!messagingLimit) return false
  const m = messagingLimit.toUpperCase()
  if (m.includes('UNLIMITED')) return true
  // extrai o número (ex.: '1K' → 1000, '10K' → 10000, 'TIER_2K' → 2000)
  const match = m.match(/(\d+)\s*K/)
  if (match) return Number(match[1]) * 1000 >= 2000
  const plain = m.match(/(\d{3,})/)
  return plain ? Number(plain[1]) >= 2000 : false
}
