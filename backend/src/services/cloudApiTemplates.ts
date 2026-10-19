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
  /** Detalhes do sync REST. `undefined` = a origem (webhook) não informa: não sobrescreve. */
  detalhes?: {
    metaUpdatedAt: Date | null
    qualityScoreAt: Date | null
    parameterFormat: string | null
    previousCategory: string | null
    subCategory: string | null
    messageSendTtlSeconds: number | null
    libraryTemplateName: string | null
  }
}

/** Data da Meta: ISO (`2026-08-20T12:31:02+0000`) ou epoch em segundos. */
function dataDaMeta(v: unknown): Date | null {
  if (v === null || v === undefined || v === '') return null
  const d = typeof v === 'number' ? new Date(v * 1000) : new Date(String(v).replace(/([+-]\d{2})(\d{2})$/, '$1:$2'))
  return Number.isNaN(d.getTime()) ? null : d
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
    detalhes: {
      metaUpdatedAt: dataDaMeta(t.last_updated_time),
      qualityScoreAt: typeof t.quality_score === 'object' ? dataDaMeta(t.quality_score?.date) : null,
      parameterFormat: t.parameter_format ? String(t.parameter_format) : null,
      previousCategory: t.previous_category ? String(t.previous_category) : null,
      subCategory: t.sub_category ? String(t.sub_category) : null,
      messageSendTtlSeconds: t.message_send_ttl_seconds != null && Number.isFinite(Number(t.message_send_ttl_seconds)) ? Number(t.message_send_ttl_seconds) : null,
      libraryTemplateName: t.library_template_name ? String(t.library_template_name) : null,
    },
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
  if (n.detalhes) Object.assign(data, n.detalhes)
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
      ...(n.detalhes ?? {}),
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

// ─── Uso de cada modelo (lista da tela de Modelos) ──────
export interface UsoDoModelo {
  enviadas: number
  entregues: number // delivered + read: lida também foi entregue
  lidas: number
  falhas: number
  primeiroEnvio: Date | null
  ultimoEnvio: Date | null
}

/**
 * Uso de cada modelo, pelo log de envios da Cloud API (CloudApiMessageLog).
 *
 * O log guarda o nome do modelo e a conexão, não o id: o nome só é único dentro
 * da conta (WABA), então a conexão diz de qual conta é. Envio antigo sem
 * conexão gravada só conta se o nome existir em uma única conta — atribuir a
 * duas seria contar o mesmo envio duas vezes.
 */
export async function usoDosModelos(
  templates: Array<{ id: number; wabaId: string; name: string }>,
): Promise<Map<number, UsoDoModelo>> {
  const uso = new Map<number, UsoDoModelo>()
  if (!templates.length) return uso
  const nomes = [...new Set(templates.map((t) => t.name))]
  const [linhas, conns] = await Promise.all([
    prisma.cloudApiMessageLog.groupBy({
      by: ['cloudApiConnectionId', 'templateName', 'status'],
      where: { direction: 'outbound', templateName: { in: nomes } },
      _count: { _all: true },
      _min: { createdAt: true },
      _max: { createdAt: true },
    }),
    prisma.cloudApiConnection.findMany({ select: { id: true, wabaId: true } }),
  ])
  const wabaDaConexao = new Map(conns.map((c) => [c.id, c.wabaId]))
  const porChave = new Map(templates.map((t) => [`${t.wabaId}|${t.name}`, t.id]))
  const contasDoNome = new Map<string, number[]>()
  for (const t of templates) contasDoNome.set(t.name, [...(contasDoNome.get(t.name) ?? []), t.id])

  for (const l of linhas) {
    const nome = l.templateName ?? ''
    const waba = l.cloudApiConnectionId != null ? wabaDaConexao.get(l.cloudApiConnectionId) : undefined
    const id = waba ? porChave.get(`${waba}|${nome}`)
      : (contasDoNome.get(nome)?.length === 1 ? contasDoNome.get(nome)![0] : undefined)
    if (id === undefined) continue
    const u = uso.get(id) ?? { enviadas: 0, entregues: 0, lidas: 0, falhas: 0, primeiroEnvio: null, ultimoEnvio: null }
    const n = l._count._all
    u.enviadas += n
    if (l.status === 'delivered' || l.status === 'read') u.entregues += n
    if (l.status === 'read') u.lidas += n
    if (l.status === 'failed') u.falhas += n
    const min = l._min.createdAt, max = l._max.createdAt
    if (min && (!u.primeiroEnvio || min < u.primeiroEnvio)) u.primeiroEnvio = min
    if (max && (!u.ultimoEnvio || max > u.ultimoEnvio)) u.ultimoEnvio = max
    uso.set(id, u)
  }
  return uso
}

// ─── Data de criação de cada modelo ─────────────────────
export interface CriacaoDoModelo {
  data: Date
  /** false = o modelo já existia quando o vimos: `data` é "criado antes de". */
  exata: boolean
}

/**
 * A Meta não informa quando o modelo foi criado — só a última edição
 * (`last_updated_time`). O `createdAt` local é quando o sistema VIU o modelo:
 * vale como criação para o que nasceu depois de a conta ser conectada (pelo
 * painel, ou pelo WhatsApp Manager e trazido pelo webhook/sync), mas não para o
 * que já existia e veio no primeiro lote da sincronização.
 *
 * Já existia quando: entrou no primeiro lote da conta (2+ modelos no mesmo
 * minuto da primeira sincronização), ou a última edição na Meta é anterior à
 * data em que o vimos. Aí a data mostrada é a mais antiga conhecida, como
 * limite: "criado antes de".
 */
export function criacaoDosModelos(
  templates: Array<{ id: number; wabaId: string; createdAt: Date; metaUpdatedAt: Date | null }>,
): Map<number, CriacaoDoModelo> {
  const LOTE_MS = 2 * 60_000
  const FOLGA_MS = 60 * 60_000
  const primeiro = new Map<string, number>()
  for (const t of templates) {
    const v = t.createdAt.getTime()
    if (v < (primeiro.get(t.wabaId) ?? Infinity)) primeiro.set(t.wabaId, v)
  }
  const noLote = (t: { wabaId: string; createdAt: Date }) => t.createdAt.getTime() - primeiro.get(t.wabaId)! <= LOTE_MS
  const tamanhoDoLote = new Map<string, number>()
  for (const t of templates) if (noLote(t)) tamanhoDoLote.set(t.wabaId, (tamanhoDoLote.get(t.wabaId) ?? 0) + 1)

  const r = new Map<number, CriacaoDoModelo>()
  for (const t of templates) {
    const visto = t.createdAt.getTime()
    const editado = t.metaUpdatedAt?.getTime() ?? null
    const jaExistia = (noLote(t) && (tamanhoDoLote.get(t.wabaId) ?? 0) > 1)
      || (editado !== null && editado + FOLGA_MS < visto)
    r.set(t.id, { data: new Date(Math.min(visto, editado ?? visto)), exata: !jaExistia })
  }
  return r
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
