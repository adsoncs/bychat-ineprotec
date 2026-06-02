import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { authMiddleware } from '../lib/auth.js'

export async function statsRoutes(app: FastifyInstance) {

  app.get('/api/bychat/stats', { preHandler: authMiddleware }, async () => {
    const [
      total,
      novos,
      leadsRaw,
      segmentosRaw
    ] = await Promise.all([
      // Stats só contam leads qualificados (conversas WhatsApp ad-hoc não contam).
      prisma.lead.count({ where: { qualifiedAt: { not: null } } }),
      prisma.lead.count({ where: { status: 'NOVO', qualifiedAt: { not: null } } }),
      prisma.lead.findMany({
        where: { qualifiedAt: { not: null } },
        select: { scores: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: 500
      }),
      prisma.lead.groupBy({
        by: ['segmento'],
        where: { qualifiedAt: { not: null } },
        _count: { segmento: true },
        orderBy: { _count: { segmento: 'desc' } },
        take: 8
      })
    ])

    // Score médio geral
    const scores = leadsRaw.map(l => (l.scores as any)?.geral || 0)
    const avgScore = scores.length
      ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
      : 0

    // Scores por pilar
    const pilares = ['mkt', 'vnd', 'oferta', 'dados', 'proc']
    const avgPilares = Object.fromEntries(pilares.map(p => {
      const vals = leadsRaw.map(l => (l.scores as any)?.[p] || 0)
      return [p, vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : 0]
    }))

    // Leads por semana (últimas 8 semanas)
    const now = Date.now()
    const weeklyData = Array.from({ length: 8 }, (_, i) => {
      const weekStart = now - (7 - i) * 7 * 24 * 3600 * 1000
      const weekEnd   = weekStart + 7 * 24 * 3600 * 1000
      return {
        week: new Date(weekStart).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }),
        count: leadsRaw.filter(l => {
          const t = new Date(l.createdAt).getTime()
          return t >= weekStart && t < weekEnd
        }).length
      }
    })

    return {
      total,
      novos,
      avgScore,
      avgPilares,
      segmentos: segmentosRaw.map(s => ({
        segmento: s.segmento || 'Outro',
        count: s._count.segmento
      })),
      weeklyLeads: weeklyData
    }
  })
}
