// Notificações do módulo de Agendamento: confirmação, lembrete e cancelamento
// (WhatsApp + e-mail), links públicos de remarcar/cancelar, e cron de lembretes.
import { prisma } from '../lib/prisma.js'
import { sendEmailGeneric, getEmailConfig, getFromAddress } from './notify.js'
import { getBranding } from '../lib/branding.js'
import { getRenderedTemplate } from './messageTemplates.js'

function publicBase(): string { return (process.env.APP_URL || 'https://localhost').replace(/\/$/, '') }
export function cancelLink(token: string): string { return `${publicBase()}/agendar/cancelar/${token}` }
export function rescheduleLink(token: string): string { return `${publicBase()}/agendar/remarcar/${token}` }

function fmtDateTime(d: Date, tz: string): string {
  try { return new Intl.DateTimeFormat('pt-BR', { timeZone: tz, dateStyle: 'full', timeStyle: 'short' }).format(d) }
  catch { return d.toISOString() }
}
function esc(s: string): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string))
}

async function sendWa(leadId: number | null, phone: string, text: string): Promise<void> {
  if (!phone) return
  try {
    const wp = await import('./whatsappProvider.js')
    // Lead → provider do dono/canal do lead. Sem leadId (aviso interno ao operador)
    // → Evolution (Cloud API não entrega texto livre a número fora da janela 24h).
    const provider = leadId
      ? (await wp.getProviderForLeadOwner({ id: leadId, whatsapp: phone })).provider
      : wp.createEvolutionProvider()
    await provider.sendText(phone, text)
  } catch (e: any) { console.warn('[scheduling] WhatsApp falhou:', e?.message) }
}

async function resolveMeetLink(booking: { meetLink: string | null; activityId: number | null; id: number }): Promise<string | null> {
  if (booking.meetLink) return booking.meetLink
  if (!booking.activityId) return null
  const a = await prisma.activity.findUnique({ where: { id: booking.activityId }, select: { metadata: true } })
  const link = ((a?.metadata as any)?.googleMeetLink) || null
  if (link) await prisma.booking.update({ where: { id: booking.id }, data: { meetLink: link } }).catch(() => {})
  return link
}

// kind: 'confirmation' (na reserva) | 'reminder' (antes da reunião)
export async function notifyBooking(bookingId: number, kind: 'confirmation' | 'reminder'): Promise<void> {
  const booking = await prisma.booking.findUnique({ where: { id: bookingId } })
  if (!booking || booking.status === 'cancelled') return
  const mt = await prisma.meetingType.findUnique({ where: { id: booking.meetingTypeId } })
  if (!mt) return
  const lead = booking.leadId
    ? await prisma.lead.findUnique({ where: { id: booking.leadId }, select: { id: true, whatsapp: true, email: true, nome: true } })
    : null

  const meetLink = await resolveMeetLink(booking)
  const when = fmtDateTime(booking.startAt, booking.timezone)
  const name = booking.inviteeName || lead?.nome || ''
  const head = kind === 'reminder' ? 'Lembrete de reunião' : 'Reunião confirmada'
  const kindKey = kind === 'reminder' ? 'lembrete' : 'confirmado' // chave do template (pt-BR)
  const locLine = meetLink ? `\nLink: ${meetLink}` : (mt.locationDetail ? `\nLocal: ${mt.locationDetail}` : '')

  // ── WhatsApp ao lead — texto editável (MessageTemplate booking_<kind>_wa) ──
  // Variáveis: {{saudacao}} {{nome}} {{reuniao}} {{quando}} {{link}}
  const waVars = { saudacao: name ? `Olá, ${name}!` : 'Olá!', nome: name, reuniao: mt.name, quando: when, link: locLine }
  const waDefault = kind === 'reminder'
    ? `{{saudacao}}\n\n⏰ *Lembrete: {{reuniao}}*\n📅 {{quando}}{{link}}`
    : `{{saudacao}}\n\n✅ *Reunião confirmada: {{reuniao}}*\n📅 {{quando}}{{link}}`
  const wa = await getRenderedTemplate(`agendamento_${kindKey}_wa`, 'whatsapp', waVars, { body: waDefault })

  const phone = lead?.whatsapp || booking.inviteePhone || ''
  if (phone && wa.body.trim()) await sendWa(lead?.id ?? null, phone, wa.body)

  const toEmail = lead?.email || booking.inviteeEmail
  if (toEmail) {
    try {
      const cfg = await getEmailConfig()
      const brand = await getBranding()
      // E-mail ao lead — editável (modelo agendamento_<kind>_email).
      // Variáveis (já escapadas): {{nome}} {{saudacao}} {{titulo}} {{reuniao}} {{quando}} {{linkHtml}}
      const emailVars = {
        nome: esc(name), saudacao: name ? `Olá, ${esc(name)}!` : 'Olá!',
        titulo: esc(head), reuniao: esc(mt.name), quando: esc(when),
        linkHtml: meetLink ? `<p>Link da reunião: <a href="${esc(meetLink)}">${esc(meetLink)}</a></p>` : (mt.locationDetail ? `<p>Local: ${esc(mt.locationDetail)}</p>` : ''),
      }
      const emailDefault = `<div style="font-family:system-ui;max-width:560px;margin:0 auto">
        <h2 style="color:#1a73e8">{{titulo}}: {{reuniao}}</h2>
        <p>{{saudacao}}</p>
        <p>📅 <b>{{quando}}</b></p>
        {{linkHtml}}
        <p style="margin-top:20px;font-size:13px;color:#5f6368">Para remarcar ou cancelar, fale com a nossa equipe.</p>
      </div>`
      const em = await getRenderedTemplate(`agendamento_${kindKey}_email`, 'email', emailVars, { subject: `{{titulo}}: {{reuniao}} — {{quando}}`, body: emailDefault })
      if (em.body.trim()) await sendEmailGeneric({ from: getFromAddress(cfg, brand?.brandName || 'Agendamentos'), to: toEmail, subject: em.subject, html: em.body })
    } catch (e: any) { console.warn('[scheduling] e-mail falhou:', e?.message) }
  }

  // Operador/dono da agenda (só na confirmação) — WhatsApp + e-mail, ambos editáveis.
  if (kind === 'confirmation' && mt.ownerUserId) {
    const op = await prisma.user.findUnique({ where: { id: mt.ownerUserId }, select: { email: true, name: true, notifyWhatsapp: true } })
    // WhatsApp ao operador (se ele tiver número de avisos configurado).
    if (op?.notifyWhatsapp) {
      const waOpVars = { operador: op.name || '', nome: name, telefone: phone || '', emailLead: toEmail || '', reuniao: mt.name, quando: when, link: locLine }
      const waOpDefault = `🗓️ *Novo agendamento: {{reuniao}}*\n👤 {{nome}}{{telefone}}\n📅 {{quando}}{{link}}`
      const waOp = await getRenderedTemplate('agendamento_operador_wa', 'whatsapp', { ...waOpVars, telefone: phone ? `\n📱 ${phone}` : '' }, { body: waOpDefault })
      if (waOp.body.trim()) await sendWa(null, op.notifyWhatsapp, waOp.body)
    }
    // E-mail ao operador.
    if (op?.email) {
      try {
        const cfg = await getEmailConfig()
        const brand = await getBranding()
        const emailOpVars = {
          operador: esc(op.name || ''), nome: esc(name), telefone: esc(phone || ''), emailLead: esc(toEmail || ''),
          reuniao: esc(mt.name), quando: esc(when),
          linkHtml: meetLink ? `<p>Link: <a href="${esc(meetLink)}">${esc(meetLink)}</a></p>` : (mt.locationDetail ? `<p>Local: ${esc(mt.locationDetail)}</p>` : ''),
        }
        const emailOpDefault = `<div style="font-family:system-ui;max-width:560px;margin:0 auto"><h3>🗓️ Novo agendamento: {{reuniao}}</h3><p>Com: <b>{{nome}}</b>${phone ? ' · {{telefone}}' : ''}${toEmail ? ' · {{emailLead}}' : ''}</p><p>📅 {{quando}}</p>{{linkHtml}}</div>`
        const emOp = await getRenderedTemplate('agendamento_operador_email', 'email', emailOpVars, { subject: `Novo agendamento: {{nome}} — {{quando}}`, body: emailOpDefault })
        if (emOp.body.trim()) await sendEmailGeneric({ from: getFromAddress(cfg, brand?.brandName || 'Agendamentos'), to: op.email, subject: emOp.subject, html: emOp.body })
      } catch { /* best-effort */ }
    }
  }
}

export async function notifyCancelled(bookingId: number): Promise<void> {
  const booking = await prisma.booking.findUnique({ where: { id: bookingId } })
  if (!booking) return
  const mt = await prisma.meetingType.findUnique({ where: { id: booking.meetingTypeId }, select: { name: true, ownerUserId: true } })
  const lead = booking.leadId ? await prisma.lead.findUnique({ where: { id: booking.leadId }, select: { id: true, whatsapp: true } }) : null
  const when = fmtDateTime(booking.startAt, booking.timezone)
  const phone = lead?.whatsapp || booking.inviteePhone || ''
  if (phone) {
    // Cancelamento ao lead — editável (MessageTemplate booking_cancelled_wa).
    const cancelled = await getRenderedTemplate('agendamento_cancelado_wa', 'whatsapp',
      { reuniao: mt?.name || 'reunião', quando: when },
      { body: `Seu agendamento de *{{reuniao}}* ({{quando}}) foi *cancelado*.` })
    if (cancelled.body.trim()) await sendWa(lead?.id ?? null, phone, cancelled.body)
  }
}

// ── Cron de lembretes (24h e 1h antes) — idempotente via metadata da Activity ──
let reminderTimer: NodeJS.Timeout | null = null

async function reminderTick(): Promise<void> {
  const now = Date.now()
  // Janela ampla: pega meetings nas próximas ~25h ainda pendentes.
  const acts = await prisma.activity.findMany({
    where: { type: 'meeting', status: 'pending', scheduledAt: { gt: new Date(now), lt: new Date(now + 25 * 3600000) } },
    select: { id: true, scheduledAt: true, metadata: true },
    take: 200,
  })
  for (const a of acts) {
    const meta = (a.metadata as any) || {}
    const bookingId = meta.bookingId
    if (!bookingId) continue
    const diffMin = (a.scheduledAt.getTime() - now) / 60000
    let flag: string | null = null
    if (diffMin <= 70 && !meta.reminded1h) flag = 'reminded1h'
    else if (diffMin <= 25 * 60 && diffMin > 70 && !meta.reminded24h) flag = 'reminded24h'
    if (!flag) continue
    try {
      await notifyBooking(bookingId, 'reminder')
      await prisma.activity.update({ where: { id: a.id }, data: { metadata: { ...meta, [flag]: true } } })
    } catch { /* tenta no próximo tick */ }
  }
}

export function startSchedulingReminders(): void {
  if (reminderTimer) return
  reminderTimer = setInterval(() => { reminderTick().catch(() => {}) }, 5 * 60000)
  console.log('[scheduling] lembretes iniciados (tick 5min)')
}
