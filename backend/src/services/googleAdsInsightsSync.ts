// src/services/googleAdsInsightsSync.ts
//
// Sync de métricas do Google Ads para o painel local. Espelha o sync do Meta Ads
// (CampaignCost ← Marketing API insights) usando GAQL em 3 níveis.
//
// Chamado manualmente (POST /sync) ou pelo cron — não roda automático no boot.

import { prisma } from '../lib/prisma.js'
import { getAuthenticatedClient } from '../lib/google.js'

const GOOGLE_ADS_API_BASE = 'https://googleads.googleapis.com/v20'

async function getDeveloperToken(): Promise<string | null> {
  const row = await prisma.setting.findUnique({ where: { key: 'google.ads.developer_token' }, select: { value: true } }).catch(() => null)
  if (!row?.value) return null
  const v = row.value as any
  const raw = typeof v === 'string' ? v : (v?.token || v?.value || '')
  return String(raw).trim() || null
}

async function getLoginCustomerId(): Promise<string | null> {
  const row = await prisma.setting.findUnique({ where: { key: 'google.ads.login_customer_id' }, select: { value: true } }).catch(() => null)
  if (!row?.value) return null
  const v = row.value as any
  const raw = typeof v === 'string' ? v : (v?.id || v?.value || '')
  return String(raw).replace(/\D/g, '') || null
}

function microsToReais(micros: number | string | null | undefined): number {
  if (!micros) return 0
  return Number(micros) / 1_000_000
}

function costKey(level: string, customerId: string, campaignId: string, adGroupId: string | null, adId: string | null, date: string): string {
  if (level === 'campaign') return `campaign:${customerId}:${campaignId}:${date}`
  if (level === 'ad_group') return `ad_group:${customerId}:${campaignId}:${adGroupId}:${date}`
  return `ad:${customerId}:${campaignId}:${adGroupId}:${adId}:${date}`
}

async function callSearchStream(
  customerId: string,
  accessToken: string,
  developerToken: string,
  loginCustomerId: string | null,
  query: string,
): Promise<any[]> {
  const cid = customerId.replace(/\D/g, '')
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    'developer-token': developerToken,
    'Content-Type': 'application/json',
  }
  if (loginCustomerId) headers['login-customer-id'] = loginCustomerId
  // searchStream devolve tudo em chunks num array de "responses" — sem paginação.
  // googleAds:search exigiria pageToken; pra dashboards a stream é mais simples.
  const url = `${GOOGLE_ADS_API_BASE}/customers/${cid}/googleAds:searchStream`
  console.log(`[gAdsSync] POST ${url}  login-customer-id=${loginCustomerId || '(none)'} queryLen=${query.length}`)
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ query }),
  })
  const data = await res.json().catch(() => ({})) as any
  if (!res.ok) {
    const detail = JSON.stringify(data?.error || data).slice(0, 800)
    console.warn(`[gAdsSync] ← ${res.status} ${detail}`)
    const msg = data?.error?.message || `HTTP ${res.status}`
    const errCode = data?.error?.details?.[0]?.errors?.[0]?.errorCode
    const errCodeStr = errCode ? Object.values(errCode).join('=') : ''
    throw new Error(`${msg}${errCodeStr ? ` [${errCodeStr}]` : ''}`)
  }
  // searchStream pode retornar um array de batches OU um único batch
  // (depende do client). Achatar para uma lista de results uniforme.
  const rows: any[] = []
  if (Array.isArray(data)) {
    for (const batch of data) {
      if (Array.isArray(batch?.results)) rows.push(...batch.results)
    }
  } else if (Array.isArray(data?.results)) {
    rows.push(...data.results)
  }
  console.log(`[gAdsSync] ← 200 results=${rows.length}`)
  return rows
}

interface SyncResult {
  level: 'campaign' | 'ad_group' | 'ad'
  rowsUpserted: number
  rowsFromApi: number
  errors: string[]
}

interface SyncSummary {
  customerId: string
  dateRange: { from: string; to: string }
  results: SyncResult[]
  totalUpserted: number
  startedAt: string
  finishedAt: string
}

// Janela default: 30 dias atrás → ontem (Google só consolida ontem em diante)
function defaultDateRange(): { from: string; to: string } {
  const today = new Date()
  const to = new Date(today.getTime() - 24 * 60 * 60 * 1000) // ontem
  const from = new Date(to.getTime() - 29 * 24 * 60 * 60 * 1000) // 30 dias atrás
  const fmt = (d: Date) => d.toISOString().slice(0, 10)
  return { from: fmt(from), to: fmt(to) }
}

const METRIC_FIELDS = [
  'metrics.cost_micros',
  'metrics.impressions',
  'metrics.clicks',
  'metrics.conversions',
  'metrics.conversions_value',
  'metrics.average_cpc',
  'metrics.average_cpm',
  'metrics.ctr',
].join(', ')

const QUERIES = {
  campaign: (from: string, to: string) => `
    SELECT
      campaign.id,
      campaign.name,
      segments.date,
      ${METRIC_FIELDS}
    FROM campaign
    WHERE segments.date BETWEEN '${from}' AND '${to}'
      AND campaign.status != 'REMOVED'
  `,
  ad_group: (from: string, to: string) => `
    SELECT
      campaign.id,
      campaign.name,
      ad_group.id,
      ad_group.name,
      segments.date,
      ${METRIC_FIELDS}
    FROM ad_group
    WHERE segments.date BETWEEN '${from}' AND '${to}'
      AND ad_group.status != 'REMOVED'
  `,
  ad: (from: string, to: string) => `
    SELECT
      campaign.id,
      campaign.name,
      ad_group.id,
      ad_group.name,
      ad_group_ad.ad.id,
      ad_group_ad.ad.name,
      segments.date,
      ${METRIC_FIELDS}
    FROM ad_group_ad
    WHERE segments.date BETWEEN '${from}' AND '${to}'
      AND ad_group_ad.status != 'REMOVED'
  `,
}

async function upsertRow(
  level: 'campaign' | 'ad_group' | 'ad',
  customerId: string,
  campaignId: string,
  campaignName: string,
  adGroupId: string | null,
  adGroupName: string | null,
  adId: string | null,
  adName: string | null,
  date: string,
  metrics: any,
) {
  const key = costKey(level, customerId, campaignId, adGroupId, adId, date)
  const spend = microsToReais(metrics?.costMicros)
  const cpc = microsToReais(metrics?.averageCpc)
  const cpm = microsToReais(metrics?.averageCpm)
  const data = {
    costKey: key,
    level,
    customerId,
    campaignId,
    campaignName: campaignName || campaignId,
    adGroupId,
    adGroupName,
    adId,
    adName,
    date: new Date(date),
    spend,
    impressions: typeof metrics?.impressions === 'number' || typeof metrics?.impressions === 'string' ? Number(metrics.impressions) : null,
    clicks: typeof metrics?.clicks === 'number' || typeof metrics?.clicks === 'string' ? Number(metrics.clicks) : null,
    conversions: metrics?.conversions != null ? Number(metrics.conversions) : null,
    conversionValue: metrics?.conversionsValue != null ? Number(metrics.conversionsValue) : null,
    cpc: cpc || null,
    cpm: cpm || null,
    ctr: metrics?.ctr != null ? Number(metrics.ctr) : null,
    avgPosition: null,
    source: 'google_ads_api',
    raw: metrics,
  }
  await prisma.googleAdsCampaignCost.upsert({
    where: { costKey: key },
    create: data as any,
    update: data as any,
  })
}

/**
 * Sincroniza métricas de uma conta Google Ads para o intervalo informado.
 * Se from/to forem omitidos, usa janela default (últimos 30 dias até ontem).
 */
export async function syncGoogleAdsInsights(
  connectionId: number,
  customerId: string,
  dateFrom?: string,
  dateTo?: string,
): Promise<SyncSummary> {
  const startedAt = new Date().toISOString()
  const developerToken = await getDeveloperToken()
  if (!developerToken) {
    throw new Error('Developer Token não configurado')
  }

  const auth = await getAuthenticatedClient(connectionId)
  const accessToken = (await auth.getAccessToken()).token
  if (!accessToken) throw new Error('OAuth sem access token')

  const loginCustomerId = await getLoginCustomerId()
  const { from, to } = dateFrom && dateTo ? { from: dateFrom, to: dateTo } : defaultDateRange()
  console.log(`[gAdsSync] starting customer=${customerId} from=${from} to=${to} loginCid=${loginCustomerId || '(none)'}`)
  const results: SyncResult[] = []

  for (const level of ['campaign', 'ad_group', 'ad'] as const) {
    const r: SyncResult = { level, rowsUpserted: 0, rowsFromApi: 0, errors: [] }
    try {
      const rows = await callSearchStream(customerId, accessToken, developerToken, loginCustomerId, QUERIES[level](from, to))
      r.rowsFromApi = rows.length
      for (const row of rows) {
        try {
          const campaign = row.campaign || {}
          const adGroup = row.adGroup || {}
          const adGroupAd = row.adGroupAd?.ad || {}
          const segments = row.segments || {}
          const metrics = row.metrics || {}
          const campaignId = String(campaign.id || '')
          if (!campaignId) continue
          const date = String(segments.date || '')
          if (!date) continue
          await upsertRow(
            level,
            customerId,
            campaignId,
            campaign.name || '',
            level !== 'campaign' ? String(adGroup.id || '') : null,
            level !== 'campaign' ? (adGroup.name || null) : null,
            level === 'ad' ? String(adGroupAd.id || '') : null,
            level === 'ad' ? (adGroupAd.name || null) : null,
            date,
            metrics,
          )
          r.rowsUpserted++
        } catch (e: any) {
          r.errors.push(`row error: ${e?.message || e}`)
        }
      }
    } catch (e: any) {
      r.errors.push(e?.message || String(e))
    }
    results.push(r)
  }

  const totalUpserted = results.reduce((s, r) => s + r.rowsUpserted, 0)
  return {
    customerId,
    dateRange: { from, to },
    results,
    totalUpserted,
    startedAt,
    finishedAt: new Date().toISOString(),
  }
}
