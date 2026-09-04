// src/services/meetingCalendarWatch.ts
// "Vigia da Agenda Google" — cobertura ALÉM da agenda do CRM. Para cada usuário
// com licença de bot ativa (seat enabled + autoJoin), lê a agenda Google PRÓPRIA
// dele (conexão OPERATOR) e dispara o bot em QUALQUER evento com link do Meet
// prestes a começar — mesmo que o compromisso não exista como Activity do CRM
// (ex.: convite de cliente, evento criado direto no Google Calendar).
//
// Escopo: conexões OPERATOR (conta pessoal do agente) SEMPRE. Conexões COMPANY
// (ex.: contato@agenciabeyond.com.br) são OPT-IN via Setting
// meetings.company_calendar_watch — quando ligado, o bot também cobre a agenda da
// conta da empresa (reuniões atribuídas ao seat meetings.company_calendar_owner_user_id,
// ou ao 1º seat ativo). Cuidado: a agenda COMPANY espelha as reuniões de leads do
// CRM; a dedup por nativeMeetingId evita duplicar com o autoDispatch do CRM.
//
// Portões idênticos ao auto-disparo do CRM: consentimento do tenant
// (shouldRecordMeeting) + licença (seat). Dedup por nativeMeetingId para NÃO
// duplicar com o autoDispatch do CRM (mesmo link do Meet = mesmo código nativo).

import { prisma } from '../lib/prisma.js'
import { shouldRecordMeeting, getMeetingsSettings } from '../lib/meetingsConfig.js'
import { getUserBot } from '../lib/meetingBotSeat.js'
import { dispatchMeetingBot, nativeMeetingIdFromUrl } from '../lib/vexaClient.js'
import { listCalendarEvents } from '../lib/google.js'

// Janela: começou há até 1min OU começa nos próximos N min (mesma do CRM).
const PAST_MS = 60_000
// Dedup: uma gravação por código nativo dentro desta janela (evita reentrar na
// mesma reunião a cada tick e colidir com o disparo do CRM).
const DEDUP_MS = 8 * 60 * 60 * 1000

export interface DueCalendarMeeting {
  userId: number
  meetUrl: string
  nativeId: string
  title: string
  language: string
  calendarEmail: string
}

/** Cobertura opt-in da agenda da conta da empresa (conexões COMPANY). */
async function getCompanyWatch(): Promise<{ enabled: boolean; ownerUserId: number | null }> {
  const rows = await prisma.setting.findMany({
    where: { key: { in: ['meetings.company_calendar_watch', 'meetings.company_calendar_owner_user_id'] } },
  })
  const g = new Map(rows.map(r => [r.key, String(r.value).replace(/^"|"$/g, '').trim()]))
  const ownerRaw = g.get('meetings.company_calendar_owner_user_id')
  const ownerId = ownerRaw ? parseInt(ownerRaw, 10) : NaN
  return {
    enabled: (g.get('meetings.company_calendar_watch') || '').toLowerCase() === 'true',
    ownerUserId: Number.isFinite(ownerId) ? ownerId : null,
  }
}

/** Reuniões da agenda Google dos agentes com seat ativo, elegíveis AGORA. */
export async function findDueCalendarMeetings(nowMs: number = Date.now()): Promise<DueCalendarMeeting[]> {
  // Gate do tenant (consentimento). Sem opt-out por evento aqui (não há metadata).
  if (!(await shouldRecordMeeting({}))) return []

  const aheadMin = (await getMeetingsSettings()).joinAheadMinutes
  const from = new Date(nowMs - PAST_MS)
  const to = new Date(nowMs + Math.max(1, aheadMin) * 60_000)

  // Seats ativos (licença + entra sozinho).
  const seats = await prisma.userMeetingBot.findMany({
    where: { enabled: true, autoJoin: true },
    select: { userId: true, language: true },
  })
  if (seats.length === 0) return []
  const seatUserIds = seats.map(s => s.userId)

  // Cobertura extra da agenda da conta da empresa (COMPANY), opt-in por Setting.
  const cw = await getCompanyWatch()
  const companyOwnerId = cw.ownerUserId ?? seats[0].userId

  // Conexões OPERATOR (sempre) + COMPANY (se ligado) com integrações de calendar ativas.
  const orConds: any[] = [{ kind: 'OPERATOR', userId: { in: seatUserIds } }]
  if (cw.enabled) orConds.push({ kind: 'COMPANY' })
  const conns = await prisma.googleConnection.findMany({
    where: { active: true, OR: orConds },
    select: { id: true, email: true, userId: true, kind: true, calendarIntegrations: { where: { active: true }, select: { calendarId: true } } },
  })

  const due: DueCalendarMeeting[] = []
  const seenNative = new Set<string>()

  for (const conn of conns) {
    // COMPANY não tem userId → atribui ao seat dono (config ou 1º seat ativo).
    const ownerUserId = conn.userId ?? companyOwnerId
    const seat = seats.find(s => s.userId === ownerUserId)
    const language = seat?.language || 'pt'
    // Se não houver integração de calendar configurada, cai no calendário primário.
    const calendarIds = conn.calendarIntegrations.length
      ? conn.calendarIntegrations.map(i => i.calendarId || 'primary')
      : ['primary']

    for (const calendarId of calendarIds) {
      let events: Awaited<ReturnType<typeof listCalendarEvents>>
      try {
        events = await listCalendarEvents(conn.id, calendarId, from, to)
      } catch (e: any) {
        console.warn(`[MeetingCalWatch] falha ao ler agenda de ${conn.email} (${calendarId}):`, e?.message)
        continue
      }

      for (const ev of events) {
        if (!ev.meetLink) continue                       // só reuniões com Meet
        if (ev.allDay || !ev.start) continue             // ignora eventos de dia inteiro
        const startMs = new Date(ev.start).getTime()
        if (!Number.isFinite(startMs)) continue
        if (startMs < nowMs - PAST_MS || startMs > to.getTime()) continue  // fora da janela de início

        const nativeId = nativeMeetingIdFromUrl(ev.meetLink, 'google_meet')
        if (seenNative.has(nativeId)) continue           // já elegível neste tick
        seenNative.add(nativeId)

        due.push({
          userId: ownerUserId,
          meetUrl: ev.meetLink,
          nativeId,
          title: ev.summary || 'Reunião',
          language,
          calendarEmail: conn.email,
        })
      }
    }
  }
  return due
}

/** Dispara o bot para as reuniões elegíveis da agenda Google. Retorna o total. */
export async function autoDispatchCalendarMeetings(): Promise<number> {
  const due = await findDueCalendarMeetings()
  if (due.length === 0) return 0

  const dedupSince = new Date(Date.now() - DEDUP_MS)
  let count = 0
  for (const m of due) {
    try {
      // Dedup por código nativo: cobre tanto reentrar na mesma reunião quanto a
      // colisão com o auto-disparo do CRM (mesmo Meet vira o mesmo nativeId).
      const existing = await prisma.meetingRecording.findFirst({
        where: { nativeMeetingId: m.nativeId, status: { not: 'failed' }, createdAt: { gte: dedupSince } },
        select: { id: true },
      })
      if (existing) continue

      const d = await dispatchMeetingBot({ meetUrl: m.meetUrl, platform: 'google_meet', language: m.language })
      // O vigia enxerga o evento do Google, não o CRM: não conhece lead nem
      // reserva. O link do Meet é o fio comum — amarrar aqui é o que permite a
      // reunião se fechar sozinha quando a gravação termina, em vez de ficar
      // eternamente "agendada".
      let bookingId: number | null = null
      try {
        const { resolverBookingPorLink } = await import('./meetingOutcome.js')
        bookingId = await resolverBookingPorLink(m.meetUrl, new Date())
      } catch { /* sem reserva casada: segue como reunião solta, que é o normal aqui */ }

      await prisma.meetingRecording.create({
        data: {
          userId: m.userId,
          title: m.title,
          bookingId,
          platform: 'google_meet', nativeMeetingId: d.nativeMeetingId,
          meetingUrl: m.meetUrl, language: m.language,
          status: d.status || 'requested', botId: d.id ?? null, botContainerId: d.containerId ?? null,
        },
      })
      count++
      console.log(`[MeetingCalWatch] bot disparado p/ "${m.title}" (${m.nativeId}, user ${m.userId}, agenda ${m.calendarEmail})`)
    } catch (e: any) {
      console.warn(`[MeetingCalWatch] falha ao disparar ${m.nativeId}:`, e?.message)
    }
  }
  return count
}

let _timer: ReturnType<typeof setInterval> | null = null
let _running = false

export function startMeetingCalendarWatch(): void {
  if (_timer) return
  _timer = setInterval(async () => {
    if (_running) return
    _running = true
    try {
      await autoDispatchCalendarMeetings()
    } catch (e: any) {
      console.error('[MeetingCalWatch] loop falhou:', e?.message)
    } finally {
      _running = false
    }
  }, 60_000)
  if (typeof _timer.unref === 'function') _timer.unref()
  console.log('[MeetingCalWatch] vigia da agenda Google iniciado')
}
