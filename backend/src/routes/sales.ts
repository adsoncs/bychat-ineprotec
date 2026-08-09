// src/routes/sales.ts
// Dashboard e gestão de vendas detectadas — Fase 7

import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { authMiddleware, adminOnly } from '../lib/auth.js'
import { resolvePeriod } from '../lib/period.js'
import { processSaleDetection } from '../services/saleDetection.js'
import { logEvent } from '../services/leadHistory.js'

function sanitizeRaw(rows: any[]): any[] {
  return rows.map(row => {
    const obj: any = {}
    for (const [k, v] of Object.entries(row)) {
      obj[k] = typeof v === 'bigint' ? Number(v) : v
    }
    return obj
  })
}

export async function salesRoutes(app: FastifyInstance) {

  // GET /api/admin/sales — List detected sales
  app.get('/api/admin/sales', { preHandler: authMiddleware }, async (req) => {
    const q = req.query as any
    const page = parseInt(q.page) || 1
    const limit = Math.min(parseInt(q.limit) || 50, 200)
    const skip = (page - 1) * limit

    const where: any = {}
    if (q.status) where.status = q.status
    if (q.originType) where.originType = q.originType
    if (q.campaignId) where.campaignId = q.campaignId
    if (q.dateFrom || q.dateTo) {
      where.detectedAt = {}
      if (q.dateFrom) where.detectedAt.gte = new Date(q.dateFrom)
      if (q.dateTo) where.detectedAt.lte = new Date(q.dateTo)
    }

    const [sales, total] = await Promise.all([
      prisma.detectedSale.findMany({
        where,
        orderBy: { detectedAt: 'desc' },
        skip,
        take: limit,
        include: {
          lead: { select: { id: true, nome: true, empresa: true, whatsapp: true, status: true } }
        }
      }),
      prisma.detectedSale.count({ where }),
    ])

    return { sales, total, page, limit }
  })

  // GET /api/admin/sales/dashboard — Sales overview
  app.get('/api/admin/sales/dashboard', { preHandler: authMiddleware }, async (req) => {
    const q = req.query as any
    const days = parseInt(q.days) || 30
    const since = new Date()
    since.setDate(since.getDate() - days)

    const where = { detectedAt: { gte: since } }
    const confirmedWhere = { ...where, status: { in: ['detected', 'confirmed'] } }

    const [totalSales, confirmedSales, totalValueResult, salesByOrigin, salesByDay, salesByCampaign] = await Promise.all([
      prisma.detectedSale.count({ where }),
      prisma.detectedSale.count({ where: confirmedWhere }),
      prisma.detectedSale.aggregate({
        where: confirmedWhere,
        _sum: { value: true },
        _avg: { value: true },
        _count: true,
      }),
      // By origin type
      prisma.$queryRaw`
        SELECT originType, COUNT(*) as count, SUM(value) as totalValue
        FROM bychat_detected_sales
        WHERE detectedAt >= ${since} AND status IN ('detected', 'confirmed')
        GROUP BY originType
        ORDER BY count DESC
      ` as Promise<any[]>,
      // By day
      prisma.$queryRaw`
        SELECT DATE(detectedAt) as date, COUNT(*) as count, SUM(value) as totalValue
        FROM bychat_detected_sales
        WHERE detectedAt >= ${since} AND status IN ('detected', 'confirmed')
        GROUP BY DATE(detectedAt)
        ORDER BY date ASC
      ` as Promise<any[]>,
      // By campaign (top 10)
      prisma.$queryRaw`
        SELECT campaignName, campaignId, COUNT(*) as count, SUM(value) as totalValue
        FROM bychat_detected_sales
        WHERE detectedAt >= ${since} AND status IN ('detected', 'confirmed') AND campaignName IS NOT NULL
        GROUP BY campaignName, campaignId
        ORDER BY totalValue DESC
        LIMIT 10
      ` as Promise<any[]>,
    ])

    return {
      totalSales,
      confirmedSales,
      totalValue: totalValueResult._sum.value || 0,
      avgTicket: totalValueResult._avg.value || 0,
      salesByOrigin: sanitizeRaw(salesByOrigin),
      salesByDay: sanitizeRaw(salesByDay),
      salesByCampaign: sanitizeRaw(salesByCampaign),
    }
  })

  // GET /api/admin/sales/:id — Sale detail
  app.get('/api/admin/sales/:id', { preHandler: authMiddleware }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const sale = await prisma.detectedSale.findUnique({
      where: { id: parseInt(id) },
      include: {
        lead: { select: { id: true, nome: true, empresa: true, whatsapp: true, email: true, status: true, originType: true } }
      }
    })
    if (!sale) return reply.code(404).send({ error: 'Venda não encontrada' })
    return { sale }
  })

  // PUT /api/admin/sales/:id/confirm — Confirm sale
  app.put('/api/admin/sales/:id/confirm', { preHandler: adminOnly }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const body = req.body as any
    const userId = (req as any).user?.id

    const sale = await prisma.detectedSale.update({
      where: { id: parseInt(id) },
      data: {
        status: 'confirmed',
        confirmedBy: userId,
        confirmedAt: new Date(),
        ...(body.value !== undefined ? { value: body.value } : {}),
      }
    })

    // Dispara CAPI 'Purchase' com value real — sinal mais valioso pro Meta
    // otimizar campanhas. Fire-and-forget, dedup já existe no service.
    ;(async () => {
      try {
        const { sendCapiEvent } = await import('../services/metaCapi.js')
        await sendCapiEvent({
          leadId: sale.leadId,
          eventName: 'Purchase',
          value: sale.value ? Number(sale.value) : undefined,
          currency: sale.currency || 'BRL',
        })
      } catch { /* skip */ }
    })()

    return { ok: true, sale }
  })

  // PUT /api/admin/sales/:id/reject — Reject false positive
  app.put('/api/admin/sales/:id/reject', { preHandler: adminOnly }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const userId = (req as any).user?.id

    const sale = await prisma.detectedSale.findUnique({ where: { id: parseInt(id) } })
    if (!sale) return reply.code(404).send({ error: 'Venda não encontrada' })

    await prisma.detectedSale.update({
      where: { id: parseInt(id) },
      data: { status: 'rejected', confirmedBy: userId, confirmedAt: new Date() }
    })

    // Revert lead sale status
    await prisma.lead.update({
      where: { id: sale.leadId },
      data: { saleDetected: false, saleValue: null, saleDetectedAt: null }
    })

    return { ok: true }
  })

  // POST /api/admin/sales/analyze/:leadId — Manual trigger
  app.post('/api/admin/sales/analyze/:leadId', { preHandler: adminOnly }, async (req, reply) => {
    const { leadId } = req.params as { leadId: string }
    const lead = await prisma.lead.findUnique({ where: { id: parseInt(leadId) } })
    if (!lead) return reply.code(404).send({ error: 'Lead não encontrado' })

    await processSaleDetection(parseInt(leadId))

    const sale = await prisma.detectedSale.findFirst({
      where: { leadId: parseInt(leadId) },
      orderBy: { detectedAt: 'desc' }
    })

    return { ok: true, sale: sale || null }
  })

  // GET /api/admin/origins/stats — Origin breakdown
  // Se `originType` estiver vazio, cai pra `source` (backfill automático)
  // — leads antigos via Meta Lead Ads/webhook WhatsApp não tinham originType preenchido.
  app.get('/api/admin/origins/stats', { preHandler: authMiddleware }, async (req) => {
    const { from: since, to: until } = resolvePeriod(req.query, 30)

    // COALESCE resolve a tipagem inconsistente dos leads antigos:
    //   lead.originType foi adicionado depois; fallback para lead.source
    //   (meta_lead_ads, whatsapp, manual, web_form, web_chat, api, import)
    const [originBreakdown, originByDay, totalLeads, trackedLeads] = await Promise.all([
      prisma.$queryRaw`
        SELECT COALESCE(originType, source, 'organic') as originType, COUNT(*) as count
        FROM bychat_leads
        WHERE createdAt >= ${since} AND createdAt <= ${until}
        GROUP BY COALESCE(originType, source, 'organic')
        ORDER BY count DESC
      ` as Promise<any[]>,
      prisma.$queryRaw`
        SELECT DATE(createdAt) as date, COALESCE(originType, source, 'organic') as originType, COUNT(*) as count
        FROM bychat_leads
        WHERE createdAt >= ${since} AND createdAt <= ${until} AND qualifiedAt IS NOT NULL
        GROUP BY DATE(createdAt), COALESCE(originType, source, 'organic')
        ORDER BY date ASC
      ` as Promise<any[]>,
      prisma.lead.count({ where: { createdAt: { gte: since, lte: until }, qualifiedAt: { not: null } } }),
      // "Rastreado" = tem originType OU source OU trackingVisitorId (qualquer sinal de tráfego)
      prisma.lead.count({
        where: {
          createdAt: { gte: since, lte: until },
          qualifiedAt: { not: null },
          OR: [
            { originType: { not: null } },
            { source: { not: null } },
            { trackingVisitorId: { not: null } },
          ],
        },
      }),
    ])

    return {
      originBreakdown: sanitizeRaw(originBreakdown),
      originByDay: sanitizeRaw(originByDay),
      totalLeads,
      trackedLeads,
      trackingRate: totalLeads > 0 ? Math.round((trackedLeads / totalLeads) * 100) : 0,
    }
  })

  // GET /api/admin/sales/settings — Get sale detection settings
  app.get('/api/admin/sales/settings', { preHandler: adminOnly }, async () => {
    const keys = ['sale_detection.prompt', 'sale_detection.target_stage', 'sale_detection.enabled', 'sale_detection.interval']
    const rows = await prisma.setting.findMany({ where: { key: { in: keys } } })
    const cfg: Record<string, string> = {}
    rows.forEach(r => {
      const val = typeof r.value === 'string' ? r.value : String(r.value)
      cfg[r.key] = val.replace(/^"|"$/g, '')
    })
    return { settings: cfg }
  })

  // PUT /api/admin/sales/settings — Update sale detection settings
  app.put('/api/admin/sales/settings', { preHandler: adminOnly }, async (req) => {
    const body = req.body as Record<string, string>
    const allowed = ['sale_detection.prompt', 'sale_detection.target_stage', 'sale_detection.enabled', 'sale_detection.interval']

    for (const [key, value] of Object.entries(body)) {
      if (!allowed.includes(key)) continue
      const exists = await prisma.setting.findUnique({ where: { key } })
      if (exists) {
        await prisma.setting.update({ where: { key }, data: { value: JSON.stringify(value) } })
      } else {
        await prisma.setting.create({
          data: {
            key,
            value: JSON.stringify(value),
            label: key.replace('sale_detection.', '').replace(/_/g, ' '),
            grp: 'sale_detection',
            fieldType: 'text',
          }
        })
      }
    }
    return { ok: true }
  })
}
