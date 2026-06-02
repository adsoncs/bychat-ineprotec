// src/routes/googleAdsReport.ts
//
// Dashboard de relatórios Google Ads — espelho do `metaAdsReport.ts` (Meta).
// Lê de `GoogleAdsCampaignCost` (sincronizado via `services/googleAdsInsightsSync.ts`)
// e cruza com `Lead.gclid` + `Lead.saleValue` para calcular ROAS/ROI/Leads.

import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { adminOnly } from '../lib/auth.js'
import { syncGoogleAdsInsights } from '../services/googleAdsInsightsSync.js'

interface DashboardFilters {
  dateFrom?: string
  dateTo?: string
  customerId?: string
  campaignId?: string
}

function parseDateRange(q: any): { from: Date; to: Date; fromStr: string; toStr: string } {
  const today = new Date()
  const dEnd = q?.dateTo ? new Date(q.dateTo) : today
  const dStart = q?.dateFrom ? new Date(q.dateFrom) : new Date(today.getTime() - 29 * 24 * 60 * 60 * 1000)
  const fmt = (d: Date) => d.toISOString().slice(0, 10)
  return {
    from: new Date(`${fmt(dStart)}T00:00:00.000Z`),
    to: new Date(`${fmt(dEnd)}T23:59:59.999Z`),
    fromStr: fmt(dStart),
    toStr: fmt(dEnd),
  }
}

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
    const { from, to, fromStr, toStr } = parseDateRange(q)

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

    // Leads com gclid no período → revenue (saleValue) e count
    const leadWhere: any = {
      gclid: { not: null },
      createdAt: { gte: from, lte: to },
    }
    const leadsAgg = await prisma.lead.aggregate({
      where: leadWhere,
      _count: { _all: true },
      _sum: { saleValue: true },
    })
    const salesAgg = await prisma.lead.aggregate({
      where: { ...leadWhere, saleDetected: true },
      _count: { _all: true },
      _sum: { saleValue: true },
    })

    const totalSpend = campaigns.reduce((s, c) => s + c.spend, 0)
    const totalClicks = campaigns.reduce((s, c) => s + c.clicks, 0)
    const totalImpressions = campaigns.reduce((s, c) => s + c.impressions, 0)
    const totalConversions = campaigns.reduce((s, c) => s + c.conversions, 0)
    const totalLeads = leadsAgg._count._all || 0
    const totalSales = salesAgg._count._all || 0
    const totalRevenue = num(salesAgg._sum.saleValue)
    const roas = totalSpend > 0 ? totalRevenue / totalSpend : 0
    const roi = totalSpend > 0 ? (totalRevenue - totalSpend) / totalSpend : 0
    const cpl = totalLeads > 0 ? totalSpend / totalLeads : 0
    const cpc = totalClicks > 0 ? totalSpend / totalClicks : 0

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
      dateRange: { from: fromStr, to: toStr },
      kpis: {
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
      campaigns: campaigns.sort((a, b) => b.spend - a.spend),
      adGroups: adGroups.sort((a, b) => b.spend - a.spend),
      ads: ads.sort((a, b) => b.spend - a.spend),
      daily,
    }
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
