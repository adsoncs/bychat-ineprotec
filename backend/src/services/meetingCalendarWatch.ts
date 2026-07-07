// src/services/meetingCalendarWatch.ts
// "Vigia da Agenda Google" — cobertura ALÉM da agenda do CRM. Para cada usuário
// com licença de bot ativa (seat enabled + autoJoin), lê a agenda Google PRÓPRIA
// dele (conexão OPERATOR) e dispara o bot em QUALQUER evento com link do Meet
// prestes a começar — mesmo que o compromisso não exista como Activity do CRM
// (ex.: convite de cliente, evento criado direto no Google Calendar).
//
// Escopo deliberado: só conexões OPERATOR (a conta pessoal do agente). Conexões
// COMPANY são ignoradas de propósito — elas espelham TODAS as reuniões de leads
// do CRM e fariam o bot entrar em reunião de qualquer um, furando o gate de seat.
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

  // Conexões OPERATOR desses usuários + suas integrações de calendar ativas.
  const conns = await prisma.googleConnection.findMany({
    where: { kind: 'OPERATOR', active: true, userId: { in: seatUserIds } },
    select: { id: true, email: true, userId: true, calendarIntegrations: { where: { active: true }, select: { calendarId: true } } },
  })

  const due: DueCalendarMeeting[] = []
  const seenNative = new Set<string>()

  for (const conn of conns) {
    if (conn.userId == null) continue
    const seat = seats.find(s => s.userId === conn.userId)
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
          userId: conn.userId,
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
      await prisma.meetingRecording.create({
        data: {
          userId: m.userId,
          title: m.title,
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
