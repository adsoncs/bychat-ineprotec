// services/ga4Sync.ts
// Google Analytics 4 Measurement Protocol — send CRM events server-side

import { prisma } from '../lib/prisma.js'
import { eventBus, type DomainEvent } from '../lib/eventBus.js'

const GA4_URL = 'https://www.google-analytics.com/mp/collect'

// Map CRM events to GA4 event names
const EVENT_MAP: Record<string, string> = {
  'lead.created': 'generate_lead',
  'lead.stage_changed': 'lead_stage_changed',
  'lead.assigned': 'lead_assigned',
  'lead.closed': 'lead_closed',
  'sale.detected': 'purchase',
  'message.received': 'message_received',
  'message.sent': 'message_sent',
  'activity.completed': 'activity_completed',
  'diagnosis.completed': 'diagnosis_completed',
}

export const GA4_AVAILABLE_EVENTS = Object.entries(EVENT_MAP).map(([crm, ga4]) => ({
  crmEvent: crm, ga4Event: ga4,
}))

// ── Cache of active configs ───────────────────────────
let cached: Array<{ id: number; measurementId: string; apiSecret: string; events: string[] }> = []
let cacheAt = 0

async function getActiveConfigs() {
  if (Date.now() - cacheAt < 60_000 && cached.length > 0) return cached
  const rows = await prisma.gA4Config.findMany({
    where: { active: true },
    select: { id: true, measurementId: true, apiSecret: true, events: true },
  })
  cached = rows.map(r => ({ ...r, events: r.events as string[] }))
  cacheAt = Date.now()
  return cached
}

export function invalidateGA4Cache() { cacheAt = 0 }

// ── Send event to GA4 ────────────────────────────────
async function sendToGA4(config: (typeof cached)[number], event: DomainEvent, lead: any): Promise<void> {
  const ga4Event = EVENT_MAP[event.type]
  if (!ga4Event) return

  const clientId = lead?.uid || `lead_${event.leadId}`

  const payload = {
    client_id: clientId,
    events: [{
      name: ga4Event,
      params: {
        crm_event: event.type,
        lead_id: event.leadId,
        lead_name: lead?.nome || '',
        lead_source: lead?.source || '',
        lead_status: lead?.status || '',
        ...(event.type === 'sale.detected' ? {
          value: lead?.saleValue || 0,
          currency: 'BRL',
        } : {}),
        ...(event.payload || {}),
      },
    }],
  }

  try {
    const url = `${GA4_URL}?measurement_id=${config.measurementId}&api_secret=${config.apiSecret}`
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })

    if (resp.ok || resp.status === 204) {
      prisma.gA4Config.update({
        where: { id: config.id },
        data: { totalSent: { increment: 1 }, lastSentAt: new Date() },
      }).catch(() => {})
      console.log(`[GA4] ${event.type} → ${ga4Event} sent`)
    } else {
      const text = await resp.text().catch(() => '')
      prisma.gA4Config.update({
        where: { id: config.id },
        data: { totalFailed: { increment: 1 } },
      }).catch(() => {})
      console.warn(`[GA4] FAIL ${ga4Event}: HTTP ${resp.status} ${text.substring(0, 200)}`)
    }
  } catch (err: any) {
    prisma.gA4Config.update({
      where: { id: config.id },
      data: { totalFailed: { increment: 1 } },
    }).catch(() => {})
    console.error(`[GA4] Error sending ${ga4Event}:`, err.message)
  }
}

// ── Main event handler ────────────────────────────────
async function onDomainEvent(event: DomainEvent): Promise<void> {
  try {
    const configs = await getActiveConfigs()
    if (configs.length === 0) return

    const matched = configs.filter(c => c.events.includes(event.type) || c.events.includes('*'))
    if (matched.length === 0) return

    const lead = await prisma.lead.findUnique({
      where: { id: event.leadId },
      select: { uid: true, nome: true, source: true, status: true, saleValue: true },
    })

    for (const config of matched) {
      sendToGA4(config, event, lead).catch(() => {})
    }
  } catch (err) {
    console.error('[GA4] Sync error:', err)
  }
}

export function startGA4Sync(): void {
  eventBus.on('*', (event: DomainEvent) => { onDomainEvent(event) })
  console.log('[GA4] Measurement Protocol sync started')
}
