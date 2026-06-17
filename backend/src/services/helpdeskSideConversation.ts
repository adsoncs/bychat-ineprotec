// src/services/helpdeskSideConversation.ts
// F27 — Conversas paralelas ("side conversations"): thread separada com um
// TERCEIRO (fornecedor, especialista, outra área) vinculada a um ticket, sem
// expor ao solicitante. Saída por e-mail ou WhatsApp reusando os providers.

import { prisma } from '../lib/prisma.js'
import { logTicketEvent } from './helpdesk.js'

export type SideChannel = 'email' | 'whatsapp'

interface Operator { userId?: number | null; userName?: string | null }

/** Envia o texto pelo canal escolhido. Retorna { ok, error? } (best-effort). */
async function deliver(channel: SideChannel, target: { email?: string | null; phone?: string | null }, subject: string, body: string): Promise<{ ok: boolean; error?: string }> {
  try {
    if (channel === 'email') {
      if (!target.email) return { ok: false, error: 'E-mail do destinatário ausente' }
      const { getEmailConfig, getFromAddress, sendEmailGeneric } = await import('./notify.js')
      const cfg = await getEmailConfig()
      const html = `<div style="font-family:system-ui,sans-serif;font-size:14px;color:#111">${body.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\n/g, '<br>')}</div>`
      await sendEmailGeneric({ from: getFromAddress(cfg, 'suporte'), to: target.email, subject, html })
      return { ok: true }
    }
    // whatsapp
    if (!target.phone) return { ok: false, error: 'WhatsApp do destinatário ausente' }
    const wp = await import('./whatsappProvider.js')
    await wp.createEvolutionProvider().sendText(target.phone, body)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

export async function listSideConversations(ticketId: number) {
  const convs = await prisma.helpdeskSideConversation.findMany({
    where: { ticketId },
    orderBy: { lastActivityAt: 'desc' },
    include: { messages: { orderBy: { createdAt: 'asc' } } },
  })
  return convs
}

/** Cria a conversa paralela e dispara a 1ª mensagem (outbound). */
export async function createSideConversation(
  ticketId: number,
  input: { channel: SideChannel; targetName?: string; targetEmail?: string; targetPhone?: string; subject?: string; body: string },
  op: Operator,
) {
  const ticket = await prisma.helpdeskTicket.findUnique({ where: { id: ticketId }, select: { id: true, number: true, subject: true } })
  if (!ticket) throw new Error('Chamado não encontrado')
  const subject = (input.subject || `[#${ticket.number}] ${ticket.subject}`).slice(0, 255)

  const conv = await prisma.helpdeskSideConversation.create({
    data: {
      ticketId,
      channel: input.channel,
      targetName: input.targetName?.slice(0, 150) ?? null,
      targetEmail: input.targetEmail?.trim() ?? null,
      targetPhone: input.targetPhone?.trim() ?? null,
      subject,
      status: 'open',
      createdById: op.userId ?? null,
      createdByName: op.userName ?? null,
    },
  })

  const sent = await deliver(input.channel, { email: conv.targetEmail, phone: conv.targetPhone }, subject, input.body)
  const msg = await prisma.helpdeskSideMessage.create({
    data: { sideConversationId: conv.id, direction: 'outbound', authorName: op.userName ?? null, body: input.body },
  })
  await logTicketEvent({ ticketId, type: 'side_conversation', title: `Conversa paralela aberta (${input.channel}) com ${conv.targetName || conv.targetEmail || conv.targetPhone || 'terceiro'}`, userId: op.userId ?? undefined, userName: op.userName ?? undefined, actorType: 'agent' })
  return { conv, msg, sent }
}

/** Envia nova mensagem (outbound) numa conversa paralela existente. */
export async function sendSideMessage(sideConversationId: number, body: string, op: Operator) {
  const conv = await prisma.helpdeskSideConversation.findUnique({ where: { id: sideConversationId } })
  if (!conv) throw new Error('Conversa paralela não encontrada')
  if (conv.status === 'closed') throw new Error('Conversa paralela encerrada')
  const sent = await deliver(conv.channel as SideChannel, { email: conv.targetEmail, phone: conv.targetPhone }, conv.subject || 'Mensagem', body)
  const msg = await prisma.helpdeskSideMessage.create({ data: { sideConversationId, direction: 'outbound', authorName: op.userName ?? null, body } })
  await prisma.helpdeskSideConversation.update({ where: { id: sideConversationId }, data: { lastActivityAt: new Date() } })
  return { msg, sent }
}

/** Registra uma RESPOSTA recebida do terceiro (inbound) — manual ou via webhook futuro. */
export async function addInboundSideMessage(sideConversationId: number, body: string, authorName?: string) {
  const conv = await prisma.helpdeskSideConversation.findUnique({ where: { id: sideConversationId }, select: { id: true, ticketId: true, targetName: true } })
  if (!conv) throw new Error('Conversa paralela não encontrada')
  const msg = await prisma.helpdeskSideMessage.create({ data: { sideConversationId, direction: 'inbound', authorName: authorName || conv.targetName || 'Terceiro', body } })
  await prisma.helpdeskSideConversation.update({ where: { id: sideConversationId }, data: { lastActivityAt: new Date() } })
  return { msg }
}

export async function closeSideConversation(sideConversationId: number) {
  await prisma.helpdeskSideConversation.update({ where: { id: sideConversationId }, data: { status: 'closed', lastActivityAt: new Date() } })
  return { ok: true }
}
