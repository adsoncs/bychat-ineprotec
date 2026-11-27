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
  /** Reenvio: usa a MESMA linha e a data original do evento, em vez de criar outro. */
  reenvio?: { id: number; eventTime: Date }
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

// ── Eventos de CRM (Conversion Leads) ────────────
// Setting `capi.crm_events` = true liga o modo CRM da Meta ("leads qualificados"):
//  · um evento por etapa do funil, inclusive a inicial, disparado pela mudança de
//    etapa de QUALQUER origem (tela, chatbot, fluxo, portal) e pela criação do lead;
//  · custom_data.event_source = 'crm' e lead_event_source = `capi.lead_event_source`
//    (padrão 'Attrae'); user_data.lead_id = id do lead do formulário da Meta;
//  · valor só no evento que tem valor de verdade (nota de prioridade não vai).
// Desligado, tudo segue como antes. Severiano, 27/11/2026.
const lerSetting = async (key: string) => {
  const r = await prisma.setting.findUnique({ where: { key } }).catch(() => null)
  return r?.value == null ? '' : String(typeof r.value === 'string' ? r.value : JSON.stringify(r.value)).replace(/^"|"$/g, '').trim()
}
export async function crmLigado(): Promise<boolean> {
  return ['true', '1'].includes((await lerSetting('capi.crm_events')).toLowerCase())
}
/** Id do lead do formulário da Meta (Lead Ads), 15–17 dígitos. */
async function metaLeadIdDo(leadId: number): Promise<string | null> {
  const r = await prisma.metaLeadLog.findFirst({ where: { leadId, status: 'processed' }, orderBy: { id: 'desc' }, select: { metaLeadId: true } }).catch(() => null)
  const id = String(r?.metaLeadId ?? '').trim()
  return /^\d{10,20}$/.test(id) ? id : null
}
// lead_id tem até 17 dígitos: como número em JS perde precisão. Vai no JSON
// como inteiro cru, sem passar por Number.
const MARCA_LEAD_ID = (id: string) => `__LEADID__${id}__`
const corpoDoEnvio = (payload: unknown) => JSON.stringify(payload).replace(/"__LEADID__(\d{10,20})__"/g, '$1')
/** Trava curta contra o mesmo evento sair duas vezes no mesmo instante
 *  (ex.: "ganho" e "Matriculado" juntos geravam 2 Purchase). */
async function primeiraVez(leadId: number, eventName: string): Promise<boolean> {
  try {
    const { redis } = await import('../lib/redis.js')
    return (await redis.set(`capi:once:${leadId}:${eventName}`, '1', 'EX', 300, 'NX')) === 'OK'
  } catch { return true }
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
  // Duas empresas no mesmo ambiente (identidade da unidade): a conversão vai
  // para o pixel da empresa da pessoa; empresa sem pixel próprio e marcada
  // "não enviar" não manda nada; sem identidade, o pixel geral de sempre.
  const { capiDoLead } = await import('../lib/identidadeDaUnidade.js')
  const daEmpresa = await capiDoLead(data.leadId).catch(() => null)
  if (daEmpresa?.desligado) {
    return { success: false, eventId: '', error: 'Empresa da pessoa não envia conversões a este pixel (identidade da unidade)' }
  }
  const geral = await getCapiConfig()
  const config = daEmpresa
    ? { pixelId: daEmpresa.pixelId, accessToken: daEmpresa.accessToken, testEventCode: undefined as string | undefined }
    : geral
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
      priorityScore: true, cloudApiConnectionId: true, uid: true, formData: true,
    }
  })
  if (!lead) {
    return { success: false, eventId: '', error: 'Lead não encontrado' }
  }

  const eventId = data.eventId || generateEventId()
  const eventTime = Math.floor((data.reenvio?.eventTime ?? new Date()).getTime() / 1000)

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
  const crm = await crmLigado()
  if (data.value && data.value > 0) {
    customData.value = data.value
  } else if (!crm && lead.priorityScore != null && data.eventName !== 'Purchase') {
    customData.value = Number(lead.priorityScore.toFixed(2))
    customData.value_source = 'priority_score'
  }
  if (lead.campaignId) customData.campaign_id = lead.campaignId
  if (data.funnelStage) customData.funnel_stage = data.funnelStage
  if (data.customData) Object.assign(customData, data.customData)
  const metaLeadId = crm ? await metaLeadIdDo(lead.id) : null
  if (crm) {
    customData.event_source = 'crm'
    customData.lead_event_source = (await lerSetting('capi.lead_event_source')) || 'Attrae'
    if (metaLeadId) userData.lead_id = MARCA_LEAD_ID(metaLeadId)
  }

  // Evento CAPI
  const event: Record<string, any> = {
    event_name: data.eventName,
    event_time: eventTime,
    event_id: eventId,
    action_source: 'system_generated',
    user_data: userData,
    custom_data: customData,
  }

  // Conversa que veio de anúncio de mensagem: a Meta só liga a venda ao anúncio
  // quando o evento vai como business_messaging, com o id do clique (WhatsApp)
  // ou o id da pessoa na Página/conta (Messenger/Instagram). Se a Meta recusar
  // (dataset não ligado à WABA/Página), o mesmo evento segue como antes.
  const original = { ...event }
  // Lead do formulário da Meta com lead_id: evento de CRM, sempre system_generated.
  const bm = metaLeadId ? null : await camposDeMensagem(lead).catch(() => null)
  if (bm) {
    event.action_source = 'business_messaging'
    event.messaging_channel = bm.canal
    event.user_data = { ...userData, ...bm.userData }
  }

  // Payload
  const payload: Record<string, any> = {
    data: [event],
  }
  if (config.testEventCode) {
    payload.test_event_code = config.testEventCode
  }

  // Salvar registro antes de enviar
  const convRecord = data.reenvio ? { id: data.reenvio.id } : await prisma.conversionEvent.create({
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
    const url = `https://graph.facebook.com/v24.0/${config.pixelId}/events?access_token=${config.accessToken}`
    let resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: corpoDoEnvio(payload),
    })

    let result = await resp.json() as any
    if (!resp.ok && bm) {
      console.warn(`[CAPI] business_messaging recusado (lead ${lead.id}): ${result?.error?.message || resp.status} — reenviando como system_generated`)
      payload.data = [original]
      resp = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: corpoDoEnvio(payload) })
      result = await resp.json() as any
    }

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

/**
 * Dados do evento de mensagem (Conversions API for Business Messaging), só para
 * conversa que veio de anúncio:
 *  - WhatsApp: ctwa_clid + WABA da conexão Cloud API (Evolution não tem WABA).
 *  - Messenger: page_id + page_scoped_user_id; Instagram: ig_account_id + ig_sid.
 */
async function camposDeMensagem(lead: { ctwaClid: string | null; cloudApiConnectionId: number | null; uid: string | null; originType: string | null; formData: unknown }):
  Promise<{ canal: 'whatsapp' | 'messenger' | 'instagram'; userData: Record<string, string> } | null> {
  if (lead.ctwaClid && lead.cloudApiConnectionId) {
    const c = await prisma.cloudApiConnection.findUnique({ where: { id: lead.cloudApiConnectionId }, select: { wabaId: true } })
    if (c?.wabaId) return { canal: 'whatsapp', userData: { whatsapp_business_account_id: c.wabaId, ctwa_clid: lead.ctwaClid } }
  }
  if (lead.originType === 'meta_ctm' && lead.uid) {
    const [canal, contato] = lead.uid.split(':')
    const fd = (lead.formData ?? {}) as Record<string, any>
    const conta = String(fd.instagramPageId || '')
    if (!contato || !conta) return null
    if (canal === 'messenger') return { canal: 'messenger', userData: { page_id: conta, page_scoped_user_id: contato } }
    if (canal === 'instagram' && fd.instagramAccountId) return { canal: 'instagram', userData: { ig_account_id: String(fd.instagramAccountId), ig_sid: contato } }
  }
  return null
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
    const url = `https://graph.facebook.com/v24.0/${input.pixelId}/events?access_token=${encodeURIComponent(input.accessToken)}`
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: corpoDoEnvio(payload),
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
    if (!(await primeiraVez(leadId, 'Purchase'))) return

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
  // "<funilId>:<ETAPA>" vale só naquele funil (a mesma chave NOVO existe em
  // funis de alunos/pais); "<ETAPA>" sozinha, como antes, vale em todos.
  const doFunil = Object.keys(mappings).some((k) => k.includes(':'))
    ? (await prisma.lead.findUnique({ where: { id: leadId }, select: { funnelId: true } }).catch(() => null))?.funnelId
    : null
  const eventName = (doFunil != null ? mappings[`${doFunil}:${newStage}`] : undefined) ?? mappings[newStage]
  if (!eventName) return // Etapa não mapeada

  // Verificar se já enviou este evento para este lead (deduplicação)
  const existing = await prisma.conversionEvent.findFirst({
    where: { leadId, eventName, platform: 'meta_capi', status: 'sent' }
  })
  if (existing) return
  if (!(await primeiraVez(leadId, eventName))) return

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

// A Meta recusa evento com mais de 7 dias, e reenviar como se fosse de agora
// inventaria uma conversão: até 6 dias, com a data e o event_id originais.
//
// Até 05/11/2026 o reenvio criava uma linha nova e nunca tocava na antiga: as 10
// falhas mais antigas voltavam a cada 10 minutos, para sempre. Na beyond isso
// mandou cerca de 64 mil Purchase falsos de um único lead para o pixel.
const JANELA_REENVIO_MS = 6 * 24 * 60 * 60 * 1000

export async function retryFailedEvents(): Promise<number> {
  const failed = await prisma.conversionEvent.findMany({
    where: { status: 'failed', retries: { lt: 3 }, platform: 'meta_capi', createdAt: { gte: new Date(Date.now() - JANELA_REENVIO_MS) } },
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
      eventId: evt.eventId || undefined,
      reenvio: { id: evt.id, eventTime: evt.eventTime },
    })
    // Sem CAPI configurado o envio volta sem tocar na linha: conta a tentativa aqui.
    if (!result.eventId) await prisma.conversionEvent.update({ where: { id: evt.id }, data: { retries: { increment: 1 } } })
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
    // Modo CRM: toda mudança de etapa e todo lead novo passam pelo mapa de
    // etapas. A etapa vem da ficha (o newValue do evento nem sempre é a chave).
    const pelaFicha = (e: any) => {
      if (!e?.leadId) return
      setTimeout(() => {
        crmLigado().then(async (on) => {
          if (!on) return
          const l = await prisma.lead.findUnique({ where: { id: e.leadId }, select: { status: true } }).catch(() => null)
          if (l?.status) await onLeadStageChanged(e.leadId, l.status)
        }).catch(() => {})
      }, 3000)
    }
    eventBus.on('lead.stage_changed', pelaFicha)
    eventBus.on('lead.created', pelaFicha)

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
