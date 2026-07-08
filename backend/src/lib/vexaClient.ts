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
  authenticated: boolean   // bot entra LOGADO numa conta Google (evita reCAPTCHA/sala de espera)
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
    where: { key: { in: ['meetings.vexa.api_url', 'meetings.vexa.api_key', 'meetings.vexa.authenticated'] } },
  })
  const byKey = new Map(rows.map(r => [r.key, r.value]))
  const apiUrl = (unwrap(byKey.get('meetings.vexa.api_url')) || process.env.VEXA_API_URL || 'http://localhost:8056').replace(/\/+$/, '')
  const apiKey = unwrap(byKey.get('meetings.vexa.api_key')) || process.env.VEXA_API_KEY || ''
  const authenticated = unwrap(byKey.get('meetings.vexa.authenticated')).toLowerCase() === 'true'
  _cfg = { apiUrl, apiKey, authenticated }
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

/** Força a UI do Google Meet em inglês (hl=en). O bot Vexa procura os botões do
 *  lobby por texto em INGLÊS ("Join now"/"Ask to join"); se a conta logada estiver
 *  em português ("Participar agora") o join falha por timeout. */
function withEnglishUi(url: string): string {
  try {
    const u = new URL(url)
    u.searchParams.set('hl', 'en')
    return u.toString()
  } catch {
    return url + (url.includes('?') ? '&' : '?') + 'hl=en'
  }
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
  authenticated?: boolean   // força login (override do meetings.vexa.authenticated)
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
  const cfg = await getVexaConfig()
  const botName = input.botName || settings.botName || 'ByChat Transcritor'
  // Modo autenticado: bot entra LOGADO (evita reCAPTCHA/sala de espera). Só quando
  // a sessão da conta já foi semeada no MinIO (users/{id}/browser-userdata).
  const authenticated = input.authenticated ?? cfg.authenticated
  const res = await vexaFetch('/bots', {
    method: 'POST',
    body: JSON.stringify({
      platform,
      native_meeting_id: nativeId,
      // Meet em inglês só quando autenticado (o fluxo autenticado busca botões por
      // texto em inglês); no anônimo o Vexa já usa seletores locale-agnósticos.
      meeting_url: authenticated && platform === 'google_meet' ? withEnglishUi(input.meetUrl) : input.meetUrl,
      bot_name: botName,
      language: input.language || settings.language || 'pt',
      transcribe_enabled: true,
      video: settings.saveVideo === true, // (#3) captura vídeo quando "gravar vídeo" ativo
      ...(authenticated ? { authenticated: true } : {}),
      // Timeouts de permanência/encerramento:
      // - no_one_joined_timeout: quanto o bot ESPERA por alguém após entrar. O bot
      //   entra ~3min ANTES do horário; o default do Vexa (2min) o fazia sair
      //   ANTES dos participantes chegarem (incidente reunião do Benedito). 10min
      //   cobre entrada antecipada + início atrasado.
      // - max_time_left_alone: depois que TODOS saem (pós-fala), finaliza em 2min.
      // Encerramento pelo host / remoção do bot continua imediato (detecção Vexa).
      automatic_leave: { no_one_joined_timeout: 600_000, max_time_left_alone: 120_000 },
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

/** Baixa o VÍDEO da reunião do Vexa (best-effort). Retorna null se indisponível. */
export async function fetchMeetingVideo(nativeId: string): Promise<{ buffer: Buffer; ext: string } | null> {
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
    const video = media.find(m => /video|mp4|webm|mkv|mov/i.test(String(m.type || m.mime || m.kind || m.filename || m.name || '')))
    const mediaId = video?.id ?? video?.media_file_id
    if (!mediaId) return null
    const dlRes = await vexaFetch(`/recordings/${recId}/media/${mediaId}/download`)
    if (!dlRes.ok) return null
    const ab = await dlRes.arrayBuffer()
    const nameExt = String(video.filename || video.name || '').split('.').pop() || ''
    const ext = /^[a-z0-9]{2,4}$/i.test(nameExt) ? nameExt.toLowerCase() : 'mp4'
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
