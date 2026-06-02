// src/services/attribution.ts
// Atribuição multi-touch — rastrear múltiplos pontos de contato por lead

import { prisma } from '../lib/prisma.js'

type AttributionModel = 'first_touch' | 'last_touch' | 'linear'

interface TouchpointData {
  leadId: number
  channel: string
  source?: string
  medium?: string
  campaign?: string
  campaignId?: string
  content?: string
  term?: string
  referrer?: string
  landingUrl?: string
  gclid?: string
  fbclid?: string
  ctwaClid?: string
}

/**
 * Registra um novo touchpoint para um lead e recalcula os pesos de atribuição.
 */
export async function recordTouchpoint(data: TouchpointData): Promise<void> {
  try {
    // Contar touchpoints existentes
    const existingCount = await prisma.leadTouchpoint.count({
      where: { leadId: data.leadId }
    })

    const touchOrder = existingCount + 1

    // Criar touchpoint
    await prisma.leadTouchpoint.create({
      data: {
        leadId: data.leadId,
        channel: data.channel,
        source: data.source || null,
        medium: data.medium || null,
        campaign: data.campaign || null,
        campaignId: data.campaignId || null,
        content: data.content || null,
        term: data.term || null,
        referrer: data.referrer || null,
        landingUrl: data.landingUrl || null,
        gclid: data.gclid || null,
        fbclid: data.fbclid || null,
        ctwaClid: data.ctwaClid || null,
        touchType: existingCount === 0 ? 'first' : 'middle',
        touchOrder,
      }
    })

    // Recalcular pesos de atribuição
    await recalculateWeights(data.leadId)
  } catch (err) {
    console.error(`[Attribution] Error recording touchpoint for lead ${data.leadId}:`, err)
  }
}

/**
 * Recalcula os pesos de atribuição para todos os touchpoints de um lead.
 */
async function recalculateWeights(leadId: number): Promise<void> {
  const touchpoints = await prisma.leadTouchpoint.findMany({
    where: { leadId },
    orderBy: { timestamp: 'asc' },
  })

  if (touchpoints.length === 0) return

  const total = touchpoints.length

  for (let i = 0; i < total; i++) {
    const tp = touchpoints[i]

    // Determinar tipo
    let touchType: string
    if (total === 1) touchType = 'only'
    else if (i === 0) touchType = 'first'
    else if (i === total - 1) touchType = 'last'
    else touchType = 'middle'

    // Calcular pesos
    const weightFirst = i === 0 ? 1 : 0                   // First-touch: 100% para primeiro
    const weightLast = i === total - 1 ? 1 : 0            // Last-touch: 100% para último
    const weightLinear = parseFloat((1 / total).toFixed(4)) // Linear: dividido igualmente

    await prisma.leadTouchpoint.update({
      where: { id: tp.id },
      data: {
        touchType,
        touchOrder: i + 1,
        weightFirst,
        weightLast,
        weightLinear,
      }
    })
  }
}

/**
 * Obtém o resumo de atribuição por campanha com base no modelo selecionado.
 */
export async function getAttributionReport(days: number, model: AttributionModel = 'linear'): Promise<any[]> {
  const since = new Date()
  since.setDate(since.getDate() - days)

  const weightField = model === 'first_touch' ? 'weightFirst'
    : model === 'last_touch' ? 'weightLast'
    : 'weightLinear'

  // Três queries separadas por modelo (Prisma não interpola nomes de coluna em raw)
  let results: any[]
  if (model === 'first_touch') {
    results = await prisma.$queryRaw`
      SELECT t.channel, t.source, t.campaign, t.campaignId,
        COUNT(DISTINCT t.leadId) as totalLeads,
        ROUND(SUM(t.weightFirst), 2) as attributedLeads,
        COUNT(DISTINCT CASE WHEN l.saleDetected = true THEN t.leadId END) as totalSales,
        COALESCE(SUM(CASE WHEN l.saleDetected = true THEN l.saleValue ELSE 0 END), 0) as totalRevenue
      FROM bychat_lead_touchpoints t
      JOIN bychat_leads l ON l.id = t.leadId
      WHERE t.createdAt >= ${since}
      GROUP BY t.channel, t.source, t.campaign, t.campaignId
      ORDER BY attributedLeads DESC
    ` as any[]
  } else if (model === 'last_touch') {
    results = await prisma.$queryRaw`
      SELECT t.channel, t.source, t.campaign, t.campaignId,
        COUNT(DISTINCT t.leadId) as totalLeads,
        ROUND(SUM(t.weightLast), 2) as attributedLeads,
        COUNT(DISTINCT CASE WHEN l.saleDetected = true THEN t.leadId END) as totalSales,
        COALESCE(SUM(CASE WHEN l.saleDetected = true THEN l.saleValue ELSE 0 END), 0) as totalRevenue
      FROM bychat_lead_touchpoints t
      JOIN bychat_leads l ON l.id = t.leadId
      WHERE t.createdAt >= ${since}
      GROUP BY t.channel, t.source, t.campaign, t.campaignId
      ORDER BY attributedLeads DESC
    ` as any[]
  } else {
    results = await prisma.$queryRaw`
      SELECT t.channel, t.source, t.campaign, t.campaignId,
        COUNT(DISTINCT t.leadId) as totalLeads,
        ROUND(SUM(t.weightLinear), 2) as attributedLeads,
        COUNT(DISTINCT CASE WHEN l.saleDetected = true THEN t.leadId END) as totalSales,
        COALESCE(SUM(CASE WHEN l.saleDetected = true THEN l.saleValue ELSE 0 END), 0) as totalRevenue
      FROM bychat_lead_touchpoints t
      JOIN bychat_leads l ON l.id = t.leadId
      WHERE t.createdAt >= ${since}
      GROUP BY t.channel, t.source, t.campaign, t.campaignId
      ORDER BY attributedLeads DESC
    ` as any[]
  }

  return (results || []).map((r: any) => ({
    channel: r.channel,
    source: r.source,
    campaign: r.campaign,
    campaignId: r.campaignId,
    totalLeads: Number(r.totalLeads),
    attributedLeads: Number(r.attributedLeads),
    totalSales: Number(r.totalSales),
    totalRevenue: Number(r.totalRevenue),
  }))
}

/**
 * Obtém a jornada completa de touchpoints de um lead.
 */
export async function getLeadJourney(leadId: number): Promise<any[]> {
  return prisma.leadTouchpoint.findMany({
    where: { leadId },
    orderBy: { timestamp: 'asc' },
  })
}
