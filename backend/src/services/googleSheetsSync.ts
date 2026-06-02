// services/googleSheetsSync.ts
// Event-driven Google Sheets sync — listens to domain events and appends rows

import { prisma } from '../lib/prisma.js'
import { eventBus, type DomainEvent } from '../lib/eventBus.js'
import { appendRow } from '../lib/google.js'
import { WEBHOOK_EVENTS, WEBHOOK_EVENT_LABELS } from './webhookDispatcher.js'

export { WEBHOOK_EVENTS as SHEETS_EVENTS, WEBHOOK_EVENT_LABELS as SHEETS_EVENT_LABELS }

// ── In-memory cache of active integrations ────────────
type CachedIntegration = {
  id: number
  connectionId: number
  spreadsheetId: string
  sheetName: string
  events: string[]
  fieldMapping: Array<{ header: string; source: string }>
  includeTimestamp: boolean
}

let cached: CachedIntegration[] = []
let cacheAt = 0
const CACHE_TTL = 60_000

async function getActiveIntegrations(): Promise<CachedIntegration[]> {
  if (Date.now() - cacheAt < CACHE_TTL && cached.length > 0) return cached
  const rows = await prisma.googleSheetIntegration.findMany({
    where: { active: true, connection: { active: true } },
    select: {
      id: true,
      connectionId: true,
      spreadsheetId: true,
      sheetName: true,
      events: true,
      fieldMapping: true,
      includeTimestamp: true,
    },
  })
  cached = rows.map(r => ({
    ...r,
    events: r.events as string[],
    fieldMapping: r.fieldMapping as Array<{ header: string; source: string }>,
  }))
  cacheAt = Date.now()
  return cached
}

export function invalidateGoogleSheetsCache() {
  cacheAt = 0
}

// ── Resolve a field source to a value ─────────────────
function resolveField(source: string, lead: any, event: DomainEvent): string {
  if (source === 'event.type') return event.type
  if (source === 'event.timestamp') return event.timestamp.toISOString()
  if (source.startsWith('event.payload.')) {
    const key = source.replace('event.payload.', '')
    return String(event.payload?.[key] ?? '')
  }
  if (source.startsWith('lead.customFields.')) {
    const key = source.replace('lead.customFields.', '')
    const cf = lead?.customFields as Record<string, any> | null
    return String(cf?.[key] ?? '')
  }
  if (source.startsWith('lead.')) {
    const key = source.replace('lead.', '')
    return String(lead?.[key] ?? '')
  }
  return ''
}

// ── Build row values from field mapping ───────────────
function buildRowValues(integration: CachedIntegration, lead: any, event: DomainEvent): string[] {
  const values = integration.fieldMapping.map(m => resolveField(m.source, lead, event))
  if (integration.includeTimestamp) {
    values.push(new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }))
  }
  return values
}

// ── Dispatch to a single integration ──────────────────
async function dispatchToSheet(
  integration: CachedIntegration,
  event: DomainEvent,
  lead: any,
  attempt: number = 1,
): Promise<void> {
  const startTime = Date.now()
  const values = buildRowValues(integration, lead, event)

  try {
    await appendRow(integration.connectionId, integration.spreadsheetId, integration.sheetName, values)
    const duration = Date.now() - startTime

    // Log success
    prisma.googleSheetLog.create({
      data: {
        integrationId: integration.id,
        event: event.type,
        rowData: values as any,
        success: true,
        duration,
      },
    }).catch(() => {})

    // Update stats
    prisma.googleSheetIntegration.update({
      where: { id: integration.id },
      data: { totalSent: { increment: 1 }, lastSentAt: new Date(), lastError: null },
    }).catch(() => {})

    console.log(`[GoogleSheets] ${event.type} → row appended (${duration}ms)`)
  } catch (err: any) {
    const duration = Date.now() - startTime
    const error = err.message?.substring(0, 500) || 'Unknown error'

    // Log failure
    prisma.googleSheetLog.create({
      data: {
        integrationId: integration.id,
        event: event.type,
        rowData: values as any,
        success: false,
        error,
        duration,
      },
    }).catch(() => {})

    prisma.googleSheetIntegration.update({
      where: { id: integration.id },
      data: { totalFailed: { increment: 1 }, lastError: error },
    }).catch(() => {})

    // Retry with exponential backoff (max 3 attempts)
    if (attempt < 3) {
      const delay = Math.min(1000 * Math.pow(2, attempt), 30_000)
      console.warn(`[GoogleSheets] FAIL attempt ${attempt}/3: ${error} — retrying in ${delay}ms`)
      setTimeout(() => dispatchToSheet(integration, event, lead, attempt + 1), delay)
    } else {
      console.error(`[GoogleSheets] FAILED after 3 attempts: ${error}`)
    }
  }
}

// ── Main event handler ────────────────────────────────
async function onDomainEvent(event: DomainEvent): Promise<void> {
  try {
    const integrations = await getActiveIntegrations()
    if (integrations.length === 0) return

    const matched = integrations.filter(i => i.events.includes(event.type) || i.events.includes('*'))
    if (matched.length === 0) return

    // Fetch lead data once for all integrations
    const lead = await prisma.lead.findUnique({
      where: { id: event.leadId },
      select: {
        id: true, uid: true, nome: true, empresa: true, whatsapp: true,
        email: true, segmento: true, cidade: true, status: true,
        funnelId: true, source: true, saleDetected: true, saleValue: true,
        customFields: true, createdAt: true, updatedAt: true,
      },
    })

    for (const integration of matched) {
      dispatchToSheet(integration, event, lead).catch(err => {
        console.error(`[GoogleSheets] Dispatch error:`, err)
      })
    }
  } catch (err) {
    console.error('[GoogleSheets] Sync error:', err)
  }
}

// ── Start ─────────────────────────────────────────────
export function startGoogleSheetsSync(): void {
  eventBus.on('*', (event: DomainEvent) => {
    onDomainEvent(event)
  })
  console.log('[GoogleSheets] Sync started — listening for domain events')
}

// ── Test: send a dummy row ────────────────────────────
export async function testGoogleSheetIntegration(integrationId: number): Promise<{ success: boolean; error?: string; duration?: number }> {
  const integration = await prisma.googleSheetIntegration.findUnique({
    where: { id: integrationId },
    include: { connection: { select: { active: true } } },
  })
  if (!integration) throw new Error('Integracao nao encontrada')
  if (!integration.connection.active) throw new Error('Conexao Google inativa')

  const mapping = integration.fieldMapping as Array<{ header: string; source: string }>
  const testValues = mapping.map(m => `[teste] ${m.header}`)
  if (integration.includeTimestamp) {
    testValues.push(new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }))
  }

  const startTime = Date.now()
  try {
    await appendRow(integration.connectionId, integration.spreadsheetId, integration.sheetName, testValues)
    const duration = Date.now() - startTime

    prisma.googleSheetLog.create({
      data: { integrationId, event: 'test.ping', rowData: testValues as any, success: true, duration },
    }).catch(() => {})

    return { success: true, duration }
  } catch (err: any) {
    const duration = Date.now() - startTime
    const error = err.message?.substring(0, 300) || 'Unknown error'
    return { success: false, error, duration }
  }
}
