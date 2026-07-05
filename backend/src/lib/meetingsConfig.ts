// src/lib/meetingsConfig.ts
// Config do módulo Reuniões (gravação/transcrição) lida das Settings, com cache
// curto. Fonte única do texto-padrão do aviso de gravação (F0.3) e do estado do
// opt-in (F0.2). Usado por googleCalendarSync (descrição do convite) e pela
// notificação de agendamento para dar TRANSPARÊNCIA/consentimento ao participante.

import { prisma } from './prisma.js'

export const MEETINGS_NOTICE_DEFAULT =
  'Esta reunião poderá ser gravada e transcrita para fins de registro do atendimento. ' +
  'Ao permanecer na sala, você concorda com o registro. Para dúvidas sobre o tratamento ' +
  'dos seus dados ou para exercer seus direitos, fale com o nosso Encarregado (DPO).'

function unwrap(raw: unknown): string {
  if (raw === null || raw === undefined) return ''
  if (typeof raw === 'string') return raw.replace(/^"|"$/g, '').trim()
  return String(raw)
}

let _cache: { enabled: boolean; notice: string } | null = null
let _cacheAt = 0
const TTL = 60_000

export async function getMeetingRecordingConfig(): Promise<{ enabled: boolean; notice: string }> {
  if (_cache && Date.now() - _cacheAt < TTL) return _cache
  const rows = await prisma.setting.findMany({
    where: { key: { in: ['meetings.recording.enabled', 'meetings.recording.notice_text'] } },
  })
  const byKey = new Map(rows.map(r => [r.key, r.value]))
  const enabled = unwrap(byKey.get('meetings.recording.enabled')).toLowerCase() === 'true'
  const notice = unwrap(byKey.get('meetings.recording.notice_text')) || MEETINGS_NOTICE_DEFAULT
  _cache = { enabled, notice }
  _cacheAt = Date.now()
  return _cache
}

export function invalidateMeetingsConfigCache(): void {
  _cacheAt = 0
  _cache = null
  _pbAt = 0
  _pb = null
  _msAt = 0
  _ms = null
}

// ── Configurações gerais do módulo (nome do bot, transcrição, entregas) ─────
export interface MeetingsSettings {
  botName: string
  language: string             // (1) idioma da transcrição/análise
  transcriptMode: 'fiel' | 'corrigida'
  analysisEnabled: boolean
  analysisExtra: string        // (3) instruções extras de análise
  joinAnnouncement: string
  joinAheadMinutes: number     // (8) janela: minutos antes de o bot entrar
  saveAudio: boolean           // (9) guardar o áudio da reunião
  redactPii: boolean           // (6) mascarar dados sensíveis no resumo
  attachToLead: boolean        // (5) anexar resumo como atividade no lead
  webhookUrl: string           // (7) webhook "reunião analisada"
  alertLowAdherence: boolean   // (4) alerta ao gestor por baixa aderência
  alertThreshold: number
  alertEmail: string
  notifyEmailEnabled: boolean
  notifyEmailTo: string
  notifyToOwner: boolean
  notifyWhatsappEnabled: boolean
  notifyWhatsappTo: string
}

let _ms: MeetingsSettings | null = null
let _msAt = 0

export async function getMeetingsSettings(): Promise<MeetingsSettings> {
  if (_ms && Date.now() - _msAt < TTL) return _ms
  const rows = await prisma.setting.findMany({ where: { key: { startsWith: 'meetings.' } } })
  const g = new Map(rows.map(r => [r.key, r.value]))
  const b = (k: string): boolean => unwrap(g.get(k)).toLowerCase() === 'true'
  const s = (k: string): string => unwrap(g.get(k))
  const n = (k: string, def: number): number => { const v = parseInt(unwrap(g.get(k)), 10); return Number.isFinite(v) ? v : def }
  _ms = {
    botName: s('meetings.bot_name') || 'ByChat Transcritor',
    language: s('meetings.language') || 'pt',
    transcriptMode: s('meetings.transcript_mode') === 'corrigida' ? 'corrigida' : 'fiel',
    analysisEnabled: g.has('meetings.analysis_enabled') ? b('meetings.analysis_enabled') : true,
    analysisExtra: s('meetings.analysis_extra'),
    joinAnnouncement: s('meetings.join_announcement'),
    joinAheadMinutes: Math.max(0, Math.min(30, n('meetings.join_ahead_minutes', 3))),
    saveAudio: b('meetings.save_audio'),
    redactPii: b('meetings.redact_pii'),
    attachToLead: b('meetings.attach_to_lead'),
    webhookUrl: s('meetings.webhook_url'),
    alertLowAdherence: b('meetings.alert_low_adherence'),
    alertThreshold: Math.max(0, Math.min(100, n('meetings.alert_threshold', 50))),
    alertEmail: s('meetings.alert_email'),
    notifyEmailEnabled: b('meetings.notify.email_enabled'),
    notifyEmailTo: s('meetings.notify.email_to'),
    notifyToOwner: b('meetings.notify.to_owner'),
    notifyWhatsappEnabled: b('meetings.notify.whatsapp_enabled'),
    notifyWhatsappTo: s('meetings.notify.whatsapp_to'),
  }
  _msAt = Date.now()
  return _ms
}

// ── Playbook de vendas (contexto p/ a análise IA) ──────────────────────────
// Quando ativo, a IA avalia a conduta do time NA reunião à luz deste playbook e
// devolve direcionamento/coaching, além do resumo padrão.
export interface SalesPlaybook {
  enabled: boolean
  text: string
}

let _pb: SalesPlaybook | null = null
let _pbAt = 0

export async function getSalesPlaybook(): Promise<SalesPlaybook> {
  if (_pb && Date.now() - _pbAt < TTL) return _pb
  const rows = await prisma.setting.findMany({
    where: { key: { in: ['meetings.playbook.enabled', 'meetings.playbook.text'] } },
  })
  const byKey = new Map(rows.map(r => [r.key, r.value]))
  const text = unwrap(byKey.get('meetings.playbook.text'))
  // Só considera ativo se estiver ligado E houver conteúdo de playbook.
  const enabled = unwrap(byKey.get('meetings.playbook.enabled')).toLowerCase() === 'true' && text.trim().length > 0
  _pb = { enabled, text }
  _pbAt = Date.now()
  return _pb
}

/** Aviso de gravação a exibir no convite/confirmação — string vazia quando a
 *  gravação está DESLIGADA (nada a divulgar). */
export async function getMeetingRecordingNotice(): Promise<string> {
  const c = await getMeetingRecordingConfig()
  return c.enabled ? c.notice : ''
}

/** Decide se ESTA reunião deve ser gravada (F0.5). Política = opt-OUT por reunião:
 *  grava quando a gravação está ligada no tenant, SALVO recusa explícita
 *  (metadata.recordMeeting === false). O F1 (disparo do bot) chama isto antes de
 *  colocar o bot na sala. Recebe o metadata da Activity/Booking. */
export async function shouldRecordMeeting(meta: unknown): Promise<boolean> {
  const c = await getMeetingRecordingConfig()
  if (!c.enabled) return false
  const m = (meta ?? {}) as Record<string, unknown>
  return m.recordMeeting !== false
}
