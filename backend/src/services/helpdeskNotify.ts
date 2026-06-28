// src/services/helpdeskNotify.ts
// Notificações do Helpdesk (F21). Avisa o agente responsável por e-mail e
// WhatsApp em eventos-chave — reusa `notify` (SMTP/Resend) e o provider
// Evolution (mesmo caminho de `schedulingNotify`/`notify_operator`).

import { prisma } from '../lib/prisma.js'

export type HelpdeskNotifyEvent = 'assigned' | 'sla_at_risk' | 'sla_breached' | 'customer_reply'

const MESSAGES: Record<HelpdeskNotifyEvent, (n: number, s: string) => string> = {
  assigned: (n, s) => `🎫 Chamado #${n} atribuído a você: ${s}`,
  sla_at_risk: (n, s) => `⏳ SLA do chamado #${n} perto do prazo: ${s}`,
  sla_breached: (n, s) => `🔴 SLA do chamado #${n} ESTOUROU: ${s}`,
  customer_reply: (n, s) => `💬 Nova resposta do cliente no chamado #${n}: ${s}`,
}

async function notifyEnabled(): Promise<boolean> {
  try {
    const s = await prisma.setting.findUnique({ where: { key: 'helpdesk.notify_agents' } })
    if (!s) return true // default: ligado
    const v = s.value as any
    return v === true || String(v).replace(/"/g, '') === 'true'
  } catch {
    return true
  }
}

async function emailTo(to: string | null, subject: string, html: string): Promise<void> {
  if (!to) return
  try {
    const { getEmailConfig, getFromAddress, sendEmailGeneric } = await import('./notify.js')
    const cfg = await getEmailConfig()
    await sendEmailGeneric({ from: getFromAddress(cfg, 'suporte'), to, subject, html })
  } catch (e) {
    console.warn('[helpdesk-notify] e-mail falhou:', (e as Error).message)
  }
}

async function waToOperator(phone: string | null, text: string): Promise<void> {
  if (!phone) return
  try {
    // Aviso interno ao operador → Evolution (texto livre a número interno).
    const wp = await import('./whatsappProvider.js')
    await wp.createEvolutionProvider().sendText(phone, text)
  } catch (e) {
    console.warn('[helpdesk-notify] WhatsApp falhou:', (e as Error).message)
  }
}

/** Notifica o AGENTE responsável pelo ticket. Best-effort (nunca quebra o fluxo). */
export async function notifyTicketAgent(ticketId: number, event: HelpdeskNotifyEvent): Promise<void> {
  try {
    if (!(await notifyEnabled())) return
    const t = await prisma.helpdeskTicket.findUnique({ where: { id: ticketId }, select: { number: true, subject: true, assignedUserId: true } })
    if (!t || t.assignedUserId == null) return
    const agent = await prisma.user.findUnique({ where: { id: t.assignedUserId }, select: { email: true, name: true, notifyWhatsapp: true } })
    if (!agent) return
    const text = MESSAGES[event](t.number, t.subject)
    const link = `${process.env.APP_URL || ''}/app/helpdesk`
    const html = `<div style="font-family:system-ui,sans-serif"><p>${text}</p><p><a href="${link}">Abrir Helpdesk</a></p></div>`
    await Promise.all([
      emailTo(agent.email, `Helpdesk — chamado #${t.number}`, html),
      waToOperator(agent.notifyWhatsapp, text),
    ])
  } catch (e) {
    console.error('[helpdesk-notify] notifyTicketAgent falhou:', (e as Error).message)
  }
}
