// src/services/metaCapi.ts
// Meta Conversions API (CAPI) — Envio server-side de eventos de conversão

import { prisma } from '../lib/prisma.js'
import crypto from 'crypto'

// ── Helpers ──────────────────────────────────────

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value.trim().toLowerCase()).digest('hex')
}

function generateEventId(): string {
  return `evt_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`
}

// ── Tipos ────────────────────────────────────────

interface CapiConfig {
  pixelId: string
  accessToken: string
  testEventCode?: string  // Para teste (não produção)
}

interface CapiEventData {
  leadId: number
  eventName: string        // Lead, Purchase, CompleteRegistration, Subscribe, etc.
  value?: number
  currency?: string
  funnelStage?: string
  customData?: Record<string, any>
  /** event_id externo p/ dedup com o Pixel do browser (mesmo id ⇒ Meta deduplica). */
  eventId?: string
}

// ── Configuração ─────────────────────────────────

export async function getCapiConfig(): Promise<CapiConfig | null> {
  try {
    const [pixelSetting, tokenSetting, testCodeSetting] = await Promise.all([
      prisma.setting.findUnique({ where: { key: 'capi.pixel_id' } }),
      prisma.setting.findUnique({ where: { key: 'capi.access_token' } }),
      prisma.setting.findUnique({ where: { key: 'capi.test_event_code' } }),
    ])

    const pixelId = pixelSetting?.value ? String(pixelSetting.value).replace(/^"|"$/g, '') : ''
    const accessToken = tokenSetting?.value ? String(tokenSetting.value).replace(/^"|"$/g, '') : ''

    if (!pixelId || !accessToken) return null

    return {
      pixelId,
      accessToken,
      testEventCode: testCodeSetting?.value ? String(testCodeSetting.value).replace(/^"|"$/g, '') : undefined,
    }
  } catch {
    return null
  }
}

// ── Mapeamento de Etapas → Eventos ───────────────

export async function getStageEventMappings(): Promise<Record<string, string>> {
  try {
    const setting = await prisma.setting.findUnique({ where: { key: 'capi.stage_mappings' } })
    if (!setting?.value) return {}
    const val = typeof setting.value === 'string' ? setting.value : JSON.stringify(setting.value)
    return JSON.parse(val.replace(/^"|"$/g, ''))
  } catch {
    return {}
  }
}

// ── Envio de Evento ──────────────────────────────

export async function sendCapiEvent(data: CapiEventData): Promise<{ success: boolean; eventId: string; error?: string }> {
  const config = await getCapiConfig()
  if (!config) {
    return { success: false, eventId: '', error: 'CAPI não configurado (pixel_id ou access_token ausente)' }
  }

  const lead = await prisma.lead.findUnique({
    where: { id: data.leadId },
    select: {
      id: true, email: true, whatsapp: true, nome: true,
      cidade: true, customFields: true,
      campaignId: true, ctwaClid: true, gclid: true,
      originType: true, utmSource: true, utmMedium: true, utmCampaign: true,
      priorityScore: true,
    }
  })
  if (!lead) {
    return { success: false, eventId: '', error: 'Lead não encontrado' }
  }

  const eventId = data.eventId || generateEventId()
  const eventTime = Math.floor(Date.now() / 1000)

  // User data (hashed para CAPI). Quanto mais campos, maior o "match quality"
  // que a Meta atribui ao evento — impacta direto na atribuição e otimização.
  const userData: Record<string, any> = {}
  if (lead.email) userData.em = [sha256(lead.email)]
  if (lead.whatsapp) {
    const phone = lead.whatsapp.replace(/\D/g, '')
    if (phone.length >= 10) userData.ph = [sha256(phone)]
  }
  if (lead.nome) {
    const parts = lead.nome.trim().split(/\s+/)
    if (parts[0]) userData.fn = [sha256(parts[0])]
    if (parts.length > 1) userData.ln = [sha256(parts[parts.length - 1])]
  }
  // Advanced matching: cidade e CEP (quando capturados) elevam match quality.
  if (lead.cidade) userData.ct = [sha256(lead.cidade.replace(/\s+/g, '').toLowerCase())]
  const cf = (lead.customFields ?? {}) as Record<string, unknown>
  const cep = typeof cf?.cep === 'string' ? cf.cep.replace(/\D/g, '') : null
  if (cep && cep.length >= 5) userData.zp = [sha256(cep)]
  userData.country = [sha256('br')]
  // external_id permite Meta vincular CAPI server-side com pixel browser quando
  // ambos enviam mesmo lead.id (em hash). Dedup forte por outro caminho que não
  // só o eventId.
  userData.external_id = [sha256(String(lead.id))]
  // _fbc — quando temos ctwaClid (Click-to-WhatsApp da Meta), reconstrói o
  // cookie _fbc no formato esperado pela CAPI: 'fb.<idx>.<ts>.<clid>'. Eleva
  // muito o match quality em campanhas CTWA porque a Meta vincula direto.
  if (lead.ctwaClid) {
    const ts = Date.now()
    userData.fbc = `fb.1.${ts}.${lead.ctwaClid}`
  }

  // Custom data
  const customData: Record<string, any> = {
    currency: data.currency || 'BRL',
  }
  // value: prioriza o explícito, senão usa priorityScore (proxy de "qualidade"
  // do lead — Meta otimiza por valor, então passar 0-100 ajuda a aprender).
  if (data.value && data.value > 0) {
    customData.value = data.value
  } else if (lead.priorityScore != null && data.eventName !== 'Purchase') {
    customData.value = Number(lead.priorityScore.toFixed(2))
    customData.value_source = 'priority_score'
  }
  if (lead.campaignId) customData.campaign_id = lead.campaignId
  if (data.funnelStage) customData.funnel_stage = data.funnelStage
  if (data.customData) Object.assign(customData, data.customData)

  // Evento CAPI
  const event: Record<string, any> = {
    event_name: data.eventName,
    event_time: eventTime,
    event_id: eventId,
    action_source: 'system_generated',
    user_data: userData,
    custom_data: customData,
  }

  // Payload
  const payload: Record<string, any> = {
    data: [event],
  }
  if (config.testEventCode) {
    payload.test_event_code = config.testEventCode
  }

  // Salvar registro antes de enviar
  const convRecord = await prisma.conversionEvent.create({
    data: {
      leadId: data.leadId,
      platform: 'meta_capi',
      eventName: data.eventName,
      eventTime: new Date(),
      value: data.value || null,
      currency: data.currency || 'BRL',
      funnelStage: data.funnelStage || null,
      pixelId: config.pixelId,
      eventId,
      userEmail: lead.email || null,
      userPhone: lead.whatsapp || null,
      userFirstName: lead.nome?.split(/\s+/)[0] || null,
      gclid: lead.gclid || null,
      status: 'pending',
    }
  })

  // Enviar para Meta
  try {
    const url = `https://graph.facebook.com/v19.0/${config.pixelId}/events?access_token=${config.accessToken}`
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })

    const result = await resp.json() as any

    if (resp.ok) {
      await prisma.conversionEvent.update({
        where: { id: convRecord.id },
        data: {
          status: 'sent',
          sentAt: new Date(),
          response: result,
        }
      })
      return { success: true, eventId }
    } else {
      const errorMsg = result?.error?.message || `HTTP ${resp.status}`
      await prisma.conversionEvent.update({
        where: { id: convRecord.id },
        data: {
          status: 'failed',
          errorMessage: errorMsg,
          response: result,
          retries: { increment: 1 },
        }
      })
      return { success: false, eventId, error: errorMsg }
    }
  } catch (err: any) {
    await prisma.conversionEvent.update({
      where: { id: convRecord.id },
      data: {
        status: 'failed',
        errorMessage: err.message,
        retries: { increment: 1 },
      }
    })
    return { success: false, eventId, error: err.message }
  }
}

// ── Envio ad-hoc sem Lead (clique em trackable link) ──
// Usa Pixel ID + Access Token passados diretamente (suporta configuração por link).

export interface CapiClickLeadInput {
  pixelId: string
  accessToken: string
  eventId?: string             // fornecido externamente para dedup com browser pixel
  eventSourceUrl?: string
  fbclid?: string
  clientIp?: string
  clientUserAgent?: string
  contentName?: string         // ex: nome do link/campanha
  contentCategory?: string
  testEventCode?: string
}

export async function fireCapiLeadNoLead(input: CapiClickLeadInput): Promise<{ success: boolean; eventId: string; error?: string }> {
  if (!input.pixelId || !input.accessToken) {
    return { success: false, eventId: '', error: 'pixelId e accessToken obrigatórios' }
  }

  const eventId = input.eventId || generateEventId()
  const eventTime = Math.floor(Date.now() / 1000)

  const userData: Record<string, any> = {}
  if (input.clientIp) userData.client_ip_address = input.clientIp
  if (input.clientUserAgent) userData.client_user_agent = input.clientUserAgent
  if (input.fbclid) userData.fbc = `fb.1.${Date.now()}.${input.fbclid}`
  userData.country = [sha256('br')]

  const customData: Record<string, any> = {}
  if (input.contentName) customData.content_name = input.contentName
  if (input.contentCategory) customData.content_category = input.contentCategory

  const payload: Record<string, any> = {
    data: [{
      event_name: 'Lead',
      event_time: eventTime,
      event_id: eventId,
      action_source: 'website',
      ...(input.eventSourceUrl ? { event_source_url: input.eventSourceUrl } : {}),
      user_data: userData,
      custom_data: customData,
    }],
  }
  if (input.testEventCode) payload.test_event_code = input.testEventCode

  try {
    const url = `https://graph.facebook.com/v19.0/${input.pixelId}/events?access_token=${encodeURIComponent(input.accessToken)}`
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const text = await resp.text().catch(() => '')
    if (!resp.ok) {
      return { success: false, eventId, error: `HTTP ${resp.status}: ${text.slice(0, 300)}` }
    }
    return { success: true, eventId }
  } catch (err: any) {
    return { success: false, eventId, error: err?.message?.slice(0, 300) || 'Unknown error' }
  }
}

// ── Trigger automático ao mudar etapa do funil ──

// Fase 23-G: dispara Purchase no CAPI quando lead é marcado como Ganho.
// Toggle: setting `capi.auto_send_on_lead_won` (default false).
// Dedup pelo mesmo `ConversionEvent.eventName='Purchase'` com platform=meta_capi.
export async function onLeadWonAutoSend(leadId: number, value?: number | null): Promise<void> {
  try {
    const toggle = await prisma.setting.findUnique({ where: { key: 'capi.auto_send_on_lead_won' } })
    const raw = toggle ? (typeof toggle.value === 'string' ? toggle.value : String(toggle.value)) : ''
    const enabled = raw.replace(/^"|"$/g, '').trim().toLowerCase()
    if (enabled !== 'true' && enabled !== '1') return

    const existing = await prisma.conversionEvent.findFirst({
      where: { leadId, eventName: 'Purchase', platform: 'meta_capi', status: 'sent' }
    })
    if (existing) return

    let resolvedValue: number | undefined = value != null ? Number(value) : undefined
    if (resolvedValue == null) {
      const lead = await prisma.lead.findUnique({
        where: { id: leadId },
        select: { saleValue: true },
      })
      if (lead?.saleValue) resolvedValue = Number(lead.saleValue)
    }

    await sendCapiEvent({
      leadId,
      eventName: 'Purchase',
      value: resolvedValue,
      funnelStage: 'lead_won',
    })
  } catch (err: any) {
    console.warn('[CAPI] onLeadWonAutoSend falhou:', err?.message || err)
  }
}

export async function onLeadStageChanged(leadId: number, newStage: string, eventId?: string): Promise<void> {
  const mappings = await getStageEventMappings()
  const eventName = mappings[newStage]
  if (!eventName) return // Etapa não mapeada

  // Verificar se já enviou este evento para este lead (deduplicação)
  const existing = await prisma.conversionEvent.findFirst({
    where: { leadId, eventName, platform: 'meta_capi', status: 'sent' }
  })
  if (existing) return

  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: { saleValue: true }
  })

  await sendCapiEvent({
    leadId,
    eventName,
    value: eventName === 'Purchase' && lead?.saleValue ? Number(lead.saleValue) : undefined,
    funnelStage: newStage,
    // event_id do Pixel (quando veio da página hospedada) p/ a Meta deduplicar.
    ...(eventId ? { eventId } : {}),
  })
}

// ── Retry de eventos falhados ────────────────────

export async function retryFailedEvents(): Promise<number> {
  const failed = await prisma.conversionEvent.findMany({
    where: { status: 'failed', retries: { lt: 3 }, platform: 'meta_capi' },
    take: 10,
    orderBy: { createdAt: 'asc' },
  })

  let retried = 0
  for (const evt of failed) {
    const result = await sendCapiEvent({
      leadId: evt.leadId,
      eventName: evt.eventName,
      value: evt.value ? Number(evt.value) : undefined,
      funnelStage: evt.funnelStage || undefined,
    })
    if (result.success) retried++
    await new Promise(r => setTimeout(r, 1000))
  }
  return retried
}

// Cron interno: roda a cada 10min e reprocessa até 10 falhas. Batch pequeno
// e backoff de 1s entre eventos protege contra rate-limit. Se CAPI não estiver
// configurado, retryFailedEvents retorna 0 e o cron fica inerte.
let capiRetryTimer: NodeJS.Timeout | null = null
const CAPI_RETRY_INTERVAL_MS = 10 * 60_000

export function startCapiRetryScheduler(): void {
  if (capiRetryTimer) return
  capiRetryTimer = setInterval(async () => {
    try {
      const n = await retryFailedEvents()
      if (n > 0) console.log(`[CAPI] Reprocessou ${n} eventos falhados`)
    } catch (err: any) {
      console.warn('[CAPI] Erro no retry scheduler:', err?.message || err)
    }
  }, CAPI_RETRY_INTERVAL_MS)
  console.log(`[CAPI] Retry scheduler iniciado (a cada ${CAPI_RETRY_INTERVAL_MS / 60_000}min)`)

  // Fase 23-G: ouvir lead.won para auto-enviar Purchase quando toggle ativo.
  // Import dinâmico evita ciclo (eventBus → metaCapi → eventBus).
  import('../lib/eventBus.js').then(({ eventBus }) => {
    eventBus.on('lead.won', (e: any) => {
      const value = e?.payload?.metadata?.value
      onLeadWonAutoSend(e.leadId, typeof value === 'number' ? value : null).catch(() => {})
    })

    // "Ao agendar": quando o Tipo de Reunião opta (pixelConfig.fireConversions),
    // dispara conversão na reserva — Meta (etapa do MeetingType, via stage-mapping
    // + dedup) e Google (trigger meeting.scheduled). O MeetingType já moveu o lead
    // de etapa/time no createBooking; aqui só plugamos o pixel. Modelo "por contexto".
    eventBus.on('meeting.scheduled', (e: any) => {
      const mtId = e?.payload?.meetingTypeId
      if (!mtId || !e?.leadId) return
      prisma.meetingType.findUnique({ where: { id: mtId }, select: { pixelConfig: true, stageKey: true } })
        .then((mt) => {
          const pc = (mt?.pixelConfig ?? {}) as any
          if (!pc.fireConversions) return
          if (mt?.stageKey) onLeadStageChanged(e.leadId, mt.stageKey).catch(() => {})
          import('./googleAdsConversions.js')
            .then((m) => m.dispatchConversion('meeting.scheduled', e.leadId, null).catch(() => {}))
            .catch(() => {})
        })
        .catch(() => {})
    })
  }).catch(() => {})
}

export function stopCapiRetryScheduler(): void {
  if (capiRetryTimer) {
    clearInterval(capiRetryTimer)
    capiRetryTimer = null
  }
}
