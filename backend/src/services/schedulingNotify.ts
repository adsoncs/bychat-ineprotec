// Notificações do módulo de Agendamento: confirmação, lembrete e cancelamento
// (WhatsApp + e-mail), links públicos de remarcar/cancelar, e cron de lembretes.
import { prisma } from '../lib/prisma.js'
import { sendEmailGeneric, getEmailConfig, getFromAddress } from './notify.js'
import { getBranding } from '../lib/branding.js'

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
    const provider = leadId
      ? (await wp.getProviderForLeadOwner({ id: leadId, whatsapp: phone })).provider
      : await wp.getDefaultProvider()
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
  const locLine = meetLink ? `\nLink: ${meetLink}` : (mt.locationDetail ? `\nLocal: ${mt.locationDetail}` : '')
  const waText = `*${head}: ${mt.name}*\n${name ? 'Olá, ' + name + '!\n' : ''}📅 ${when}${locLine}\n\nRemarcar: ${rescheduleLink(booking.token)}\nCancelar: ${cancelLink(booking.token)}`

  const phone = lead?.whatsapp || booking.inviteePhone || ''
  if (phone) await sendWa(lead?.id ?? null, phone, waText)

  const toEmail = lead?.email || booking.inviteeEmail
  if (toEmail) {
    try {
      const cfg = await getEmailConfig()
      const brand = await getBranding()
      const html = `<div style="font-family:system-ui;max-width:560px;margin:0 auto">
        <h2 style="color:#1a73e8">${esc(head)}: ${esc(mt.name)}</h2>
        <p>${name ? 'Olá, ' + esc(name) + '!' : ''}</p>
        <p>📅 <b>${esc(when)}</b></p>
        ${meetLink ? `<p>Link da reunião: <a href="${esc(meetLink)}">${esc(meetLink)}</a></p>` : (mt.locationDetail ? `<p>Local: ${esc(mt.locationDetail)}</p>` : '')}
        <p style="margin-top:20px;font-size:13px"><a href="${esc(rescheduleLink(booking.token))}">Remarcar</a> &nbsp;·&nbsp; <a href="${esc(cancelLink(booking.token))}">Cancelar</a></p>
      </div>`
      await sendEmailGeneric({ from: getFromAddress(cfg, brand?.brandName || 'Agendamentos'), to: toEmail, subject: `${head}: ${mt.name} — ${when}`, html })
    } catch (e: any) { console.warn('[scheduling] e-mail falhou:', e?.message) }
  }

  // Operador (só na confirmação) — por e-mail.
  if (kind === 'confirmation' && mt.ownerUserId) {
    const op = await prisma.user.findUnique({ where: { id: mt.ownerUserId }, select: { email: true } })
    if (op?.email) {
      try {
        const cfg = await getEmailConfig()
        const brand = await getBranding()
        const html = `<div style="font-family:system-ui"><h3>Novo agendamento: ${esc(mt.name)}</h3><p>Com: <b>${esc(name)}</b>${phone ? ' · ' + esc(phone) : ''}${toEmail ? ' · ' + esc(toEmail) : ''}</p><p>📅 ${esc(when)}</p>${meetLink ? `<p>Link: <a href="${esc(meetLink)}">${esc(meetLink)}</a></p>` : ''}</div>`
        await sendEmailGeneric({ from: getFromAddress(cfg, brand?.brandName || 'Agendamentos'), to: op.email, subject: `Novo agendamento: ${name} — ${when}`, html })
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
  if (phone) await sendWa(lead?.id ?? null, phone, `Seu agendamento de *${mt?.name || 'reunião'}* (${when}) foi *cancelado*.`)
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
