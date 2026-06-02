// src/services/broadcast.ts
// Disparo em massa (broadcast) via WhatsApp Cloud API.
//
// Envio proativo, em massa, usando template HSM aprovado (fora da janela de 24h
// só template é permitido pela Meta). Audiência vem de leads do sistema ou de
// planilha importada. Cada destinatário é 1 job na fila wf-broadcast; um
// scheduler dispara campanhas agendadas. Métricas via webhook (ligado por wamid).
//
// Compliance (decisão do produto): respeita opt-out (Lead.optOutChannels inclui
// 'whatsapp') e remove duplicados; NÃO aplica frequency cap (campanha é intencional).

import { Worker } from 'bullmq'
import { prisma } from '../lib/prisma.js'
import { queues, redisConnection } from '../lib/queues.js'
import { decryptToken, normalizePhone } from './cloudApi.js'
import { CloudApiProvider } from './whatsappProvider.js'
import { recordOutbound, getPricingTable, estimateCost } from './cloudApiBilling.js'
import { recordSend, markSendSent, markSendFailed } from './outboundSendTracking.js'

// ─── Variáveis de template (espelha o front WhatsappSend.tsx) ──
const PH = /\{\{\s*([^}]*?)\s*\}\}/g
function classifyToken(t: string): 'numeric' | 'named' | null {
  if (/^\d+$/.test(t)) return 'numeric'
  if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(t)) return 'named'
  return null
}
function varsFromText(text: string, comp: 'header' | 'body'): string[] {
  const out: string[] = []; const seen = new Set<string>()
  let m: RegExpExecArray | null; PH.lastIndex = 0
  while ((m = PH.exec(text)) !== null) {
    const tok = (m[1] ?? '').trim()
    if (classifyToken(tok) === null) continue
    const key = `${comp}:${tok}`
    if (!seen.has(key)) { seen.add(key); out.push(key) }
  }
  return out
}

/** Extrai as chaves de variáveis ("body:1","header:nome") de um template. */
export function extractTemplateVariables(components: unknown): { keys: string[]; named: boolean } {
  const keys: string[] = []
  if (Array.isArray(components)) {
    for (const c of components as any[]) {
      const type = String(c?.type || '').toUpperCase()
      if (type === 'HEADER' && c.format === 'TEXT' && typeof c.text === 'string') keys.push(...varsFromText(c.text, 'header'))
      else if (type === 'BODY' && typeof c.text === 'string') keys.push(...varsFromText(c.text, 'body'))
    }
  }
  const named = keys.some((k) => { const tok = k.split(':')[1] || ''; return tok !== '' && !/^\d+$/.test(tok) })
  return { keys, named }
}

/** Monta os components de ENVIO (Meta) a partir das variáveis resolvidas. */
function buildSendComponents(variables: Record<string, string>): unknown[] {
  const groups: Record<'header' | 'body', Array<{ token: string; value: string }>> = { header: [], body: [] }
  for (const [key, value] of Object.entries(variables)) {
    const [comp, token] = [key.split(':')[0], key.split(':').slice(1).join(':')]
    if (comp === 'header' || comp === 'body') groups[comp].push({ token, value })
  }
  const comps: unknown[] = []
  for (const comp of ['header', 'body'] as const) {
    const list = groups[comp]
    if (!list.length) continue
    const named = list.some((f) => f.token !== '' && !/^\d+$/.test(f.token))
    const allNumeric = list.every((f) => /^\d+$/.test(f.token))
    const ordered = allNumeric ? [...list].sort((a, b) => Number(a.token) - Number(b.token)) : list
    comps.push({
      type: comp,
      parameters: ordered.map((f) => {
        const p: Record<string, unknown> = { type: 'text', text: f.value || '' }
        if (named && f.token) p.parameter_name = f.token
        return p
      }),
    })
  }
  return comps
}

// ─── Resolução de variáveis por destinatário ───────────
type VarMapping = Record<string, { type: 'lead_field' | 'column' | 'fixed'; value: string }>

function leadFieldValue(lead: any, field: string): string {
  if (field in lead && typeof lead[field] !== 'object') return String(lead[field] ?? '')
  const cf = (lead.customFields || {}) as Record<string, unknown>
  return cf[field] != null ? String(cf[field]) : ''
}

function resolveVarsForLead(lead: any, mapping: VarMapping, keys: string[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const k of keys) {
    const m = mapping[k]
    if (!m) { out[k] = ''; continue }
    out[k] = m.type === 'fixed' ? m.value : m.type === 'lead_field' ? leadFieldValue(lead, m.value) : ''
  }
  return out
}

function resolveVarsForRow(row: Record<string, string>, mapping: VarMapping, keys: string[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const k of keys) {
    const m = mapping[k]
    if (!m) { out[k] = ''; continue }
    out[k] = m.type === 'fixed' ? m.value : m.type === 'column' ? (row[m.value] ?? '') : ''
  }
  return out
}

// ─── Telefone / opt-out / dedup ─────────────────────────
function brDigits(raw: string): string {
  const d = normalizePhone(raw || '')
  if (d.length === 10 || d.length === 11) return `55${d}`
  return d
}
function validPhone(d: string): boolean { return d.length >= 12 && d.length <= 15 }

async function optedOutPhones(phones: string[]): Promise<Set<string>> {
  // leads com 'whatsapp' em optOutChannels cujos últimos 8 dígitos batem
  const out = new Set<string>()
  if (!phones.length) return out
  const leads = await prisma.lead.findMany({
    where: { optOutChannels: { not: null as any } },
    select: { whatsapp: true, optOutChannels: true },
  })
  const blocked = new Set<string>()
  for (const l of leads) {
    const ch = Array.isArray(l.optOutChannels) ? (l.optOutChannels as string[]) : []
    if (ch.includes('whatsapp') && l.whatsapp) blocked.add(normalizePhone(l.whatsapp).slice(-8))
  }
  for (const p of phones) if (blocked.has(p.slice(-8))) out.add(p)
  return out
}

// ─── Criação de destinatários (audiência) ───────────────
const MAX_RECIPIENTS = 50_000

export async function buildRecipientsFromLeads(campaign: any, leads: any[]): Promise<{ created: number; skipped: number }> {
  const { keys } = extractTemplateVariables(await templateComponents(campaign.templateId))
  const mapping = (campaign.variableMapping || {}) as VarMapping
  const seen = new Set<string>()
  const phones: string[] = []
  const prepared: any[] = []
  for (const lead of leads) {
    const phone = brDigits(lead.whatsapp || '')
    if (!validPhone(phone)) { prepared.push({ leadId: lead.id, phone: phone || '(inválido)', name: lead.nome, skipReason: 'invalid_phone' }); continue }
    if (seen.has(phone)) { prepared.push({ leadId: lead.id, phone, name: lead.nome, skipReason: 'duplicate' }); continue }
    seen.add(phone); phones.push(phone)
    prepared.push({ leadId: lead.id, phone, name: lead.nome, variables: resolveVarsForLead(lead, mapping, keys) })
  }
  const optedOut = await optedOutPhones(phones)
  return persistRecipients(campaign.id, prepared.map((r) => optedOut.has(r.phone) ? { ...r, skipReason: 'opt_out' } : r))
}

export async function buildRecipientsFromRows(campaign: any, rows: Record<string, string>[], phoneColumn: string, nameColumn?: string): Promise<{ created: number; skipped: number }> {
  const { keys } = extractTemplateVariables(await templateComponents(campaign.templateId))
  const mapping = (campaign.variableMapping || {}) as VarMapping
  const seen = new Set<string>()
  const phones: string[] = []
  const prepared: any[] = []
  for (const row of rows) {
    const phone = brDigits(row[phoneColumn] || '')
    const name = nameColumn ? row[nameColumn] : undefined
    if (!validPhone(phone)) { prepared.push({ phone: phone || '(inválido)', name, skipReason: 'invalid_phone' }); continue }
    if (seen.has(phone)) { prepared.push({ phone, name, skipReason: 'duplicate' }); continue }
    seen.add(phone); phones.push(phone)
    prepared.push({ phone, name, variables: resolveVarsForRow(row, mapping, keys) })
  }
  const optedOut = await optedOutPhones(phones)
  return persistRecipients(campaign.id, prepared.map((r) => optedOut.has(r.phone) ? { ...r, skipReason: 'opt_out' } : r))
}

async function templateComponents(templateId: number): Promise<unknown> {
  const t = await prisma.cloudApiTemplate.findUnique({ where: { id: templateId }, select: { components: true } })
  return t?.components ?? []
}

async function persistRecipients(campaignId: number, prepared: any[]): Promise<{ created: number; skipped: number }> {
  // limpa destinatários antigos (re-resolução de audiência num draft)
  await prisma.broadcastRecipient.deleteMany({ where: { campaignId } })
  const limited = prepared.slice(0, MAX_RECIPIENTS)
  let created = 0, skipped = 0
  for (let i = 0; i < limited.length; i += 500) {
    const chunk = limited.slice(i, i + 500)
    await prisma.broadcastRecipient.createMany({
      data: chunk.map((r) => ({
        campaignId, leadId: r.leadId ?? null, phone: r.phone, name: r.name ?? null,
        variables: r.variables ?? {}, status: r.skipReason ? 'skipped' : 'pending',
        skipReason: r.skipReason ?? null,
      })),
    })
    for (const r of chunk) r.skipReason ? skipped++ : created++
  }
  await prisma.broadcastCampaign.update({
    where: { id: campaignId },
    data: { totalRecipients: created, skippedCount: skipped },
  })
  return { created, skipped }
}

// ─── Custo estimado ─────────────────────────────────────
export async function estimateCampaignCost(category: string, recipients: number): Promise<number> {
  const table = await getPricingTable()
  const billable = category.toLowerCase() !== 'service'
  const unit = estimateCost(category, billable, table)
  return Math.round(unit * recipients * 1e6) / 1e6
}

// ─── Início / agendamento / fila ────────────────────────
export async function startCampaign(campaignId: number): Promise<void> {
  const campaign = await prisma.broadcastCampaign.findUnique({ where: { id: campaignId } })
  if (!campaign) throw new Error('Campanha não encontrada')
  await prisma.broadcastCampaign.update({ where: { id: campaignId }, data: { status: 'running', startedAt: campaign.startedAt ?? new Date() } })
  await enqueuePending(campaignId)
}

async function enqueuePending(campaignId: number): Promise<void> {
  const pending = await prisma.broadcastRecipient.findMany({ where: { campaignId, status: 'pending' }, select: { id: true } })
  for (const r of pending) {
    await queues.broadcast.add('send', { recipientId: r.id, campaignId }, { attempts: 2, backoff: { type: 'exponential', delay: 8000 } })
    await prisma.broadcastRecipient.update({ where: { id: r.id }, data: { status: 'queued', queuedAt: new Date() } })
  }
}

export async function pauseCampaign(id: number) { await prisma.broadcastCampaign.update({ where: { id }, data: { status: 'paused' } }) }
export async function resumeCampaign(id: number) {
  await prisma.broadcastCampaign.update({ where: { id }, data: { status: 'running' } })
  await enqueuePending(id)
}
export async function cancelCampaign(id: number) {
  await prisma.broadcastCampaign.update({ where: { id }, data: { status: 'canceled', completedAt: new Date() } })
  await prisma.broadcastRecipient.updateMany({ where: { campaignId: id, status: { in: ['pending', 'queued'] } }, data: { status: 'skipped', skipReason: 'canceled' } })
}

// ─── Worker ─────────────────────────────────────────────
let _worker: Worker | null = null

function createBroadcastWorker(): Worker {
  return new Worker('wf-broadcast', async (job) => {
    const { recipientId } = job.data
    const rec = await prisma.broadcastRecipient.findUnique({ where: { id: recipientId } })
    if (!rec || rec.status === 'skipped') return
    const campaign = await prisma.broadcastCampaign.findUnique({ where: { id: rec.campaignId } })
    if (!campaign) return

    // Pausada/cancelada → devolve à fila lógica (pending) sem enviar.
    if (campaign.status !== 'running') {
      await prisma.broadcastRecipient.update({ where: { id: rec.id }, data: { status: 'pending', queuedAt: null } })
      return
    }

    const conn = await prisma.cloudApiConnection.findUnique({ where: { id: campaign.cloudApiConnectionId } })
    if (!conn || !conn.active) throw new Error('Conexão Cloud API inativa')

    const provider = new CloudApiProvider(conn.phoneNumberId, conn.systemUserToken)
    const components = buildSendComponents((rec.variables || {}) as Record<string, string>)

    const tracked = await recordSend({
      channel: 'whatsapp', queueName: 'wf-broadcast', jobId: job.id ? String(job.id) : null,
      leadId: rec.leadId, recipient: rec.phone, bodyPreview: `[broadcast] ${campaign.templateName}`,
      attempts: job.attemptsMade + 1, maxAttempts: job.opts?.attempts ?? null, source: 'broadcast', sourceId: campaign.id,
    })
    try {
      const result = await provider.sendTemplate(rec.phone, campaign.templateName, campaign.templateLanguage, components)
      await markSendSent(tracked.id, tracked.startedAt, { externalId: result.messageId })
      await recordOutbound({ wamid: result.messageId, connectionId: conn.id, leadId: rec.leadId, templateName: campaign.templateName })
      await prisma.broadcastRecipient.update({ where: { id: rec.id }, data: { status: 'sent', wamid: result.messageId, sentAt: new Date(), error: null } })
      await prisma.broadcastCampaign.update({ where: { id: campaign.id }, data: { sentCount: { increment: 1 } } })
    } catch (err: any) {
      await markSendFailed(tracked.id, tracked.startedAt, { error: String(err.message) })
      // só marca failed definitivo quando esgota retries
      if (job.attemptsMade + 1 >= (job.opts?.attempts ?? 1)) {
        await prisma.broadcastRecipient.update({ where: { id: rec.id }, data: { status: 'failed', failedAt: new Date(), error: String(err.message).substring(0, 500) } })
        await prisma.broadcastCampaign.update({ where: { id: campaign.id }, data: { failedCount: { increment: 1 } } })
      }
      throw err
    }
    await maybeComplete(campaign.id)
  }, {
    connection: redisConnection,
    concurrency: 3,
    // Throttle conservador para proteger a qualidade do número (1/s).
    limiter: { max: 60, duration: 60_000 },
  })
}

async function maybeComplete(campaignId: number): Promise<void> {
  const remaining = await prisma.broadcastRecipient.count({ where: { campaignId, status: { in: ['pending', 'queued'] } } })
  if (remaining === 0) {
    await prisma.broadcastCampaign.updateMany({ where: { id: campaignId, status: 'running' }, data: { status: 'completed', completedAt: new Date() } })
  }
}

// Atualiza recipient quando o webhook de status chega (ligado por wamid).
export async function applyStatusToBroadcast(wamid: string, status: string): Promise<void> {
  if (!wamid) return
  const map: Record<string, any> = {
    delivered: { status: 'delivered', deliveredAt: new Date() },
    read: { status: 'read', readAt: new Date() },
  }
  const data = map[status]
  if (!data) return
  await prisma.broadcastRecipient.updateMany({ where: { wamid }, data }).catch(() => {})
}

// ─── Scheduler de campanhas agendadas ───────────────────
const INTERVAL_MS = 30_000
let _handle: ReturnType<typeof setInterval> | null = null

async function tick(): Promise<void> {
  const due = await prisma.broadcastCampaign.findMany({
    where: { status: 'scheduled', scheduledAt: { lte: new Date() } },
    select: { id: true },
  })
  for (const c of due) {
    await startCampaign(c.id).catch((e) => console.error(`[broadcast] start ${c.id} falhou:`, e?.message ?? e))
  }
}

export function startBroadcastWorker(): void {
  if (!_worker) _worker = createBroadcastWorker()
  if (_handle) return
  console.log('[broadcast] worker + scheduler iniciados (tick 30s)')
  _handle = setInterval(() => { tick().catch((e) => console.error('[broadcast] tick erro:', e?.message ?? e)) }, INTERVAL_MS)
}
