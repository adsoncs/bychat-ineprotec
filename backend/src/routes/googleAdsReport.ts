// src/routes/googleAdsReport.ts
//
// Dashboard de relatórios Google Ads — espelho do `metaAdsReport.ts` (Meta).
// Lê de `GoogleAdsCampaignCost` (sincronizado via `services/googleAdsInsightsSync.ts`)
// e cruza com `Lead.gclid` + `Lead.saleValue` para calcular ROAS/ROI/Leads.

import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { adminOnly } from '../lib/auth.js'
import { syncGoogleAdsInsights, callSearchStream, getDeveloperToken, getLoginCustomerId } from '../services/googleAdsInsightsSync.js'
import { getAuthenticatedClient } from '../lib/google.js'

interface DashboardFilters {
  dateFrom?: string
  dateTo?: string
  customerId?: string
  campaignId?: string
}

const DIA = 86400000
const isoDia = (ms: number) => new Date(ms).toISOString().slice(0, 10)
function ontemNoBrasil(): string {
  const hoje = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date())
  return isoDia(Date.parse(hoje + 'T12:00:00Z') - DIA)
}

/**
 * Janela do relatório: sempre até ONTEM (o dia corrente ainda muda no Google) e
 * o período anterior do MESMO tamanho (len = até − de + 1; anterior = de−len … de−1).
 */
function parseDateRange(q: any) {
  const ontem = ontemNoBrasil()
  const pedidoAte = String(q?.dateTo || '').slice(0, 10) || ontem
  const toStr = pedidoAte > ontem ? ontem : pedidoAte
  const fromStr = String(q?.dateFrom || '').slice(0, 10) || isoDia(Date.parse(toStr + 'T12:00:00Z') - 29 * DIA)
  const len = Math.max(1, Math.round((Date.parse(toStr + 'T12:00:00Z') - Date.parse(fromStr + 'T12:00:00Z')) / DIA) + 1)
  const antToStr = isoDia(Date.parse(fromStr + 'T12:00:00Z') - DIA)
  const antFromStr = isoDia(Date.parse(fromStr + 'T12:00:00Z') - len * DIA)
  return {
    from: new Date(`${fromStr}T00:00:00.000Z`),
    to: new Date(`${toStr}T23:59:59.999Z`),
    fromStr, toStr, ateOntem: pedidoAte > ontem,
    // Leads do CRM: dia-calendário em Brasília.
    leadFrom: new Date(`${fromStr}T00:00:00.000-03:00`), leadTo: new Date(`${toStr}T23:59:59.999-03:00`),
    ant: { fromStr: antFromStr, toStr: antToStr, from: new Date(`${antFromStr}T00:00:00.000Z`), to: new Date(`${antToStr}T23:59:59.999Z`), leadFrom: new Date(`${antFromStr}T00:00:00.000-03:00`), leadTo: new Date(`${antToStr}T23:59:59.999-03:00`) },
  }
}

let saldoCache: { chave: string; expira: number; valor: any } | null = null

function num(v: any): number {
  if (v == null) return 0
  if (typeof v === 'number') return v
  if (typeof v === 'object' && 'toNumber' in v) return Number(v.toNumber())
  return Number(v) || 0
}

export async function googleAdsReportRoutes(app: FastifyInstance) {

  // ── GET /api/admin/google-ads-report/dashboard ────────────────
  app.get('/api/admin/google-ads-report/dashboard', { preHandler: adminOnly }, async (req) => {
    const q = (req.query as DashboardFilters) || {}
    const { from, to, fromStr, toStr, ateOntem, leadFrom, leadTo, ant } = parseDateRange(q)

    const baseWhere: any = { date: { gte: from, lte: to } }
    if (q.customerId) baseWhere.customerId = q.customerId
    if (q.campaignId) baseWhere.campaignId = q.campaignId

    // Métricas por campanha (aggregated)
    const campaignRows = await prisma.googleAdsCampaignCost.findMany({
      where: { ...baseWhere, level: 'campaign' },
      orderBy: { date: 'asc' },
    })

    const adGroupRows = await prisma.googleAdsCampaignCost.findMany({
      where: { ...baseWhere, level: 'ad_group' },
      orderBy: { date: 'asc' },
    })

    const adRows = await prisma.googleAdsCampaignCost.findMany({
      where: { ...baseWhere, level: 'ad' },
      orderBy: { date: 'asc' },
    })

    const keywordRows = await prisma.googleAdsCampaignCost.findMany({
      where: { ...baseWhere, level: 'keyword' },
      orderBy: { date: 'asc' },
    })

    // Agregação por nível
    function aggregateByKey<T extends { campaignId: string; campaignName: string; adGroupId?: string | null; adGroupName?: string | null; adId?: string | null; adName?: string | null }>(
      rows: any[],
      keyOf: (r: any) => string,
      labelsOf: (r: any) => Partial<T>,
    ) {
      const map = new Map<string, any>()
      for (const r of rows) {
        const k = keyOf(r)
        if (!map.has(k)) {
          map.set(k, {
            key: k,
            ...labelsOf(r),
            spend: 0,
            impressions: 0,
            clicks: 0,
            conversions: 0,
            conversionValue: 0,
            days: 0,
          })
        }
        const acc = map.get(k)
        acc.spend += num(r.spend)
        acc.impressions += num(r.impressions)
        acc.clicks += num(r.clicks)
        acc.conversions += num(r.conversions)
        acc.conversionValue += num(r.conversionValue)
        acc.days++
      }
      return Array.from(map.values())
    }

    const campaigns = aggregateByKey(campaignRows, r => r.campaignId, r => ({
      campaignId: r.campaignId,
      campaignName: r.campaignName,
    }))
    const adGroups = aggregateByKey(adGroupRows, r => `${r.campaignId}::${r.adGroupId}`, r => ({
      campaignId: r.campaignId,
      campaignName: r.campaignName,
      adGroupId: r.adGroupId,
      adGroupName: r.adGroupName,
    }))
    const ads = aggregateByKey(adRows, r => `${r.campaignId}::${r.adGroupId}::${r.adId}`, r => ({
      campaignId: r.campaignId,
      campaignName: r.campaignName,
      adGroupId: r.adGroupId,
      adGroupName: r.adGroupName,
      adId: r.adId,
      adName: r.adName,
    }))
    // Custo por palavra-chave (agregado por texto da keyword).
    const keywordsCost = aggregateByKey(keywordRows, r => (r.keyword || '').toLowerCase(), r => ({
      keyword: r.keyword,
      campaignName: r.campaignName,
    }))

    // ── ATRIBUIÇÃO DE LEADS DO CRM (Google) — o que identifica os leads por campanha ──
    // Espelha o Meta: cruza pelos campos google* do lead (preenchidos por ValueTrack +
    // enriquecimento por gclid), somando vendas/receita via saleDetected/saleValue.
    const leadWhere: any = { originType: 'google_ads', createdAt: { gte: leadFrom, lte: leadTo } }
    if (q.campaignId) leadWhere.googleCampaignId = q.campaignId
    const leads = await prisma.lead.findMany({
      where: leadWhere,
      select: {
        googleCampaignId: true, googleCampaignName: true,
        googleAdGroupId: true, googleAdGroupName: true,
        googleKeyword: true, saleDetected: true, saleValue: true, outcome: true,
      },
    })

    const cLead = new Map<string, any>()
    const agLead = new Map<string, any>()
    const kwLead = new Map<string, any>()
    const bump = (map: Map<string, any>, key: string, lead: any, labels: any) => {
      let a = map.get(key)
      if (!a) { a = { ...labels, leads: 0, sales: 0, revenue: 0, won: 0, lost: 0 }; map.set(key, a) }
      a.leads++
      if (lead.saleDetected) { a.sales++; a.revenue += num(lead.saleValue) }
      if (lead.outcome === 'won') a.won++
      if (lead.outcome === 'lost') a.lost++
    }
    for (const l of leads) {
      if (l.googleCampaignId) bump(cLead, l.googleCampaignId, l, { campaignId: l.googleCampaignId, campaignName: l.googleCampaignName })
      if (l.googleCampaignId && l.googleAdGroupId) bump(agLead, `${l.googleCampaignId}::${l.googleAdGroupId}`, l, { campaignId: l.googleCampaignId, campaignName: l.googleCampaignName, adGroupId: l.googleAdGroupId, adGroupName: l.googleAdGroupName })
      if (l.googleKeyword) bump(kwLead, l.googleKeyword.toLowerCase(), l, { keyword: l.googleKeyword, campaignName: l.googleCampaignName })
    }

    // Funde a atribuição de leads nas linhas de custo (e cria linhas p/ campanhas/grupos
    // que têm leads mas ainda sem custo sincronizado — nenhum lead fica de fora).
    const finalize = (row: any) => {
      row.roas = row.spend > 0 ? row.revenue / row.spend : 0
      row.roi = row.spend > 0 ? (row.revenue - row.spend) / row.spend : 0
      row.cpl = row.leads > 0 && row.spend > 0 ? row.spend / row.leads : 0
      // Conversões do Google (o "resultado" do painel do Google) e o custo de cada uma.
      row.costPerConversion = row.conversions > 0 && row.spend > 0 ? row.spend / row.conversions : 0
      row.ctr = row.impressions > 0 ? (row.clicks / row.impressions) * 100 : 0
      row.cpc = row.clicks > 0 ? row.spend / row.clicks : 0
    }
    const mergeLeads = (rows: any[], map: Map<string, any>, keyOf: (r: any) => string, labelOf: (a: any) => any) => {
      const seen = new Set<string>()
      for (const r of rows) {
        const a = map.get(keyOf(r))
        r.leads = a?.leads || 0; r.sales = a?.sales || 0; r.revenue = a?.revenue || 0
        r.won = a?.won || 0; r.lost = a?.lost || 0
        finalize(r)
        seen.add(keyOf(r))
      }
      for (const [k, a] of map) {
        if (seen.has(k)) continue
        rows.push({ ...labelOf(a), spend: 0, impressions: 0, clicks: 0, conversions: 0, conversionValue: 0, days: 0, leads: a.leads, sales: a.sales, revenue: a.revenue, won: a.won, lost: a.lost, roas: 0, roi: 0, cpl: 0 })
      }
    }
    mergeLeads(campaigns, cLead, r => r.campaignId, a => ({ campaignId: a.campaignId, campaignName: a.campaignName }))
    mergeLeads(adGroups, agLead, r => `${r.campaignId}::${r.adGroupId}`, a => ({ campaignId: a.campaignId, campaignName: a.campaignName, adGroupId: a.adGroupId, adGroupName: a.adGroupName }))
    // Anúncios não têm atribuição por lead (o lead não guarda o adId do Google) → zera.
    for (const r of ads) { r.leads = 0; r.sales = 0; r.revenue = 0; r.won = 0; r.lost = 0; finalize(r) }

    // Palavras-chave: junta custo (keyword_view) + leads (Lead.googleKeyword).
    const kwMap = new Map<string, any>()
    for (const kc of keywordsCost) {
      const k = (kc.keyword || '').toLowerCase()
      if (!k) continue
      kwMap.set(k, { keyword: kc.keyword, campaignName: kc.campaignName, spend: kc.spend, clicks: kc.clicks, impressions: kc.impressions, leads: 0, sales: 0, revenue: 0, won: 0, lost: 0 })
    }
    for (const [k, a] of kwLead) {
      const e = kwMap.get(k) || { keyword: a.keyword, campaignName: a.campaignName, spend: 0, clicks: 0, impressions: 0, leads: 0, sales: 0, revenue: 0, won: 0, lost: 0 }
      e.leads = a.leads; e.sales = a.sales; e.revenue = a.revenue; e.won = a.won; e.lost = a.lost
      if (!e.keyword) e.keyword = a.keyword
      kwMap.set(k, e)
    }
    const keywords = Array.from(kwMap.values()).map(e => { finalize(e); return e })
      .sort((a, b) => b.revenue - a.revenue || b.leads - a.leads || b.spend - a.spend)

    // Status/tipo atuais da campanha: o da linha mais recente sincronizada.
    const ultimoStatus = new Map<string, { status: string | null; tipo: string | null }>()
    for (const r of campaignRows) {
      const raw: any = r.raw || {}
      if (raw.campaignStatus) ultimoStatus.set(r.campaignId, { status: raw.campaignStatus === 'ENABLED' ? 'ACTIVE' : raw.campaignStatus, tipo: raw.channelType || null })
    }
    for (const c of campaigns) { const st = ultimoStatus.get(c.campaignId); c.status = st?.status ?? null; c.channelType = st?.tipo ?? null }

    const totalSpend = campaigns.reduce((s, c) => s + c.spend, 0)
    const totalClicks = campaigns.reduce((s, c) => s + c.clicks, 0)
    const totalImpressions = campaigns.reduce((s, c) => s + c.impressions, 0)
    const totalConversions = campaigns.reduce((s, c) => s + c.conversions, 0)
    const totalLeads = leads.length
    const totalSales = leads.filter(l => l.saleDetected).length
    const totalRevenue = leads.reduce((s, l) => (l.saleDetected ? s + num(l.saleValue) : s), 0)
    const roas = totalSpend > 0 ? totalRevenue / totalSpend : 0
    const roi = totalSpend > 0 ? (totalRevenue - totalSpend) / totalSpend : 0
    const cpl = totalLeads > 0 && totalSpend > 0 ? totalSpend / totalLeads : 0
    const cpc = totalClicks > 0 ? totalSpend / totalClicks : 0
    const costPerConversion = totalConversions > 0 && totalSpend > 0 ? totalSpend / totalConversions : 0
    const ctr = totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0
    const conversionRate = totalClicks > 0 ? (totalConversions / totalClicks) * 100 : 0

    // Período anterior do mesmo tamanho (só nível campanha + leads do CRM).
    const antWhere: any = { level: 'campaign', date: { gte: ant.from, lte: ant.to } }
    if (q.customerId) antWhere.customerId = q.customerId
    if (q.campaignId) antWhere.campaignId = q.campaignId
    const antRows = await prisma.googleAdsCampaignCost.findMany({ where: antWhere, select: { spend: true, clicks: true, impressions: true, conversions: true } })
    const antSpend = antRows.reduce((s, r) => s + num(r.spend), 0)
    const antConv = antRows.reduce((s, r) => s + num(r.conversions), 0)
    const antClicks = antRows.reduce((s, r) => s + num(r.clicks), 0)
    const antImpr = antRows.reduce((s, r) => s + num(r.impressions), 0)
    const antLeads = await prisma.lead.count({ where: { ...leadWhere, createdAt: { gte: ant.leadFrom, lte: ant.leadTo } } })
    const previous = {
      from: ant.fromStr, to: ant.toStr,
      spend: antSpend, conversions: antConv, clicks: antClicks, impressions: antImpr, leads: antLeads,
      costPerConversion: antConv > 0 && antSpend > 0 ? antSpend / antConv : 0,
      cpc: antClicks > 0 ? antSpend / antClicks : 0,
      cpl: antLeads > 0 && antSpend > 0 ? antSpend / antLeads : 0,
    }
    const ultimaSync = await prisma.googleAdsCampaignCost.findFirst({ where: { level: 'campaign', ...(q.customerId ? { customerId: q.customerId } : {}) }, orderBy: { updatedAt: 'desc' }, select: { updatedAt: true } }).catch(() => null)

    // Daily breakdown (todas as linhas campaign)
    const dailyMap = new Map<string, { date: string; spend: number; clicks: number; impressions: number; conversions: number }>()
    for (const r of campaignRows) {
      const day = r.date.toISOString().slice(0, 10)
      const cur = dailyMap.get(day) || { date: day, spend: 0, clicks: 0, impressions: 0, conversions: 0 }
      cur.spend += num(r.spend)
      cur.clicks += num(r.clicks)
      cur.impressions += num(r.impressions)
      cur.conversions += num(r.conversions)
      dailyMap.set(day, cur)
    }
    const daily = Array.from(dailyMap.values()).sort((a, b) => a.date.localeCompare(b.date))

    return {
      dateRange: { from: fromStr, to: toStr, ateOntem },
      previous,
      ultimaSincronizacao: ultimaSync?.updatedAt ?? null,
      kpis: {
        costPerConversion,
        ctr,
        conversionRate,
        totalSpend,
        totalClicks,
        totalImpressions,
        totalConversions,
        totalLeads,
        totalSales,
        totalRevenue,
        roas,
        roi,
        cpl,
        cpc,
      },
      campaigns: campaigns.sort((a, b) => b.revenue - a.revenue || b.spend - a.spend),
      adGroups: adGroups.sort((a, b) => b.revenue - a.revenue || b.spend - a.spend),
      ads: ads.sort((a, b) => b.spend - a.spend),
      keywords,
      daily,
    }
  })

  // ── GET /api/admin/google-ads-report/saldo — orçamento da conta (account_budget) ──
  // Com limite de gastos: saldo = limite aprovado − valor já veiculado. Sem limite
  // (pagamento automático): não há saldo pré-pago, só o total gasto. Cache 10 min.
  app.get('/api/admin/google-ads-report/saldo', { preHandler: adminOnly }, async (req) => {
    const q = (req.query as any) || {}
    const configs = await prisma.googleAdsConfig.findMany({ where: { active: true, ...(q.customerId ? { customerId: String(q.customerId) } : {}) } })
    const chave = configs.map((c) => c.customerId).join(',')
    if (saldoCache && saldoCache.chave === chave && saldoCache.expira > Date.now()) return saldoCache.valor
    const dev = await getDeveloperToken()
    const login = await getLoginCustomerId()
    const contas: any[] = []
    const erros: string[] = []
    for (const c of configs) {
      try {
        if (!dev) throw new Error('Developer Token não configurado')
        const at = (await (await getAuthenticatedClient(c.connectionId)).getAccessToken()).token
        if (!at) throw new Error('OAuth sem access token')
        const [cli] = await callSearchStream(c.customerId, at, dev, login, 'SELECT customer.descriptive_name, customer.currency_code FROM customer')
        const orc = await callSearchStream(c.customerId, at, dev, login,
          "SELECT account_budget.status, account_budget.approved_spending_limit_micros, account_budget.approved_spending_limit_type, account_budget.amount_served_micros, account_budget.approved_end_date_time FROM account_budget WHERE account_budget.status = 'APPROVED'")
        const m = (v: any) => (v == null ? null : Number(v) / 1_000_000)
        // Orçamento vigente: o aprovado sem data de fim ou com fim mais distante.
        const b = orc.map((r: any) => r.accountBudget).sort((x: any, y: any) => String(y?.approvedEndDateTime || '9999').localeCompare(String(x?.approvedEndDateTime || '9999')))[0]
        const ilimitado = !b || b.approvedSpendingLimitType === 'INFINITE'
        const limite = ilimitado ? null : m(b.approvedSpendingLimitMicros)
        const gasto = m(b?.amountServedMicros) ?? 0
        contas.push({
          customerId: c.customerId, nome: cli?.customer?.descriptiveName || c.customerId, moeda: cli?.customer?.currencyCode || 'BRL',
          ilimitado, limiteDeGastos: limite, gastoNoOrcamento: gasto,
          saldoDisponivel: limite != null ? Math.max(0, limite - gasto) : null,
          fimDoOrcamento: b?.approvedEndDateTime || null,
        })
      } catch (e: any) { erros.push(`${c.customerId}: ${e?.message || e}`) }
    }
    const valor = { contas, erros: erros.length ? erros : undefined, consultadoEm: new Date().toISOString() }
    saldoCache = { chave, expira: Date.now() + 10 * 60_000, valor }
    return valor
  })

  // ── GET /api/admin/google-ads-report/campaigns — lista campanhas únicas
  app.get('/api/admin/google-ads-report/campaigns', { preHandler: adminOnly }, async () => {
    const rows = await prisma.googleAdsCampaignCost.findMany({
      where: { level: 'campaign' },
      select: { campaignId: true, campaignName: true, customerId: true },
      distinct: ['campaignId'],
      orderBy: { campaignName: 'asc' },
      take: 500,
    })
    return { data: rows }
  })

  // ── POST /api/admin/google-ads-report/sync — sincroniza insights ──
  app.post('/api/admin/google-ads-report/sync', { preHandler: adminOnly }, async (req, reply) => {
    const body = (req.body as any) || {}
    const customerId = String(body.customerId || '').trim()
    if (!customerId) return reply.code(400).send({ error: 'customerId obrigatório' })

    const config = await prisma.googleAdsConfig.findFirst({ where: { customerId, active: true } })
    if (!config) return reply.code(404).send({ error: 'Conexão Google Ads ativa não encontrada para esse customerId' })

    try {
      const summary = await syncGoogleAdsInsights(
        config.connectionId,
        customerId,
        typeof body.dateFrom === 'string' ? body.dateFrom : undefined,
        typeof body.dateTo === 'string' ? body.dateTo : undefined,
      )
      return { ok: true, summary }
    } catch (e: any) {
      return reply.code(500).send({ error: e?.message || 'sync failed' })
    }
  })

  // ── DELETE /api/admin/google-ads-report/costs/:id — admin remove linha
  app.delete('/api/admin/google-ads-report/costs/:id', { preHandler: adminOnly }, async (req, reply) => {
    const { id } = req.params as any
    try {
      await prisma.googleAdsCampaignCost.delete({ where: { id: parseInt(id) } })
      return { ok: true }
    } catch (e: any) {
      return reply.code(404).send({ error: e.message })
    }
  })
}
