// Ponte bidirecional entre a Agenda nativa (módulo Agendamento) e o Google Calendar.
//   - Entrada (Google → bychat): lê os eventos do Google do operador para exibir na
//     Agenda e bloquear a disponibilidade pública (free/busy).
//   - Saída (bychat → Google): espelha os bloqueios/compromissos manuais no Google.
// Usa SOMENTE a conexão pessoal do operador (kind=OPERATOR) — nunca a da empresa —
// para não bloquear a agenda de todos com o calendário corporativo.
import { prisma } from '../lib/prisma.js'
import { listCalendarEvents, createCalendarEvent, updateCalendarEvent, deleteCalendarEvent } from '../lib/google.js'

export type ExternalEvent = {
  eventId: string
  summary: string
  startAt: string // ISO
  endAt: string // ISO
  allDay: boolean
  htmlLink: string
}

// Resolve {connectionId, calendarId} da conexão PESSOAL do operador. null se não houver.
export async function resolveOperatorCalendar(userId: number | null | undefined): Promise<{ connectionId: number; calendarId: string } | null> {
  if (!userId) return null
  const op = await prisma.googleConnection.findFirst({
    where: { userId, active: true, kind: 'OPERATOR' },
    select: { id: true },
  })
  if (!op) return null
  const integ = await prisma.googleCalendarIntegration.findFirst({
    where: { connectionId: op.id, active: true },
    select: { calendarId: true },
  })
  return { connectionId: op.id, calendarId: integ?.calendarId || 'primary' }
}

// Cache curto p/ events.list (a função roda no cálculo de slots público — latência/quota).
const cache = new Map<string, { at: number; events: ExternalEvent[] }>()
const TTL = 60_000

export function invalidateGoogleCalCache(): void { cache.clear() }

// Eventos EXTERNOS do Google (que o bychat NÃO criou) no intervalo. Servem tanto para
// exibir na Agenda quanto para bloquear slots. Nunca lança — falha vira lista vazia.
export async function getExternalGoogleEvents(userId: number | null | undefined, from: Date, to: Date): Promise<ExternalEvent[]> {
  try {
    const cal = await resolveOperatorCalendar(userId)
    if (!cal) return []
    const key = `${cal.connectionId}|${cal.calendarId}|${from.toISOString().slice(0, 10)}|${to.toISOString().slice(0, 10)}`
    const hit = cache.get(key)
    if (hit && Date.now() - hit.at < TTL) return hit.events
    const raw = await listCalendarEvents(cal.connectionId, cal.calendarId, from, to)
    const events: ExternalEvent[] = raw
      .filter((e) => !e.bychatSource) // exclui o que o próprio bychat empurrou (já aparece nativo)
      .filter((e) => e.transparency !== 'transparent') // ignora eventos marcados como "disponível"
      .filter((e) => e.start && e.end)
      .map((e) => ({
        eventId: e.eventId,
        summary: e.summary,
        startAt: new Date(e.start as string).toISOString(),
        endAt: new Date(e.end as string).toISOString(),
        allDay: e.allDay,
        htmlLink: e.htmlLink,
      }))
    cache.set(key, { at: Date.now(), events })
    return events
  } catch (e: any) {
    console.warn(`[scheduling:gcal] getExternalGoogleEvents falhou (operador ${userId}) — slots NÃO consideram a agenda do Google:`, e?.message || e)
    return []
  }
}

// ── Saída: espelhar bloqueio manual no Google ──
export async function pushBlockToGoogle(blockId: number): Promise<void> {
  try {
    const b = await prisma.calendarBlock.findUnique({ where: { id: blockId } })
    if (!b || !b.operatorUserId || b.googleEventId) return
    const cal = await resolveOperatorCalendar(b.operatorUserId)
    if (!cal) { console.warn(`[scheduling:gcal] bloco #${blockId}: operador ${b.operatorUserId} sem conta Google conectada — não espelhado`); return }
    const res = await createCalendarEvent(cal.connectionId, cal.calendarId, {
      summary: b.title || (b.kind === 'busy' ? 'Bloqueado' : 'Compromisso'),
      description: b.note || 'Criado no bychat (Agenda).',
      start: b.startAt,
      end: b.endAt,
      allDay: b.allDay,
      extendedPrivate: { bychatSource: 'block', bychatBlockId: String(b.id) },
    })
    await prisma.calendarBlock.update({ where: { id: b.id }, data: { googleEventId: res.eventId, googleCalendarId: cal.calendarId } })
    invalidateGoogleCalCache()
  } catch (e: any) { console.warn(`[scheduling:gcal] pushBlockToGoogle #${blockId} falhou:`, e?.message || e) }
}

export async function updateBlockInGoogle(blockId: number): Promise<void> {
  try {
    const b = await prisma.calendarBlock.findUnique({ where: { id: blockId } })
    if (!b) return
    if (!b.googleEventId) { await pushBlockToGoogle(blockId); return }
    const cal = await resolveOperatorCalendar(b.operatorUserId)
    if (!cal) { console.warn(`[scheduling:gcal] bloco #${blockId}: operador ${b.operatorUserId} sem conta Google — alteração não espelhada`); return }
    await updateCalendarEvent(cal.connectionId, b.googleCalendarId || cal.calendarId, b.googleEventId, {
      summary: b.title || (b.kind === 'busy' ? 'Bloqueado' : 'Compromisso'),
      start: b.startAt,
      end: b.endAt,
      allDay: b.allDay,
    })
    invalidateGoogleCalCache()
  } catch (e: any) { console.warn(`[scheduling:gcal] updateBlockInGoogle #${blockId} falhou:`, e?.message || e) }
}

export async function deleteBlockFromGoogle(googleEventId: string | null, googleCalendarId: string | null, operatorUserId: number | null): Promise<void> {
  try {
    if (!googleEventId) return
    const cal = await resolveOperatorCalendar(operatorUserId)
    if (!cal) return
    await deleteCalendarEvent(cal.connectionId, googleCalendarId || cal.calendarId, googleEventId)
    invalidateGoogleCalCache()
  } catch (e: any) { console.warn(`[scheduling:gcal] deleteBlockFromGoogle falhou:`, e?.message || e) }
}
