// src/services/meetingAutoDispatch.ts
// "Funciona sozinho" — agendador que dispara o bot AUTOMATICAMENTE nas reuniões
// prestes a começar, para usuários com LICENÇA ativa (seat) + "entra sozinho".
// Aplica todos os portões: licença (cobrança), consentimento do tenant + opt-out
// por reunião (shouldRecordMeeting) e dedup (uma gravação por atividade).
//
// A elegibilidade (findDueMeetings) é separada do disparo para ser testável sem
// spawnar bots reais.

import { prisma } from '../lib/prisma.js'
import { shouldRecordMeeting, getMeetingsSettings } from '../lib/meetingsConfig.js'
import { getUserBot } from '../lib/meetingBotSeat.js'
import { dispatchMeetingBot } from '../lib/vexaClient.js'

export interface DueMeeting {
  activityId: number
  userId: number
  leadId: number | null
  meetUrl: string
  language: string
}

// Janela de disparo: começou há até 1min OU começa nos próximos N min (configurável).
const PAST_MS = 60_000

/** Reuniões elegíveis para disparo autônomo AGORA (sem efeitos colaterais). */
export async function findDueMeetings(nowMs: number = Date.now()): Promise<DueMeeting[]> {
  const aheadMin = (await getMeetingsSettings()).joinAheadMinutes
  const from = new Date(nowMs - PAST_MS)
  const to = new Date(nowMs + Math.max(1, aheadMin) * 60_000)

  const activities = await prisma.activity.findMany({
    where: { type: 'meeting', scheduledAt: { gte: from, lte: to } },
    select: { id: true, userId: true, leadId: true, metadata: true },
    take: 100,
  })

  const due: DueMeeting[] = []
  for (const a of activities) {
    const meta = (a.metadata as any) || {}
    if (meta.meetingBotDispatched) continue           // já disparado
    const meetUrl: string = meta.googleMeetLink || ''
    if (!meetUrl) continue                             // sem link do Meet
    if (!a.userId) continue                            // sem dono
    if (!(await shouldRecordMeeting(meta))) continue   // tenant off ou opt-out
    const bot = await getUserBot(a.userId)
    if (!bot.enabled || !bot.autoJoin) continue        // sem licença ativa / autoJoin off
    const existing = await prisma.meetingRecording.findFirst({ where: { activityId: a.id }, select: { id: true } })
    if (existing) continue                             // dedup
    due.push({ activityId: a.id, userId: a.userId, leadId: a.leadId ?? null, meetUrl, language: bot.language })
  }
  return due
}

/** Dispara o bot para as reuniões elegíveis. Retorna quantas foram disparadas. */
export async function autoDispatchDueMeetings(): Promise<number> {
  const due = await findDueMeetings()
  let count = 0
  for (const m of due) {
    try {
      const d = await dispatchMeetingBot({ meetUrl: m.meetUrl, platform: 'google_meet', language: m.language })
      await prisma.meetingRecording.create({
        data: {
          leadId: m.leadId, activityId: m.activityId, userId: m.userId,
          platform: 'google_meet', nativeMeetingId: d.nativeMeetingId,
          meetingUrl: m.meetUrl, language: m.language,
          status: d.status || 'requested', botId: d.id ?? null, botContainerId: d.containerId ?? null,
        },
      })
      // Marca a atividade para não disparar de novo.
      const a = await prisma.activity.findUnique({ where: { id: m.activityId }, select: { metadata: true } })
      const meta = (a?.metadata as any) || {}
      await prisma.activity.update({
        where: { id: m.activityId },
        data: { metadata: { ...meta, meetingBotDispatched: true, meetingBotAt: new Date().toISOString() } },
      })
      count++
      console.log(`[MeetingAuto] bot disparado p/ atividade #${m.activityId} (user ${m.userId})`)
    } catch (e: any) {
      console.warn(`[MeetingAuto] falha ao disparar atividade #${m.activityId}:`, e?.message)
    }
  }
  return count
}

let _timer: ReturnType<typeof setInterval> | null = null
let _running = false

export function startMeetingAutoDispatch(): void {
  if (_timer) return
  _timer = setInterval(async () => {
    if (_running) return
    _running = true
    try {
      await autoDispatchDueMeetings()
    } catch (e: any) {
      console.error('[MeetingAuto] loop falhou:', e?.message)
    } finally {
      _running = false
    }
  }, 60_000)
  if (typeof _timer.unref === 'function') _timer.unref()
  console.log('[MeetingAuto] auto-disparo de bots em reuniões iniciado')
}
