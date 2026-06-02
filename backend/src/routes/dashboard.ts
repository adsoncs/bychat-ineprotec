import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { adminOnly } from '../lib/auth.js'
import { getScoringConfig, LEGACY_BYCHAT_CONFIG } from '../services/scoring.js'

export async function dashboardRoutes(app: FastifyInstance) {

  // GET /api/admin/scoring-config?chatbotId=X — Retorna config de scoring (pilares, thresholds)
  app.get('/api/admin/scoring-config', { preHandler: adminOnly }, async (req) => {
    const { chatbotId } = req.query as { chatbotId?: string }
    const config = await getScoringConfig(chatbotId ? parseInt(chatbotId) : null)
    return { config }
  })

  app.get('/api/admin/dashboard', { preHandler: adminOnly }, async (req) => {
    const { dateFrom, dateTo, funnelId } = req.query as {
      dateFrom?: string
      dateTo?: string
      funnelId?: string
    }

    // Filtro de data
    const dateFilter: any = {}
    if (dateFrom) dateFilter.gte = new Date(dateFrom + 'T00:00:00.000Z')
    if (dateTo) dateFilter.lte = new Date(dateTo + 'T23:59:59.999Z')
    const hasDateFilter = dateFrom || dateTo

    // Dashboard exibe apenas leads qualificados — conversas WhatsApp ad-hoc
    // não devem inflar métricas. Conversas vivem em painel próprio.
    const leadWhere: any = { qualifiedAt: { not: null } }
    if (hasDateFilter) leadWhere.createdAt = dateFilter
    if (funnelId) leadWhere.funnelId = parseInt(funnelId)

    // ── Queries paralelas ──
    const [
      totalLeads,
      leadsByStatus,
      leadsThisWeek,
      leadsToday,
      scoresRaw,
      funnels,
      activitiesSummary,
      overdueActivities,
      landingPages,
      forms,
      metaForms,
      chatbots,
      templates,
      recentLeads,
      leadsBySource,
      leadsLast30Days,
      totalVisitors,
      tagsWithCounts,
      // Fase 24: contagens de duplicados pra KPIs "Inscrições vs Leads únicos"
      duplicatesPending,
      duplicatesKeptSeparate,
    ] = await Promise.all([
      // Total de leads
      prisma.lead.count({ where: leadWhere }),

      // Leads agrupados por status
      prisma.lead.groupBy({
        by: ['status'],
        where: leadWhere,
        _count: { status: true },
      }),

      // Leads esta semana
      prisma.lead.count({
        where: {
          ...leadWhere,
          createdAt: hasDateFilter ? dateFilter : { gte: new Date(Date.now() - 7 * 24 * 3600 * 1000) },
        },
      }),

      // Leads hoje
      prisma.lead.count({
        where: {
          ...leadWhere,
          createdAt: hasDateFilter ? dateFilter : {
            gte: new Date(new Date().setHours(0, 0, 0, 0)),
          },
        },
      }),

      // Scores e sentimento para médias
      prisma.lead.findMany({
        where: leadWhere,
        select: { scores: true, aiSentiment: true },
        take: 1000,
      }),

      // Funis com contagem de leads e stages
      prisma.funnel.findMany({
        where: { active: true },
        include: {
          stages: { where: { active: true }, orderBy: { position: 'asc' }, select: { id: true, key: true, name: true, color: true } },
          _count: { select: { leads: true } },
        },
        orderBy: { createdAt: 'asc' },
      }),

      // Atividades pendentes
      prisma.activity.count({
        where: { status: 'pending' },
      }),

      // Atividades atrasadas
      prisma.activity.count({
        where: { status: 'pending', scheduledAt: { lt: new Date() } },
      }),

      // Landing pages
      prisma.landingPage.findMany({
        select: { id: true, title: true, slug: true, status: true, views: true, submissions: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
      }),

      // Forms
      prisma.form.findMany({
        select: { id: true, name: true, active: true, submissions: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
      }),

      // Meta forms
      prisma.metaForm.findMany({
        select: { id: true, formName: true, status: true, formId: true },
      }),

      // Chatbots
      prisma.chatbot.findMany({
        select: { id: true, name: true, channel: true },
      }),

      // Templates
      prisma.messageTemplate.findMany({
        select: { id: true, name: true, channel: true, active: true, usageCount: true },
      }),

      // Últimos 10 leads
      prisma.lead.findMany({
        where: leadWhere,
        select: { id: true, nome: true, empresa: true, scores: true, status: true, createdAt: true, source: true, funnelId: true },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),

      // Leads por fonte
      prisma.lead.groupBy({
        by: ['source'],
        where: leadWhere,
        _count: { source: true },
      }),

      // Leads dos últimos 30 dias (para gráfico) — só qualificados
      prisma.lead.findMany({
        where: {
          qualifiedAt: { not: null },
          createdAt: hasDateFilter ? dateFilter : { gte: new Date(Date.now() - 30 * 24 * 3600 * 1000) },
        },
        select: { createdAt: true },
        orderBy: { createdAt: 'asc' },
      }),

      // Total de visitantes tracking
      prisma.trackingVisitor.count(),

      // Tags — distribuição
      prisma.tag.findMany({
        where: { active: true },
        orderBy: [{ position: 'asc' }],
        select: { id: true, name: true, color: true, _count: { select: { leads: true } } },
      }),

      // Fase 24: leads pendentes de revisão (duplicados não decididos)
      prisma.lead.count({ where: { ...leadWhere, duplicateStatus: 'pending_review' } }),

      // Leads marcados pelo operador como "manter separados" — contam separadamente
      prisma.lead.count({ where: { ...leadWhere, duplicateStatus: 'kept_separate' } }),
    ])

    // ── Processar dados ──

    // Status map
    const statusMap: Record<string, number> = {}
    leadsByStatus.forEach(s => { statusMap[s.status] = s._count.status })

    // Score médio
    const scoreValues = scoresRaw.map(l => (l.scores as any)?.geral || 0).filter(v => v > 0)
    const avgScore = scoreValues.length
      ? Math.round(scoreValues.reduce((a, b) => a + b, 0) / scoreValues.length)
      : 0

    // Pilares dinâmicos - detecta todos os pilares presentes nos leads
    const allPillars = new Set<string>()
    const pillarSums: Record<string, { sum: number; count: number }> = {}
    scoresRaw.forEach(l => {
      const sc = (l.scores as any) || {}
      Object.keys(sc).filter(k => k !== 'geral').forEach(k => {
        allPillars.add(k)
        if (!pillarSums[k]) pillarSums[k] = { sum: 0, count: 0 }
        if (sc[k] > 0) { pillarSums[k].sum += sc[k]; pillarSums[k].count++ }
      })
    })
    const avgPillars: Record<string, number> = {}
    allPillars.forEach(k => {
      avgPillars[k] = pillarSums[k]?.count > 0
        ? Math.round(pillarSums[k].sum / pillarSums[k].count)
        : 0
    })

    // Probabilidade média de conversão (do aiSentiment)
    const probValues = scoresRaw
      .map(l => (l.aiSentiment as any)?.probabilidade)
      .filter(v => typeof v === 'number' && v > 0)
    const avgProbability = probValues.length
      ? Math.round(probValues.reduce((a, b) => a + b, 0) / probValues.length)
      : null

    // Leads por funil com contagem por stage
    const funnelsData = await Promise.all(funnels.map(async f => {
      const stageCounts = await prisma.lead.groupBy({
        by: ['status'],
        where: { funnelId: f.id, ...leadWhere },
        _count: { status: true },
      })
      const stageMap: Record<string, number> = {}
      stageCounts.forEach(s => { stageMap[s.status] = s._count.status })
      return {
        id: f.id,
        name: f.name,
        isDefault: f.isDefault,
        totalLeads: f._count.leads,
        stages: f.stages.map(s => ({
          key: s.key,
          name: s.name,
          color: s.color,
          count: stageMap[s.key] || 0,
        })),
      }
    }))

    // Leads por dia (últimos 30 dias ou range)
    const dailyLeads: Record<string, number> = {}
    leadsLast30Days.forEach(l => {
      const day = l.createdAt.toISOString().split('T')[0]
      dailyLeads[day] = (dailyLeads[day] || 0) + 1
    })

    // Sources
    const sources = leadsBySource
      .map(s => ({ source: s.source || 'direto', count: s._count.source }))
      .sort((a, b) => b.count - a.count)

    // Landing pages resumo
    const lpStats = {
      total: landingPages.length,
      published: landingPages.filter(p => p.status === 'PUBLISHED').length,
      totalViews: landingPages.reduce((a, p) => a + (p.views || 0), 0),
      totalSubmissions: landingPages.reduce((a, p) => a + (p.submissions || 0), 0),
      pages: landingPages.slice(0, 5).map(p => ({
        id: p.id, title: p.title, slug: p.slug, status: p.status,
        views: p.views || 0, submissions: p.submissions || 0,
      })),
    }

    // Forms resumo
    const formStats = {
      total: forms.length,
      active: forms.filter(f => f.active).length,
      totalSubmissions: forms.reduce((a, f) => a + (f.submissions || 0), 0),
      forms: forms.slice(0, 5).map(f => ({
        id: f.id, name: f.name, active: f.active, submissions: f.submissions || 0,
      })),
    }

    // Meta forms resumo
    const metaStats = {
      total: metaForms.length,
      active: metaForms.filter(f => f.status === 'ACTIVE').length,
    }

    // Chatbots resumo
    const chatbotStats = {
      total: chatbots.length,
      byChannel: chatbots.reduce((acc, c) => {
        acc[c.channel] = (acc[c.channel] || 0) + 1
        return acc
      }, {} as Record<string, number>),
    }

    // Templates resumo
    const templateStats = {
      total: templates.length,
      active: templates.filter(t => t.active).length,
      byChannel: templates.reduce((acc, t) => {
        acc[t.channel] = (acc[t.channel] || 0) + 1
        return acc
      }, {} as Record<string, number>),
    }

    // Fase 24: Inscrições vs Leads únicos.
    // - submissions = todas as criações de Lead no período (cada submit = 1 evento de aquisição).
    // - uniqueLeads = inscrições menos duplicados pending_review (leads que ainda
    //   não foram resolvidos pelo operador; após decisão, viram master/kept_separate).
    // - duplicatesPending exposto como diagnóstico (quanto está aguardando revisão).
    const submissions = totalLeads
    const uniqueLeads = Math.max(0, submissions - duplicatesPending)

    return {
      leads: {
        total: totalLeads,
        today: leadsToday,
        thisWeek: leadsThisWeek,
        avgScore,
        avgPillars,
        avgProbability,
        byStatus: statusMap,
        bySource: sources,
        daily: dailyLeads,
        recent: recentLeads,
        // Fase 24
        submissions,
        uniqueLeads,
        duplicatesPending,
        duplicatesKeptSeparate,
      },
      funnels: funnelsData,
      activities: {
        pending: activitiesSummary,
        overdue: overdueActivities,
      },
      landingPages: lpStats,
      forms: formStats,
      metaForms: metaStats,
      chatbots: chatbotStats,
      templates: templateStats,
      tracking: {
        visitors: totalVisitors,
      },
      tags: (tagsWithCounts as any[]).map((t: any) => ({
        id: t.id, name: t.name, color: t.color, count: t._count.leads,
      })),
    }
  })
}
