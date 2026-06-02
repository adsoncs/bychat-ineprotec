// src/routes/leadHistory.ts
// Rotas de consulta do histórico completo de eventos do lead

import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { authMiddleware } from '../lib/auth.js'
import { canUserAccessLead, type AccessRole } from '../lib/teamAccess.js'

// ─── Tracking event title/description helpers ──

function getTrackingTitle(type: string, evt: any): string {
  const data = evt.data as any || {}
  switch (type) {
    case 'pageview': return `Visitou: ${evt.title || evt.url || 'página'}`
    case 'click': return `Clicou: ${data.text || data.selector || 'elemento'}`
    case 'scroll': return `Scroll: ${data.scroll_depth || 0}% da página`
    case 'form_start': return 'Começou a preencher formulário'
    case 'form_submit': return 'Submeteu formulário'
    case 'identify': return 'Visitante identificado'
    case 'custom': return `Evento: ${data.eventName || 'custom'}`
    case 'web_vital': return `Web Vital: ${data.metric || ''} = ${data.value || ''}`
    case 'page_exit': return `Saiu da página (${data.timeOnPage || 0}s)`
    case 'tab_return': return `Voltou à aba (${data.awaySeconds || 0}s ausente)`
    default: return `Tracking: ${type}`
  }
}

function getTrackingDescription(evt: any): string {
  const parts: string[] = []
  if (evt.url) {
    try {
      const u = new URL(evt.url)
      parts.push(u.pathname + u.search)
    } catch {
      parts.push(evt.url)
    }
  }
  const session = evt.session as any
  if (session?.utmSource) parts.push(`UTM: ${session.utmSource}/${session.utmMedium || ''}/${session.utmCampaign || ''}`)
  if (session?.referrer) {
    try { parts.push(`Ref: ${new URL(session.referrer).hostname}`) } catch {}
  }
  return parts.join(' · ')
}

export async function leadHistoryRoutes(app: FastifyInstance) {

  // ── GET /api/leads/:id/history — Timeline completa de eventos (inclui tracking) ──
  app.get('/api/leads/:id/history', { preHandler: authMiddleware }, async (req, reply) => {
    try {
      const { id } = req.params as any
      // Isolamento per-agent: AGENT só vê leads dele (scope=own).
      {
        const _user = (req as any).user as { userId: number; role: string }
        const _ok = await canUserAccessLead(_user.userId, _user.role as AccessRole, parseInt(id))
        if (!_ok) return reply.code(403).send({ error: 'Sem permissão sobre este lead' })
      }
      const query = req.query as any
      const limit = Math.min(parseInt(query.limit) || 50, 200)
      const offset = parseInt(query.offset) || 0
      const leadId = parseInt(id)
      const includeTracking = query.category === 'monitoring' || !query.category

      const where: any = { leadId }

      // Filtros opcionais
      if (query.type) where.type = query.type
      if (query.category && query.category !== 'monitoring') where.category = query.category
      if (query.channel) where.channel = query.channel
      if (query.actorType) where.actorType = query.actorType
      if (query.from) where.createdAt = { ...(where.createdAt || {}), gte: new Date(query.from) }
      if (query.to) where.createdAt = { ...(where.createdAt || {}), lte: new Date(query.to) }

      // Se filtrando por monitoring, pular lead events normais
      const isMonitoringOnly = query.category === 'monitoring'

      let leadEvents: any[] = []
      let leadTotal = 0
      if (!isMonitoringOnly) {
        [leadEvents, leadTotal] = await Promise.all([
          prisma.leadEvent.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            take: limit,
            skip: offset,
          }),
          prisma.leadEvent.count({ where })
        ])
      }

      // Buscar tracking events se o lead tem trackingVisitorId
      let trackingEvents: any[] = []
      if (includeTracking) {
        const lead = await prisma.lead.findUnique({
          where: { id: leadId },
          select: { trackingVisitorId: true }
        })

        if (lead?.trackingVisitorId) {
          const visitor = await prisma.trackingVisitor.findUnique({
            where: { visitorId: lead.trackingVisitorId },
            select: { id: true }
          })

          if (visitor) {
            const trackingWhere: any = { visitorId: visitor.id }
            if (query.from) trackingWhere.timestamp = { gte: new Date(query.from) }
            if (query.to) trackingWhere.timestamp = { ...(trackingWhere.timestamp || {}), lte: new Date(query.to) }

            const rawTracking = await prisma.trackingEvent.findMany({
              where: trackingWhere,
              orderBy: { timestamp: 'desc' },
              take: isMonitoringOnly ? limit : 50,
              include: { session: { select: { referrer: true, utmSource: true, utmMedium: true, utmCampaign: true } } }
            })

            // Converter tracking events para formato de LeadEvent
            trackingEvents = rawTracking.map(te => ({
              id: `t_${te.id}`,
              leadId,
              type: `tracking_${te.type}`,
              category: 'monitoring',
              channel: 'tracking',
              source: 'beyond_tracking',
              actorType: 'system',
              title: getTrackingTitle(te.type, te),
              description: getTrackingDescription(te),
              metadata: {
                trackingEventId: te.id,
                url: te.url,
                title: te.title,
                data: te.data,
                session: te.session,
              },
              createdAt: te.timestamp,
              _isTracking: true,
            }))
          }
        }
      }

      // Merge e ordenar por data
      const allEvents = [...leadEvents, ...trackingEvents]
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .slice(0, limit)

      const total = leadTotal + trackingEvents.length

      return { events: allEvents, total, limit, offset }
    } catch (err: any) {
      app.log.error(`Lead history error: ${err.message}`)
      return reply.code(500).send({ error: err.message })
    }
  })

  // ── GET /api/leads/:id/history/stats — Resumo/estatísticas dos eventos ──
  app.get('/api/leads/:id/history/stats', { preHandler: authMiddleware }, async (req, reply) => {
    try {
      const { id } = req.params as any
      // Isolamento per-agent: AGENT só vê leads dele (scope=own).
      {
        const _user = (req as any).user as { userId: number; role: string }
        const _ok = await canUserAccessLead(_user.userId, _user.role as AccessRole, parseInt(id))
        if (!_ok) return reply.code(403).send({ error: 'Sem permissão sobre este lead' })
      }
      const leadId = parseInt(id)

      const [
        totalEvents,
        byCategory,
        byChannel,
        byType,
        firstEvent,
        lastEvent
      ] = await Promise.all([
        prisma.leadEvent.count({ where: { leadId } }),
        prisma.leadEvent.groupBy({ by: ['category'], where: { leadId }, _count: true }),
        prisma.leadEvent.groupBy({ by: ['channel'], where: { leadId, channel: { not: null } }, _count: true }),
        prisma.leadEvent.groupBy({ by: ['type'], where: { leadId }, _count: true, orderBy: { _count: { type: 'desc' } }, take: 15 }),
        prisma.leadEvent.findFirst({ where: { leadId }, orderBy: { createdAt: 'asc' }, select: { createdAt: true, type: true, channel: true } }),
        prisma.leadEvent.findFirst({ where: { leadId }, orderBy: { createdAt: 'desc' }, select: { createdAt: true, type: true } }),
      ])

      // Incluir contagem de tracking events
      let trackingCount = 0
      const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { trackingVisitorId: true } })
      if (lead?.trackingVisitorId) {
        const visitor = await prisma.trackingVisitor.findUnique({ where: { visitorId: lead.trackingVisitorId }, select: { id: true, totalPageviews: true, totalEvents: true } })
        if (visitor) {
          trackingCount = (visitor.totalPageviews || 0) + (visitor.totalEvents || 0)
        }
      }

      // Adicionar monitoring à lista de categorias
      const categories = byCategory.map(c => ({ category: c.category, count: c._count }))
      if (trackingCount > 0) categories.push({ category: 'monitoring', count: trackingCount })

      return {
        totalEvents: totalEvents + trackingCount,
        byCategory: categories,
        byChannel: byChannel.map(c => ({ channel: c.channel, count: c._count })),
        topEventTypes: byType.map(t => ({ type: t.type, count: t._count })),
        firstEvent,
        lastEvent,
        entryChannel: firstEvent?.channel || 'unknown',
      }
    } catch (err: any) {
      app.log.error(`Lead history stats error: ${err.message}`)
      return reply.code(500).send({ error: err.message })
    }
  })

  // ── GET /api/leads/:id/history/journey — Jornada resumida do lead ──
  app.get('/api/leads/:id/history/journey', { preHandler: authMiddleware }, async (req, reply) => {
    try {
      const { id } = req.params as any
      // Isolamento per-agent: AGENT só vê leads dele (scope=own).
      {
        const _user = (req as any).user as { userId: number; role: string }
        const _ok = await canUserAccessLead(_user.userId, _user.role as AccessRole, parseInt(id))
        if (!_ok) return reply.code(403).send({ error: 'Sem permissão sobre este lead' })
      }
      const leadId = parseInt(id)

      // Busca eventos-chave da jornada (marcos importantes)
      const milestones = await prisma.leadEvent.findMany({
        where: {
          leadId,
          type: {
            in: [
              'lead_created', 'diagnosis_started', 'diagnosis_completed',
              'status_changed', 'lead_closed', 'lead_reopened',
              'report_sent', 'ai_sentiment_generated',
              'inactivity_detected', 'inactivity_closed'
            ]
          }
        },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true, type: true, category: true, channel: true,
          title: true, description: true, oldValue: true, newValue: true,
          actorType: true, userName: true, createdAt: true,
        }
      })

      // Canais únicos por onde o lead interagiu
      const channels = await prisma.leadEvent.findMany({
        where: { leadId, channel: { not: null } },
        distinct: ['channel'],
        select: { channel: true }
      })

      // Operadores que interagiram
      const operators = await prisma.leadEvent.findMany({
        where: { leadId, actorType: 'operator', userName: { not: null } },
        distinct: ['userName'],
        select: { userName: true }
      })

      return {
        milestones,
        channels: channels.map(c => c.channel),
        operators: operators.map(o => o.userName),
      }
    } catch (err: any) {
      app.log.error(`Lead journey error: ${err.message}`)
      return reply.code(500).send({ error: err.message })
    }
  })
}
