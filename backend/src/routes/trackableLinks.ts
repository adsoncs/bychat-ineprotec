// src/routes/trackableLinks.ts
// Links Rastreáveis para WhatsApp — Fase 7 Rastreamento Inteligente

import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { authMiddleware, adminOnly } from '../lib/auth.js'
import QRCode from 'qrcode'
import { dispatchStandaloneEvent } from '../services/webhookDispatcher.js'
import { fireCapiLeadNoLead } from '../services/metaCapi.js'
import crypto from 'crypto'

// Parâmetros conhecidos de atribuição capturados na query string.
// Meta injeta fbclid; Google, gclid. ctwaClid vem de click-to-WhatsApp.
// tintim_fbid é o formato legado do Tintim (compat para quem migra).
function extractClickIds(query: any): {
  fbclid?: string; gclid?: string; ctwaClid?: string; tintimFbid?: string
  utmSource?: string; utmMedium?: string; utmCampaign?: string; utmContent?: string; utmTerm?: string
  queryParams: any
} {
  const q = query || {}
  const get = (k: string) => {
    const v = q[k]
    if (!v) return undefined
    const s = String(v).slice(0, 250)
    return s || undefined
  }
  return {
    fbclid:     get('fbclid'),
    gclid:      get('gclid'),
    ctwaClid:   get('ctwa_clid') || get('ctwaClid'),
    tintimFbid: get('tintim_fbid'),
    utmSource:   get('utm_source'),
    utmMedium:   get('utm_medium'),
    utmCampaign: get('utm_campaign'),
    utmContent:  get('utm_content'),
    utmTerm:     get('utm_term'),
    queryParams: Object.keys(q).length ? q : undefined,
  }
}

function buildWhatsappUrl(link: { whatsappPhone: string; prefilledMessage: string | null; slug: string }, sessionId?: string): string {
  const phone = link.whatsappPhone.replace(/\D/g, '')
  let message = link.prefilledMessage || ''
  const ref = sessionId ? `#ref:${link.slug}:${sessionId}` : `#ref:${link.slug}`
  if (message) message = `${message} ${ref}`
  else message = ref
  return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`
}

function escapeHtml(s: string): string {
  return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]!))
}

// Convert BigInt values from raw queries to Number for JSON serialization
function sanitizeRaw(rows: any[]): any[] {
  return rows.map(row => {
    const obj: any = {}
    for (const [k, v] of Object.entries(row)) {
      obj[k] = typeof v === 'bigint' ? Number(v) : v
    }
    return obj
  })
}

function generateSlug(length = 8): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let result = ''
  for (let i = 0; i < length; i++) result += chars[Math.floor(Math.random() * chars.length)]
  return result
}

function parseUA(ua: string): { deviceType: string; browser: string; os: string } {
  const deviceType = /mobile|android|iphone|ipad/i.test(ua) ? (/ipad|tablet/i.test(ua) ? 'tablet' : 'mobile') : 'desktop'
  let browser = 'other'
  if (/chrome/i.test(ua) && !/edge|opr/i.test(ua)) browser = 'Chrome'
  else if (/firefox/i.test(ua)) browser = 'Firefox'
  else if (/safari/i.test(ua) && !/chrome/i.test(ua)) browser = 'Safari'
  else if (/edge/i.test(ua)) browser = 'Edge'
  else if (/opr|opera/i.test(ua)) browser = 'Opera'
  let os = 'other'
  if (/windows/i.test(ua)) os = 'Windows'
  else if (/macintosh|mac os/i.test(ua)) os = 'macOS'
  else if (/android/i.test(ua)) os = 'Android'
  else if (/iphone|ipad|ios/i.test(ua)) os = 'iOS'
  else if (/linux/i.test(ua)) os = 'Linux'
  return { deviceType, browser, os }
}

// ── Bot detection para links rastreáveis ──
const BOT_PATTERNS = [
  /bot\b/i, /crawl/i, /spider/i, /slurp/i, /wget/i, /curl\//i,
  /python/i, /java\//i, /go-http/i, /node-fetch/i,
  /googlebot/i, /bingbot/i, /yandex/i, /baiduspider/i,
  /facebookexternalhit/i, /twitterbot/i, /linkedinbot/i,
  /telegrambot/i, /discordbot/i, /slackbot/i,
  /semrush/i, /ahrefs/i, /mj12bot/i, /petalbot/i,
  /zgrab/i, /masscan/i, /nmap/i, /sqlmap/i, /nikto/i,
  /phantom/i, /headless/i, /selenium/i, /puppeteer/i,
]

function isBotUA(ua: string): boolean {
  if (!ua || ua.length < 10) return true
  for (const p of BOT_PATTERNS) { if (p.test(ua)) return true }
  return false
}

export async function trackableLinksRoutes(app: FastifyInstance) {

  // ═══════════════════════════════════════════
  // PUBLIC: Redirect direto — GET /r/:slug
  // ═══════════════════════════════════════════
  app.get('/r/:slug', async (req, reply) => {
    const { slug } = req.params as { slug: string }

    const link = await prisma.trackableLink.findUnique({ where: { slug } })
    if (!link || !link.active) {
      return reply.code(404).send({ error: 'Link não encontrado' })
    }

    const qqr = req.query as any
    const sessionIdR = qqr?.sid ? String(qqr.sid).slice(0, 64) : undefined
    const waUrl = buildWhatsappUrl(link, sessionIdR)

    const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip
    const ua = req.headers['user-agent'] || ''
    const referer = (req.headers['referer'] as string) || ''

    if (!isBotUA(ua)) {
      const { deviceType, browser, os } = parseUA(ua)
      const ids = extractClickIds(req.query)
      recordClick({ linkId: link.id, ip, userAgent: ua, referer, deviceType, browser, os, ...ids, sessionId: sessionIdR }).catch(() => {})
    }

    return reply.redirect(302, waUrl)
  })

  // ═══════════════════════════════════════════
  // PUBLIC: Página intermediária com pixel — GET /l/:slug
  // Usada quando o link é destino de Meta Ads: aguarda N ms para o pixel
  // (Meta/GA4) disparar antes do redirect pro WhatsApp. O pixel aqui captura
  // fbclid/gclid/ctwaClid que já vieram na URL e dispara o evento `Lead`.
  // ═══════════════════════════════════════════
  app.get('/l/:slug', async (req, reply) => {
    const { slug } = req.params as { slug: string }

    const link = await prisma.trackableLink.findUnique({ where: { slug } })
    if (!link || !link.active) {
      return reply.code(404).type('text/html').send('<h1>Link não encontrado</h1>')
    }

    // Pré-gera eventId para dedup Meta (CAPI server-side usa o mesmo id que o pixel do browser)
    const capiEventId = crypto.randomUUID()
    const eventSourceUrl = `${process.env.APP_URL || `${req.protocol}://${req.headers.host}`}/l/${slug}`

    const qq = req.query as any
    const sessionId = qq?.sid ? String(qq.sid).slice(0, 64) : undefined
    const waUrl = buildWhatsappUrl(link, sessionId)

    // Registrar o clique imediatamente (não esperamos o delay)
    const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip
    const ua = req.headers['user-agent'] || ''
    const referer = (req.headers['referer'] as string) || ''
    if (!isBotUA(ua)) {
      const { deviceType, browser, os } = parseUA(ua)
      const ids = extractClickIds(req.query)
      recordClick({ linkId: link.id, ip, userAgent: ua, referer, deviceType, browser, os, ...ids, sessionId, capiEventId, eventSourceUrl }).catch(() => {})
    }

    const delay = Math.max(500, Math.min(link.redirectDelayMs ?? 3000, 10000))
    const fbPixelId = link.fbPixelId || ''
    const ga4Id = link.ga4MeasurementId || ''

    const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>Redirecionando para WhatsApp...</title>
<style>
  *{box-sizing:border-box}
  body{margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:linear-gradient(135deg,#25D366 0%,#128C7E 100%);min-height:100vh;display:flex;align-items:center;justify-content:center;color:#fff}
  .card{background:rgba(255,255,255,0.12);backdrop-filter:blur(10px);border-radius:20px;padding:40px;text-align:center;max-width:420px;margin:20px}
  .logo{width:80px;height:80px;margin:0 auto 20px;background:#fff;border-radius:50%;display:flex;align-items:center;justify-content:center}
  h1{font-size:22px;margin:0 0 8px}
  p{font-size:14px;opacity:0.9;margin:0 0 24px;line-height:1.5}
  .spinner{width:48px;height:48px;border:4px solid rgba(255,255,255,0.3);border-top-color:#fff;border-radius:50%;animation:spin 0.8s linear infinite;margin:0 auto 16px}
  @keyframes spin{to{transform:rotate(360deg)}}
  .countdown{font-size:13px;opacity:0.85}
  a.manual{display:inline-block;margin-top:20px;padding:10px 20px;background:#fff;color:#128C7E;text-decoration:none;border-radius:10px;font-weight:600;font-size:13px}
</style>
${fbPixelId ? `
<!-- Meta Pixel -->
<script>
!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');
fbq('init','${escapeHtml(fbPixelId)}');
fbq('track','PageView');
fbq('track','Lead',{content_name:'${escapeHtml(link.name || slug)}',content_category:'whatsapp_click'},{eventID:'${escapeHtml(capiEventId)}'});
</script>
<noscript><img height="1" width="1" style="display:none" src="https://www.facebook.com/tr?id=${escapeHtml(fbPixelId)}&ev=PageView&noscript=1"/></noscript>
` : ''}
${ga4Id ? `
<!-- Google tag (gtag.js) -->
<script async src="https://www.googletagmanager.com/gtag/js?id=${escapeHtml(ga4Id)}"></script>
<script>
window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}
gtag('js',new Date());gtag('config','${escapeHtml(ga4Id)}');
gtag('event','generate_lead',{event_category:'whatsapp_click',event_label:'${escapeHtml(link.name || slug)}'});
</script>
` : ''}
</head>
<body>
  <div class="card">
    <div class="logo">
      <svg width="48" height="48" viewBox="0 0 24 24" fill="#25D366"><path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38c1.45.79 3.08 1.21 4.74 1.21 5.46 0 9.91-4.45 9.91-9.91S17.5 2 12.04 2zm5.79 14.02c-.25.69-1.45 1.36-1.99 1.41-.54.06-1.02.27-3.37-.7-2.8-1.18-4.59-4.07-4.73-4.25-.14-.19-1.11-1.49-1.11-2.84 0-1.36.71-2.02.97-2.3.25-.28.55-.35.74-.35.19 0 .37 0 .55.01.17.01.42-.07.65.5.25.61.84 2.12.92 2.27.08.15.13.33.02.52-.11.19-.16.32-.33.5-.16.18-.34.4-.48.54-.16.16-.33.33-.14.64.19.31.83 1.37 1.78 2.22 1.22 1.09 2.25 1.43 2.57 1.58.31.16.49.13.68-.08.19-.21.78-.91 1-1.22.21-.31.42-.26.71-.16.29.11 1.83.86 2.14 1.02.31.16.52.23.6.36.08.13.08.73-.18 1.43z"/></svg>
    </div>
    <h1>Conectando ao WhatsApp</h1>
    <p>Você será redirecionado em <span id="cd">${Math.round(delay/1000)}</span> segundos...</p>
    <div class="spinner"></div>
    <a class="manual" href="${escapeHtml(waUrl)}" id="go">Abrir agora</a>
  </div>
<script>
(function(){
  var url = ${JSON.stringify(waUrl)};
  var delay = ${delay};
  var secs = Math.round(delay/1000);
  var cd = document.getElementById('cd');
  var iv = setInterval(function(){ secs--; if(secs<=0){ clearInterval(iv); } if(cd) cd.textContent = Math.max(0, secs); }, 1000);
  setTimeout(function(){ window.location.replace(url); }, delay);
})();
</script>
</body>
</html>`
    return reply.type('text/html').send(html)
  })

  // ═══════════════════════════════════════════
  // ADMIN: CRUD Routes
  // ═══════════════════════════════════════════

  // POST /api/admin/trackable-links — Create
  app.post('/api/admin/trackable-links', { preHandler: adminOnly }, async (req, reply) => {
    const body = req.body as any
    let slug = body.slug?.trim()

    if (!slug) {
      slug = generateSlug()
    }

    // Validate slug format
    slug = slug.toLowerCase().replace(/[^a-z0-9-_]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')

    if (!body.name || !body.whatsappPhone) {
      return reply.code(400).send({ error: 'name e whatsappPhone são obrigatórios' })
    }

    const exists = await prisma.trackableLink.findUnique({ where: { slug } })
    if (exists) {
      return reply.code(409).send({ error: 'Slug já existe. Escolha outro.' })
    }

    const link = await prisma.trackableLink.create({
      data: {
        slug,
        name: body.name,
        description: body.description || null,
        whatsappPhone: body.whatsappPhone,
        prefilledMessage: body.prefilledMessage || null,
        utmSource: body.utmSource || null,
        utmMedium: body.utmMedium || null,
        utmCampaign: body.utmCampaign || null,
        utmContent: body.utmContent || null,
        utmTerm: body.utmTerm || null,
        campaignId: body.campaignId || null,
        campaignName: body.campaignName || null,
        fbPixelId: body.fbPixelId || null,
        fbCapiAccessToken: body.fbCapiAccessToken || null,
        ga4MeasurementId: body.ga4MeasurementId || null,
        redirectDelayMs: typeof body.redirectDelayMs === 'number' ? Math.max(500, Math.min(body.redirectDelayMs, 10000)) : 3000,
        active: body.active !== false,
        createdBy: (req as any).user?.id || null,
      }
    })

    return { ok: true, link }
  })

  // GET /api/admin/trackable-links — List all
  app.get('/api/admin/trackable-links', { preHandler: authMiddleware }, async (req) => {
    const q = req.query as any
    const page = parseInt(q.page) || 1
    const limit = Math.min(parseInt(q.limit) || 50, 200)
    const skip = (page - 1) * limit

    const where: any = {}
    if (q.active === 'true') where.active = true
    if (q.active === 'false') where.active = false
    if (q.search) {
      where.OR = [
        { name: { contains: q.search } },
        { slug: { contains: q.search } },
        { utmCampaign: { contains: q.search } },
      ]
    }

    const [links, total] = await Promise.all([
      prisma.trackableLink.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.trackableLink.count({ where }),
    ])

    return { links, total, page, limit }
  })

  // GET /api/admin/trackable-links/:id — Detail
  app.get('/api/admin/trackable-links/:id', { preHandler: authMiddleware }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const link = await prisma.trackableLink.findUnique({
      where: { id: parseInt(id) },
      include: {
        clicks: {
          orderBy: { createdAt: 'desc' },
          take: 50,
        }
      }
    })
    if (!link) return reply.code(404).send({ error: 'Link não encontrado' })
    return { link }
  })

  // GET /api/admin/trackable-links/:id/leads — Lead Journey por link
  // Retorna leads que vieram por este link, etapa atual, venda detectada e timestamps.
  app.get('/api/admin/trackable-links/:id/leads', { preHandler: authMiddleware }, async (req) => {
    const { id } = req.params as { id: string }
    const q = req.query as any
    const limit = Math.min(parseInt(q.limit) || 100, 500)

    const linkId = parseInt(id)
    const link = await prisma.trackableLink.findUnique({
      where: { id: linkId },
      select: { id: true, slug: true, name: true, totalClicks: true, uniqueClicks: true, leadsGenerated: true, totalSales: true, totalRevenue: true },
    })
    if (!link) return { leads: [], link: null }

    const leads = await prisma.lead.findMany({
      where: { trackableLinkId: linkId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true, uid: true, nome: true, empresa: true, whatsapp: true, email: true,
        status: true, funnelId: true,
        saleDetected: true, saleValue: true, saleDetectedAt: true,
        source: true, originType: true, campaignName: true,
        createdAt: true, lastMessageAt: true,
        funnel: { select: { id: true, name: true } },
      },
    })

    // Funis + stages para traduzir stage key → label
    const stages = await prisma.stage.findMany({
      select: { funnelId: true, key: true, name: true, color: true },
    })
    const stageMap = new Map<string, { name: string; color: string | null }>()
    for (const s of stages) {
      stageMap.set(`${s.funnelId}::${s.key}`, { name: s.name, color: s.color })
    }

    const enriched = leads.map(l => {
      const key = `${l.funnelId}::${l.status}`
      const stage = stageMap.get(key)
      return { ...l, stageName: stage?.name || l.status, stageColor: stage?.color || null }
    })

    return {
      link,
      leads: enriched,
      total: enriched.length,
    }
  })

  // PUT /api/admin/trackable-links/:id — Update
  app.put('/api/admin/trackable-links/:id', { preHandler: adminOnly }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const body = req.body as any

    const link = await prisma.trackableLink.findUnique({ where: { id: parseInt(id) } })
    if (!link) return reply.code(404).send({ error: 'Link não encontrado' })

    const data: any = {}
    if (body.name !== undefined) data.name = body.name
    if (body.description !== undefined) data.description = body.description
    if (body.whatsappPhone !== undefined) data.whatsappPhone = body.whatsappPhone
    if (body.prefilledMessage !== undefined) data.prefilledMessage = body.prefilledMessage
    if (body.utmSource !== undefined) data.utmSource = body.utmSource
    if (body.utmMedium !== undefined) data.utmMedium = body.utmMedium
    if (body.utmCampaign !== undefined) data.utmCampaign = body.utmCampaign
    if (body.utmContent !== undefined) data.utmContent = body.utmContent
    if (body.utmTerm !== undefined) data.utmTerm = body.utmTerm
    if (body.campaignId !== undefined) data.campaignId = body.campaignId
    if (body.campaignName !== undefined) data.campaignName = body.campaignName
    if (body.fbPixelId !== undefined) data.fbPixelId = body.fbPixelId || null
    if (body.fbCapiAccessToken !== undefined) data.fbCapiAccessToken = body.fbCapiAccessToken || null
    if (body.ga4MeasurementId !== undefined) data.ga4MeasurementId = body.ga4MeasurementId || null
    if (body.redirectDelayMs !== undefined) data.redirectDelayMs = Math.max(500, Math.min(parseInt(body.redirectDelayMs) || 3000, 10000))
    if (body.active !== undefined) data.active = body.active

    const updated = await prisma.trackableLink.update({
      where: { id: parseInt(id) },
      data,
    })

    return { ok: true, link: updated }
  })

  // DELETE /api/admin/trackable-links/:id
  app.delete('/api/admin/trackable-links/:id', { preHandler: adminOnly }, async (req, reply) => {
    const { id } = req.params as { id: string }
    await prisma.trackableLink.delete({ where: { id: parseInt(id) } }).catch(() => null)
    return { ok: true }
  })

  // GET /api/admin/trackable-links/:id/clicks — Click log
  app.get('/api/admin/trackable-links/:id/clicks', { preHandler: authMiddleware }, async (req) => {
    const { id } = req.params as { id: string }
    const q = req.query as any
    const page = parseInt(q.page) || 1
    const limit = Math.min(parseInt(q.limit) || 50, 200)

    const [clicks, total] = await Promise.all([
      prisma.trackableLinkClick.findMany({
        where: { linkId: parseInt(id) },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.trackableLinkClick.count({ where: { linkId: parseInt(id) } }),
    ])

    return { clicks, total, page, limit }
  })

  // GET /api/admin/trackable-links/stats/overview — Dashboard stats
  app.get('/api/admin/trackable-links/stats/overview', { preHandler: authMiddleware }, async (req) => {
    const q = req.query as any
    const days = parseInt(q.days) || 30
    const since = new Date()
    since.setDate(since.getDate() - days)

    const [totalLinks, activeLinks, totalClicks, recentClicks, topLinks, totals] = await Promise.all([
      prisma.trackableLink.count(),
      prisma.trackableLink.count({ where: { active: true } }),
      prisma.trackableLinkClick.count(),
      prisma.trackableLinkClick.count({ where: { createdAt: { gte: since } } }),
      prisma.trackableLink.findMany({
        where: { active: true },
        orderBy: { totalClicks: 'desc' },
        take: 10,
        select: { id: true, name: true, slug: true, totalClicks: true, uniqueClicks: true, leadsGenerated: true, totalSales: true, totalRevenue: true, utmCampaign: true }
      }),
      prisma.trackableLink.aggregate({
        _sum: { totalSales: true, totalRevenue: true, leadsGenerated: true },
      }),
    ])

    // Clicks per day for chart
    const clicksByDay = await prisma.$queryRaw`
      SELECT DATE(createdAt) as date, COUNT(*) as clicks
      FROM bychat_trackable_link_clicks
      WHERE createdAt >= ${since}
      GROUP BY DATE(createdAt)
      ORDER BY date ASC
    ` as Array<{ date: string; clicks: number }>

    // Device breakdown
    const deviceBreakdown = await prisma.$queryRaw`
      SELECT deviceType, COUNT(*) as count
      FROM bychat_trackable_link_clicks
      WHERE createdAt >= ${since} AND deviceType IS NOT NULL
      GROUP BY deviceType
      ORDER BY count DESC
    ` as Array<{ deviceType: string; count: number }>

    return {
      totalLinks,
      activeLinks,
      totalClicks,
      recentClicks,
      topLinks,
      totalSales: totals._sum.totalSales || 0,
      totalRevenue: Number(totals._sum.totalRevenue || 0),
      totalLeadsGenerated: totals._sum.leadsGenerated || 0,
      clicksByDay: sanitizeRaw(clicksByDay),
      deviceBreakdown: sanitizeRaw(deviceBreakdown),
    }
  })

  // ═══════════════════════════════════════════
  // QR Code PNG do link
  // GET /api/admin/trackable-links/:id/qrcode.png?type=r|l&size=512
  // ═══════════════════════════════════════════
  app.get('/api/admin/trackable-links/:id/qrcode.png', { preHandler: authMiddleware }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const q = req.query as any
    const type = q.type === 'l' ? 'l' : 'r'
    const size = Math.max(128, Math.min(parseInt(q.size) || 512, 2048))

    const link = await prisma.trackableLink.findUnique({ where: { id: parseInt(id) } })
    if (!link) return reply.code(404).send({ error: 'Link não encontrado' })

    const base = process.env.APP_URL || `${req.protocol}://${req.headers.host}`
    const url = `${base}/${type}/${link.slug}`
    const buf = await QRCode.toBuffer(url, { type: 'png', width: size, margin: 2, errorCorrectionLevel: 'M' })
    reply.header('Content-Type', 'image/png')
    reply.header('Content-Disposition', `inline; filename="qr-${link.slug}-${type}.png"`)
    return reply.send(buf)
  })

  // ═══════════════════════════════════════════
  // Export CSV dos cliques
  // GET /api/admin/trackable-links/:id/clicks.csv
  // ═══════════════════════════════════════════
  app.get('/api/admin/trackable-links/:id/clicks.csv', { preHandler: authMiddleware }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const link = await prisma.trackableLink.findUnique({ where: { id: parseInt(id) } })
    if (!link) return reply.code(404).send({ error: 'Link não encontrado' })

    const clicks = await prisma.trackableLinkClick.findMany({
      where: { linkId: link.id },
      orderBy: { createdAt: 'desc' },
      take: 10000,
    })

    const cols = [
      'id','createdAt','ip','deviceType','browser','os','referer',
      'fbclid','gclid','ctwaClid','tintimFbid',
      'utmSource','utmMedium','utmCampaign','utmContent','utmTerm',
      'userAgent',
    ]
    const esc = (v: any) => {
      if (v == null) return ''
      const s = String(v).replace(/"/g, '""').replace(/\r?\n/g, ' ')
      return /[",;\n]/.test(s) ? `"${s}"` : s
    }
    const lines = [cols.join(',')]
    for (const c of clicks) {
      lines.push(cols.map(k => esc((c as any)[k])).join(','))
    }
    const csv = '\uFEFF' + lines.join('\n')
    reply.header('Content-Type', 'text/csv; charset=utf-8')
    reply.header('Content-Disposition', `attachment; filename="clicks-${link.slug}.csv"`)
    return reply.send(csv)
  })
}

// ── Helper: Record click asynchronously (atômico via transaction) ──
interface ClickData {
  linkId: number; ip: string; userAgent: string; referer: string
  deviceType: string; browser: string; os: string
  fbclid?: string; gclid?: string; ctwaClid?: string; tintimFbid?: string
  utmSource?: string; utmMedium?: string; utmCampaign?: string; utmContent?: string; utmTerm?: string
  queryParams?: any
  sessionId?: string
  capiEventId?: string      // id pre-gerado quando /l/ é servido (para dedup com pixel browser)
  eventSourceUrl?: string
}
async function recordClick(d: ClickData) {
  try {
    let clickId: number | null = null
    let linkSnap: any = null
    let linkFull: any = null
    await prisma.$transaction(async (tx) => {
      const click = await tx.trackableLinkClick.create({
        data: {
          linkId: d.linkId, ip: d.ip, userAgent: d.userAgent, referer: d.referer,
          deviceType: d.deviceType, browser: d.browser, os: d.os,
          fbclid: d.fbclid, gclid: d.gclid, ctwaClid: d.ctwaClid, tintimFbid: d.tintimFbid,
          utmSource: d.utmSource, utmMedium: d.utmMedium, utmCampaign: d.utmCampaign,
          utmContent: d.utmContent, utmTerm: d.utmTerm,
          queryParams: d.queryParams,
          sessionId: d.sessionId,
          capiEventId: d.capiEventId,
        }
      })
      clickId = click.id

      const yesterday = new Date()
      yesterday.setHours(yesterday.getHours() - 24)
      const existingFromIp = await tx.trackableLinkClick.count({
        where: { linkId: d.linkId, ip: d.ip, createdAt: { gte: yesterday } }
      })

      linkSnap = await tx.trackableLink.update({
        where: { id: d.linkId },
        data: {
          totalClicks: { increment: 1 },
          ...(existingFromIp <= 1 ? { uniqueClicks: { increment: 1 } } : {}),
        },
        select: {
          id: true, slug: true, name: true, campaignName: true,
          utmSource: true, utmMedium: true, utmCampaign: true,
          totalClicks: true, uniqueClicks: true,
          fbPixelId: true, fbCapiAccessToken: true,
        }
      })
      linkFull = linkSnap
    })

    // Meta CAPI server-side — só dispara se o link tem Pixel ID + Access Token E temos fbclid
    // (sem fbclid o evento não tem como ser atribuído pelo Meta, não compensa gastar cota)
    if (clickId && linkFull && linkFull.fbPixelId && linkFull.fbCapiAccessToken && d.fbclid) {
      fireCapiLeadNoLead({
        pixelId: linkFull.fbPixelId,
        accessToken: linkFull.fbCapiAccessToken,
        eventId: d.capiEventId,
        eventSourceUrl: d.eventSourceUrl,
        fbclid: d.fbclid,
        clientIp: d.ip,
        clientUserAgent: d.userAgent,
        contentName: linkFull.name || linkFull.slug,
        contentCategory: 'whatsapp_click',
      }).then(r => {
        if (r.success) {
          prisma.trackableLinkClick.update({
            where: { id: clickId! },
            data: { capiSent: true },
          }).catch(() => {})
        } else {
          console.warn(`[CAPI] Link click falhou: ${r.error}`)
        }
      }).catch(() => {})
    }

    // Fire-and-forget webhook (out-of-transaction para não bloquear o redirect)
    if (clickId && linkSnap) {
      dispatchStandaloneEvent('trackable_link.click', {
        clickId,
        link: linkSnap,
        click: {
          ip: d.ip,
          deviceType: d.deviceType,
          browser: d.browser,
          os: d.os,
          referer: d.referer,
          fbclid: d.fbclid,
          gclid: d.gclid,
          ctwaClid: d.ctwaClid,
          tintimFbid: d.tintimFbid,
          utmSource: d.utmSource,
          utmMedium: d.utmMedium,
          utmCampaign: d.utmCampaign,
          utmContent: d.utmContent,
          utmTerm: d.utmTerm,
        },
      }).catch(() => {})
    }
  } catch (err) {
    console.error('Error recording trackable link click:', err)
  }
}
