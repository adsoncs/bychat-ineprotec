// src/services/meetingTranscriptPoll.ts
// F1.3 — Poller que acompanha as gravações de reunião "em voo": consulta o Vexa,
// atualiza o status do bot e, ao encerrar, consolida a transcrição, grava um .txt
// em uploads/meeting-recordings/ (governado pela retenção — F0.6) e marca completed.
// Molde: services/voipRecordingSync.ts (loop setInterval com guarda de concorrência).

import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { prisma } from '../lib/prisma.js'
import {
  listMeetingBots, getMeetingTranscript, postMeetingChat, fetchMeetingAudio, fetchMeetingVideo, type MeetingPlatform, type TranscriptSegment,
} from '../lib/vexaClient.js'
import { analyzePendingMeetings, polishPendingMeetings } from './meetingAnalysisService.js'
import { deliverPendingMeetings } from './meetingDelivery.js'
import { getMeetingsSettings } from '../lib/meetingsConfig.js'

const IN_FLIGHT = ['requested', 'joining', 'active']
const MAX_WAIT_MS = 15 * 60_000 // sem nunca ficar ativo por 15min → considera falho

function fileUrl(storagePath: string): string {
  const base = process.env.APP_URL || `http://localhost:${process.env.PORT || 3005}`
  return `${base}/uploads/${storagePath}`
}

function fmtTime(sec: number | null): string {
  if (sec === null || !Number.isFinite(sec)) return '00:00'
  const s = Math.max(0, Math.floor(sec))
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

function consolidate(segments: TranscriptSegment[]): string {
  return segments
    .map(s => `[${fmtTime(s.start)}] ${s.speaker || 'Participante'}: ${s.text}`.trim())
    .filter(Boolean)
    .join('\n')
}

async function persistTranscriptFile(recId: number, text: string): Promise<{ path: string; url: string } | null> {
  if (!text.trim()) return null
  try {
    const dir = join(process.cwd(), '..', 'uploads', 'meeting-recordings')
    await fs.mkdir(dir, { recursive: true })
    const fileName = `transcript-${recId}-${Date.now()}.txt`
    await fs.writeFile(join(dir, fileName), text, 'utf8')
    const storagePath = `meeting-recordings/${fileName}`
    return { path: storagePath, url: fileUrl(storagePath) }
  } catch (e: any) {
    console.warn('[MeetingPoll] falha ao gravar transcrição:', e?.message)
    return null
  }
}

async function persistMediaFile(recId: number, buffer: Buffer, ext: string, kind: 'audio' | 'video'): Promise<{ path: string; url: string } | null> {
  try {
    if (!buffer || buffer.length === 0) return null
    const dir = join(process.cwd(), '..', 'uploads', 'meeting-recordings')
    await fs.mkdir(dir, { recursive: true })
    const fileName = `${kind}-${recId}-${Date.now()}.${ext}`
    await fs.writeFile(join(dir, fileName), buffer)
    const storagePath = `meeting-recordings/${fileName}`
    return { path: storagePath, url: fileUrl(storagePath) }
  } catch (e: any) {
    console.warn('[MeetingPoll] falha ao gravar áudio:', e?.message)
    return null
  }
}

// Mapeia o meeting_status do Vexa para o status interno.
function mapStatus(vexaStatus: string): string {
  const s = (vexaStatus || '').toLowerCase()
  if (s.includes('active') || s.includes('recording') || s.includes('admitted')) return 'active'
  if (s.includes('join')) return 'joining'
  return 'joining'
}

export async function pollMeetingTranscripts(): Promise<{ updated: number; completed: number }> {
  const inFlight = await prisma.meetingRecording.findMany({
    where: { status: { in: IN_FLIGHT } },
    orderBy: { createdAt: 'asc' },
    take: 50,
  })
  if (inFlight.length === 0) return { updated: 0, completed: 0 }

  let running: any[] = []
  try {
    running = await listMeetingBots()
  } catch (e: any) {
    console.warn('[MeetingPoll] Vexa indisponível:', e?.message)
    return { updated: 0, completed: 0 }
  }

  const ms = await getMeetingsSettings()
  let updated = 0
  let completed = 0

  for (const rec of inFlight) {
    try {
      const bot = running.find(
        b => b.native_meeting_id === rec.nativeMeetingId && b.platform === rec.platform,
      )
      const segments = await getMeetingTranscript(rec.platform as MeetingPlatform, rec.nativeMeetingId)
      const text = consolidate(segments)

      if (bot) {
        // Ainda na reunião: atualiza status + transcrição parcial (ao vivo).
        const newStatus = mapStatus(bot.meeting_status || '')
        const data: any = { transcriptSegments: segments as any, segmentCount: segments.length }
        if (text) data.transcriptText = text
        if (newStatus !== rec.status) data.status = newStatus
        if (newStatus === 'active' && !rec.startedAt) data.startedAt = new Date()
        // Anúncio de entrada: posta uma vez, na transição para "ativo".
        if (newStatus === 'active' && rec.status !== 'active' && ms.joinAnnouncement.trim()) {
          postMeetingChat(rec.platform as MeetingPlatform, rec.nativeMeetingId, ms.joinAnnouncement).catch(() => {})
        }
        await prisma.meetingRecording.update({ where: { id: rec.id }, data })
        updated++
        continue
      }

      // Bot não está mais rodando.
      const teveReuniao = rec.status === 'active' || segments.length > 0
      if (teveReuniao) {
        const file = await persistTranscriptFile(rec.id, text)
        // (9) Guardar áudio / (#3) vídeo da reunião, se ativos (best-effort).
        let audioPath = rec.audioPath, audioUrl = rec.audioUrl
        let videoPath = rec.videoPath, videoUrl = rec.videoUrl
        if (ms.saveAudio && !rec.audioPath) {
          const a = await fetchMeetingAudio(rec.nativeMeetingId)
          if (a) { const s = await persistMediaFile(rec.id, a.buffer, a.ext, 'audio'); if (s) { audioPath = s.path; audioUrl = s.url } }
        }
        if (ms.saveVideo && !rec.videoPath) {
          const v = await fetchMeetingVideo(rec.nativeMeetingId)
          if (v) { const s = await persistMediaFile(rec.id, v.buffer, v.ext, 'video'); if (s) { videoPath = s.path; videoUrl = s.url } }
        }
        await prisma.meetingRecording.update({
          where: { id: rec.id },
          data: {
            status: 'completed',
            transcriptText: text || rec.transcriptText,
            transcriptSegments: segments as any,
            segmentCount: segments.length,
            recordingPath: file?.path ?? rec.recordingPath,
            recordingUrl: file?.url ?? rec.recordingUrl,
            audioPath, audioUrl, videoPath, videoUrl,
            endedAt: new Date(),
            transcribedAt: text ? new Date() : rec.transcribedAt,
          },
        })
        completed++
        console.log(`[MeetingPoll] #${rec.id} completed — ${segments.length} segmento(s)`)
      } else if (Date.now() - new Date(rec.createdAt).getTime() > MAX_WAIT_MS) {
        // Nunca ficou ativo e sumiu do Vexa → não admitido / sem áudio.
        await prisma.meetingRecording.update({
          where: { id: rec.id },
          data: { status: 'failed', errorReason: 'Bot não admitido ou sem captura', endedAt: new Date() },
        })
        console.log(`[MeetingPoll] #${rec.id} failed — não admitido em ${Math.round(MAX_WAIT_MS / 60000)}min`)
      }
      // senão: ainda dentro da janela de graça — aguarda o próximo tick.
    } catch (e: any) {
      console.warn(`[MeetingPoll] tick #${rec.id} falhou:`, e?.message)
    }
  }

  return { updated, completed }
}

let _timer: ReturnType<typeof setInterval> | null = null
let _running = false

export function startMeetingTranscriptPoll(): void {
  if (_timer) return
  const TICK_MS = 30_000
  _timer = setInterval(async () => {
    if (_running) return
    _running = true
    try {
      await pollMeetingTranscripts()
      // Revisão da transcrição (modo corrigida), análise IA e entrega — idempotentes.
      await polishPendingMeetings().catch(() => {})
      await analyzePendingMeetings().catch(() => {})
      await deliverPendingMeetings().catch(() => {})
    } catch (e: any) {
      console.error('[MeetingPoll] loop falhou:', e?.message)
    } finally {
      _running = false
    }
  }, TICK_MS)
  if (typeof _timer.unref === 'function') _timer.unref()
  console.log('[MeetingPoll] poller de transcrição de reuniões iniciado')
}
