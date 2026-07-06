// src/services/meetingUploadTranscribe.ts
// Modo REUNIÃO PRESENCIAL (P0) — transcreve o áudio enviado da sala física SEM o
// bot Vexa. O áudio (gravado no navegador/celular ou upload de arquivo) é mandado
// direto ao nosso whisper CPU soberano (transcription-service, endpoint OpenAI-
// compatível) e, ao concluir, o registro vira status "completed" — daí o pipeline
// existente (polish → análise IA → entrega → anexo no lead) assume automaticamente.
//
// Soberania: o áudio NUNCA sai do servidor (mesma filosofia do modo online).
// Diarização (quem falou) fica para a fase P4 (pyannote); aqui a transcrição é
// corrida, com falante genérico "Participante".

import { promises as fs } from 'node:fs'
import { join, basename } from 'node:path'
import { prisma } from '../lib/prisma.js'

// Endpoint OpenAI-compatível do whisper CPU (transcription-service do Vexa).
// Alcançável a partir do host do bychat em :8083. Configurável por env/Setting.
const DEFAULT_TRANSCRIBE_URL = 'http://localhost:8083/v1/audio/transcriptions'

interface WhisperSegment { start?: number | null; end?: number | null; text?: string }
interface WhisperResponse { text?: string; language?: string; segments?: WhisperSegment[] }

function fmtTime(sec: number | null | undefined): string {
  if (sec === null || sec === undefined || !Number.isFinite(sec)) return '00:00'
  const s = Math.max(0, Math.floor(sec))
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

// Mesmo formato do poller online: "[mm:ss] Falante: texto".
function consolidate(segments: { start: number | null; speaker: string | null; text: string }[]): string {
  return segments
    .map(s => `[${fmtTime(s.start)}] ${s.speaker || 'Participante'}: ${s.text}`.trim())
    .filter(Boolean)
    .join('\n')
}

async function getTranscribeUrl(): Promise<string> {
  if (process.env.MEETINGS_TRANSCRIBE_URL) return process.env.MEETINGS_TRANSCRIBE_URL
  try {
    const row = await prisma.setting.findUnique({ where: { key: 'meetings.presencial.transcribe_url' } })
    const v = typeof row?.value === 'string' ? row.value.replace(/^"|"$/g, '').trim() : ''
    if (v) return v
  } catch { /* usa default */ }
  return DEFAULT_TRANSCRIBE_URL
}

// Transcreve via transcription-service (whisper CPU, OpenAI-compat). Retorna texto
// consolidado + segmentos {start,end,speaker,text}. speaker=null (sem diarização).
async function transcribeViaService(
  absPath: string, language: string,
): Promise<{ text: string; segments: { start: number | null; end: number | null; speaker: string | null; text: string }[] } | null> {
  const url = await getTranscribeUrl()
  const buffer = await fs.readFile(absPath)
  const fd = new FormData()
  // undici/Node 18+: Blob a partir do Buffer.
  fd.append('file', new Blob([buffer]), basename(absPath))
  fd.append('model', 'whisper')
  if (language) fd.append('language', language)

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10 * 60_000) // 10min p/ áudios longos
  try {
    const res = await fetch(url, { method: 'POST', body: fd as any, signal: controller.signal })
    if (!res.ok) {
      console.warn(`[MeetingUpload] transcription-service HTTP ${res.status}`)
      return null
    }
    const data = (await res.json()) as WhisperResponse
    const raw = Array.isArray(data.segments) ? data.segments : []
    const segments = raw
      .filter(s => (s.text || '').trim())
      .map(s => ({ start: s.start ?? null, end: s.end ?? null, speaker: null as string | null, text: (s.text || '').trim() }))
    // Se não vierem segmentos mas houver texto, cria um único segmento.
    if (segments.length === 0 && (data.text || '').trim()) {
      segments.push({ start: 0, end: null, speaker: null, text: (data.text || '').trim() })
    }
    const text = segments.length ? consolidate(segments) : (data.text || '').trim()
    return { text, segments }
  } finally {
    clearTimeout(timeout)
  }
}

// Fallback soberano: whisper local via scripts/transcribe.py (só texto, sem tempo).
async function transcribeViaLocalScript(absPath: string): Promise<{ text: string; segments: { start: number | null; end: number | null; speaker: string | null; text: string }[] } | null> {
  try {
    const { execSync } = await import('node:child_process')
    const scriptPath = join(process.cwd(), 'scripts', 'transcribe.py')
    const out = execSync(`python3 "${scriptPath}" "${absPath}"`, { timeout: 10 * 60_000, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] })
    const parsed = JSON.parse(out.trim())
    if (parsed.error || !parsed.text) return null
    const t = String(parsed.text).trim()
    if (!t) return null
    return { text: `[00:00] Participante: ${t}`, segments: [{ start: 0, end: null, speaker: null, text: t }] }
  } catch (e: any) {
    console.warn('[MeetingUpload] fallback local falhou:', e?.message)
    return null
  }
}

function absFromStoragePath(storagePath: string): string {
  // storagePath é relativo a uploads/ (ex.: "meeting-recordings/audio-...webm").
  return join(process.cwd(), '..', 'uploads', storagePath)
}

// Transcreve UM registro presencial em "transcribing" e o leva a "completed"
// (ou "failed"). Idempotente: sai cedo se já tem transcrição ou não é presencial.
export async function transcribeUploadRecording(recId: number): Promise<void> {
  const rec = await prisma.meetingRecording.findUnique({ where: { id: recId } })
  if (!rec || rec.source !== 'presencial') return
  if (rec.status !== 'transcribing') return
  if (rec.transcriptText && rec.transcriptText.trim()) return
  if (!rec.audioPath) {
    await prisma.meetingRecording.update({ where: { id: recId }, data: { status: 'failed', errorReason: 'Sem áudio para transcrever', endedAt: new Date() } })
    return
  }

  const absPath = absFromStoragePath(rec.audioPath)
  try { await fs.access(absPath) } catch {
    await prisma.meetingRecording.update({ where: { id: recId }, data: { status: 'failed', errorReason: 'Arquivo de áudio não encontrado', endedAt: new Date() } })
    return
  }

  const result = (await transcribeViaService(absPath, rec.language || 'pt'))
    || (await transcribeViaLocalScript(absPath))

  if (!result || !result.text.trim()) {
    await prisma.meetingRecording.update({
      where: { id: recId },
      data: { status: 'failed', errorReason: 'Transcrição vazia (áudio inaudível ou serviço indisponível)', endedAt: new Date() },
    })
    console.log(`[MeetingUpload] #${recId} failed — transcrição vazia`)
    return
  }

  await prisma.meetingRecording.update({
    where: { id: recId },
    data: {
      status: 'completed',
      transcriptText: result.text,
      transcriptSegments: result.segments as any,
      segmentCount: result.segments.length,
      transcribedAt: new Date(),
      startedAt: rec.startedAt ?? rec.createdAt,
      endedAt: new Date(),
    },
  })
  console.log(`[MeetingUpload] #${recId} completed — ${result.segments.length} segmento(s) (presencial)`)
}

// Rede de segurança: reprocessa presenciais travados em "transcribing" (ex.: restart
// do servidor no meio da transcrição). Chamado pelo loop do poller a cada tick.
export async function transcribePendingUploads(limit = 3): Promise<number> {
  const pend = await prisma.meetingRecording.findMany({
    where: { source: 'presencial', status: 'transcribing' },
    orderBy: { createdAt: 'asc' },
    take: limit,
  })
  let n = 0
  for (const r of pend) {
    try { await transcribeUploadRecording(r.id); n++ } catch (e: any) {
      console.warn(`[MeetingUpload] reprocesso #${r.id} falhou:`, e?.message)
    }
  }
  return n
}
