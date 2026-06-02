import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { authMiddleware, adminOnly, type JwtPayload } from '../lib/auth.js'
import { metaFetch } from '../lib/meta.js'

// ── Cache de "window reach" (Fase 21.10 fix) ────────────────────
// Reach do Meta é deduplicado dentro da janela — não dá pra somar dias.
// Pra mostrar exatamente o que o Meta UI mostra, fazemos chamada extra à
// Meta API sem `time_increment` (1 linha agregada). Cache 5 min em memória
// pra evitar chamada extra em todo refresh do dashboard.
type WindowReachData = { byCampaign: Record<string, number>; accountTotal: number }
const windowReachCache: Map<string, { value: WindowReachData; expiresAt: number }> = new Map()
const WINDOW_REACH_TTL_MS = 5 * 60_000

// Resolve as contas de anúncio de uma integração. Prioridade:
//  1) Contas configuradas manualmente (MetaIntegration.metadata.adAccountIds)
//     — usadas direto com o token (user token), sem depender do business da
//     página. Resolve o caso em que `/{pageId}?fields=business` retorna
//     "(#200) Requires business_management permission" e o sync ficava vazio.
//  2) Fallback (legado): descoberta via business da página → owned_ad_accounts.
async function resolveAdAccountIds(integ: any, token: string): Promise<string[]> {
  const md = (integ?.metadata as any) || {}
  const configured = Array.isArray(md.adAccountIds)
    ? md.adAccountIds.filter((x: any) => typeof x === 'string' && x.startsWith('act_'))
    : []
  if (configured.length > 0) return configured

  const pageInfo = await metaFetch(`/${integ.pageId}?fields=business`, token)
  if (!pageInfo.business?.id) return []
  const resp = await metaFetch(`/${pageInfo.business.id}/owned_ad_accounts?fields=id&limit=50`, token)
  return (resp.data || []).map((a: any) => a.id)
}

async function getWindowReach(dateFrom: Date, dateTo: Date, app: FastifyInstance): Promise<WindowReachData> {
  const since = dateFrom.toISOString().slice(0, 10)
  const until = dateTo.toISOString().slice(0, 10)
  const cacheKey = `${since}|${until}`
  const cached = windowReachCache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) return cached.value

  const integrations = await prisma.metaIntegration.findMany({ where: { active: true } })
  if (integrations.length === 0) {
    const empty: WindowReachData = { byCampaign: {}, accountTotal: 0 }
    windowReachCache.set(cacheKey, { value: empty, expiresAt: Date.now() + WINDOW_REACH_TTL_MS })
    return empty
  }

  const byCampaign: Record<string, number> = {}
  let accountTotal = 0
  const timeRange = encodeURIComponent(JSON.stringify({ since, until }))

  for (const integ of integrations) {
    const token = integ.userAccessToken || integ.pageAccessToken
    if (!token) continue
    try {
      // Descobrir ad accounts (config manual ou business da página)
      let adAccountIds: string[] = []
      try {
        adAccountIds = await resolveAdAccountIds(integ, token)
      } catch {
        continue
      }
      if (adAccountIds.length === 0) continue

      for (const actId of adAccountIds) {
        // Reach por campanha (deduped na janela)
        try {
          const r = await metaFetch(
            `/${actId}/insights?fields=campaign_id,reach&level=campaign&time_range=${timeRange}&limit=500`,
            token,
          )
          for (const row of r.data || []) {
            const cid = row.campaign_id
            const reach = parseInt(row.reach) || 0
            if (cid && reach > 0) byCampaign[cid] = (byCampaign[cid] || 0) + reach
          }
        } catch (e: any) {
          app.log.warn(`[window-reach] campaign-level falhou pra ${actId}: ${e.message}`)
        }

        // Reach total da account na janela (1 linha)
        try {
          const r = await metaFetch(
            `/${actId}/insights?fields=reach&level=account&time_range=${timeRange}&limit=1`,
            token,
          )
          const row = r.data?.[0]
          if (row?.reach) accountTotal += parseInt(row.reach) || 0
        } catch (e: any) {
          app.log.warn(`[window-reach] account-level falhou pra ${actId}: ${e.message}`)
        }
      }
    } catch (e: any) {
      app.log.warn(`[window-reach] integração ${integ.pageName} falhou: ${e.message}`)
    }
  }

  const value: WindowReachData = { byCampaign, accountTotal }
  windowReachCache.set(cacheKey, { value, expiresAt: Date.now() + WINDOW_REACH_TTL_MS })
  return value
}

export function invalidateWindowReachCache() {
  windowReachCache.clear()
}

// Janela de data com timezone Brasil (-03:00) explícito.
// `kind: 'start'` → 00:00:00 BRT do dia; `kind: 'end'` → 23:59:59.999 BRT.
// Sem isso, `new Date('2026-05-01')` é UTC midnight (= 30/04 21:00 BRT) e
// dateTo+'T23:59:59' depende do fuso do servidor.
function parseBrazilDate(dateStr: string, kind: 'start' | 'end'): Date {
  const suffix = kind === 'start' ? 'T00:00:00-03:00' : 'T23:59:59.999-03:00'
  const d = new Date(dateStr + suffix)
  if (Number.isNaN(d.getTime())) return new Date()
  return d
}

// Formata Date para 'YYYY-MM-DD' no fuso Brasil (não em UTC).
function toBrazilDay(d: Date): string {
  // pt-BR retorna 'DD/MM/YYYY'; reordenar para ISO YYYY-MM-DD
  const parts = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(d)
  const yyyy = parts.find(p => p.type === 'year')?.value ?? '1970'
  const mm = parts.find(p => p.type === 'month')?.value ?? '01'
  const dd = parts.find(p => p.type === 'day')?.value ?? '01'
  return `${yyyy}-${mm}-${dd}`
}

// Gera a chave única usada por CampaignCost. Suporta 3 níveis sem ambiguidade
// de NULL em UNIQUE composto (MySQL permite múltiplos NULLs em UNIQUE).
function costKeyFor(
  level: 'campaign' | 'adset' | 'ad',
  campaignId: string,
  adsetId: string | null,
  adId: string | null,
  dateStr: string, // YYYY-MM-DD
): string {
  if (level === 'campaign') return `campaign:${campaignId}:${dateStr}`
  if (level === 'adset')    return `adset:${campaignId}:${adsetId ?? ''}:${dateStr}`
  return `ad:${campaignId}:${adsetId ?? ''}:${adId ?? ''}:${dateStr}`
}

function isoDateOnly(d: Date): string {
  // 'YYYY-MM-DD' baseado em UTC (CampaignCost.date é DATE, sem hora)
  return d.toISOString().slice(0, 10)
}

// Retorna { weekKey: 'YYYY-WW', weekStart: 'YYYY-MM-DD', weekEnd: 'YYYY-MM-DD' }
// Semana ISO 8601 (segunda → domingo) ancorada no fuso Brasil. weekKey usa o
// ano da quinta-feira da semana (regra ISO) — semanas do início/fim de ano são
// agrupadas corretamente.
function brazilIsoWeek(dayStr: string): { weekKey: string; weekStart: string; weekEnd: string } {
  const [y, m, d] = dayStr.split('-').map(Number)
  // Tratar a data como meio-dia BRT pra evitar bugs de DST
  const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0))
  const dow = dt.getUTCDay() === 0 ? 7 : dt.getUTCDay() // segunda=1..domingo=7
  const monday = new Date(dt)
  monday.setUTCDate(dt.getUTCDate() - (dow - 1))
  const sunday = new Date(monday)
  sunday.setUTCDate(monday.getUTCDate() + 6)
  // Ano ISO: usa a quinta-feira da semana
  const thursday = new Date(monday)
  thursday.setUTCDate(monday.getUTCDate() + 3)
  const isoYear = thursday.getUTCFullYear()
  // Número da semana = floor((thursday - jan4Thursday) / 7) + 1
  const jan4 = new Date(Date.UTC(isoYear, 0, 4, 12, 0, 0))
  const jan4Dow = jan4.getUTCDay() === 0 ? 7 : jan4.getUTCDay()
  const week1Monday = new Date(jan4)
  week1Monday.setUTCDate(jan4.getUTCDate() - (jan4Dow - 1))
  const weekNum = Math.round((monday.getTime() - week1Monday.getTime()) / (7 * 86400000)) + 1
  const ww = String(weekNum).padStart(2, '0')
  const fmt = (x: Date) =>
    `${x.getUTCFullYear()}-${String(x.getUTCMonth() + 1).padStart(2, '0')}-${String(x.getUTCDate()).padStart(2, '0')}`
  return { weekKey: `${isoYear}-${ww}`, weekStart: fmt(monday), weekEnd: fmt(sunday) }
}

export async function metaAdsReportRoutes(app: FastifyInstance) {

  // ── GET /api/admin/meta-ads-report/ad-accounts — lista contas de anúncio
  // acessíveis pelo token de cada integração + a seleção salva. Usado pra
  // configurar qual conta o sync deve puxar (evita depender do business da
  // página, que pode não ser acessível). ──
  app.get('/api/admin/meta-ads-report/ad-accounts', { preHandler: adminOnly }, async () => {
    const integrations = await prisma.metaIntegration.findMany({ where: { active: true } })
    const result: any[] = []
    for (const integ of integrations) {
      const token = integ.userAccessToken || integ.pageAccessToken
      const md = (integ.metadata as any) || {}
      const selected: string[] = Array.isArray(md.adAccountIds) ? md.adAccountIds : []
      const entry: any = {
        integrationId: integ.id,
        pageId: integ.pageId,
        pageName: integ.pageName,
        selected,
        accounts: [] as any[],
        error: null as string | null,
      }
      if (!token) {
        entry.error = 'sem token'
        result.push(entry)
        continue
      }
      try {
        const accounts: any[] = []
        let path: string | null = `/me/adaccounts?fields=id,name,account_status&limit=200`
        for (let page = 0; page < 5 && path; page++) {
          const resp: any = await metaFetch(path, token)
          for (const a of resp.data || []) {
            accounts.push({ id: a.id, name: a.name || a.id, status: a.account_status })
          }
          const next: string | undefined = resp.paging?.next
          path = next ? next.replace(/^https:\/\/graph\.facebook\.com\/v\d+\.\d+/, '') : null
        }
        accounts.sort((a, b) => String(a.name).localeCompare(String(b.name)))
        entry.accounts = accounts
      } catch (e: any) {
        entry.error = e.message || 'falha ao listar contas'
      }
      result.push(entry)
    }
    return { integrations: result }
  })

  // ── PUT /api/admin/meta-ads-report/ad-accounts — salva quais contas de
  // anúncio o sync deve usar para uma integração (MetaIntegration.metadata). ──
  app.put('/api/admin/meta-ads-report/ad-accounts', { preHandler: adminOnly }, async (req, reply) => {
    const body = (req.body as any) || {}
    const integrationId = parseInt(body.integrationId)
    if (!integrationId) return reply.code(400).send({ error: 'integrationId obrigatório' })
    const ids: string[] = Array.isArray(body.adAccountIds)
      ? body.adAccountIds
          .map((x: any) => String(x).trim())
          .filter((x: string) => /^act_\d+$/.test(x))
      : []
    const integ = await prisma.metaIntegration.findUnique({ where: { id: integrationId } })
    if (!integ) return reply.code(404).send({ error: 'Integração não encontrada' })
    const md = (integ.metadata as any) || {}
    md.adAccountIds = ids
    await prisma.metaIntegration.update({ where: { id: integrationId }, data: { metadata: md } })
    return { ok: true, integrationId, adAccountIds: ids }
  })

  // ── GET /api/admin/meta-ads-report/dashboard — Dados completos do dashboard de ROI ──
  app.get('/api/admin/meta-ads-report/dashboard', { preHandler: authMiddleware }, async (req) => {
    const q = req.query as any
    // Janelas com timezone Brasil explícito (-03:00). Sem isso, "01/05" interpretado
    // como UTC midnight some no fuso local; "23:59:59" sem TZ depende do fuso do
    // servidor. Ambos efeitos enviesavam a janela em até 3h em cada ponta.
    const dateFrom = q.dateFrom ? parseBrazilDate(q.dateFrom, 'start') : new Date(Date.now() - 30 * 86400000)
    const dateTo = q.dateTo ? parseBrazilDate(q.dateTo, 'end') : new Date()
    const campaignId = q.campaignId || null
    const funnelId = q.funnelId ? parseInt(q.funnelId, 10) : null

    // Filtro de leads: aceitar qualquer source desde que tenha campaignId atribuído.
    // Fix 4: leads que vieram via web_form/whatsapp/click-to-WhatsApp com UTM/campaignId
    // do Meta também contam para o ROI das campanhas.
    const leadWhere: any = {
      campaignId: campaignId ? campaignId : { not: null },
      createdAt: { gte: dateFrom, lte: dateTo },
    }
    if (funnelId) leadWhere.funnelId = funnelId

    const costWhereBase: any = {
      date: { gte: dateFrom, lte: dateTo }
    }
    if (campaignId) costWhereBase.campaignId = campaignId

    // Leads agrupados por campanha (filtered by date)
    const leads = await prisma.lead.findMany({
      where: leadWhere,
      select: {
        id: true, campaignId: true, campaignName: true,
        adsetId: true, adsetName: true, adId: true, adName: true,
        status: true, funnelId: true, createdAt: true, source: true,
        saleDetected: true, saleValue: true,
        outcome: true, outcomeAt: true, lostReasonId: true,
      }
    })

    // Custos no período — somente nível campanha (evita dupla contagem com adset/ad).
    const costs = await prisma.campaignCost.findMany({
      where: { ...costWhereBase, level: 'campaign' }
    })
    // Custos por adset/ad no período (alimentam flat-lists com CPL real).
    const adsetCosts = await prisma.campaignCost.findMany({
      where: { ...costWhereBase, level: 'adset' },
      select: { adsetId: true, spend: true, impressions: true, clicks: true },
    })
    const adCosts = await prisma.campaignCost.findMany({
      where: { ...costWhereBase, level: 'ad' },
      select: { adId: true, spend: true, impressions: true, clicks: true },
    })
    const spendByAdset: Record<string, { spend: number; impressions: number; clicks: number }> = {}
    for (const a of adsetCosts) {
      if (!a.adsetId) continue
      const key = a.adsetId
      if (!spendByAdset[key]) spendByAdset[key] = { spend: 0, impressions: 0, clicks: 0 }
      spendByAdset[key].spend += Number(a.spend)
      spendByAdset[key].impressions += a.impressions || 0
      spendByAdset[key].clicks += a.clicks || 0
    }
    const spendByAd: Record<string, { spend: number; impressions: number; clicks: number }> = {}
    for (const a of adCosts) {
      if (!a.adId) continue
      const key = a.adId
      if (!spendByAd[key]) spendByAd[key] = { spend: 0, impressions: 0, clicks: 0 }
      spendByAd[key].spend += Number(a.spend)
      spendByAd[key].impressions += a.impressions || 0
      spendByAd[key].clicks += a.clicks || 0
    }

    // Custos totais (all time) — exposto separadamente como `totalSpend` na tabela.
    // Fix 2: NUNCA mais usar como fallback de spend do período (vazava para janela errada).
    const allCosts = await prisma.campaignCost.findMany({
      where: { level: 'campaign', ...(campaignId ? { campaignId } : {}) },
      select: { campaignId: true, spend: true }
    })
    const totalSpendByCampaign: Record<string, number> = {}
    for (const c of allCosts) {
      totalSpendByCampaign[c.campaignId] = (totalSpendByCampaign[c.campaignId] || 0) + Number(c.spend)
    }

    // Agregar por campanha
    interface AdAgg {
      name: string
      leads: number
      sales: number
      revenue: number
      won: number
      lost: number
    }
    interface AdsetAgg {
      name: string
      leads: number
      sales: number
      revenue: number
      won: number
      lost: number
      ads: Record<string, AdAgg>
    }
    interface CampaignAgg {
      id: string
      name: string
      leads: number
      sales: number
      revenue: number
      won: number
      lost: number
      spend: number
      impressions: number
      clicks: number
      /** Cliques no link/CTA — usado pelo "CTR" do Meta UI */
      linkClicks: number
      reach: number
      adsets: Record<string, AdsetAgg>
    }
    const campaignMap: Record<string, CampaignAgg> = {}

    for (const lead of leads) {
      const cid = lead.campaignId || '_unknown'
      if (!campaignMap[cid]) {
        campaignMap[cid] = { id: cid, name: lead.campaignName || 'Sem campanha', leads: 0, sales: 0, revenue: 0, won: 0, lost: 0, spend: 0, impressions: 0, clicks: 0, linkClicks: 0, reach: 0, adsets: {} }
      }
      const c = campaignMap[cid]
      c.leads++
      if (lead.saleDetected) {
        c.sales++
        c.revenue += Number(lead.saleValue ?? 0)
      }
      if (lead.outcome === 'won') c.won++
      else if (lead.outcome === 'lost') c.lost++

      // Adset breakdown
      const asid = lead.adsetId || '_none'
      if (!c.adsets[asid]) {
        c.adsets[asid] = { name: lead.adsetName || 'Sem adset', leads: 0, sales: 0, revenue: 0, won: 0, lost: 0, ads: {} }
      }
      const as = c.adsets[asid]
      as.leads++
      if (lead.saleDetected) {
        as.sales++
        as.revenue += Number(lead.saleValue ?? 0)
      }
      if (lead.outcome === 'won') as.won++
      else if (lead.outcome === 'lost') as.lost++

      // Ad breakdown
      const adid = lead.adId || '_none'
      if (!as.ads[adid]) {
        as.ads[adid] = { name: lead.adName || 'Sem anuncio', leads: 0, sales: 0, revenue: 0, won: 0, lost: 0 }
      }
      const ad = as.ads[adid]
      ad.leads++
      if (lead.saleDetected) {
        ad.sales++
        ad.revenue += Number(lead.saleValue ?? 0)
      }
      if (lead.outcome === 'won') ad.won++
      else if (lead.outcome === 'lost') ad.lost++
    }

    // Agregar custos e leads da Meta API (actions.lead)
    const metaLeadsCount: Record<string, number> = {}
    for (const cost of costs) {
      const cid = cost.campaignId
      if (!campaignMap[cid]) {
        campaignMap[cid] = { id: cid, name: cost.campaignName, leads: 0, sales: 0, revenue: 0, won: 0, lost: 0, spend: 0, impressions: 0, clicks: 0, linkClicks: 0, reach: 0, adsets: {} }
      }
      campaignMap[cid].spend += Number(cost.spend)
      campaignMap[cid].impressions += cost.impressions || 0
      campaignMap[cid].clicks += cost.clicks || 0
      campaignMap[cid].linkClicks += (cost as any).inlineLinkClicks || 0
      // Fix 3: reach NÃO é aditivo (mesma pessoa em N dias = 1 pessoa). MAX
      // diário é aproximação conservadora; o valor 100% certo vem da chamada
      // window-reach mais abaixo (overrides este). Mantemos esse fallback se
      // a chamada Meta falhar.
      campaignMap[cid].reach = Math.max(campaignMap[cid].reach || 0, cost.reach || 0)

      const actions = cost.actions as Record<string, number> | null
      if (actions?.lead) {
        metaLeadsCount[cid] = (metaLeadsCount[cid] || 0) + actions.lead
      }
    }

    // ── Reach da janela (Fix Fase 21.10): Meta API call extra ──
    //
    // O reach por dia, somado, NÃO bate com o reach do Meta UI: a mesma pessoa
    // vista em 5 dias conta 5x se somar, mas é 1 só "pessoa alcançada" (deduplicado
    // pela Meta na janela inteira). Pra ter paridade com o painel da Meta, fazemos
    // uma chamada SEM time_increment (1 linha por campanha = reach único da janela).
    // Cache 5 min em memória pra não bater em todo dashboard.
    const windowReachByCampaign: Record<string, number> = {}
    let windowReachTotal: number | null = null
    try {
      const reachData = await getWindowReach(dateFrom, dateTo, app)
      Object.assign(windowReachByCampaign, reachData.byCampaign)
      windowReachTotal = reachData.accountTotal
      // Override do reach por campanha quando temos o valor correto
      for (const [cid, reach] of Object.entries(windowReachByCampaign)) {
        if (campaignMap[cid]) campaignMap[cid].reach = reach
      }
    } catch (e: any) {
      app.log.warn(`[Meta dashboard] window reach failed: ${e.message}`)
    }

    // Filter: only campaigns that have data (leads, spend, impressions, or clicks) in the period
    const rawCampaigns = Object.values(campaignMap)
      .filter(c => c.leads > 0 || c.spend > 0 || c.impressions > 0 || c.clicks > 0 || (metaLeadsCount[c.id] || 0) > 0)
      .sort((a, b) => b.spend - a.spend || b.leads - a.leads)

    // Build final campaigns — TODOS os valores são do período. CPL usa leads reais
    // do DB (Fix 6); metaLeads e cpc expostos como diagnóstico secundário.
    // ROAS = revenue / spend (multiplicador). ROI = (revenue - spend) / spend (%).
    const campaigns = rawCampaigns.map(c => {
      const totalSpend = totalSpendByCampaign[c.id] ?? 0
      const metaLeads = metaLeadsCount[c.id] || 0
      const cpl = c.leads > 0 && c.spend > 0 ? c.spend / c.leads : 0
      const cpc = c.clicks > 0 && c.spend > 0 ? c.spend / c.clicks : 0
      const cpv = c.sales > 0 && c.spend > 0 ? c.spend / c.sales : 0
      const roas = c.spend > 0 ? c.revenue / c.spend : 0
      const roi = c.spend > 0 ? ((c.revenue - c.spend) / c.spend) * 100 : 0
      const conversionRate = c.leads > 0 ? (c.sales / c.leads) * 100 : 0
      const winRate = (c.won + c.lost) > 0 ? (c.won / (c.won + c.lost)) * 100 : 0
      return {
        id: c.id,
        name: c.name,
        leads: c.leads,
        metaLeads,
        sales: c.sales,
        won: c.won,
        lost: c.lost,
        revenue: Number(c.revenue.toFixed(2)),
        spend: Number(c.spend.toFixed(2)),
        totalSpend: Number(totalSpend.toFixed(2)),
        impressions: c.impressions,
        clicks: c.clicks,
        linkClicks: c.linkClicks,
        reach: c.reach,
        cpl: Number(cpl.toFixed(2)),
        cpc: Number(cpc.toFixed(2)),
        linkCtr: c.impressions > 0 ? Number(((c.linkClicks / c.impressions) * 100).toFixed(2)) : 0,
        cpv: Number(cpv.toFixed(2)),
        roas: Number(roas.toFixed(2)),
        roi: Number(roi.toFixed(1)),
        conversionRate: Number(conversionRate.toFixed(1)),
        winRate: Number(winRate.toFixed(1)),
        adsets: Object.values(c.adsets).map(as => ({
          name: as.name,
          leads: as.leads,
          sales: as.sales,
          revenue: Number(as.revenue.toFixed(2)),
          won: as.won,
          lost: as.lost,
          ads: Object.values(as.ads).map(ad => ({
            name: ad.name,
            leads: ad.leads,
            sales: ad.sales,
            revenue: Number(ad.revenue.toFixed(2)),
            won: ad.won,
            lost: ad.lost,
          })),
        })),
      }
    })

    // Flat lists de adsets e ads para tabelas dedicadas (estilo TERRAM).
    // Spend real vem de CampaignCost level='adset'/'ad' (sync da Meta puxa os 3
    // níveis). Quando ausente, fallback proporcional ao share de leads na campanha.
    // `spendKind` informa qual foi usado pra UI poder distinguir.
    const adsetsFlat: any[] = []
    const adsFlat: any[] = []
    for (const c of rawCampaigns) {
      for (const [asid, as] of Object.entries(c.adsets)) {
        const realAdset = asid !== '_none' ? spendByAdset[asid] : undefined
        const adsetSpend = realAdset?.spend ?? (
          c.spend > 0 && c.leads > 0 ? c.spend * (as.leads / c.leads) : 0
        )
        const adsetSpendKind: 'real' | 'estimated' | 'none' =
          realAdset && realAdset.spend > 0 ? 'real'
          : adsetSpend > 0 ? 'estimated'
          : 'none'
        const cpl = adsetSpend > 0 && as.leads > 0 ? adsetSpend / as.leads : 0
        const roas = adsetSpend > 0 ? as.revenue / adsetSpend : 0
        const roi = adsetSpend > 0 ? ((as.revenue - adsetSpend) / adsetSpend) * 100 : 0
        adsetsFlat.push({
          id: asid === '_none' ? null : asid,
          name: as.name,
          campaignId: c.id,
          campaignName: c.name,
          leads: as.leads,
          sales: as.sales,
          revenue: Number(as.revenue.toFixed(2)),
          won: as.won,
          lost: as.lost,
          spend: Number(adsetSpend.toFixed(2)),
          spendKind: adsetSpendKind,
          impressions: realAdset?.impressions ?? 0,
          clicks: realAdset?.clicks ?? 0,
          cpl: Number(cpl.toFixed(2)),
          roas: Number(roas.toFixed(2)),
          roi: Number(roi.toFixed(1)),
          conversionRate: as.leads > 0 ? Number(((as.sales / as.leads) * 100).toFixed(1)) : 0,
        })
        for (const [adid, ad] of Object.entries(as.ads)) {
          const realAd = adid !== '_none' ? spendByAd[adid] : undefined
          const adSpend = realAd?.spend ?? (
            c.spend > 0 && c.leads > 0 ? c.spend * (ad.leads / c.leads) : 0
          )
          const adSpendKind: 'real' | 'estimated' | 'none' =
            realAd && realAd.spend > 0 ? 'real'
            : adSpend > 0 ? 'estimated'
            : 'none'
          const adCpl = adSpend > 0 && ad.leads > 0 ? adSpend / ad.leads : 0
          const adRoas = adSpend > 0 ? ad.revenue / adSpend : 0
          const adRoi = adSpend > 0 ? ((ad.revenue - adSpend) / adSpend) * 100 : 0
          adsFlat.push({
            id: adid === '_none' ? null : adid,
            name: ad.name,
            adsetId: asid === '_none' ? null : asid,
            adsetName: as.name,
            campaignId: c.id,
            campaignName: c.name,
            leads: ad.leads,
            sales: ad.sales,
            revenue: Number(ad.revenue.toFixed(2)),
            won: ad.won,
            lost: ad.lost,
            spend: Number(adSpend.toFixed(2)),
            spendKind: adSpendKind,
            impressions: realAd?.impressions ?? 0,
            clicks: realAd?.clicks ?? 0,
            cpl: Number(adCpl.toFixed(2)),
            roas: Number(adRoas.toFixed(2)),
            roi: Number(adRoi.toFixed(1)),
            conversionRate: ad.leads > 0 ? Number(((ad.sales / ad.leads) * 100).toFixed(1)) : 0,
          })
        }
      }
    }
    adsetsFlat.sort((a, b) => b.leads - a.leads || b.revenue - a.revenue)
    adsFlat.sort((a, b) => b.leads - a.leads || b.revenue - a.revenue)

    // Summary uses the same resolved values as the table
    const totalRealLeads = campaigns.reduce((s, c) => s + c.leads, 0)
    const totalMetaLeads = campaigns.reduce((s, c) => s + c.metaLeads, 0)
    const totalSales = campaigns.reduce((s, c) => s + c.sales, 0)
    const totalWon = campaigns.reduce((s, c) => s + c.won, 0)
    const totalLost = campaigns.reduce((s, c) => s + c.lost, 0)
    const totalRevenue = campaigns.reduce((s, c) => s + c.revenue, 0)
    const totalSpend = campaigns.reduce((s, c) => s + c.spend, 0)
    const totalImpressions = campaigns.reduce((s, c) => s + c.impressions, 0)
    const totalClicks = campaigns.reduce((s, c) => s + c.clicks, 0)
    const totalLinkClicks = campaigns.reduce((s, c) => s + (c.linkClicks || 0), 0)
    // Reach total: usa o valor account-level da Meta API (deduped na janela inteira).
    // Se a chamada falhou, fallback pra MAX entre campanhas (conservador).
    const totalReach = windowReachTotal !== null
      ? windowReachTotal
      : campaigns.reduce((s, c) => Math.max(s, c.reach), 0)
    const avgCPL = totalRealLeads > 0 && totalSpend > 0 ? totalSpend / totalRealLeads : 0
    const avgCPC = totalClicks > 0 && totalSpend > 0 ? totalSpend / totalClicks : 0
    const avgCTR = totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0
    // CTR (link) = inline_link_clicks/impressions × 100 — métrica que o Meta UI mostra
    const avgLinkCTR = totalImpressions > 0 ? (totalLinkClicks / totalImpressions) * 100 : 0
    const totalRoas = totalSpend > 0 ? totalRevenue / totalSpend : 0
    const totalRoi = totalSpend > 0 ? ((totalRevenue - totalSpend) / totalSpend) * 100 : 0
    const avgConversionRate = totalRealLeads > 0 ? (totalSales / totalRealLeads) * 100 : 0
    const totalWinRate = (totalWon + totalLost) > 0 ? (totalWon / (totalWon + totalLost)) * 100 : 0

    // Daily total — Fix 12: leads vêm do Lead table (createdAt), batendo com KPIs
    // de cima. Spend/clicks/imp continuam vindo de CampaignCost (Meta API).
    type Bucket = { leads: number; sales: number; revenue: number; won: number; lost: number; spend: number; impressions: number; clicks: number }
    const empty = (): Bucket => ({ leads: 0, sales: 0, revenue: 0, won: 0, lost: 0, spend: 0, impressions: 0, clicks: 0 })
    const dailyTotal: Record<string, Bucket> = {}
    for (const lead of leads) {
      const day = toBrazilDay(lead.createdAt)
      if (!dailyTotal[day]) dailyTotal[day] = empty()
      dailyTotal[day].leads++
      if (lead.saleDetected) {
        dailyTotal[day].sales++
        dailyTotal[day].revenue += Number(lead.saleValue ?? 0)
      }
      if (lead.outcome === 'won') dailyTotal[day].won++
      else if (lead.outcome === 'lost') dailyTotal[day].lost++
    }
    for (const cost of costs) {
      const day = toBrazilDay(cost.date)
      if (!dailyTotal[day]) dailyTotal[day] = empty()
      dailyTotal[day].spend += Number(cost.spend)
      dailyTotal[day].impressions += cost.impressions || 0
      dailyTotal[day].clicks += cost.clicks || 0
    }

    // Weekly: agrega o daily em buckets ISO-week (segunda→domingo). weekStart/weekEnd
    // expostos pra UI mostrar o range; weekKey 'YYYY-WW' usado como chave estável.
    type WeekBucket = Bucket & { weekKey: string; weekStart: string; weekEnd: string }
    const weeklyMap: Record<string, WeekBucket> = {}
    for (const [day, d] of Object.entries(dailyTotal)) {
      const wk = brazilIsoWeek(day)
      if (!weeklyMap[wk.weekKey]) {
        weeklyMap[wk.weekKey] = { ...empty(), weekKey: wk.weekKey, weekStart: wk.weekStart, weekEnd: wk.weekEnd }
      }
      const w = weeklyMap[wk.weekKey]
      w.leads += d.leads
      w.sales += d.sales
      w.revenue += d.revenue
      w.won += d.won
      w.lost += d.lost
      w.spend += d.spend
      w.impressions += d.impressions
      w.clicks += d.clicks
    }

    // Leads por status (snapshot atual — pode divergir do estado quando criado)
    const statusCount: Record<string, number> = {}
    for (const lead of leads) {
      statusCount[lead.status] = (statusCount[lead.status] || 0) + 1
    }

    // ── Funil por etapas do Funnel selecionado ──
    // Stage = etapa visível no kanban. Lead "passou pela etapa" = (a) está
    // atualmente nessa stage OU (b) tem LeadEvent type='status_changed'
    // newValue=stage.key (em qualquer momento, inclusive antes do período).
    // Restrito ao conjunto filtrado (campanha + janela + funilId).
    let funnelOut: any = null
    if (funnelId && leads.length > 0) {
      const funnel = await prisma.funnel.findUnique({
        where: { id: funnelId },
        select: { id: true, name: true },
      })
      if (funnel) {
        const stages = await prisma.stage.findMany({
          where: { funnelId, active: true },
          orderBy: { position: 'asc' },
          select: { id: true, key: true, name: true, color: true, position: true, terminalKind: true },
        })
        const stageKeys = stages.map(s => s.key)
        const filteredLeadIds = leads.map(l => l.id)

        // Eventos histórico-completos: descobre todas as etapas pelas quais cada
        // lead já passou (independente de ter avançado/recuado depois).
        const events = filteredLeadIds.length > 0 && stageKeys.length > 0
          ? await prisma.leadEvent.findMany({
              where: {
                leadId: { in: filteredLeadIds },
                type: 'status_changed',
                newValue: { in: stageKeys },
              },
              select: { leadId: true, newValue: true },
            })
          : []

        const passedByStage: Record<string, Set<number>> = {}
        for (const k of stageKeys) passedByStage[k] = new Set()
        for (const e of events) {
          if (e.newValue && passedByStage[e.newValue]) passedByStage[e.newValue].add(e.leadId)
        }
        // Cobre o caso de lead criado já com status=stageKey (sem evento)
        for (const lead of leads) {
          if (lead.status && passedByStage[lead.status]) passedByStage[lead.status].add(lead.id)
        }

        // Soma de saleValue por stage atual (ticket médio apenas para a stage
        // atual do lead — proxy razoável para "faturamento gerado naquela etapa")
        const revenueByStatus: Record<string, number> = {}
        const salesCountByStatus: Record<string, number> = {}
        for (const lead of leads) {
          if (!lead.saleDetected || !lead.status) continue
          revenueByStatus[lead.status] = (revenueByStatus[lead.status] || 0) + Number(lead.saleValue ?? 0)
          salesCountByStatus[lead.status] = (salesCountByStatus[lead.status] || 0) + 1
        }

        // Topo do funil = leads do conjunto filtrado (entrada). conversionFromTop
        // usa esse total. conversionFromPrev usa a stage imediatamente anterior
        // (em position).
        const top = leads.length
        const stagesOut = stages.map((s, i) => {
          const count = passedByStage[s.key].size
          const prev = i > 0 ? passedByStage[stages[i - 1].key].size : top
          const sales = salesCountByStatus[s.key] || 0
          const revenue = revenueByStatus[s.key] || 0
          return {
            id: s.id,
            key: s.key,
            name: s.name,
            color: s.color,
            position: s.position,
            terminalKind: s.terminalKind,
            count,
            conversionFromTop: top > 0 ? Number(((count / top) * 100).toFixed(2)) : 0,
            conversionFromPrev: prev > 0 ? Number(((count / prev) * 100).toFixed(2)) : 0,
            ticketAvg: sales > 0 ? Number((revenue / sales).toFixed(2)) : 0,
            revenue: Number(revenue.toFixed(2)),
            sales,
          }
        })
        funnelOut = { id: funnel.id, name: funnel.name, top, stages: stagesOut }

        // Per-entity stage counts: para cada (campanha/adset/ad), conta quantos
        // leads passaram por cada stage. Reusa `passedByStage` (já considera
        // eventos históricos + status atual). Usado pela UI para tabelas
        // "Por etapa do funil" (paridade com template Pipedrive+Meta).
        const stageByCampaign: Record<string, Record<string, number>> = {}
        const stageByAdset: Record<string, Record<string, number>> = {}
        const stageByAd: Record<string, Record<string, number>> = {}
        const leadById: Map<number, typeof leads[number]> = new Map(leads.map(l => [l.id, l]))
        for (const sk of stageKeys) {
          for (const lid of passedByStage[sk]) {
            const lead = leadById.get(lid)
            if (!lead) continue
            const cid = lead.campaignId || '_unknown'
            const asid = lead.adsetId || '_none'
            const adid = lead.adId || '_none'
            const akey = `${cid}|${asid}`
            const adkey = `${cid}|${asid}|${adid}`
            stageByCampaign[cid] = stageByCampaign[cid] || {}
            stageByAdset[akey] = stageByAdset[akey] || {}
            stageByAd[adkey] = stageByAd[adkey] || {}
            stageByCampaign[cid][sk] = (stageByCampaign[cid][sk] || 0) + 1
            stageByAdset[akey][sk] = (stageByAdset[akey][sk] || 0) + 1
            stageByAd[adkey][sk] = (stageByAd[adkey][sk] || 0) + 1
          }
        }
        for (const c of campaigns) {
          (c as any).stageCounts = stageByCampaign[c.id] || {}
        }
        for (const a of adsetsFlat) {
          const key = `${a.campaignId}|${a.id ?? '_none'}`
          ;(a as any).stageCounts = stageByAdset[key] || {}
        }
        for (const a of adsFlat) {
          const key = `${a.campaignId}|${a.adsetId ?? '_none'}|${a.id ?? '_none'}`
          ;(a as any).stageCounts = stageByAd[key] || {}
        }
      }
    }

    return {
      summary: {
        totalLeads: totalRealLeads,
        totalMetaLeads,
        totalSales,
        totalWon,
        totalLost,
        totalRevenue: Number(totalRevenue.toFixed(2)),
        totalSpend: Number(totalSpend.toFixed(2)),
        avgCPL: Number(avgCPL.toFixed(2)),
        avgCPC: Number(avgCPC.toFixed(2)),
        roas: Number(totalRoas.toFixed(2)),
        roi: Number(totalRoi.toFixed(1)),
        conversionRate: Number(avgConversionRate.toFixed(1)),
        winRate: Number(totalWinRate.toFixed(1)),
        totalCampaigns: campaigns.length,
        totalImpressions,
        totalClicks,
        totalLinkClicks,
        totalReach,
        avgCTR: Number(avgCTR.toFixed(2)),
        avgLinkCTR: Number(avgLinkCTR.toFixed(2)),
        // Aviso quando Meta reporta mais leads que o DB recebeu (webhook off, pull pendente)
        leadsDivergence: totalMetaLeads > totalRealLeads ? totalMetaLeads - totalRealLeads : 0,
      },
      campaigns,
      adsets: adsetsFlat,
      ads: adsFlat,
      daily: Object.entries(dailyTotal).sort((a, b) => a[0].localeCompare(b[0])).map(([date, d]) => ({ date, ...d })),
      weekly: Object.values(weeklyMap).sort((a, b) => a.weekKey.localeCompare(b.weekKey)),
      funnel: funnelOut,
      statusBreakdown: statusCount,
      dateRange: { from: toBrazilDay(dateFrom), to: toBrazilDay(dateTo) }
    }
  })

  // ── GET /api/admin/meta-ads-report/campaigns — Lista de campanhas únicas (leads + custos) ──
  app.get('/api/admin/meta-ads-report/campaigns', { preHandler: authMiddleware }, async () => {
    const [leadCampaigns, costCampaigns] = await Promise.all([
      prisma.lead.groupBy({
        by: ['campaignId', 'campaignName'],
        where: { source: 'meta_lead_ads', campaignId: { not: null } },
        _count: true,
      }),
      prisma.campaignCost.groupBy({
        by: ['campaignId', 'campaignName'],
        _sum: { spend: true, impressions: true, clicks: true, reach: true },
      })
    ])

    const map: Record<string, { id: string, name: string, leads: number, spend: number }> = {}
    for (const c of costCampaigns) {
      map[c.campaignId] = { id: c.campaignId, name: c.campaignName, leads: 0, spend: Number(c._sum.spend) || 0 }
    }
    for (const c of leadCampaigns) {
      if (!c.campaignId) continue
      if (!map[c.campaignId]) map[c.campaignId] = { id: c.campaignId, name: c.campaignName || '', leads: 0, spend: 0 }
      map[c.campaignId].leads = c._count
      if (c.campaignName) map[c.campaignId].name = c.campaignName
    }

    return { campaigns: Object.values(map).sort((a, b) => b.spend - a.spend || b.leads - a.leads) }
  })

  // ── GET /api/admin/meta-ads-report/costs — Listar custos cadastrados ──
  app.get('/api/admin/meta-ads-report/costs', { preHandler: authMiddleware }, async (req) => {
    const q = req.query as any
    const where: any = {}
    if (q.campaignId) where.campaignId = q.campaignId
    if (q.dateFrom || q.dateTo) {
      where.date = {}
      if (q.dateFrom) where.date.gte = new Date(q.dateFrom)
      if (q.dateTo) where.date.lte = new Date(q.dateTo)
    }
    const costs = await prisma.campaignCost.findMany({ where, orderBy: { date: 'desc' } })
    return { costs }
  })

  // ── POST /api/admin/meta-ads-report/costs — Adicionar/atualizar custo ──
  app.post('/api/admin/meta-ads-report/costs', { preHandler: adminOnly }, async (req, reply) => {
    const { campaignId, campaignName, date, spend, impressions, clicks, notes } = req.body as any
    if (!campaignId || !date || spend === undefined) return reply.code(400).send({ error: 'campaignId, date e spend obrigatorios' })

    const dateObj = new Date(date)
    const key = costKeyFor('campaign', campaignId, null, null, isoDateOnly(dateObj))
    const cost = await prisma.campaignCost.upsert({
      where: { costKey: key },
      create: {
        costKey: key, level: 'campaign',
        campaignId, campaignName: campaignName || '',
        date: dateObj, spend: Number(spend),
        impressions: impressions ? parseInt(impressions) : null,
        clicks: clicks ? parseInt(clicks) : null,
        notes, source: 'manual',
      },
      update: {
        spend: Number(spend),
        impressions: impressions ? parseInt(impressions) : null,
        clicks: clicks ? parseInt(clicks) : null,
        notes, campaignName: campaignName || undefined,
      },
    })
    return { ok: true, cost }
  })

  // ── POST /api/admin/meta-ads-report/costs/bulk — Adicionar custos em lote (range de datas) ──
  app.post('/api/admin/meta-ads-report/costs/bulk', { preHandler: adminOnly }, async (req, reply) => {
    const { campaignId, campaignName, dateFrom, dateTo, dailySpend, totalSpend, impressions, clicks, notes } = req.body as any
    if (!campaignId || !dateFrom || !dateTo) return reply.code(400).send({ error: 'campaignId, dateFrom, dateTo obrigatorios' })

    const start = new Date(dateFrom)
    const end = new Date(dateTo)
    const days = Math.ceil((end.getTime() - start.getTime()) / 86400000) + 1
    if (days <= 0 || days > 365) return reply.code(400).send({ error: 'Intervalo invalido (max 365 dias)' })

    const perDay = dailySpend ? Number(dailySpend) : (totalSpend ? Number(totalSpend) / days : 0)
    const perDayImpressions = impressions ? Math.round(parseInt(impressions) / days) : null
    const perDayClicks = clicks ? Math.round(parseInt(clicks) / days) : null

    let created = 0
    for (let i = 0; i < days; i++) {
      const d = new Date(start)
      d.setDate(d.getDate() + i)
      const key = costKeyFor('campaign', campaignId, null, null, isoDateOnly(d))
      await prisma.campaignCost.upsert({
        where: { costKey: key },
        create: {
          costKey: key, level: 'campaign',
          campaignId, campaignName: campaignName || '',
          date: d, spend: perDay,
          impressions: perDayImpressions, clicks: perDayClicks,
          notes, source: 'manual',
        },
        update: { spend: perDay, impressions: perDayImpressions, clicks: perDayClicks },
      })
      created++
    }
    return { ok: true, days: created, perDay: Number(perDay.toFixed(2)) }
  })

  // ── DELETE /api/admin/meta-ads-report/costs/:id — Remover custo ──
  app.delete('/api/admin/meta-ads-report/costs/:id', { preHandler: adminOnly }, async (req) => {
    const { id } = req.params as any
    await prisma.campaignCost.delete({ where: { id: parseInt(id) } })
    return { ok: true }
  })

  // ── POST /api/admin/meta-ads-report/sync-meta — Sincronizar dados de investimento da Meta Marketing API ──
  app.post('/api/admin/meta-ads-report/sync-meta', { preHandler: adminOnly }, async (req, reply) => {
    const { dateTo } = req.body as any
    const to = dateTo || new Date().toISOString().slice(0, 10)

    // Get all Meta integrations with user tokens
    const integrations = await prisma.metaIntegration.findMany({ where: { active: true }, include: { forms: { select: { formId: true } } } })
    if (integrations.length === 0) return reply.code(400).send({ error: 'Nenhuma integracao Meta ativa' })

    // Get only campaign IDs that belong to leads from connected pages
    const connectedPageIds = integrations.map(i => i.pageId)
    const allowedCampaigns = await prisma.lead.findMany({
      where: { source: 'meta_lead_ads', metaPageId: { in: connectedPageIds }, campaignId: { not: null } },
      select: { campaignId: true, createdAt: true },
      distinct: ['campaignId'],
      orderBy: { createdAt: 'asc' }
    })
    const allowedCampaignIds = new Set(allowedCampaigns.map(l => l.campaignId!))

    // Use the date of the oldest lead as the start date to capture all historical spend
    const oldestLead = allowedCampaigns[0]
    const from = oldestLead ? new Date(oldestLead.createdAt.getTime() - 30 * 86400000).toISOString().slice(0, 10) : new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10)

    let totalSynced = 0
    let totalCampaigns = 0
    const syncedCampaignIds = new Set<string>()
    const syncedCostKeys = new Set<string>() // pra cleanup considerar todos os níveis
    const errors: string[] = []
    // Fix 7: rastrear contas que foram sincronizadas COMPLETAMENTE (sem erro
    // parcial) por integração. Cleanup só roda se ao menos uma integração foi
    // 100% bem-sucedida — evita deletar dados válidos quando token expirou ou
    // rede falhou em uma das integrações.
    let anyIntegrationFullySynced = false

    // Helper: persiste um row de insights da Meta no nível indicado.
    async function upsertInsightRow(
      level: 'campaign' | 'adset' | 'ad',
      row: any,
    ) {
      if (!row.campaign_id || !row.date_start) return
      if (level === 'adset' && !row.adset_id) return
      if (level === 'ad' && !row.ad_id) return

      const actions: Record<string, number> = {}
      if (row.actions) {
        for (const a of row.actions) {
          actions[a.action_type] = parseInt(a.value) || 0
        }
      }

      const dateObj = new Date(row.date_start)
      const dateStr = isoDateOnly(dateObj)
      const adsetId = row.adset_id ?? null
      const adId = row.ad_id ?? null
      const key = costKeyFor(level, row.campaign_id, adsetId, adId, dateStr)

      const baseFields = {
        spend: parseFloat(row.spend) || 0,
        impressions: parseInt(row.impressions) || 0,
        clicks: parseInt(row.clicks) || 0,
        inlineLinkClicks: row.inline_link_clicks != null ? parseInt(row.inline_link_clicks) : null,
        inlineLinkClickCtr: row.inline_link_click_ctr != null ? parseFloat(row.inline_link_click_ctr) : null,
        reach: parseInt(row.reach) || 0,
        cpc: row.cpc ? parseFloat(row.cpc) : null,
        cpm: row.cpm ? parseFloat(row.cpm) : null,
        ctr: row.ctr ? parseFloat(row.ctr) : null,
        frequency: row.frequency ? parseFloat(row.frequency) : null,
        actions: Object.keys(actions).length > 0 ? actions : undefined,
        source: 'meta_api',
      }

      await prisma.campaignCost.upsert({
        where: { costKey: key },
        create: {
          costKey: key, level,
          campaignId: row.campaign_id, campaignName: row.campaign_name || '',
          adsetId: level !== 'campaign' ? adsetId : null,
          adsetName: row.adset_name || null,
          adId: level === 'ad' ? adId : null,
          adName: row.ad_name || null,
          date: dateObj,
          ...baseFields,
        },
        update: {
          campaignName: row.campaign_name || undefined,
          adsetName: row.adset_name || undefined,
          adName: row.ad_name || undefined,
          ...baseFields,
        },
      })
      syncedCampaignIds.add(row.campaign_id)
      syncedCostKeys.add(key)
      totalSynced++
    }

    // Detecta erro Meta API 500 com error_subcode=99 ("query muito grande")
    function isMetaApiTooLargeError(err: unknown): boolean {
      const msg = err instanceof Error ? err.message : String(err)
      // Forma típica: 'Meta API 500: {"error":{"code":1,...,"error_subcode":99}}'
      return /Meta API 500/.test(msg) && /error_subcode["\s:]+99/.test(msg)
    }

    // Helper: pagina insights da Meta API para um ad account em um nível.
    // Estratégia em duas tentativas:
    //   1. date_preset=maximum + time_increment=1 (rápido, funciona pra contas pequenas)
    //   2. Fallback: divide em janelas de 30 dias indo até 180 dias atrás —
    //      contorna o limite "query too large" do Meta (subcode 99) que aparece
    //      quando ad-level + many ads + many days estoura o que a API processa.
    //
    // O fallback é acionado SÓ quando o erro for subcode 99; outras falhas
    // propagam normalmente (token expirado, rate limit, etc.).
    async function fetchInsightsByLevel(
      actId: string,
      level: 'campaign' | 'adset' | 'ad',
      token: string,
    ) {
      const fields = level === 'campaign'
        ? 'campaign_id,campaign_name,spend,impressions,clicks,inline_link_clicks,inline_link_click_ctr,reach,cpc,cpm,ctr,frequency,actions'
        : level === 'adset'
        ? 'campaign_id,campaign_name,adset_id,adset_name,spend,impressions,clicks,inline_link_clicks,inline_link_click_ctr,reach,cpc,cpm,ctr,frequency,actions'
        : 'campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name,spend,impressions,clicks,inline_link_clicks,inline_link_click_ctr,reach,cpc,cpm,ctr,frequency,actions'

      // ad-level usa limit menor por padrão (cada linha tem ad_id + ad_name + ...)
      const limit = level === 'ad' ? 250 : 500

      // Tentativa 1: date_preset=maximum (1 chamada paginada)
      try {
        let path: string | null = `/${actId}/insights?fields=${fields}&level=${level}&date_preset=maximum&time_increment=1&limit=${limit}`
        while (path) {
          const resp: any = await metaFetch(path, token)
          for (const row of (resp.data || [])) {
            await upsertInsightRow(level, row)
          }
          const next = resp.paging?.next as string | undefined
          path = next ? next.replace(/^https?:\/\/graph\.facebook\.com\/v[\d.]+/, '') : null
        }
        return
      } catch (e) {
        if (!isMetaApiTooLargeError(e)) throw e
        app.log.warn(`[Meta sync] ${actId} level=${level}: query muito grande (subcode 99), aplicando fallback time-bucketed.`)
      }

      // Tentativa 2: bucketing por 30 dias indo 365 dias atrás. Sequencial pra
      // não saturar rate limit da Meta. Erros em buckets individuais propagam
      // (ex.: token expirado fica visível em vez de ser silenciado).
      const BUCKET_DAYS = 30
      const TOTAL_LOOKBACK_DAYS = 365
      const today = new Date()
      const buckets: Array<{ since: string; until: string }> = []
      for (let offset = 0; offset < TOTAL_LOOKBACK_DAYS; offset += BUCKET_DAYS) {
        const until = new Date(today)
        until.setDate(until.getDate() - offset)
        const since = new Date(until)
        since.setDate(since.getDate() - (BUCKET_DAYS - 1))
        buckets.push({ since: isoDateOnly(since), until: isoDateOnly(until) })
      }

      for (const b of buckets) {
        const timeRange = encodeURIComponent(JSON.stringify({ since: b.since, until: b.until }))
        let path: string | null = `/${actId}/insights?fields=${fields}&level=${level}&time_range=${timeRange}&time_increment=1&limit=${limit}`
        while (path) {
          const resp: any = await metaFetch(path, token)
          for (const row of (resp.data || [])) {
            await upsertInsightRow(level, row)
          }
          const next = resp.paging?.next as string | undefined
          path = next ? next.replace(/^https?:\/\/graph\.facebook\.com\/v[\d.]+/, '') : null
        }
      }
    }

    for (const integ of integrations) {
      const token = integ.userAccessToken || integ.pageAccessToken
      if (!token) { errors.push(`${integ.pageName}: sem token`); continue }

      let integrationFailed = false
      try {
        // Contas de anúncio: config manual (metadata.adAccountIds) ou,
        // como fallback, descoberta via business da página.
        let adAccountIds: string[] = []
        try {
          adAccountIds = await resolveAdAccountIds(integ, token)
        } catch (e: any) {
          errors.push(`${integ.pageName}: erro ao listar contas de anuncio (${e.message}). Token pode estar sem escopo ads_read/ads_management.`)
          integrationFailed = true
        }
        if (adAccountIds.length === 0 && !integrationFailed) {
          errors.push(`${integ.pageName}: nenhuma conta de anuncio configurada nem vinculada ao negocio da pagina`)
          integrationFailed = true
        }

        // Fetch insights at all 3 levels per ad account.
        // 3 requests por account (com paginação se >500 linhas/nível).
        for (const actId of adAccountIds) {
          try {
            await fetchInsightsByLevel(actId, 'campaign', token)
            await fetchInsightsByLevel(actId, 'adset', token)
            await fetchInsightsByLevel(actId, 'ad', token)
            totalCampaigns++
          } catch (e: any) {
            errors.push(`${integ.pageName}/${actId}: ${e.message}`)
            integrationFailed = true
          }
        }

        if (!integrationFailed) anyIntegrationFullySynced = true
      } catch (e: any) {
        errors.push(`${integ.pageName}: ${e.message}`)
      }
    }

    // Cleanup: só roda quando AO MENOS uma integração foi 100% bem-sucedida.
    // Deleta por costKey (cobre os 3 níveis).
    let cleaned = 0
    if (anyIntegrationFullySynced && syncedCostKeys.size > 0) {
      const result = await prisma.campaignCost.deleteMany({
        where: { source: 'meta_api', costKey: { notIn: [...syncedCostKeys] } }
      })
      cleaned = result.count
    }

    return {
      ok: true,
      synced: totalSynced,
      campaigns: syncedCampaignIds.size,
      cleaned,
      cleanupSkipped: !anyIntegrationFullySynced && integrations.length > 0,
      errors: errors.length > 0 ? errors : undefined,
    }
  })

  // ═══════════════════════════════════════════════
  // ROI REAL — Dashboard Unificado (Ads → Leads → Vendas)
  // ═══════════════════════════════════════════════

  // GET /api/admin/meta-ads-report/full — Dashboard completo de ROI real
  app.get('/api/admin/meta-ads-report/full', { preHandler: authMiddleware }, async (req) => {
    const q = req.query as any
    // Aceita dateFrom/dateTo (paridade com /dashboard) OU days (compat).
    const dateFrom = q.dateFrom
      ? parseBrazilDate(q.dateFrom, 'start')
      : new Date(Date.now() - (parseInt(q.days) || 30) * 86400000)
    const dateTo = q.dateTo ? parseBrazilDate(q.dateTo, 'end') : new Date()

    // 1. Leads por origem (todas, não só Meta)
    const leadsByOrigin = await prisma.$queryRaw`
      SELECT
        COALESCE(originType, 'unknown') as origin,
        COUNT(*) as leads,
        COUNT(CASE WHEN saleDetected = true THEN 1 END) as sales,
        COALESCE(SUM(CASE WHEN saleDetected = true THEN saleValue ELSE 0 END), 0) as revenue
      FROM bychat_leads
      WHERE createdAt >= ${dateFrom} AND createdAt <= ${dateTo}
      GROUP BY COALESCE(originType, 'unknown')
      ORDER BY leads DESC
    ` as any[]

    // 2. Leads + vendas por campanha
    const byCampaign = await prisma.$queryRaw`
      SELECT
        l.campaignId, l.campaignName, COALESCE(l.originType, 'unknown') as origin,
        COUNT(*) as leads,
        COUNT(CASE WHEN l.saleDetected = true THEN 1 END) as sales,
        COALESCE(SUM(CASE WHEN l.saleDetected = true THEN l.saleValue ELSE 0 END), 0) as revenue
      FROM bychat_leads l
      WHERE l.createdAt >= ${dateFrom} AND l.createdAt <= ${dateTo} AND l.campaignId IS NOT NULL
      GROUP BY l.campaignId, l.campaignName, COALESCE(l.originType, 'unknown')
      ORDER BY revenue DESC
    ` as any[]

    // 3. Custos por campanha no período
    const costs = await prisma.$queryRaw`
      SELECT campaignId, campaignName,
        SUM(spend) as spend,
        SUM(impressions) as impressions,
        SUM(clicks) as clicks
      FROM bychat_campaign_costs
      WHERE date >= ${dateFrom} AND date <= ${dateTo}
      GROUP BY campaignId, campaignName
    ` as any[]

    // 4. Montar ROI por campanha
    const costMap: Record<string, { spend: number; impressions: number; clicks: number }> = {}
    for (const c of costs || []) {
      costMap[c.campaignId] = {
        spend: Number(c.spend),
        impressions: Number(c.impressions || 0),
        clicks: Number(c.clicks || 0),
      }
    }

    const campaignROI = (byCampaign || []).map((c: any) => {
      const leads = Number(c.leads)
      const sales = Number(c.sales)
      const revenue = Number(c.revenue)
      const cost = costMap[c.campaignId]
      const spend = cost?.spend || 0

      return {
        campaignId: c.campaignId,
        campaignName: c.campaignName,
        origin: c.origin,
        leads,
        sales,
        revenue,
        spend,
        cpl: leads > 0 && spend > 0 ? Number((spend / leads).toFixed(2)) : null,
        cpv: sales > 0 && spend > 0 ? Number((spend / sales).toFixed(2)) : null,  // Custo por venda
        roas: spend > 0 ? Number((revenue / spend).toFixed(2)) : null,  // Return on Ad Spend
        conversionRate: leads > 0 ? Number(((sales / leads) * 100).toFixed(1)) : 0,
      }
    })

    // 5. Totais gerais
    const totalLeads = (leadsByOrigin || []).reduce((s: number, r: any) => s + Number(r.leads), 0)
    const totalSales = (leadsByOrigin || []).reduce((s: number, r: any) => s + Number(r.sales), 0)
    const totalRevenue = (leadsByOrigin || []).reduce((s: number, r: any) => s + Number(r.revenue), 0)
    const totalSpend = (costs || []).reduce((s: number, r: any) => s + Number(r.spend), 0)

    const totals = {
      leads: totalLeads,
      sales: totalSales,
      revenue: totalRevenue,
      spend: totalSpend,
      roas: totalSpend > 0 ? Number((totalRevenue / totalSpend).toFixed(2)) : null,
      cpl: totalLeads > 0 && totalSpend > 0 ? Number((totalSpend / totalLeads).toFixed(2)) : null,
      cpv: totalSales > 0 && totalSpend > 0 ? Number((totalSpend / totalSales).toFixed(2)) : null,
      conversionRate: totalLeads > 0 ? Number(((totalSales / totalLeads) * 100).toFixed(1)) : 0,
    }

    // 6. Performance diária
    const daily = await prisma.$queryRaw`
      SELECT
        DATE(l.createdAt) as date,
        COUNT(*) as leads,
        COUNT(CASE WHEN l.saleDetected = true THEN 1 END) as sales,
        COALESCE(SUM(CASE WHEN l.saleDetected = true THEN l.saleValue ELSE 0 END), 0) as revenue
      FROM bychat_leads l
      WHERE l.createdAt >= ${dateFrom} AND l.createdAt <= ${dateTo}
      GROUP BY DATE(l.createdAt)
      ORDER BY date ASC
    ` as any[]

    // Agregar custos diários
    const dailyCosts = await prisma.$queryRaw`
      SELECT DATE(date) as date, SUM(spend) as spend
      FROM bychat_campaign_costs
      WHERE date >= ${dateFrom} AND date <= ${dateTo}
      GROUP BY DATE(date)
    ` as any[]
    const dailyCostMap: Record<string, number> = {}
    for (const d of dailyCosts || []) {
      const dateStr = new Date(d.date).toISOString().slice(0, 10)
      dailyCostMap[dateStr] = Number(d.spend)
    }

    return {
      period: { from: toBrazilDay(dateFrom), to: toBrazilDay(dateTo) },
      totals,
      byOrigin: (leadsByOrigin || []).map((r: any) => ({
        origin: r.origin,
        leads: Number(r.leads),
        sales: Number(r.sales),
        revenue: Number(r.revenue),
      })),
      byCampaign: campaignROI,
      daily: (daily || []).map((d: any) => {
        const dateStr = d.date instanceof Date ? d.date.toISOString().slice(0, 10) : String(d.date)
        return {
          date: dateStr,
          leads: Number(d.leads),
          sales: Number(d.sales),
          revenue: Number(d.revenue),
          spend: dailyCostMap[dateStr] || 0,
        }
      }),
    }
  })
}
