// src/services/helpdeskChannel.ts
// Ponte Helpdesk ↔ Conversas (F15). Reusa o módulo de Conversas/WhatsApp do
// bychat (whatsappProvider, Message, leadConversation) — NÃO recria messaging.
// Permite responder por WhatsApp a partir do ticket e espelhar a conversa real.

import { prisma } from '../lib/prisma.js'

// Canais que possuem uma conversa real (Lead) por trás do ticket.
export const CONVERSATION_CHANNELS = ['whatsapp', 'chat']

export function isConversationBacked(ticket: { requesterLeadId: number | null; channel: string }): boolean {
  return !!ticket.requesterLeadId && CONVERSATION_CHANNELS.includes(ticket.channel)
}

/**
 * Envia a resposta do agente pelo MESMO canal/número da conversa do lead,
 * reusando `getProviderForSender` (Evolution/Cloud API) e persistindo a Message.
 * Garante a conversa aberta no módulo Conversas (idempotente).
 */
export async function sendTicketChannelReply(
  ticket: { id: number; requesterLeadId: number | null; channel: string },
  body: string,
  op: { userId?: number | undefined; userName?: string | undefined; role?: string | undefined },
): Promise<{ ok: boolean; error?: string }> {
  if (!ticket.requesterLeadId) return { ok: false, error: 'Chamado sem conversa vinculada' }
  const lead = await prisma.lead.findUnique({ where: { id: ticket.requesterLeadId }, select: { id: true, whatsapp: true } })
  if (!lead?.whatsapp) return { ok: false, error: 'Lead vinculado sem WhatsApp' }
  try {
    const wp = await import('./whatsappProvider.js')
    const { provider, instanceName, cloudApiConnectionId } = await wp.getProviderForSender(
      { id: lead.id, whatsapp: lead.whatsapp },
      { userId: op.userId ?? 0, role: op.role || 'AGENT' },
    )
    const result = await provider.sendText(lead.whatsapp, body)
    await prisma.message.create({
      data: {
        leadId: lead.id, fromMe: true, body, mediaType: 'text',
        provider: provider.providerName, evolutionInstance: instanceName ?? null,
        cloudApiConnectionId: cloudApiConnectionId ?? null,
        externalId: result?.messageId ?? null, ack: 1,
        senderName: op.userName ?? null, timestamp: new Date(),
      },
    })
    const { ensureConversationOpen } = await import('./leadConversation.js')
    ensureConversationOpen(lead.id, { byUserId: op.userId, byUserName: op.userName, reason: 'outbound' }).catch(() => {})
    return { ok: true }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

/**
 * Envia a resposta do agente por E-MAIL (SMTP/Resend) ao solicitante, com
 * `[#protocolo]` no assunto para o threading do inbound (F3). Reusa `notify`.
 */
export async function sendTicketEmailReply(
  ticket: { number: number; subject: string; requesterEmail: string | null },
  body: string,
  _op: { userId?: number | undefined; userName?: string | undefined },
): Promise<{ ok: boolean; error?: string }> {
  if (!ticket.requesterEmail) return { ok: false, error: 'Solicitante sem e-mail' }
  try {
    const { getEmailConfig, getFromAddress, sendEmailGeneric } = await import('./notify.js')
    const cfg = await getEmailConfig()
    const html = `<div style="font-family:system-ui,sans-serif;font-size:14px;color:#111">${body.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\n/g, '<br>')}</div>`
    await sendEmailGeneric({ from: getFromAddress(cfg, 'suporte'), to: ticket.requesterEmail, subject: `Re: ${ticket.subject} [#${ticket.number}]`, html })
    return { ok: true }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

/** Chamadas (VoIP) do lead vinculado, para mostrar no ticket. */
export async function getTicketCalls(requesterLeadId: number | null, limit = 20) {
  if (!requesterLeadId) return []
  try {
    return await prisma.voipCall.findMany({
      where: { leadId: requesterLeadId },
      orderBy: { startedAt: 'desc' },
      take: limit,
      select: { id: true, direction: true, phone: true, status: true, durationSec: true, recordingUrl: true, userName: true, startedAt: true },
    })
  } catch {
    return [] // tenant sem módulo VoIP
  }
}

/** Inicia click-to-call para o solicitante, reusando o serviço VoIP do bychat. */
export async function startTicketCall(
  ticket: { requesterLeadId: number | null; requesterPhone: string | null },
  op: { userId?: number | undefined },
): Promise<{ ok: boolean; error?: string; call?: any }> {
  let phone = ticket.requesterPhone || ''
  if (!phone && ticket.requesterLeadId) {
    const lead = await prisma.lead.findUnique({ where: { id: ticket.requesterLeadId }, select: { whatsapp: true } })
    phone = lead?.whatsapp || ''
  }
  if (!phone) return { ok: false, error: 'Solicitante sem telefone' }
  if (!op.userId) return { ok: false, error: 'Operador não identificado' }
  const operator = await prisma.user.findUnique({ where: { id: op.userId }, select: { voipExtension: true, name: true } })
  if (!operator?.voipExtension) return { ok: false, error: 'Seu usuário não tem ramal VoIP configurado' }
  try {
    const { createClickToCall } = await import('./voipCallService.js')
    return await createClickToCall({ leadId: ticket.requesterLeadId, phone, userId: op.userId, userName: operator.name, extension: operator.voipExtension, callerId: null } as any)
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

/** Mensagens reais da conversa (Message) do lead, para espelhar na thread do ticket. */
export async function getTicketConversation(requesterLeadId: number | null, limit = 50) {
  if (!requesterLeadId) return []
  const msgs = await prisma.message.findMany({
    where: { leadId: requesterLeadId, isInternal: false, isDeleted: false },
    orderBy: { timestamp: 'desc' },
    take: limit,
    select: { id: true, fromMe: true, body: true, mediaType: true, mediaUrl: true, senderName: true, ack: true, timestamp: true },
  })
  return msgs.reverse()
}
