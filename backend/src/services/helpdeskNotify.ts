// src/services/helpdeskNotify.ts
// Notificações do Helpdesk (F21). Avisa o agente responsável por e-mail e
// WhatsApp em eventos-chave — reusa `notify` (SMTP/Resend) e o provider
// Evolution (mesmo caminho de `schedulingNotify`/`notify_operator`).

import { prisma } from '../lib/prisma.js'

export type HelpdeskNotifyEvent = 'assigned' | 'sla_at_risk' | 'sla_breached' | 'customer_reply'

/** Evento → prefixo do modelo (helpdesk_<x>_wa / helpdesk_<x>_email). */
const MODELO: Record<HelpdeskNotifyEvent, string> = {
  assigned: 'helpdesk_atribuido',
  sla_at_risk: 'helpdesk_sla_risco',
  sla_breached: 'helpdesk_sla_estourou',
  customer_reply: 'helpdesk_resposta_cliente',
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
    await sendEmailGeneric({ from: getFromAddress(cfg), to, subject, html })
  } catch (e) {
    console.warn('[helpdesk-notify] e-mail falhou:', (e as Error).message)
  }
}

async function waToOperator(phone: string | null, text: string): Promise<void> {
  if (!phone) return
  try {
    // Aviso interno ao operador → Evolution (texto livre a número interno).
    const wp = await import('./whatsappProvider.js')
    const provider = wp.createEvolutionProvider()
    const r = await provider.sendText(phone, text)
    const { registrarSaidaParaGrupo } = await import('./groupOutboundLog.js')
    await registrarSaidaParaGrupo({
      destino: phone, texto: text, externalId: r?.messageId ?? null,
      instanceName: (provider as any).instanceName ?? null,
    })
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
    const { renderizarModelo } = await import('./modelosDoSistema.js')
    const { urlNoPainel } = await import('../lib/appUrl.js')
    const esc = (x: string) => x.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
    const vars = { numero: t.number, assunto: t.subject, agente: agent.name || '', link: urlNoPainel('/app/helpdesk') || '' }
    const wa = await renderizarModelo(`${MODELO[event]}_wa`, vars)
    const em = await renderizarModelo(`${MODELO[event]}_email`, { ...vars, assunto: esc(t.subject), agente: esc(agent.name || '') })
    await Promise.all([
      em?.body.trim() ? emailTo(agent.email, em.subject, em.body) : Promise.resolve(),
      wa?.body.trim() ? waToOperator(agent.notifyWhatsapp, wa.body) : Promise.resolve(),
    ])
  } catch (e) {
    console.error('[helpdesk-notify] notifyTicketAgent falhou:', (e as Error).message)
  }
}
