// src/services/googleAdsClickEnrich.ts
//
// Enriquecimento server-side de leads do Google Ads a partir do gclid.
// Espelha o "fetch único" da Meta (que já traz nomes de campanha/adset/anúncio),
// mas para o Google os nomes NÃO vêm no clique — resolvemos consultando o recurso
// `click_view` da Google Ads API (GAQL), que devolve campanha/grupo/keyword do gclid.
//
// Restrições do click_view (Google): a consulta é por UM dia (segments.date) e só
// cobre os últimos ~90 dias. Como não sabemos o dia exato do clique, tentamos o dia
// de criação do lead e o dia anterior.
//
// Fontes combinam: o que o ValueTrack já preencheu (IDs/keyword/matchtype/rede) é
// preservado; o enriquecimento SÓ preenche o que estiver vazio (principalmente os
// NOMES de campanha/grupo, que o ValueTrack não fornece).

import { prisma } from '../lib/prisma.js'
import { getAuthenticatedClient } from '../lib/google.js'

import { GOOGLE_ADS_API_BASE as API_BASE } from '../lib/googleAdsApi.js'
const MAX_LOOKBACK_DAYS = 90

async function getSetting(key: string): Promise<string | null> {
  const row = await prisma.setting.findUnique({ where: { key }, select: { value: true } }).catch(() => null)
  if (!row?.value) return null
  const v = row.value as any
  const raw = typeof v === 'string' ? v : (v?.token || v?.id || v?.value || '')
  return String(raw).trim() || null
}

interface AdsCtx { customerId: string; accessToken: string; developerToken: string; loginCustomerId: string | null }

async function resolveAdsContext(): Promise<AdsCtx | null> {
  const cfg = await prisma.googleAdsConfig.findFirst({
    where: { active: true },
    select: { connectionId: true, customerId: true },
  })
  if (!cfg?.connectionId || !cfg.customerId) return null
  const developerToken = await getSetting('google.ads.developer_token')
  if (!developerToken) return null
  const loginRaw = await getSetting('google.ads.login_customer_id')
  const loginCustomerId = loginRaw ? loginRaw.replace(/\D/g, '') : null
  try {
    const auth = await getAuthenticatedClient(cfg.connectionId)
    const accessToken = (await auth.getAccessToken()).token
    if (!accessToken) return null
    return { customerId: cfg.customerId.replace(/\D/g, ''), accessToken, developerToken, loginCustomerId }
  } catch {
    return null
  }
}

async function gaqlSearch(ctx: AdsCtx, query: string): Promise<any[]> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${ctx.accessToken}`,
    'developer-token': ctx.developerToken,
    'Content-Type': 'application/json',
  }
  if (ctx.loginCustomerId) headers['login-customer-id'] = ctx.loginCustomerId
  const res = await fetch(`${API_BASE}/customers/${ctx.customerId}/googleAds:searchStream`, {
    method: 'POST', headers, body: JSON.stringify({ query }),
  })
  const data = await res.json().catch(() => ({})) as any
  if (!res.ok) {
    const msg = data?.error?.message || `HTTP ${res.status}`
    throw new Error(String(msg).slice(0, 200))
  }
  const rows: any[] = []
  if (Array.isArray(data)) { for (const b of data) if (Array.isArray(b?.results)) rows.push(...b.results) }
  else if (Array.isArray(data?.results)) rows.push(...data.results)
  return rows
}

function fmtDate(d: Date): string { return d.toISOString().slice(0, 10) }

// Mapeia o enum de match type do Google para um rótulo curto.
function matchLabel(mt: any): string | null {
  const s = String(mt || '').toUpperCase()
  if (s === 'EXACT') return 'exata'
  if (s === 'PHRASE') return 'frase'
  if (s === 'BROAD') return 'ampla'
  return null
}

interface EnrichResult {
  googleCampaignId?: string; googleCampaignName?: string
  googleAdGroupId?: string; googleAdGroupName?: string
  googleKeyword?: string; googleMatchType?: string
}

async function lookupGclid(ctx: AdsCtx, gclid: string, date: string): Promise<EnrichResult | null> {
  const q = `
    SELECT click_view.gclid, campaign.id, campaign.name, ad_group.id, ad_group.name,
           click_view.keyword_info.text, click_view.keyword_info.match_type
    FROM click_view
    WHERE segments.date = '${date}' AND click_view.gclid = '${gclid.replace(/'/g, '')}'`
  const rows = await gaqlSearch(ctx, q)
  if (!rows.length) return null
  const r = rows[0]
  const kw = r?.clickView?.keywordInfo
  return {
    googleCampaignId: r?.campaign?.id ? String(r.campaign.id) : undefined,
    googleCampaignName: r?.campaign?.name || undefined,
    googleAdGroupId: r?.adGroup?.id ? String(r.adGroup.id) : undefined,
    googleAdGroupName: r?.adGroup?.name || undefined,
    googleKeyword: kw?.text || undefined,
    googleMatchType: matchLabel(kw?.matchType) || undefined,
  }
}

/**
 * Enriquece UM lead a partir do gclid. Idempotente: sai cedo se já enriquecido ou
 * sem gclid. Só preenche colunas vazias (preserva o que o ValueTrack trouxe).
 */
export async function enrichLeadFromGclid(leadId: number, ctxIn?: AdsCtx | null): Promise<boolean> {
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: {
      id: true, gclid: true, createdAt: true, googleEnrichedAt: true,
      googleCampaignId: true, googleCampaignName: true, googleAdGroupId: true,
      googleAdGroupName: true, googleKeyword: true, googleMatchType: true,
    },
  })
  if (!lead || !lead.gclid) return false
  if (lead.googleEnrichedAt) return false // já tentado
  const ageDays = (Date.now() - new Date(lead.createdAt).getTime()) / 86_400_000
  if (ageDays > MAX_LOOKBACK_DAYS) return false // fora da janela do click_view

  const ctx = ctxIn ?? (await resolveAdsContext())
  if (!ctx) return false

  // Tenta o dia da criação e o dia anterior (o clique pode ter sido na véspera / fuso).
  const d0 = new Date(lead.createdAt)
  const dates = [fmtDate(d0), fmtDate(new Date(d0.getTime() - 86_400_000))]
  let found: EnrichResult | null = null
  for (const date of dates) {
    try {
      found = await lookupGclid(ctx, lead.gclid, date)
      if (found) break
    } catch (e: any) {
      console.warn(`[gAdsEnrich] lead #${leadId} lookup ${date} falhou: ${e?.message}`)
      // Erro de API (token/permissão): não marca como enriquecido p/ retentar depois.
      return false
    }
  }

  // Marca a tentativa mesmo sem achar (evita reconsultar infinitamente um gclid velho).
  const data: any = { googleEnrichedAt: new Date() }
  if (found) {
    // Só preenche o que está vazio (ValueTrack tem precedência).
    if (!lead.googleCampaignId && found.googleCampaignId) data.googleCampaignId = found.googleCampaignId
    if (!lead.googleCampaignName && found.googleCampaignName) data.googleCampaignName = found.googleCampaignName.slice(0, 191)
    if (!lead.googleAdGroupId && found.googleAdGroupId) data.googleAdGroupId = found.googleAdGroupId
    if (!lead.googleAdGroupName && found.googleAdGroupName) data.googleAdGroupName = found.googleAdGroupName.slice(0, 191)
    if (!lead.googleKeyword && found.googleKeyword) data.googleKeyword = found.googleKeyword.slice(0, 255)
    if (!lead.googleMatchType && found.googleMatchType) data.googleMatchType = found.googleMatchType
    // Garante originType coerente quando o clique é confirmado no Google.
    data.originType = 'google_ads'
  }
  await prisma.lead.update({ where: { id: leadId }, data })
  if (found) console.log(`[gAdsEnrich] lead #${leadId} enriquecido: campanha="${data.googleCampaignName || found.googleCampaignId}" keyword="${found.googleKeyword || '–'}"`)
  return !!found
}

/**
 * Varre leads com gclid ainda não enriquecidos (últimos 90 dias) e enriquece em lote.
 * Reusa um único contexto de auth por rodada.
 */
export async function sweepPendingGoogleEnrichment(limit = 20): Promise<number> {
  const since = new Date(Date.now() - MAX_LOOKBACK_DAYS * 86_400_000)
  const pend = await prisma.lead.findMany({
    where: { gclid: { not: null }, googleEnrichedAt: null, createdAt: { gte: since } },
    select: { id: true },
    orderBy: { createdAt: 'desc' },
    take: limit,
  })
  if (!pend.length) return 0
  const ctx = await resolveAdsContext()
  if (!ctx) return 0 // Google Ads não configurado — tenta na próxima
  let n = 0
  for (const l of pend) {
    try { if (await enrichLeadFromGclid(l.id, ctx)) n++ } catch { /* segue */ }
  }
  if (n > 0) console.log(`[gAdsEnrich] sweep enriqueceu ${n}/${pend.length} lead(s)`)
  return n
}

let _timer: ReturnType<typeof setInterval> | null = null
let _running = false

/** Scheduler no boot: varre a cada 3 min. */
export function startGoogleAdsEnrichment(): void {
  if (_timer) return
  _timer = setInterval(async () => {
    if (_running) return
    _running = true
    try { await sweepPendingGoogleEnrichment() }
    catch (e: any) { console.warn('[gAdsEnrich] sweep falhou:', e?.message) }
    finally { _running = false }
  }, 3 * 60_000)
  if (typeof _timer.unref === 'function') _timer.unref()
  console.log('[gAdsEnrich] enriquecimento Google Ads (gclid→click_view) iniciado')
}
