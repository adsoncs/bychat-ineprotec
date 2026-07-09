// src/services/googleAdsConversions.ts
//
// Envio de conversões offline ao Google Ads roteado por trigger interno.
//
// Fluxo:
//   1. eventBus.on('<trigger>') dispara `dispatchConversion(trigger, leadId)`
//   2. Para cada GoogleAdsConfig ativo, procura row em GoogleAdsConversionMap
//      com (configId, trigger) e enabled=true
//   3. Calcula valor conforme valueSource ('zero' | 'sale_value' | 'fixed')
//   4. POST customers/{id}:uploadClickConversions
//   5. Incrementa totalSent/totalFailed na row do map
//
// `autoSendConversions` na config global continua sendo o KILL SWITCH master —
// se estiver falso, NADA é enviado automaticamente (envio manual via UI ainda funciona).

import { prisma } from '../lib/prisma.js'
import { eventBus } from '../lib/eventBus.js'
import { getAuthenticatedClient } from '../lib/google.js'

import { GOOGLE_ADS_API_BASE } from '../lib/googleAdsApi.js'

// Triggers suportados — manter alinhado com SUPPORTED_TRIGGERS em routes/googleAds.ts
export const GOOGLE_ADS_TRIGGERS = [
  'lead.won',
  'lead_qualified',
  'meeting.scheduled',
  'enrollment.payment_confirmed',
  'diagnosis.completed',
] as const

export type GoogleAdsTrigger = (typeof GOOGLE_ADS_TRIGGERS)[number]

export const TRIGGER_LABELS: Record<GoogleAdsTrigger, string> = {
  'lead.won':                    'Venda confirmada',
  'lead_qualified':              'Lead qualificado',
  'meeting.scheduled':           'Reunião agendada',
  'enrollment.payment_confirmed':'Pagamento confirmado (matrícula)',
  'diagnosis.completed':         'Diagnóstico/chatbot concluído',
}

async function getDeveloperToken(): Promise<string | null> {
  const row = await prisma.setting.findUnique({ where: { key: 'google.ads.developer_token' }, select: { value: true } }).catch(() => null)
  if (!row?.value) return null
  const v = row.value as any
  const raw = typeof v === 'string' ? v : (v?.token || v?.value || '')
  return String(raw).trim() || null
}

function computeValue(valueSource: string, fixedValue: number | null, saleValue: number | null): number {
  if (valueSource === 'sale_value') return Number(saleValue || 0)
  if (valueSource === 'fixed') return Number(fixedValue || 0)
  return 0
}

/**
 * Despacha conversão para todos os configs ativos que mapearam o trigger.
 * Silencioso em caso de erro: sempre incrementa contadores no map e loga.
 */
export async function dispatchConversion(trigger: GoogleAdsTrigger, leadId: number, hintValue?: number | null): Promise<void> {
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: { id: true, gclid: true, saleValue: true },
  }).catch(() => null)
  if (!lead?.gclid) return // sem GCLID não há o que reportar pro Google Ads

  const configs = await prisma.googleAdsConfig.findMany({
    where: { active: true, autoSendConversions: true },
    include: {
      conversionMap: { where: { trigger, enabled: true } },
    },
  })
  if (configs.length === 0) return

  const developerToken = await getDeveloperToken()
  if (!developerToken) {
    console.warn(`[googleAdsConversions] developer token ausente — pulando trigger=${trigger} lead=${leadId}`)
    return
  }

  for (const config of configs) {
    const mapping = config.conversionMap[0]
    if (!mapping) continue

    const value = computeValue(
      mapping.valueSource,
      mapping.fixedValue,
      typeof hintValue === 'number' ? hintValue : (lead.saleValue != null ? Number(lead.saleValue) : null),
    )

    try {
      const auth = await getAuthenticatedClient(config.connectionId)
      const accessToken = (await auth.getAccessToken()).token
      if (!accessToken) throw new Error('OAuth sem access token')

      const payload = {
        conversions: [{
          gclid: lead.gclid,
          conversionAction: `customers/${config.customerId}/conversionActions/${mapping.conversionAction}`,
          conversionDateTime: new Date().toISOString().replace('T', ' ').replace('Z', '+00:00'),
          conversionValue: value,
          currencyCode: 'BRL',
        }],
        partialFailure: true,
      }

      const resp = await fetch(
        `${GOOGLE_ADS_API_BASE}/customers/${config.customerId}:uploadClickConversions`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            'developer-token': developerToken,
          },
          body: JSON.stringify(payload),
        },
      )

      if (resp.ok) {
        await prisma.googleAdsConversionMap.update({
          where: { id: mapping.id },
          data: { totalSent: { increment: 1 }, lastSentAt: new Date() },
        })
        await prisma.googleAdsConfig.update({
          where: { id: config.id },
          data: { totalSent: { increment: 1 }, lastSentAt: new Date() },
        })
        console.log(`[googleAdsConversions] OK trigger=${trigger} lead=${leadId} value=${value} ca=${mapping.conversionAction}`)
      } else {
        const body = await resp.text().catch(() => '')
        await prisma.googleAdsConversionMap.update({
          where: { id: mapping.id },
          data: { totalFailed: { increment: 1 } },
        })
        await prisma.googleAdsConfig.update({
          where: { id: config.id },
          data: { totalFailed: { increment: 1 } },
        })
        console.warn(`[googleAdsConversions] FAIL trigger=${trigger} lead=${leadId} status=${resp.status} ${body.slice(0, 200)}`)
      }
    } catch (err: any) {
      await prisma.googleAdsConversionMap.update({
        where: { id: mapping.id },
        data: { totalFailed: { increment: 1 } },
      }).catch(() => {})
      console.warn(`[googleAdsConversions] EXCEPTION trigger=${trigger} lead=${leadId}:`, err?.message || err)
    }
  }
}

let started = false

export function startGoogleAdsConversionDispatcher(): void {
  if (started) return
  started = true

  eventBus.on('lead.won', (e: any) => {
    const v = e?.payload?.metadata?.value
    dispatchConversion('lead.won', e.leadId, typeof v === 'number' ? v : null).catch(() => {})
  })

  eventBus.on('lead_qualified', (e: any) => {
    dispatchConversion('lead_qualified', e.leadId, null).catch(() => {})
  })

  eventBus.on('enrollment.payment_confirmed', (e: any) => {
    const v = e?.payload?.value ?? e?.payload?.amount
    dispatchConversion('enrollment.payment_confirmed', e.leadId, typeof v === 'number' ? v : null).catch(() => {})
  })

  eventBus.on('diagnosis.completed', (e: any) => {
    dispatchConversion('diagnosis.completed', e.leadId, null).catch(() => {})
  })

  console.log('[googleAdsConversions] dispatcher iniciado — escutando 4 triggers')
}
