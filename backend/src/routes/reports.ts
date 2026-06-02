// src/routes/reports.ts
// Geração de relatórios PDF white-label

import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { authMiddleware } from '../lib/auth.js'
import { getBranding } from '../lib/branding.js'

export async function reportsRoutes(app: FastifyInstance) {

  // GET /api/admin/reports/loss-reasons — Agregação de leads perdidos por objeção
  // Query params: from, to (ISO), funnelId, teamId, lostReasonIds (csv)
  // Resposta: top objeções no período + tendência semanal das top 5
  app.get('/api/admin/reports/loss-reasons', { preHandler: authMiddleware }, async (req) => {
    const q = req.query as any
    const now = new Date()
    const defaultFrom = new Date(now.getTime() - 30 * 86_400_000)
    const from = q.from ? new Date(String(q.from)) : defaultFrom
    const to = q.to ? new Date(String(q.to)) : now

    const where: any = { outcome: 'lost', outcomeAt: { gte: from, lte: to } }
    if (q.funnelId) where.funnelId = parseInt(String(q.funnelId))
    if (q.teamId) where.teamId = parseInt(String(q.teamId))
    if (q.lostReasonIds) {
      const ids = String(q.lostReasonIds).split(',').map(Number).filter(Number.isInteger)
      if (ids.length > 0) where.lostReasonId = { in: ids }
    }

    const [byReason, totalClassified, totalLost, allReasons] = await Promise.all([
      prisma.lead.groupBy({
        by: ['lostReasonId'],
        where,
        _count: { _all: true },
        _sum: { saleValue: true },
      }),
      prisma.lead.count({ where: { outcome: { in: ['won', 'lost'] }, outcomeAt: { gte: from, lte: to } } }),
      prisma.lead.count({ where: { outcome: 'lost', outcomeAt: { gte: from, lte: to } } }),
      prisma.lossReason.findMany({ select: { id: true, name: true, color: true, active: true } }),
    ])
    const reasonMap = new Map(allReasons.map(r => [r.id, r]))

    const breakdown = byReason
      .map(row => {
        const meta = row.lostReasonId != null ? reasonMap.get(row.lostReasonId) : null
        const count = row._count._all
        return {
          reasonId: row.lostReasonId,
          name: meta?.name ?? (row.lostReasonId == null ? 'Sem objeção' : 'Objeção removida'),
          color: meta?.color ?? '#94a3b8',
          active: meta?.active ?? false,
          count,
          totalSaleValue: row._sum.saleValue ? Number(row._sum.saleValue) : 0,
          percentOfLost: totalLost > 0 ? Math.round((count / totalLost) * 1000) / 10 : 0,
          percentOfClassified: totalClassified > 0 ? Math.round((count / totalClassified) * 1000) / 10 : 0,
        }
      })
      .sort((a, b) => b.count - a.count)

    // Tendência semanal das top 5 objeções (até 12 semanas no período)
    const top5 = breakdown.slice(0, 5).map(b => b.reasonId).filter((id): id is number => id != null)
    let trend: Array<{ weekStart: string; reasonId: number; count: number }> = []
    if (top5.length > 0) {
      const rows = await prisma.lead.findMany({
        where: { outcome: 'lost', outcomeAt: { gte: from, lte: to }, lostReasonId: { in: top5 } },
        select: { lostReasonId: true, outcomeAt: true },
      })
      const buckets = new Map<string, number>()
      for (const r of rows) {
        if (!r.outcomeAt || r.lostReasonId == null) continue
        const d = new Date(r.outcomeAt)
        const day = d.getUTCDay()
        const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - ((day + 6) % 7)))
        const key = `${monday.toISOString().slice(0, 10)}::${r.lostReasonId}`
        buckets.set(key, (buckets.get(key) || 0) + 1)
      }
      trend = Array.from(buckets.entries()).map(([key, count]) => {
        const [weekStart, reasonId] = key.split('::')
        return { weekStart, reasonId: Number(reasonId), count }
      }).sort((a, b) => a.weekStart.localeCompare(b.weekStart))
    }

    return {
      from: from.toISOString(),
      to: to.toISOString(),
      totalClassified,
      totalLost,
      breakdown,
      trend,
    }
  })

  // GET /api/admin/reports/meta-ads-report-pdf — Relatório PDF Meta Ads
  app.get('/api/admin/reports/meta-ads-report-pdf', { preHandler: authMiddleware }, async (req, reply) => {
    const q = req.query as any
    const days = parseInt(q.days) || 30
    // Aceita dateFrom/dateTo (paridade com /dashboard) OU `days`
    const since = q.dateFrom ? new Date(q.dateFrom + 'T00:00:00-03:00') : (() => {
      const d = new Date(); d.setDate(d.getDate() - days); return d
    })()
    const until = q.dateTo ? new Date(q.dateTo + 'T23:59:59.999-03:00') : new Date()
    const funnelId = q.funnelId ? parseInt(q.funnelId, 10) : null

    const branding = await getBranding()
    const brandName = branding.brandName || 'BeyondHub'

    // Buscar dados
    const [leadsByOrigin, costs, totalLeads, totalSales, totalLost, totalWon, leadsAds] = await Promise.all([
      prisma.$queryRaw`
        SELECT COALESCE(originType, 'unknown') as origin, COUNT(*) as leads,
          COUNT(CASE WHEN saleDetected = true THEN 1 END) as sales,
          COALESCE(SUM(CASE WHEN saleDetected = true THEN saleValue ELSE 0 END), 0) as revenue,
          COUNT(CASE WHEN outcome = 'lost' THEN 1 END) as lost,
          COUNT(CASE WHEN outcome = 'won' THEN 1 END) as won
        FROM bychat_leads WHERE createdAt >= ${since} AND createdAt <= ${until}
        GROUP BY COALESCE(originType, 'unknown') ORDER BY leads DESC
      ` as Promise<any[]>,
      prisma.$queryRaw`
        SELECT SUM(spend) as totalSpend, SUM(impressions) as totalImpressions,
          SUM(clicks) as totalClicks FROM bychat_campaign_costs WHERE date >= ${since} AND date <= ${until}
      ` as Promise<any[]>,
      prisma.lead.count({ where: { createdAt: { gte: since, lte: until } } }),
      prisma.lead.count({ where: { saleDetected: true, saleDetectedAt: { gte: since, lte: until } } }),
      prisma.lead.count({ where: { outcome: 'lost', createdAt: { gte: since, lte: until } } }),
      prisma.lead.count({ where: { outcome: 'won', createdAt: { gte: since, lte: until } } }),
      // Leads vinculados a anúncios — usado para funil + top campanhas
      prisma.lead.findMany({
        where: {
          campaignId: { not: null },
          createdAt: { gte: since, lte: until },
          ...(funnelId ? { funnelId } : {}),
        },
        select: {
          id: true, campaignId: true, campaignName: true, status: true,
          saleDetected: true, saleValue: true, outcome: true,
        },
      }),
    ])

    const totalSpend = Number(costs?.[0]?.totalSpend || 0)
    const totalRevenue = Number(leadsByOrigin?.reduce((s: number, r: any) => s + Number(r.revenue), 0) || 0)
    const roas = totalSpend > 0 ? (totalRevenue / totalSpend).toFixed(2) : 'N/A'
    const roi = totalSpend > 0 ? (((totalRevenue - totalSpend) / totalSpend) * 100).toFixed(0) : 'N/A'
    const cpl = totalLeads > 0 && totalSpend > 0 ? (totalSpend / totalLeads).toFixed(2) : 'N/A'
    const cpv = totalSales > 0 && totalSpend > 0 ? (totalSpend / totalSales).toFixed(2) : 'N/A'
    const convRate = totalLeads > 0 ? ((totalSales / totalLeads) * 100).toFixed(1) : '0'
    const winRate = (totalWon + totalLost) > 0 ? ((totalWon / (totalWon + totalLost)) * 100).toFixed(1) : '0'

    // Agregar campanhas (top 10 por leads) + funil
    const campaignAgg: Record<string, { id: string; name: string; leads: number; sales: number; revenue: number; lost: number; spend: number }> = {}
    for (const lead of leadsAds) {
      const cid = lead.campaignId || '_unknown'
      if (!campaignAgg[cid]) campaignAgg[cid] = { id: cid, name: lead.campaignName || 'Sem campanha', leads: 0, sales: 0, revenue: 0, lost: 0, spend: 0 }
      const c = campaignAgg[cid]
      c.leads++
      if (lead.saleDetected) { c.sales++; c.revenue += Number(lead.saleValue ?? 0) }
      if (lead.outcome === 'lost') c.lost++
    }
    // Spend por campanha no período
    const spendByCampaign = await prisma.campaignCost.groupBy({
      by: ['campaignId'],
      where: { date: { gte: since, lte: until } },
      _sum: { spend: true },
    })
    for (const s of spendByCampaign) {
      if (campaignAgg[s.campaignId]) {
        campaignAgg[s.campaignId].spend = Number(s._sum.spend || 0)
      }
    }
    const topCampaigns = Object.values(campaignAgg)
      .sort((a, b) => b.leads - a.leads || b.revenue - a.revenue)
      .slice(0, 10)

    // Funil — etapas do funil escolhido
    let funnelData: { name: string; stages: { name: string; color: string; count: number; conversionFromTop: number; ticketAvg: number }[] } | null = null
    if (funnelId && leadsAds.length > 0) {
      const funnel = await prisma.funnel.findUnique({ where: { id: funnelId }, select: { id: true, name: true } })
      if (funnel) {
        const stages = await prisma.stage.findMany({
          where: { funnelId, active: true },
          orderBy: { position: 'asc' },
          select: { key: true, name: true, color: true },
        })
        const filteredIds = leadsAds.map(l => l.id)
        const events = filteredIds.length > 0 && stages.length > 0
          ? await prisma.leadEvent.findMany({
              where: {
                leadId: { in: filteredIds },
                type: 'status_changed',
                newValue: { in: stages.map(s => s.key) },
              },
              select: { leadId: true, newValue: true },
            })
          : []
        const passed: Record<string, Set<number>> = {}
        for (const s of stages) passed[s.key] = new Set()
        for (const e of events) if (e.newValue && passed[e.newValue]) passed[e.newValue].add(e.leadId)
        for (const lead of leadsAds) if (lead.status && passed[lead.status]) passed[lead.status].add(lead.id)

        const revByStatus: Record<string, { rev: number; sales: number }> = {}
        for (const lead of leadsAds) {
          if (!lead.saleDetected || !lead.status) continue
          if (!revByStatus[lead.status]) revByStatus[lead.status] = { rev: 0, sales: 0 }
          revByStatus[lead.status].rev += Number(lead.saleValue ?? 0)
          revByStatus[lead.status].sales++
        }
        const top = leadsAds.length
        funnelData = {
          name: funnel.name,
          stages: stages.map(s => {
            const count = passed[s.key].size
            const r = revByStatus[s.key]
            return {
              name: s.name,
              color: s.color || '#4361ee',
              count,
              conversionFromTop: top > 0 ? (count / top) * 100 : 0,
              ticketAvg: r && r.sales > 0 ? r.rev / r.sales : 0,
            }
          }),
        }
      }
    }

    // Gerar PDF
    const PDFDocument = (await import('pdfkit')).default

    const doc = new PDFDocument({ size: 'A4', margin: 50, info: {
      Title: `Relatório Meta Ads — ${brandName}`,
      Author: brandName,
    }})

    const chunks: Buffer[] = []
    doc.on('data', (c: Buffer) => chunks.push(c))

    const dateStr = new Date().toLocaleDateString('pt-BR')
    const periodStr = `${since.toLocaleDateString('pt-BR')} — ${new Date().toLocaleDateString('pt-BR')}`

    // ── Header ──
    doc.fontSize(22).font('Helvetica-Bold').text(brandName, 50, 50)
    doc.fontSize(10).font('Helvetica').fillColor('#666')
      .text(`Relatório de Performance Meta Ads`, 50, 78)
    doc.text(`Período: ${periodStr} | Gerado em: ${dateStr}`, 50, 92)
    doc.moveTo(50, 115).lineTo(545, 115).stroke('#4361ee')

    // ── Resumo Executivo ──
    doc.moveDown(2)
    doc.fontSize(14).font('Helvetica-Bold').fillColor('#1a1a2e').text('Resumo Executivo', 50)
    doc.moveDown(0.5)

    const y1 = doc.y
    const col1 = 50, col2 = 185, col3 = 320, col4 = 455

    // KPI boxes
    const drawKPI = (x: number, y: number, label: string, value: string) => {
      doc.save()
      doc.rect(x, y, 120, 55).fill('#f4f6ff')
      doc.fontSize(9).font('Helvetica').fillColor('#666').text(label, x + 8, y + 8, { width: 104 })
      doc.fontSize(16).font('Helvetica-Bold').fillColor('#1a1a2e').text(value, x + 8, y + 26, { width: 104 })
      doc.restore()
    }

    drawKPI(col1, y1, 'Investimento', `R$ ${totalSpend.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`)
    drawKPI(col2, y1, 'Leads Gerados', String(totalLeads))
    drawKPI(col3, y1, 'Vendas Detectadas', String(totalSales))
    drawKPI(col4, y1, 'Faturamento', `R$ ${totalRevenue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`)

    doc.moveDown(5)
    const y2 = doc.y
    drawKPI(col1, y2, 'ROI', roi === 'N/A' ? 'N/A' : `${roi}%`)
    drawKPI(col2, y2, 'ROAS', `${roas}x`)
    drawKPI(col3, y2, 'CPL (Custo/Lead)', cpl === 'N/A' ? 'N/A' : `R$ ${cpl}`)
    drawKPI(col4, y2, 'Taxa de Conversão', `${convRate}%`)

    doc.moveDown(5)
    const y3 = doc.y
    drawKPI(col1, y3, 'CPV (Custo/Venda)', cpv === 'N/A' ? 'N/A' : `R$ ${cpv}`)
    drawKPI(col2, y3, 'Ganhos', String(totalWon))
    drawKPI(col3, y3, 'Perdas', String(totalLost))
    drawKPI(col4, y3, 'Win Rate', `${winRate}%`)

    // ── Funil Detalhado (quando funnelId fornecido) ──
    if (funnelData && funnelData.stages.length > 0) {
      doc.moveDown(7)
      // Page break se chegar muito perto do fim
      if (doc.y > 650) doc.addPage()
      doc.fontSize(14).font('Helvetica-Bold').fillColor('#1a1a2e').text(`Funil Detalhado — ${funnelData.name}`, 50)
      doc.moveDown(0.5)
      doc.fontSize(9).font('Helvetica').fillColor('#666').text(`${leadsAds.length} leads no topo`, 50)
      doc.moveDown(0.5)

      let fy = doc.y
      const maxBarW = 360
      for (const stage of funnelData.stages) {
        const barW = leadsAds.length > 0 ? Math.max(2, (stage.count / Math.max(1, leadsAds.length)) * maxBarW) : 0
        // nome
        doc.fontSize(9).font('Helvetica-Bold').fillColor('#333').text(stage.name, 50, fy + 4, { width: 110, ellipsis: true })
        // barra
        doc.save()
        doc.rect(165, fy, maxBarW, 18).fill('#f0f0f0')
        if (barW > 0) {
          doc.rect(165, fy, barW, 18).fill(stage.color || '#4361ee')
        }
        doc.restore()
        // count
        doc.fontSize(9).font('Helvetica-Bold').fillColor('#1a1a2e').text(String(stage.count), 170, fy + 4, { width: barW > 30 ? barW - 10 : 30 })
        // ticket inline (se houver)
        if (stage.ticketAvg > 0) {
          doc.fontSize(8).font('Helvetica').fillColor('#666')
            .text(`ticket R$ ${stage.ticketAvg.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`, 170 + Math.min(barW, maxBarW - 80), fy + 5)
        }
        // conversão direita
        doc.fontSize(9).font('Helvetica-Bold').fillColor(stage.conversionFromTop >= 50 ? '#10b981' : stage.conversionFromTop >= 20 ? '#333' : '#f59e0b')
          .text(`${stage.conversionFromTop.toFixed(1)}%`, 535, fy + 4, { width: 50, align: 'right' })
        fy += 22
      }
      doc.y = fy
    }

    // ── Top Campanhas (quando há leads de ads) ──
    if (topCampaigns.length > 0) {
      doc.moveDown(2)
      if (doc.y > 620) doc.addPage()
      doc.fontSize(14).font('Helvetica-Bold').fillColor('#1a1a2e').text('Top 10 Campanhas', 50)
      doc.moveDown(0.5)

      let cy = doc.y
      doc.fontSize(8).font('Helvetica-Bold').fillColor('#fff')
      doc.rect(50, cy, 495, 20).fill('#4361ee')
      doc.text('Campanha', 55, cy + 6, { width: 175 })
      doc.text('Invest.', 230, cy + 6, { width: 60, align: 'right' })
      doc.text('Leads', 295, cy + 6, { width: 38, align: 'right' })
      doc.text('Vendas', 335, cy + 6, { width: 40, align: 'right' })
      doc.text('Receita', 380, cy + 6, { width: 70, align: 'right' })
      doc.text('ROI', 455, cy + 6, { width: 40, align: 'right' })
      doc.text('Perdas', 495, cy + 6, { width: 45, align: 'right' })
      cy += 22

      topCampaigns.forEach((c, idx) => {
        if (cy > 770) { doc.addPage(); cy = 50 }
        const roiC = c.spend > 0 ? (((c.revenue - c.spend) / c.spend) * 100).toFixed(0) : '–'
        if (idx % 2 === 0) {
          doc.rect(50, cy, 495, 18).fill('#f9f9f9')
        }
        doc.font('Helvetica').fontSize(8).fillColor('#333')
        doc.text(c.name.length > 38 ? c.name.slice(0, 35) + '…' : c.name, 55, cy + 5, { width: 175 })
        doc.text(c.spend > 0 ? `R$ ${c.spend.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : '–', 230, cy + 5, { width: 60, align: 'right' })
        doc.text(String(c.leads), 295, cy + 5, { width: 38, align: 'right' })
        doc.text(c.sales > 0 ? String(c.sales) : '–', 335, cy + 5, { width: 40, align: 'right' })
        doc.text(c.revenue > 0 ? `R$ ${c.revenue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : '–', 380, cy + 5, { width: 70, align: 'right' })
        doc.fillColor(roiC === '–' ? '#999' : (Number(roiC) >= 0 ? '#10b981' : '#f59e0b')).font('Helvetica-Bold')
          .text(roiC === '–' ? '–' : `${Number(roiC) >= 0 ? '+' : ''}${roiC}%`, 455, cy + 5, { width: 40, align: 'right' })
        doc.fillColor(c.lost > 0 ? '#dc2626' : '#999').font('Helvetica')
          .text(c.lost > 0 ? String(c.lost) : '–', 495, cy + 5, { width: 45, align: 'right' })
        cy += 18
      })
      doc.y = cy
    }

    // ── Leads por Origem ──
    doc.moveDown(2)
    if (doc.y > 700) doc.addPage()
    doc.fontSize(14).font('Helvetica-Bold').fillColor('#1a1a2e').text('Performance por Origem', 50)
    doc.moveDown(0.5)

    // Tabela header
    const originLabels: Record<string, string> = {
      trackable_link: 'Links Rastreáveis', meta_ctwa: 'Meta Ads (CTWA)',
      google_ads: 'Google Ads', meta_lead_ads: 'Meta Ads',
      organic: 'Orgânico', web_form: 'Formulário Web',
      whatsapp: 'WhatsApp', instagram: 'Instagram Direct', telegram: 'Telegram',
      web_chat: 'Chat do Site',
      enrollment_portal: 'Portal de Matrícula',
      landing_page: 'Landing Page', api: 'API', chatbot: 'Chatbot',
      manual: 'Manual', unknown: 'Não identificado',
    }

    let ty = doc.y
    doc.fontSize(9).font('Helvetica-Bold').fillColor('#fff')
    doc.rect(50, ty, 495, 20).fill('#4361ee')
    doc.text('Origem', 55, ty + 5, { width: 130 })
    doc.text('Leads', 185, ty + 5, { width: 50, align: 'right' })
    doc.text('Vendas', 240, ty + 5, { width: 50, align: 'right' })
    doc.text('Receita', 295, ty + 5, { width: 75, align: 'right' })
    doc.text('Conv.', 375, ty + 5, { width: 50, align: 'right' })
    doc.text('Perdas', 430, ty + 5, { width: 60, align: 'right' })
    ty += 22

    for (const row of (leadsByOrigin || [])) {
      const leads = Number(row.leads)
      const sales = Number(row.sales)
      const revenue = Number(row.revenue)
      const lost = Number(row.lost || 0)
      const rate = leads > 0 ? ((sales / leads) * 100).toFixed(1) : '0'
      if (ty > 770) { doc.addPage(); ty = 50 }

      doc.font('Helvetica').fontSize(9).fillColor('#333')
      if ((leadsByOrigin || []).indexOf(row) % 2 === 0) {
        doc.rect(50, ty, 495, 18).fill('#f9f9f9')
        doc.fillColor('#333')
      }
      doc.text(originLabels[row.origin] || row.origin, 55, ty + 4, { width: 130 })
      doc.text(String(leads), 185, ty + 4, { width: 50, align: 'right' })
      doc.text(String(sales), 240, ty + 4, { width: 50, align: 'right' })
      doc.text(`R$ ${revenue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`, 295, ty + 4, { width: 75, align: 'right' })
      doc.text(`${rate}%`, 375, ty + 4, { width: 50, align: 'right' })
      doc.fillColor(lost > 0 ? '#dc2626' : '#999')
        .text(lost > 0 ? String(lost) : '–', 430, ty + 4, { width: 60, align: 'right' })
      ty += 18
    }

    // ── Footer ──
    doc.y = ty
    doc.moveDown(2)
    if (doc.y < 770) {
      doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke('#ddd')
      doc.moveDown(0.5)
      doc.fontSize(8).font('Helvetica').fillColor('#999')
        .text(`${brandName} — Relatório gerado automaticamente. Os dados de vendas são baseados em detecção por IA e podem necessitar de confirmação manual.`, 50, doc.y, { width: 495, align: 'center' })
    }

    doc.end()

    // Aguardar finalização
    await new Promise<void>((resolve) => doc.on('end', resolve))

    const pdf = Buffer.concat(chunks)
    const filename = `relatorio-roi-${days}d-${new Date().toISOString().slice(0, 10)}.pdf`

    return reply
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', `attachment; filename="${filename}"`)
      .send(pdf)
  })

  // GET /api/admin/reports/leads-pdf — Relatório de Leads
  app.get('/api/admin/reports/leads-pdf', { preHandler: authMiddleware }, async (req, reply) => {
    const q = req.query as any
    const days = parseInt(q.days) || 30
    const since = new Date()
    since.setDate(since.getDate() - days)

    const branding = await getBranding()
    const brandName = branding.brandName || 'BeyondHub'

    const leads = await prisma.lead.findMany({
      where: { createdAt: { gte: since } },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: {
        nome: true, empresa: true, email: true, whatsapp: true,
        originType: true, status: true, saleDetected: true, saleValue: true,
        createdAt: true,
      }
    })

    const PDFDocument = (await import('pdfkit')).default
    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 40, info: {
      Title: `Relatório de Leads — ${brandName}`,
      Author: brandName,
    }})

    const chunks: Buffer[] = []
    doc.on('data', (c: Buffer) => chunks.push(c))

    const periodStr = `${since.toLocaleDateString('pt-BR')} — ${new Date().toLocaleDateString('pt-BR')}`

    // Header
    doc.fontSize(18).font('Helvetica-Bold').text(`${brandName} — Relatório de Leads`, 40, 30)
    doc.fontSize(9).font('Helvetica').fillColor('#666')
      .text(`Período: ${periodStr} | Total: ${leads.length} leads | Gerado em: ${new Date().toLocaleDateString('pt-BR')}`, 40, 52)
    doc.moveTo(40, 68).lineTo(802, 68).stroke('#4361ee')

    // Table header
    let ty = 78
    doc.fontSize(8).font('Helvetica-Bold').fillColor('#fff')
    doc.rect(40, ty, 762, 16).fill('#4361ee')
    const cols = [42, 170, 270, 370, 440, 540, 610, 680, 740]
    doc.text('Nome', cols[0], ty + 3, { width: 125 })
    doc.text('Empresa', cols[1], ty + 3, { width: 98 })
    doc.text('WhatsApp', cols[2], ty + 3, { width: 98 })
    doc.text('Origem', cols[3], ty + 3, { width: 68 })
    doc.text('Status', cols[4], ty + 3, { width: 98 })
    doc.text('Venda', cols[5], ty + 3, { width: 68 })
    doc.text('Valor', cols[6], ty + 3, { width: 58 })
    doc.text('Data', cols[7], ty + 3, { width: 60 })
    ty += 18

    for (const lead of leads) {
      if (ty > 540) {
        doc.addPage()
        ty = 40
      }

      doc.font('Helvetica').fontSize(7).fillColor('#333')
      if (leads.indexOf(lead) % 2 === 0) {
        doc.rect(40, ty, 762, 14).fill('#f9f9f9')
        doc.fillColor('#333')
      }

      doc.text((lead.nome || '-').slice(0, 25), cols[0], ty + 3, { width: 125 })
      doc.text((lead.empresa || '-').slice(0, 20), cols[1], ty + 3, { width: 98 })
      doc.text(lead.whatsapp || '-', cols[2], ty + 3, { width: 98 })
      doc.text(lead.originType || '-', cols[3], ty + 3, { width: 68 })
      doc.text((lead.status || '-').slice(0, 18), cols[4], ty + 3, { width: 98 })
      doc.text(lead.saleDetected ? 'Sim' : 'Não', cols[5], ty + 3, { width: 68 })
      doc.text(lead.saleValue ? `R$ ${Number(lead.saleValue).toFixed(0)}` : '-', cols[6], ty + 3, { width: 58 })
      doc.text(new Date(lead.createdAt).toLocaleDateString('pt-BR'), cols[7], ty + 3, { width: 60 })
      ty += 14
    }

    // Footer
    doc.fontSize(7).font('Helvetica').fillColor('#999')
      .text(`${brandName} — Relatório gerado automaticamente`, 40, 560, { width: 762, align: 'center' })

    doc.end()
    await new Promise<void>((resolve) => doc.on('end', resolve))

    const pdf = Buffer.concat(chunks)
    const filename = `relatorio-leads-${days}d-${new Date().toISOString().slice(0, 10)}.pdf`

    return reply
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', `attachment; filename="${filename}"`)
      .send(pdf)
  })
}
