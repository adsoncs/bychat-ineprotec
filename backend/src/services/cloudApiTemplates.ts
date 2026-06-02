// src/services/cloudApiTemplates.ts
// Ciclo de vida dos templates HSM da WhatsApp Cloud API.
//
// Antes deste módulo o status local ficava congelado no que veio na criação
// (quase sempre PENDING): o webhook só tratava `messages` e não havia
// reconciliação. Aqui centralizamos:
//   1. upsert a partir do payload REST (getTemplates) — usado por sync manual,
//      reconexão e cron;
//   2. tratamento do webhook `message_template_status_update` (tempo real);
//   3. detecção de mudança de status → log + broadcast (notificação in-app);
//   4. scheduler de reconciliação (rede de segurança caso um webhook se perca).
//
// Os campos statusReason/qualityScore/statusUpdatedAt foram adicionados na
// migration 0077.

import { prisma } from '../lib/prisma.js'
import { decryptToken, getTemplates } from './cloudApi.js'
import { broadcastRealtimeEvent } from '../routes/realtime.js'

// ─── Estados (espelham a Meta) ──────────────────────────
// https://developers.facebook.com/docs/whatsapp/business-management-api/message-templates
export const TEMPLATE_STATUSES = [
  'APPROVED', 'PENDING', 'REJECTED', 'PAUSED', 'DISABLED',
  'IN_APPEAL', 'PENDING_DELETION', 'DELETED', 'FLAGGED', 'LIMIT_EXCEEDED',
] as const
export type TemplateStatus = (typeof TEMPLATE_STATUSES)[number]

// Único estado do qual se pode enviar. Centralizado para que rota de envio,
// UI e relatórios concordem (cloudApiSetup.ts:639 usava string literal solta).
export function isSendableStatus(status: string): boolean {
  return status === 'APPROVED'
}

// ─── Normalização de um item REST do Meta ───────────────
interface NormalizedTemplate {
  metaTemplateId: string
  name: string
  language: string
  category: string
  status: string
  statusReason: string | null
  qualityScore: string | null
}

function normalizeMetaTemplate(t: any): NormalizedTemplate {
  const reason = t.rejected_reason && t.rejected_reason !== 'NONE' ? String(t.rejected_reason) : null
  const quality =
    typeof t.quality_score === 'object' ? (t.quality_score?.score ?? null)
    : typeof t.quality_score === 'string' ? t.quality_score
    : null
  return {
    metaTemplateId: t.id || '',
    name: t.name,
    language: t.language,
    category: t.category || 'UTILITY',
    status: (t.status || 'UNKNOWN').toUpperCase(),
    statusReason: reason,
    qualityScore: quality,
  }
}

// ─── Upsert + detecção de mudança ───────────────────────
// Retorna o status anterior (null se template novo) para que o chamador decida
// se notifica. Dispara o efeito colateral de notificação aqui mesmo quando o
// status muda, para que TODA origem (sync, webhook, cron) notifique de forma
// consistente.
async function upsertAndDetect(
  wabaId: string,
  n: NormalizedTemplate,
  components: any,
): Promise<{ prevStatus: string | null; status: string; changed: boolean }> {
  const existing = await prisma.cloudApiTemplate.findUnique({
    where: { wabaId_name_language: { wabaId, name: n.name, language: n.language } },
    select: { status: true },
  })
  const prevStatus = existing?.status ?? null
  const changed = prevStatus !== null && prevStatus !== n.status

  const data: any = {
    metaTemplateId: n.metaTemplateId,
    category: n.category,
    status: n.status,
    statusReason: n.statusReason,
    lastSyncAt: new Date(),
  }
  if (n.qualityScore !== null) data.qualityScore = n.qualityScore
  if (components !== undefined) data.components = components
  // statusUpdatedAt só avança quando o status realmente muda (ou na 1ª vez).
  if (prevStatus === null || changed) data.statusUpdatedAt = new Date()

  await prisma.cloudApiTemplate.upsert({
    where: { wabaId_name_language: { wabaId, name: n.name, language: n.language } },
    update: data,
    create: {
      wabaId,
      metaTemplateId: n.metaTemplateId,
      name: n.name,
      language: n.language,
      category: n.category,
      status: n.status,
      statusReason: n.statusReason,
      qualityScore: n.qualityScore,
      statusUpdatedAt: new Date(),
      components: components ?? [],
    },
  })

  if (changed) {
    await notifyStatusChange(wabaId, n, prevStatus!).catch(() => {})
  }
  return { prevStatus, status: n.status, changed }
}

// ─── Notificação de mudança de status ───────────────────
// Não existe modelo Notification genérico no schema; o padrão do projeto é
// emitir um evento realtime (toast no painel). Sem scope → todos os operadores
// conectados recebem (templates são recurso da empresa, não de um lead).
async function notifyStatusChange(wabaId: string, n: NormalizedTemplate, prevStatus: string) {
  const emoji = n.status === 'APPROVED' ? '✅' : n.status === 'REJECTED' ? '❌' : n.status === 'PAUSED' ? '⏸️' : 'ℹ️'
  console.log(`[CloudAPI/templates] ${emoji} "${n.name}" (${n.language}): ${prevStatus} → ${n.status}${n.statusReason ? ` [${n.statusReason}]` : ''}`)
  await broadcastRealtimeEvent({
    type: 'cloudapi:template_status',
    payload: {
      wabaId,
      name: n.name,
      language: n.language,
      prevStatus,
      status: n.status,
      statusReason: n.statusReason,
      category: n.category,
    },
  })
}

// ─── Sync REST de uma conexão (sync manual / reconexão / cron) ──
export async function syncTemplatesFromMeta(wabaId: string, token: string): Promise<number> {
  const templates = await getTemplates(wabaId, token)
  let count = 0
  for (const t of templates) {
    const n = normalizeMetaTemplate(t)
    if (!n.name || !n.language) continue
    await upsertAndDetect(wabaId, n, t.components ?? undefined)
    count++
  }
  return count
}

// ─── Reconciliação de todas as conexões ativas (cron) ───
export async function reconcileAllTemplates(): Promise<number> {
  const conns = await prisma.cloudApiConnection.findMany({ where: { active: true } })
  let total = 0
  for (const conn of conns) {
    try {
      const token = decryptToken(conn.systemUserToken)
      total += await syncTemplatesFromMeta(conn.wabaId, token)
    } catch (err: any) {
      console.error(`[CloudAPI/templates] reconcile falhou (waba=${conn.wabaId}): ${err.message}`)
    }
  }
  return total
}

// ─── Webhook: message_template_status_update (tempo real) ──
// Payload (change.value):
//   { event: 'APPROVED'|'REJECTED'|'PAUSED'|..., message_template_id,
//     message_template_name, message_template_language, reason, ... }
export async function handleTemplateStatusWebhook(wabaId: string, value: any): Promise<void> {
  const name = value.message_template_name
  const language = value.message_template_language
  const event = String(value.event || '').toUpperCase()
  if (!name || !language || !event) return

  const reason = value.reason && String(value.reason).toUpperCase() !== 'NONE' ? String(value.reason) : null

  const existing = await prisma.cloudApiTemplate.findUnique({
    where: { wabaId_name_language: { wabaId, name, language } },
    select: { status: true },
  })
  const prevStatus = existing?.status ?? null

  await prisma.cloudApiTemplate.upsert({
    where: { wabaId_name_language: { wabaId, name, language } },
    update: { status: event, statusReason: reason, statusUpdatedAt: new Date(), lastSyncAt: new Date() },
    create: {
      wabaId,
      metaTemplateId: String(value.message_template_id || ''),
      name,
      language,
      category: 'UTILITY',
      status: event,
      statusReason: reason,
      statusUpdatedAt: new Date(),
      components: [],
    },
  })

  if (prevStatus !== event) {
    await notifyStatusChange(wabaId, {
      metaTemplateId: String(value.message_template_id || ''),
      name, language, category: 'UTILITY', status: event, statusReason: reason, qualityScore: null,
    }, prevStatus ?? '—').catch(() => {})
  }
}

// ─── Webhook: message_template_quality_update ───────────
export async function handleTemplateQualityWebhook(wabaId: string, value: any): Promise<void> {
  const name = value.message_template_name
  const language = value.message_template_language
  if (!name || !language) return
  const quality = value.new_quality_score || value.quality_score
  if (!quality) return
  await prisma.cloudApiTemplate.updateMany({
    where: { wabaId, name, language },
    data: { qualityScore: String(quality).toUpperCase(), lastSyncAt: new Date() },
  })
}

// ─── Scheduler de reconciliação ─────────────────────────
const INTERVAL_MS = 30 * 60 * 1000 // 30min
let _handle: ReturnType<typeof setInterval> | null = null

export function startCloudApiTemplateScheduler(): void {
  if (_handle) return
  console.log('[CloudAPI/templates] scheduler de reconciliação iniciado (cada 30min)')
  _handle = setInterval(() => {
    reconcileAllTemplates()
      .then((n) => { if (n) console.log(`[CloudAPI/templates] reconciliados ${n} template(s)`) })
      .catch((e) => console.error('[CloudAPI/templates] reconcile erro:', (e as any)?.message ?? e))
  }, INTERVAL_MS)
}

export function stopCloudApiTemplateScheduler(): void {
  if (_handle) { clearInterval(_handle); _handle = null }
}
