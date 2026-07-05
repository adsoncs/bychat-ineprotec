// src/lib/vexaClient.ts
// Cliente do Vexa (bot de reunião self-hosted) — F1. O Vexa roda como stack
// própria (Docker) no mesmo host; a URL/base e a API key ficam em Settings
// (grp 'meetings'), com fallback para env. Toda a captura de áudio/transcrição
// é local (soberana) — ver docs/meetings/F0_CONSENTIMENTO_LGPD.md.
//
// API (self-hosted, gateway :8056):
//   POST   /bots                                  → cria/dispara o bot na reunião
//   GET    /bots/status                           → bots em execução
//   GET    /transcripts/{platform}/{nativeId}     → transcrição (segments)
//   DELETE /bots/{platform}/{nativeId}            → encerra o bot
// Autenticação: header X-API-Key.

import { prisma } from './prisma.js'
import { getMeetingsSettings } from './meetingsConfig.js'

export type MeetingPlatform = 'google_meet' | 'teams' | 'zoom'

export interface VexaConfig {
  apiUrl: string
  apiKey: string
}

function unwrap(raw: unknown): string {
  if (raw === null || raw === undefined) return ''
  if (typeof raw === 'string') return raw.replace(/^"|"$/g, '').trim()
  return String(raw)
}

let _cfg: VexaConfig | null = null
let _cfgAt = 0
const TTL = 60_000

export async function getVexaConfig(): Promise<VexaConfig> {
  if (_cfg && Date.now() - _cfgAt < TTL) return _cfg
  const rows = await prisma.setting.findMany({
    where: { key: { in: ['meetings.vexa.api_url', 'meetings.vexa.api_key'] } },
  })
  const byKey = new Map(rows.map(r => [r.key, r.value]))
  const apiUrl = (unwrap(byKey.get('meetings.vexa.api_url')) || process.env.VEXA_API_URL || 'http://localhost:8056').replace(/\/+$/, '')
  const apiKey = unwrap(byKey.get('meetings.vexa.api_key')) || process.env.VEXA_API_KEY || ''
  _cfg = { apiUrl, apiKey }
  _cfgAt = Date.now()
  return _cfg
}

export function invalidateVexaConfigCache(): void {
  _cfgAt = 0
  _cfg = null
}

async function vexaFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const { apiUrl, apiKey } = await getVexaConfig()
  if (!apiKey) throw new Error('Vexa não configurado (meetings.vexa.api_key ausente)')
  const headers: Record<string, string> = {
    'X-API-Key': apiKey,
    ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    ...(init.headers as Record<string, string> | undefined),
  }
  return fetch(`${apiUrl}${path}`, { ...init, headers })
}

/** Extrai o código nativo da reunião (xxx-xxxx-xxx no Meet) de uma URL. */
export function nativeMeetingIdFromUrl(input: string, platform: MeetingPlatform = 'google_meet'): string {
  if (platform === 'google_meet') {
    const m = input.match(/[a-z]{3}-[a-z]{4}-[a-z]{3}/i)
    if (m) return m[0]
  }
  // Fallback: último segmento do path, ou a própria string.
  try {
    const u = new URL(input)
    const seg = u.pathname.split('/').filter(Boolean).pop()
    if (seg) return seg
  } catch { /* não é URL */ }
  return input
}

export interface DispatchBotInput {
  meetUrl: string
  platform?: MeetingPlatform
  language?: string
  botName?: string
}

export interface DispatchBotResult {
  id: number
  platform: string
  nativeMeetingId: string
  status: string
  containerId?: string | null
}

/** Dispara um bot para a reunião. Retorna o registro do bot (status 'requested'). */
export async function dispatchMeetingBot(input: DispatchBotInput): Promise<DispatchBotResult> {
  const platform = input.platform || 'google_meet'
  const nativeId = nativeMeetingIdFromUrl(input.meetUrl, platform)
  // Nome/idioma do bot: override explícito → configuração do tenant → padrão.
  const settings = await getMeetingsSettings()
  const botName = input.botName || settings.botName || 'ByChat Transcritor'
  const res = await vexaFetch('/bots', {
    method: 'POST',
    body: JSON.stringify({
      platform,
      native_meeting_id: nativeId,
      meeting_url: input.meetUrl,
      bot_name: botName,
      language: input.language || settings.language || 'pt',
      transcribe_enabled: true,
    }),
  })
  if (!res.ok) {
    const txt = await res.text().catch(() => '')
    throw new Error(`Vexa dispatch falhou (${res.status}): ${txt.slice(0, 300)}`)
  }
  const b: any = await res.json()
  return {
    id: b.id,
    platform: b.platform,
    nativeMeetingId: b.native_meeting_id,
    status: b.status,
    containerId: b.bot_container_id ?? null,
  }
}

export interface TranscriptSegment {
  start: number | null
  end: number | null
  speaker: string | null
  text: string
}

/** Busca a transcrição (segments) da reunião. */
export async function getMeetingTranscript(platform: MeetingPlatform, nativeId: string): Promise<TranscriptSegment[]> {
  const res = await vexaFetch(`/transcripts/${platform}/${encodeURIComponent(nativeId)}`)
  if (res.status === 404) return []
  if (!res.ok) {
    const txt = await res.text().catch(() => '')
    throw new Error(`Vexa transcript falhou (${res.status}): ${txt.slice(0, 300)}`)
  }
  const d: any = await res.json()
  const raw: any[] = d.segments || d.transcripts || []
  return raw.map(s => ({
    start: typeof s.start === 'number' ? s.start : null,
    end: typeof s.end === 'number' ? s.end : null,
    speaker: s.speaker ?? null,
    text: String(s.text ?? '').trim(),
  }))
}

/** Encerra o bot na reunião. Best-effort. */
export async function stopMeetingBot(platform: MeetingPlatform, nativeId: string): Promise<void> {
  await vexaFetch(`/bots/${platform}/${encodeURIComponent(nativeId)}`, { method: 'DELETE' }).catch(() => {})
}

/** Publica uma mensagem no chat da reunião (ex.: anúncio de gravação). Best-effort. */
export async function postMeetingChat(platform: MeetingPlatform, nativeId: string, message: string): Promise<void> {
  if (!message.trim()) return
  await vexaFetch(`/bots/${platform}/${encodeURIComponent(nativeId)}/chat`, {
    method: 'POST',
    body: JSON.stringify({ message }),
  }).catch(() => {})
}

/** Baixa o ÁUDIO da reunião do Vexa (best-effort — tolera variações de schema).
 *  Retorna null se não encontrar/indisponível. */
export async function fetchMeetingAudio(nativeId: string): Promise<{ buffer: Buffer; ext: string } | null> {
  try {
    const listRes = await vexaFetch('/recordings')
    if (!listRes.ok) return null
    const list: any = await listRes.json()
    const recs: any[] = Array.isArray(list) ? list : (list.recordings || list.results || list.data || [])
    const match = recs.find(r => [r.native_meeting_id, r.nativeMeetingId, r.meeting_id].includes(nativeId)) || recs[recs.length - 1]
    const recId = match?.id ?? match?.recording_id
    if (!recId) return null
    const detRes = await vexaFetch(`/recordings/${recId}`)
    if (!detRes.ok) return null
    const det: any = await detRes.json()
    const media: any[] = det.media || det.media_files || det.files || det.artifacts || []
    const audio = media.find(m => /audio|mp3|wav|ogg|m4a|opus/i.test(String(m.type || m.mime || m.kind || m.filename || m.name || ''))) || media[0]
    const mediaId = audio?.id ?? audio?.media_file_id
    if (!mediaId) return null
    const dlRes = await vexaFetch(`/recordings/${recId}/media/${mediaId}/download`)
    if (!dlRes.ok) return null
    const ab = await dlRes.arrayBuffer()
    const nameExt = String(audio.filename || audio.name || '').split('.').pop() || ''
    const ext = /^[a-z0-9]{2,4}$/i.test(nameExt) ? nameExt.toLowerCase() : 'wav'
    return { buffer: Buffer.from(ab), ext }
  } catch { return null }
}

/** Lista bots em execução (usado p/ health-check de conectividade). */
export async function listMeetingBots(): Promise<any[]> {
  const res = await vexaFetch('/bots/status')
  if (!res.ok) throw new Error(`Vexa status falhou (${res.status})`)
  const d: any = await res.json()
  return d.running_bots || []
}
