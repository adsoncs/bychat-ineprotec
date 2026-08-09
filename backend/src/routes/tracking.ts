// src/routes/tracking.ts
// Beyond Tracking — Sistema interno de analytics para monitorar visitantes
// antes de se tornarem leads, vinculando histórico completo quando identificados.

import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { authMiddleware } from '../lib/auth.js'
import { resolvePeriod } from '../lib/period.js'
import { beyondTrackingSnippet } from '../lib/beyondTracking.js'
import crypto from 'crypto'

// ─── Bot Detection ───────────────────────────────────────

const BOT_UA_PATTERNS = [
  /bot\b/i, /crawl/i, /spider/i, /slurp/i, /wget/i, /curl\//i,
  /python-requests/i, /python-urllib/i, /java\//i, /libwww/i,
  /http_request/i, /go-http/i, /node-fetch/i, /axios\//i,
  /scrapy/i, /phantom/i, /headless/i, /selenium/i, /puppeteer/i,
  /lighthouse/i, /pagespeed/i, /gtmetrix/i, /pingdom/i,
  /uptimerobot/i, /statuscake/i, /monitor/i,
  /googlebot/i, /bingbot/i, /yandex/i, /baiduspider/i, /duckduck/i,
  /facebookexternalhit/i, /twitterbot/i, /linkedinbot/i, /whatsapp/i,
  /telegrambot/i, /discordbot/i, /slackbot/i,
  /mediapartners/i, /adsbot/i, /semrush/i, /ahrefs/i, /mj12bot/i,
  /dotbot/i, /petalbot/i, /bytespider/i,
  /zgrab/i, /masscan/i, /nmap/i, /sqlmap/i, /nikto/i,
]

function isBot(ua: string): boolean {
  if (!ua || ua.length < 10) return true // No UA or too short = suspicious
  for (const pattern of BOT_UA_PATTERNS) {
    if (pattern.test(ua)) return true
  }
  return false
}

// ─── Helpers ──────────────────────────────────────────────

function generateId(): string {
  return crypto.randomBytes(24).toString('base64url')
}

function parseUA(ua: string): { browser: string; os: string; deviceType: string } {
  let browser = 'Unknown', os = 'Unknown', deviceType = 'desktop'

  // Browser detection
  if (/Edg\//i.test(ua)) browser = 'Edge'
  else if (/OPR\//i.test(ua) || /Opera/i.test(ua)) browser = 'Opera'
  else if (/Chrome\//i.test(ua)) browser = 'Chrome'
  else if (/Safari\//i.test(ua) && !/Chrome/i.test(ua)) browser = 'Safari'
  else if (/Firefox\//i.test(ua)) browser = 'Firefox'

  // OS detection
  if (/Windows/i.test(ua)) os = 'Windows'
  else if (/Mac OS/i.test(ua)) os = 'macOS'
  else if (/Android/i.test(ua)) os = 'Android'
  else if (/iPhone|iPad/i.test(ua)) os = 'iOS'
  else if (/Linux/i.test(ua)) os = 'Linux'

  // Device type
  if (/Mobile|Android.*Mobile|iPhone/i.test(ua)) deviceType = 'mobile'
  else if (/iPad|Android(?!.*Mobile)|Tablet/i.test(ua)) deviceType = 'tablet'

  return { browser, os, deviceType }
}

function getIp(req: any): string {
  return req.headers?.['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || ''
}

// ─── Routes ───────────────────────────────────────────────

export async function trackingRoutes(app: FastifyInstance) {

  // ── POST /api/t/collect ─── Endpoint principal de coleta (sem auth, chamado pelo script JS) ──
  app.post('/api/t/collect', async (req, reply) => {
    try {
      const body = req.body as any
      if (!body || typeof body !== 'object') return reply.code(400).send({ ok: false })

      // ── Filtrar bots/crawlers ──
      const ua = req.headers['user-agent'] || ''
      if (isBot(ua)) {
        return reply.code(200).send({ ok: true }) // Silenciosamente ignorar bots
      }

      // ── Validação de campos obrigatórios ──
      if (!body.vid || typeof body.vid !== 'string') return reply.code(400).send({ ok: false })
      if (body.vid.length > 64 || body.vid.length < 8) return reply.code(400).send({ ok: false })
      if (!/^[a-z0-9-]+$/i.test(body.vid)) return reply.code(400).send({ ok: false })

      // ── Validação de session ID ──
      if (body.sid && (typeof body.sid !== 'string' || body.sid.length > 64 || !/^[a-z0-9-]+$/i.test(body.sid))) {
        return reply.code(400).send({ ok: false })
      }

      // ── Validação de events ──
      if (body.events && !Array.isArray(body.events)) return reply.code(400).send({ ok: false })

      const VALID_EVENT_TYPES = new Set([
        'pageview', 'click', 'scroll', 'form_start', 'form_submit',
        'identify', 'custom', 'web_vital', 'tab_return', 'page_exit'
      ])

      const vid = String(body.vid).slice(0, 64)
      const sid = body.sid ? String(body.sid).slice(0, 64) : null
      const fp = body.fp ? String(body.fp).slice(0, 64) : null
      const rawEvents: any[] = Array.isArray(body.events) ? body.events.slice(0, 50) : []
      const meta = (body.meta && typeof body.meta === 'object') ? body.meta : {}
      const ip = getIp(req)
      // ua já definido acima na detecção de bots
      const { browser, os, deviceType } = parseUA(ua)

      // Filtrar eventos com tipo inválido e sanitizar
      const events = rawEvents.filter((evt: any) => {
        if (!evt || typeof evt !== 'object') return false
        const type = String(evt.t || '').toLowerCase()
        if (!type || !VALID_EVENT_TYPES.has(type)) return false
        // Validar timestamp se presente
        if (evt.ts && (typeof evt.ts !== 'number' || evt.ts < 0 || evt.ts > Date.now() + 60000)) return false
        // Validar URL se presente (max 2000 chars, deve parecer URL)
        if (evt.url && (typeof evt.url !== 'string' || evt.url.length > 2000)) return false
        return true
      })

      // ── Upsert visitor ──
      let visitor = await prisma.trackingVisitor.findUnique({ where: { visitorId: vid } })
      if (!visitor) {
        visitor = await prisma.trackingVisitor.create({
          data: {
            visitorId: vid,
            fingerprint: fp,
            metadata: {
              browser, os, deviceType,
              screenWidth: meta.sw || null,
              screenHeight: meta.sh || null,
              language: meta.lang || null,
            },
          }
        })
      } else {
        // Atualizar fingerprint se veio novo e era null
        const upd: any = { lastSeenAt: new Date() }
        if (fp && !visitor.fingerprint) upd.fingerprint = fp
        await prisma.trackingVisitor.update({ where: { id: visitor.id }, data: upd })
      }

      // ── Upsert session ──
      let session: any = null
      if (sid) {
        session = await prisma.trackingSession.findUnique({ where: { sessionId: sid } })
        if (!session) {
          const pageviewEvt = events.find((e: any) => e.t === 'pageview')
          session = await prisma.trackingSession.create({
            data: {
              sessionId: sid,
              visitorId: visitor.id,
              entryUrl: pageviewEvt?.url || meta.url || null,
              referrer: meta.ref || null,
              utmSource: meta.utm_source || null,
              utmMedium: meta.utm_medium || null,
              utmCampaign: meta.utm_campaign || null,
              utmContent: meta.utm_content || null,
              utmTerm: meta.utm_term || null,
              ip,
              userAgent: ua.slice(0, 500),
              language: meta.lang || null,
              screenWidth: meta.sw || null,
              screenHeight: meta.sh || null,
              deviceType,
              browser,
              os,
            }
          })
          // Incrementar totalSessions
          await prisma.trackingVisitor.update({
            where: { id: visitor.id },
            data: { totalSessions: { increment: 1 } }
          })
        }
      }

      // ��─ Gravar eventos ──
      if (events.length > 0) {
        let pvCount = 0
        let evCount = 0

        for (const evt of events) { // Já limitado a 50 na validação
          const type = String(evt.t || 'custom').slice(0, 30)
          const evData: any = {}

          if (type === 'pageview') {
            pvCount++
          } else {
            evCount++
          }

          // Copiar dados extras
          if (evt.d) Object.assign(evData, evt.d)
          if (evt.scroll_depth !== undefined) evData.scroll_depth = evt.scroll_depth
          if (evt.x !== undefined) { evData.x = evt.x; evData.y = evt.y }
          if (evt.selector) evData.selector = String(evt.selector).slice(0, 300)
          if (evt.value) evData.value = String(evt.value).slice(0, 500)

          await prisma.trackingEvent.create({
            data: {
              visitorId: visitor.id,
              sessionId: session?.id || null,
              type,
              url: evt.url ? String(evt.url).slice(0, 2000) : null,
              title: evt.title ? String(evt.title).slice(0, 500) : null,
              referrer: evt.ref ? String(evt.ref).slice(0, 2000) : null,
              data: Object.keys(evData).length > 0 ? evData : undefined,
              timestamp: evt.ts ? new Date(evt.ts) : new Date(),
            }
          })
        }

        // Atualizar contadores
        const visitorUpd: any = {}
        const sessionUpd: any = {}
        if (pvCount > 0) {
          visitorUpd.totalPageviews = { increment: pvCount }
          sessionUpd.pageviews = { increment: pvCount }
        }
        if (evCount > 0) {
          visitorUpd.totalEvents = { increment: evCount }
          sessionUpd.events = { increment: evCount }
        }
        // Atualizar exitUrl da sessão
        const lastPv = [...events].reverse().find((e: any) => e.t === 'pageview')
        if (lastPv) sessionUpd.exitUrl = String(lastPv.url).slice(0, 2000)

        if (Object.keys(visitorUpd).length > 0) {
          await prisma.trackingVisitor.update({ where: { id: visitor.id }, data: visitorUpd })
        }
        if (session && Object.keys(sessionUpd).length > 0) {
          await prisma.trackingSession.update({ where: { id: session.id }, data: sessionUpd })
        }
      }

      // ── Identify (vincular com lead) ──
      if (body.identify && typeof body.identify === 'object') {
        const ident = body.identify
        const identUpd: any = {}
        // Validar email básico
        if (ident.email && typeof ident.email === 'string' && ident.email.includes('@') && ident.email.length <= 191) {
          identUpd.identifiedEmail = ident.email.trim().slice(0, 191)
        }
        // Validar phone (só dígitos, 8-15 chars)
        if (ident.phone && typeof ident.phone === 'string') {
          const cleanPhone = ident.phone.replace(/\D/g, '')
          if (cleanPhone.length >= 8 && cleanPhone.length <= 15) {
            identUpd.identifiedPhone = cleanPhone.slice(0, 30)
          }
        }
        // Validar nome
        if (ident.name && typeof ident.name === 'string' && ident.name.length <= 191) {
          identUpd.identifiedName = ident.name.trim().slice(0, 191)
        }

        if (Object.keys(identUpd).length > 0) {
          await prisma.trackingVisitor.update({ where: { id: visitor.id }, data: identUpd })

          // Tentar vincular com lead existente
          if (!visitor.leadId) {
            let lead = null
            if (ident.email) {
              lead = await prisma.lead.findFirst({ where: { email: ident.email } })
            }
            if (!lead && ident.phone) {
              const phone = String(ident.phone).replace(/\D/g, '')
              if (phone.length >= 10) {
                // Buscar por número completo normalizado (últimos 10-11 dígitos = DDD + número)
                const normalizedPhone = phone.length >= 12 ? phone.slice(-11) : phone.slice(-10)
                lead = await prisma.lead.findFirst({
                  where: {
                    whatsapp: { contains: normalizedPhone }
                  }
                })
              }
            }
            if (lead) {
              await prisma.trackingVisitor.update({ where: { id: visitor.id }, data: { leadId: lead.id } })
              await prisma.lead.update({ where: { id: lead.id }, data: { trackingVisitorId: vid } })
            }
          }
        }
      }

      reply.code(200).send({ ok: true })
    } catch (err: any) {
      console.error('[Tracking] collect error:', err.message)
      reply.code(200).send({ ok: true }) // Nunca falhar para o script
    }
  })

  // ── POST /api/t/heartbeat ─── Atualizar duração da sessão ──
  app.post('/api/t/heartbeat', async (req, reply) => {
    try {
      const body = req.body as any
      if (!body?.sid) return reply.code(200).send({ ok: true })

      const sid = String(body.sid).slice(0, 64)
      const duration = Math.min(parseInt(body.duration) || 0, 86400) // Max 24h

      await prisma.trackingSession.updateMany({
        where: { sessionId: sid },
        data: { duration, endedAt: new Date() }
      })

      reply.code(200).send({ ok: true })
    } catch {
      reply.code(200).send({ ok: true })
    }
  })

  // ── GET /api/t/bt.js ─── Servir o script de tracking ──
  app.get('/api/t/bt.js', async (req, reply) => {
    const fs = await import('fs')
    const path = await import('path')
    // O frontend fica em ../frontend relativo ao cwd do PM2 (/var/www/bychat-beyond/backend)
    // ou em ../../frontend relativo ao dist/routes/
    const candidates = [
      path.resolve(process.cwd(), '../frontend/bt.js'),
      path.resolve(process.cwd(), 'frontend/bt.js'),
      '/var/www/bychat-beyond/frontend/bt.js',
    ]

    for (const scriptPath of candidates) {
      try {
        if (fs.existsSync(scriptPath)) {
          const content = fs.readFileSync(scriptPath, 'utf-8')
          return reply
            .header('Content-Type', 'application/javascript; charset=utf-8')
            .header('Cache-Control', 'public, max-age=3600')
            .header('Access-Control-Allow-Origin', '*')
            .send(content)
        }
      } catch {}
    }
    reply.code(404).send('// bt.js not found')
  })

  // ─── ADMIN ENDPOINTS (auth required) ────────────────────

  // ── GET /api/tracking/visitors ─── Listar visitantes ──
  app.get('/api/tracking/visitors', { preHandler: authMiddleware }, async (req, reply) => {
    const q = req.query as any
    const page = Math.max(1, parseInt(q.page) || 1)
    const limit = Math.min(100, parseInt(q.limit) || 25)
    const offset = (page - 1) * limit
    const search = q.search || ''
    const identified = q.identified // 'true', 'false', or undefined
    const hasLead = q.hasLead

    const where: any = {}
    if (search) {
      where.OR = [
        { identifiedEmail: { contains: search } },
        { identifiedPhone: { contains: search } },
        { identifiedName: { contains: search } },
        { visitorId: { contains: search } },
      ]
    }
    if (identified === 'true') {
      where.OR = [
        { identifiedEmail: { not: null } },
        { identifiedPhone: { not: null } },
      ]
    } else if (identified === 'false') {
      where.identifiedEmail = null
      where.identifiedPhone = null
    }
    if (hasLead === 'true') where.leadId = { not: null }
    else if (hasLead === 'false') where.leadId = null

    const [visitors, total] = await Promise.all([
      prisma.trackingVisitor.findMany({
        where,
        orderBy: { lastSeenAt: 'desc' },
        skip: offset,
        take: limit,
      }),
      prisma.trackingVisitor.count({ where })
    ])

    return { visitors, total, page, limit }
  })

  // ── GET /api/tracking/visitors/:id ─── Detalhes do visitante ──
  app.get('/api/tracking/visitors/:id', { preHandler: authMiddleware }, async (req, reply) => {
    const { id } = req.params as any
    const visitor = await prisma.trackingVisitor.findUnique({
      where: { id: parseInt(id) },
      include: {
        sessions: { orderBy: { startedAt: 'desc' }, take: 50 },
      }
    })
    if (!visitor) return reply.code(404).send({ error: 'Visitante não encontrado' })
    return visitor
  })

  // ── GET /api/tracking/visitors/:id/timeline ─── Timeline de eventos do visitante ──
  app.get('/api/tracking/visitors/:id/timeline', { preHandler: authMiddleware }, async (req, reply) => {
    const { id } = req.params as any
    const q = req.query as any
    const limit = Math.min(500, parseInt(q.limit) || 100)
    const offset = parseInt(q.offset) || 0

    const events = await prisma.trackingEvent.findMany({
      where: { visitorId: parseInt(id) },
      orderBy: { timestamp: 'desc' },
      skip: offset,
      take: limit,
      include: { session: { select: { sessionId: true, ip: true, referrer: true } } }
    })
    return { events }
  })

  // ── GET /api/tracking/stats ─── Dashboard stats ──
  app.get('/api/tracking/stats', { preHandler: authMiddleware }, async (req, reply) => {
    const { from: since, to: until, days } = resolvePeriod(req.query, 30)
    const period = { gte: since, lte: until }

    const [
      totalVisitors,
      identifiedVisitors,
      linkedLeads,
      totalSessions,
      totalPageviews,
      totalEvents,
      recentVisitors,
      topPages,
      topReferrers,
      deviceBreakdown,
    ] = await Promise.all([
      prisma.trackingVisitor.count({ where: { lastSeenAt: period } }),
      prisma.trackingVisitor.count({ where: { lastSeenAt: period, identifiedEmail: { not: null } } }),
      prisma.trackingVisitor.count({ where: { lastSeenAt: period, leadId: { not: null } } }),
      prisma.trackingSession.count({ where: { startedAt: period } }),
      prisma.trackingEvent.count({ where: { type: 'pageview', timestamp: period } }),
      prisma.trackingEvent.count({ where: { type: { not: 'pageview' }, timestamp: period } }),
      prisma.trackingVisitor.findMany({
        where: { lastSeenAt: period },
        orderBy: { lastSeenAt: 'desc' },
        take: 10,
        select: {
          id: true, visitorId: true, identifiedName: true, identifiedEmail: true,
          identifiedPhone: true, leadId: true, totalPageviews: true, totalSessions: true,
          lastSeenAt: true, firstSeenAt: true, metadata: true,
        }
      }),
      // Top pages — normalizada (remove trailing slash, query params, fragments; agrupa duplicatas)
      prisma.$queryRaw`
        SELECT
          TRIM(TRAILING '/' FROM SUBSTRING_INDEX(SUBSTRING_INDEX(url, '?', 1), '#', 1)) as url,
          COUNT(*) as views,
          COUNT(DISTINCT visitorId) as visitors,
          MAX(timestamp) as lastSeen
        FROM bychat_tracking_events
        WHERE type = 'pageview' AND timestamp >= ${since} AND timestamp <= ${until} AND url IS NOT NULL AND url != ''
        GROUP BY TRIM(TRAILING '/' FROM SUBSTRING_INDEX(SUBSTRING_INDEX(url, '?', 1), '#', 1))
        ORDER BY views DESC LIMIT 30
      ` as Promise<any[]>,
      // Top referrers
      prisma.$queryRaw`
        SELECT referrer, COUNT(*) as count
        FROM bychat_tracking_sessions
        WHERE startedAt >= ${since} AND startedAt <= ${until} AND referrer IS NOT NULL AND referrer != ''
        GROUP BY referrer ORDER BY count DESC LIMIT 10
      ` as Promise<any[]>,
      // Device breakdown
      prisma.$queryRaw`
        SELECT deviceType, COUNT(*) as count
        FROM bychat_tracking_sessions
        WHERE startedAt >= ${since} AND startedAt <= ${until} AND deviceType IS NOT NULL
        GROUP BY deviceType ORDER BY count DESC
      ` as Promise<any[]>,
    ])

    return {
      period: { days, since: since.toISOString(), until: until.toISOString() },
      overview: { totalVisitors, identifiedVisitors, linkedLeads, totalSessions, totalPageviews, totalEvents },
      recentVisitors,
      topPages: (topPages || []).map((p: any) => ({ url: p.url, views: Number(p.views), visitors: Number(p.visitors || 0), lastSeen: p.lastSeen })),
      topReferrers: (topReferrers || []).map((r: any) => ({ referrer: r.referrer, count: Number(r.count) })),
      deviceBreakdown: (deviceBreakdown || []).map((d: any) => ({ type: d.deviceType, count: Number(d.count) })),
    }
  })

  // ── GET /api/tracking/recent-leads ── Últimos leads no período ──
  // Diferente de /tracking/stats.recentVisitors (que mostra TrackingVisitor —
  // só funciona pra quem passou pelo pixel bt.js), este retorna leads "puros"
  // independente da origem (Meta Lead Ads, WhatsApp, API, formulário, etc).
  // `hasTrackedSession` indica se o lead também tem sessão de pixel vinculada.
  app.get('/api/tracking/recent-leads', { preHandler: authMiddleware }, async (req) => {
    const q = req.query as any
    const { from: since, to: until, days } = resolvePeriod(q, 30)
    const limit = Math.min(50, parseInt(q.limit) || 10)
    const period = { gte: since, lte: until }

    const [leads, totalLeads, leadsWithVisitor] = await Promise.all([
      prisma.lead.findMany({
        where: { createdAt: period },
        orderBy: { createdAt: 'desc' },
        take: limit,
        select: {
          id: true,
          nome: true,
          email: true,
          whatsapp: true,
          status: true,
          originType: true,
          qualificationSource: true,
          trackingVisitorId: true,
          createdAt: true,
          assignedUser: { select: { id: true, name: true, email: true } },
          team: { select: { id: true, name: true } },
          funnel: { select: { id: true, name: true } },
        },
      }),
      prisma.lead.count({ where: { createdAt: period } }),
      prisma.lead.count({ where: { createdAt: period, trackingVisitorId: { not: null } } }),
    ])

    return {
      period: { days, since: since.toISOString(), until: until.toISOString() },
      coverage: {
        totalLeads,
        leadsWithTrackedSession: leadsWithVisitor,
        rate: totalLeads > 0 ? Math.round((leadsWithVisitor / totalLeads) * 1000) / 10 : 0,
      },
      leads: leads.map((l) => ({
        id: l.id,
        nome: l.nome,
        email: l.email || null,
        whatsapp: l.whatsapp || null,
        status: l.status,
        originType: l.originType,
        qualificationSource: l.qualificationSource,
        hasTrackedSession: !!l.trackingVisitorId,
        createdAt: l.createdAt.toISOString(),
        assignedUser: l.assignedUser,
        team: l.team,
        funnel: l.funnel,
      })),
    }
  })

  // ── POST /api/tracking/visitors/:id/link ─── Vincular manualmente com lead ──
  app.post('/api/tracking/visitors/:id/link', { preHandler: authMiddleware }, async (req, reply) => {
    const { id } = req.params as any
    const { leadId } = req.body as any
    if (!leadId) return reply.code(400).send({ error: 'leadId obrigatório' })

    const visitor = await prisma.trackingVisitor.findUnique({ where: { id: parseInt(id) } })
    if (!visitor) return reply.code(404).send({ error: 'Visitante não encontrado' })

    const lead = await prisma.lead.findUnique({ where: { id: parseInt(leadId) } })
    if (!lead) return reply.code(404).send({ error: 'Lead não encontrado' })

    await prisma.trackingVisitor.update({ where: { id: visitor.id }, data: { leadId: lead.id } })
    await prisma.lead.update({ where: { id: lead.id }, data: { trackingVisitorId: visitor.visitorId } })

    return { ok: true }
  })

  // ── GET /api/tracking/lead/:leadId ─── Histórico de tracking de um lead ──
  app.get('/api/tracking/lead/:leadId', { preHandler: authMiddleware }, async (req, reply) => {
    const { leadId } = req.params as any
    const lead = await prisma.lead.findUnique({ where: { id: parseInt(leadId) }, select: { trackingVisitorId: true } })
    if (!lead?.trackingVisitorId) return { visitor: null, sessions: [], events: [] }

    const visitor = await prisma.trackingVisitor.findUnique({ where: { visitorId: lead.trackingVisitorId } })
    if (!visitor) return { visitor: null, sessions: [], events: [] }

    const [sessions, events] = await Promise.all([
      prisma.trackingSession.findMany({
        where: { visitorId: visitor.id },
        orderBy: { startedAt: 'desc' },
        take: 50,
      }),
      prisma.trackingEvent.findMany({
        where: { visitorId: visitor.id },
        orderBy: { timestamp: 'desc' },
        take: 200,
      }),
    ])

    return { visitor, sessions, events }
  })

  // ── GET /api/tracking/snippet ─── Snippet de instalação (cópia manual) ──
  app.get('/api/tracking/snippet', { preHandler: authMiddleware }, async (req, reply) => {
    const baseUrl = process.env.APP_URL || `https://${req.hostname}`
    return { snippet: beyondTrackingSnippet(baseUrl), baseUrl }
  })

  // ── POST /api/tracking/validate-url ─── Validar se URL tem bt.js instalado ──
  app.post('/api/tracking/validate-url', { preHandler: authMiddleware }, async (req, reply) => {
    const { url } = req.body as any
    if (!url) return reply.code(400).send({ error: 'URL obrigatória' })

    const result: any = {
      url,
      valid: false,
      hasTrackingScript: false,
      hasSnippetLoader: false,
      hasBTObject: false,
      scriptSrc: null,
      errors: [],
      warnings: [],
      timestamp: new Date().toISOString(),
    }

    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 10000)

      const resp = await fetch(url, {
        signal: controller.signal,
        headers: { 'User-Agent': 'BeyondTrackingValidator/1.0' },
        redirect: 'follow',
      })
      clearTimeout(timeout)

      if (!resp.ok) {
        result.errors.push(`HTTP ${resp.status}: ${resp.statusText}`)
        return result
      }

      const html = await resp.text()
      result.valid = true

      // Checar se o bt.js está referenciado
      // 1. Tag direta: <script src="...bt.js">
      const directScriptPattern = /src=["'][^"']*\/api\/t\/bt\.js[^"']*["']/i
      // 2. Snippet loader: d.src=o+'/api/t/bt.js' (gerado dinamicamente)
      const loaderSrcPattern = /\.src\s*=\s*[^;]*\/api\/t\/bt\.js/i
      // 3. Tag async direta: <script async src="...bt.js"></script>
      const asyncScriptPattern = /<script[^>]*src=["'][^"']*bt\.js[^"']*["'][^>]*>/i
      // 4. Snippet loader padrão (objeto BT com queue)
      const snippetQueuePattern = /BT\s*=\s*[^;]*\{\s*q\s*:\s*\[\s*\]/s
      // 5. Referências ao objeto BT
      const btObjectPattern = /\bBT\.(identify|track|page|getVisitorId|getSessionId)\b/

      // Detectar script direto
      if (directScriptPattern.test(html) || asyncScriptPattern.test(html)) {
        result.hasTrackingScript = true
        const match = html.match(/src=["']([^"']*bt\.js[^"']*)["']/i)
        if (match) result.scriptSrc = match[1]
      }

      // Detectar via snippet loader (src gerado em JS)
      if (loaderSrcPattern.test(html)) {
        result.hasTrackingScript = true
        if (!result.scriptSrc) {
          const match = html.match(/\.src\s*=\s*([^;]*bt\.js[^;'"]*)/i)
          if (match) result.scriptSrc = match[1].replace(/['"]/g, '').trim()
        }
      }

      // Detectar snippet loader (queue pattern)
      if (snippetQueuePattern.test(html)) {
        result.hasSnippetLoader = true
        result.hasTrackingScript = true // Se tem o loader, o script será carregado
      }

      // Detectar uso do objeto BT
      if (btObjectPattern.test(html) || /window\.BT\b/.test(html)) {
        result.hasBTObject = true
      }

      // Validações finais
      if (!result.hasTrackingScript) {
        result.errors.push('Script bt.js não encontrado no HTML da página')
      }

      // Checar se há outros trackers
      if (/gtag|google-analytics|googletagmanager/.test(html)) {
        result.warnings.push('Google Analytics/GTM também está instalado (compatível)')
      }
      if (/fbq\(|facebook.*pixel/i.test(html)) {
        result.warnings.push('Facebook Pixel também está instalado (compatível)')
      }

      // Checar métricas de dados recebidos dessa URL
      const recentEvents = await prisma.trackingEvent.count({
        where: {
          type: 'pageview',
          url: { contains: new URL(url).hostname },
          timestamp: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
        }
      })
      result.recentPageviews24h = recentEvents

      const totalVisitors = await prisma.trackingSession.count({
        where: {
          entryUrl: { contains: new URL(url).hostname },
        }
      })
      result.totalSessions = totalVisitors

    } catch (err: any) {
      if (err.name === 'AbortError') {
        result.errors.push('Timeout: a página demorou mais de 10s para responder')
      } else {
        result.errors.push(`Erro ao acessar URL: ${err.message}`)
      }
    }

    return result
  })

  // ── POST /api/tracking/validate-pages ─── Validar tracking em multiplas URLs ──
  app.post('/api/tracking/validate-pages', { preHandler: authMiddleware }, async (req, reply) => {
    const { urls } = req.body as { urls: string[] }
    if (!Array.isArray(urls) || urls.length === 0) return reply.code(400).send({ error: 'urls obrigatorio' })

    const results: Record<string, { hasTracking: boolean; error?: string }> = {}
    const toCheck = urls.slice(0, 20)

    await Promise.all(toCheck.map(async (url) => {
      try {
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), 8000)
        const resp = await fetch(url, {
          signal: controller.signal,
          headers: { 'User-Agent': 'BeyondTrackingValidator/1.0' },
          redirect: 'follow',
        })
        clearTimeout(timeout)

        if (!resp.ok) {
          results[url] = { hasTracking: false, error: `HTTP ${resp.status}` }
          return
        }

        const html = await resp.text()
        const hasScript = /bt\.js/i.test(html) || /BT\s*=\s*[^;]*\{[^}]*q\s*:/s.test(html)
        results[url] = { hasTracking: hasScript }
      } catch (err: any) {
        results[url] = { hasTracking: false, error: err.name === 'AbortError' ? 'Timeout' : err.message }
      }
    }))

    return { results }
  })

  // ── GET /api/tracking/monitored-urls ─── URLs monitoradas com stats ��─
  app.get('/api/tracking/monitored-urls', { preHandler: authMiddleware }, async (req, reply) => {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)

    // Pegar URLs únicas com pageviews
    const urls = await prisma.$queryRaw`
      SELECT
        SUBSTRING_INDEX(SUBSTRING_INDEX(REPLACE(REPLACE(url, 'https://', ''), 'http://', ''), '/', 1), '?', 1) as domain,
        COUNT(*) as pageviews,
        COUNT(DISTINCT visitorId) as visitors,
        MAX(timestamp) as lastSeen
      FROM bychat_tracking_events
      WHERE type = 'pageview' AND url IS NOT NULL AND timestamp >= ${since}
      GROUP BY domain
      ORDER BY pageviews DESC
      LIMIT 50
    ` as any[]

    return {
      urls: (urls || []).map((u: any) => ({
        domain: u.domain,
        pageviews: Number(u.pageviews),
        visitors: Number(u.visitors),
        lastSeen: u.lastSeen,
      }))
    }
  })
}
