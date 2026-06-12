// services/webhookDispatcher.ts
// Outbound webhook dispatcher — listens to domain events and fires registered webhooks

import crypto from 'crypto'
import { prisma } from '../lib/prisma.js'
import { eventBus, type DomainEvent } from '../lib/eventBus.js'
import { assertUrlIsPublic } from '../lib/urlSafety.js'

// ── Available events for webhook subscription ──────────
export const WEBHOOK_EVENTS = [
  'lead.created',
  'lead.stage_changed',
  'lead.tag_added',
  'lead.tag_removed',
  'lead.assigned',
  'lead.closed',
  'lead.reopened',
  'lead.funnel_changed',
  'lead.won',
  'lead.lost',
  'lead.outcome_cleared',
  'message.received',
  'message.sent',
  'sale.detected',
  'activity.completed',
  'diagnosis.completed',
  'inactivity.detected',
  'inactivity.closed',
  'trackable_link.click',
  'enrichment.completed',
  'enrichment.failed',
  'loss_reason.spike',
] as const

export type WebhookEventType = (typeof WEBHOOK_EVENTS)[number]

export const WEBHOOK_EVENT_LABELS: Record<string, string> = {
  'lead.created': 'Lead criado',
  'lead.stage_changed': 'Etapa alterada',
  'lead.tag_added': 'Tag adicionada',
  'lead.tag_removed': 'Tag removida',
  'lead.assigned': 'Operador atribuido',
  'lead.closed': 'Lead fechado',
  'lead.reopened': 'Lead reaberto',
  'lead.funnel_changed': 'Funil alterado',
  'lead.won': 'Lead ganho',
  'lead.lost': 'Lead perdido',
  'lead.outcome_cleared': 'Lead reclassificado (em andamento)',
  'message.received': 'Mensagem recebida',
  'message.sent': 'Mensagem enviada',
  'sale.detected': 'Venda detectada',
  'activity.completed': 'Atividade concluida',
  'diagnosis.completed': 'Diagnostico concluido',
  'inactivity.detected': 'Inatividade detectada',
  'inactivity.closed': 'Fechado por inatividade',
  'trackable_link.click': 'Clique em link rastreável',
  'enrichment.completed': 'Enriquecimento concluído',
  'enrichment.failed': 'Enriquecimento falhou',
  'loss_reason.spike': 'Pico de objeção detectado',
}

// ── In-memory webhook cache (refresh every 60s) ────────
let cachedWebhooks: Array<{
  id: number
  url: string
  secret: string | null
  events: string[]
  headers: Record<string, string> | null
  maxRetries: number
  timeoutMs: number
}> = []

let cacheAt = 0
const CACHE_TTL = 60_000

async function getActiveWebhooks() {
  if (Date.now() - cacheAt < CACHE_TTL && cachedWebhooks.length > 0) {
    return cachedWebhooks
  }
  const rows = await prisma.outboundWebhook.findMany({
    where: { active: true },
    select: {
      id: true,
      url: true,
      secret: true,
      events: true,
      headers: true,
      maxRetries: true,
      timeoutMs: true,
    },
  })
  cachedWebhooks = rows.map(r => ({
    ...r,
    events: r.events as string[],
    headers: r.headers as Record<string, string> | null,
  }))
  cacheAt = Date.now()
  return cachedWebhooks
}

export function invalidateWebhookCache() {
  cacheAt = 0
}

// Dispara um evento "standalone" (sem lead associado) para todos os webhooks inscritos.
// Usado por trackable_link.click e outros eventos que nascem fora do ciclo de vida do lead.
export async function dispatchStandaloneEvent(eventType: string, data: Record<string, any>): Promise<void> {
  try {
    const webhooks = await getActiveWebhooks()
    if (webhooks.length === 0) return
    const matched = webhooks.filter(w => w.events.includes(eventType) || w.events.includes('*'))
    if (matched.length === 0) return

    const event: DomainEvent = {
      type: eventType,
      leadId: 0,
      payload: data,
      timestamp: new Date(),
    }
    const payload = {
      event: eventType,
      timestamp: event.timestamp.toISOString(),
      data,
    }
    for (const webhook of matched) {
      dispatchWebhook(webhook, event, payload).catch(err => {
        console.error(`[Webhook] Standalone dispatch error for ${webhook.url}:`, err)
      })
    }
  } catch (err) {
    console.error('[Webhook] Standalone dispatcher error:', err)
  }
}

// ── HMAC signature ─────────────────────────────────────
function signPayload(payload: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex')
}

// ── Build webhook payload from domain event ────────────
async function buildPayload(event: DomainEvent) {
  const lead = await prisma.lead.findUnique({
    where: { id: event.leadId },
    select: {
      id: true,
      uid: true,
      nome: true,
      empresa: true,
      whatsapp: true,
      email: true,
      segmento: true,
      cidade: true,
      status: true,
      funnelId: true,
      source: true,
      saleDetected: true,
      saleValue: true,
      customFields: true,
      createdAt: true,
      updatedAt: true,
    },
  })

  return {
    event: event.type,
    timestamp: event.timestamp.toISOString(),
    lead: lead || { id: event.leadId },
    data: event.payload || {},
  }
}

// ── Dispatch a single webhook ──────────────────────────
async function dispatchWebhook(
  webhook: (typeof cachedWebhooks)[number],
  event: DomainEvent,
  payload: any,
  attempt: number = 1,
): Promise<void> {
  const bodyStr = JSON.stringify(payload)
  const startTime = Date.now()

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': 'ByChat-Webhook/1.0',
    'X-Webhook-Event': event.type,
    'X-Webhook-Timestamp': event.timestamp.toISOString(),
    ...(webhook.headers || {}),
  }

  if (webhook.secret) {
    headers['X-Webhook-Signature'] = `sha256=${signPayload(bodyStr, webhook.secret)}`
  }

  let statusCode: number | null = null
  let responseText = ''
  let success = false
  let error: string | null = null

  try {
    // Revalida a URL no momento do disparo (anti DNS-rebinding/TOCTOU): a URL
    // foi validada na criação, mas o DNS pode ter mudado para um IP interno.
    const pub = await assertUrlIsPublic(webhook.url)
    if (!pub.ok) {
      throw new Error(`URL bloqueada por segurança: ${pub.reason}`)
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), webhook.timeoutMs)

    const resp = await fetch(webhook.url, {
      method: 'POST',
      headers,
      body: bodyStr,
      signal: controller.signal,
    })

    clearTimeout(timeout)
    statusCode = resp.status
    responseText = await resp.text().catch(() => '')
    success = resp.ok

    if (!success) {
      error = `HTTP ${statusCode}: ${responseText.substring(0, 300)}`
    }
  } catch (err: any) {
    error = err.name === 'AbortError'
      ? `Timeout (${webhook.timeoutMs}ms)`
      : err.message?.substring(0, 300) || 'Unknown error'
  }

  const duration = Date.now() - startTime

  // Log
  prisma.webhookLog.create({
    data: {
      webhookId: webhook.id,
      event: event.type,
      url: webhook.url,
      statusCode,
      duration,
      requestBody: payload,
      response: responseText.substring(0, 2000),
      error,
      success,
      attempt,
    },
  }).catch(() => {})

  // Update webhook stats
  prisma.outboundWebhook.update({
    where: { id: webhook.id },
    data: {
      totalSent: { increment: 1 },
      ...(success
        ? { lastSentAt: new Date(), lastError: null }
        : { totalFailed: { increment: 1 }, lastError: error }),
    },
  }).catch(() => {})

  // Retry on failure
  if (!success && attempt < webhook.maxRetries) {
    const delay = Math.min(1000 * Math.pow(2, attempt), 60_000) // exponential backoff max 60s
    setTimeout(() => {
      dispatchWebhook(webhook, event, payload, attempt + 1)
    }, delay)
  }

  if (success) {
    console.log(`[Webhook] ${event.type} → ${webhook.url} (${duration}ms, ${statusCode})`)
  } else {
    console.warn(`[Webhook] FAIL ${event.type} → ${webhook.url} (attempt ${attempt}/${webhook.maxRetries}): ${error}`)
  }
}

// ── Main dispatcher (called on domain events) ─────────
async function onDomainEvent(event: DomainEvent): Promise<void> {
  try {
    const webhooks = await getActiveWebhooks()
    if (webhooks.length === 0) return

    // Filter webhooks subscribed to this event
    const matched = webhooks.filter(w => w.events.includes(event.type) || w.events.includes('*'))
    if (matched.length === 0) return

    const payload = await buildPayload(event)

    for (const webhook of matched) {
      // Fire-and-forget (non-blocking)
      dispatchWebhook(webhook, event, payload).catch(err => {
        console.error(`[Webhook] Dispatch error for ${webhook.url}:`, err)
      })
    }
  } catch (err) {
    console.error('[Webhook] Dispatcher error:', err)
  }
}

// ── Start the dispatcher ───────────────────────────────
export function startWebhookDispatcher(): void {
  eventBus.on('*', (event: DomainEvent) => {
    onDomainEvent(event)
  })
  console.log('[Webhook] Outbound dispatcher started — listening for domain events')
}

// ── Test webhook (sends a test event) ──────────────────
export async function testWebhook(webhookId: number): Promise<{ success: boolean; statusCode?: number; error?: string; duration?: number }> {
  const wh = await prisma.outboundWebhook.findUnique({ where: { id: webhookId } })
  if (!wh) throw new Error('Webhook nao encontrado')

  const testPayload = {
    event: 'test.ping',
    timestamp: new Date().toISOString(),
    lead: {
      id: 0,
      nome: 'Teste',
      empresa: 'ByChat Beyond',
      whatsapp: '5500000000000',
      email: 'test@example.com',
      status: 'NOVO',
    },
    data: { message: 'Este e um evento de teste do ByChat Beyond' },
  }

  const bodyStr = JSON.stringify(testPayload)
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': 'ByChat-Webhook/1.0',
    'X-Webhook-Event': 'test.ping',
    'X-Webhook-Timestamp': testPayload.timestamp,
    ...((wh.headers as any) || {}),
  }

  if (wh.secret) {
    headers['X-Webhook-Signature'] = `sha256=${signPayload(bodyStr, wh.secret)}`
  }

  const startTime = Date.now()
  try {
    const pub = await assertUrlIsPublic(wh.url)
    if (!pub.ok) throw new Error(`URL bloqueada por segurança: ${pub.reason}`)
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), wh.timeoutMs)
    const resp = await fetch(wh.url, { method: 'POST', headers, body: bodyStr, signal: controller.signal })
    clearTimeout(timeout)

    const duration = Date.now() - startTime
    const responseText = await resp.text().catch(() => '')

    prisma.webhookLog.create({
      data: {
        webhookId: wh.id,
        event: 'test.ping',
        url: wh.url,
        statusCode: resp.status,
        duration,
        requestBody: testPayload,
        response: responseText.substring(0, 2000),
        success: resp.ok,
        attempt: 1,
      },
    }).catch(() => {})

    return { success: resp.ok, statusCode: resp.status, duration }
  } catch (err: any) {
    const duration = Date.now() - startTime
    const error = err.name === 'AbortError' ? `Timeout (${wh.timeoutMs}ms)` : err.message
    return { success: false, error, duration }
  }
}
