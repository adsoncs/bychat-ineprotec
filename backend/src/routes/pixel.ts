// src/routes/pixel.ts
// Pixel JS público do ByChat Beyond.
// Expõe /pixel/bychat.js, POST /api/pixel/track e POST /api/pixel/identify.
// Habilita jornada anônima (visitante) → lead (conversa WhatsApp) com cruzamento
// via sessionId embutido na mensagem pré-preenchida do link rastreável.

import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'

function sanitizeStr(v: any, max = 250): string | undefined {
  if (!v) return undefined
  const s = String(v).slice(0, max)
  return s || undefined
}

function parseDeviceType(ua: string): string {
  if (!ua) return 'unknown'
  return /mobile|android|iphone|ipad/i.test(ua) ? (/ipad|tablet/i.test(ua) ? 'tablet' : 'mobile') : 'desktop'
}

const PIXEL_JS = (origin: string) => `/* ByChat Beyond Pixel — v1.0 */
(function(){
  var API = '${origin}/api/pixel';
  var KEY = 'bc_vid';
  var LSKEY = 'bc_visit';
  function rnd() {
    try { return crypto.randomUUID(); } catch(e) {}
    return 'v-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }
  function getCookie(n) {
    var m = document.cookie.match(new RegExp('(?:^|; )' + n + '=([^;]*)'));
    return m ? decodeURIComponent(m[1]) : null;
  }
  function setCookie(n, v, days) {
    var d = new Date(); d.setTime(d.getTime() + days * 864e5);
    document.cookie = n + '=' + encodeURIComponent(v) + ';path=/;expires=' + d.toUTCString() + ';SameSite=Lax';
  }
  function getVid() {
    var v = getCookie(KEY) || (function(){ try { return localStorage.getItem(KEY); } catch(e){} })();
    if (!v) {
      v = rnd();
      setCookie(KEY, v, 365);
      try { localStorage.setItem(KEY, v); } catch(e){}
    }
    return v;
  }
  function qp() {
    var q = {}; var p = location.search.replace(/^\\?/, '').split('&');
    for (var i=0;i<p.length;i++) { var kv = p[i].split('='); if (!kv[0]) continue; q[decodeURIComponent(kv[0])] = decodeURIComponent(kv[1]||''); }
    return q;
  }
  function post(path, body) {
    try {
      var data = JSON.stringify(body);
      if (navigator.sendBeacon) {
        var blob = new Blob([data], { type: 'application/json' });
        navigator.sendBeacon(API + path, blob);
        return;
      }
      fetch(API + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: data, keepalive: true, credentials: 'omit' }).catch(function(){});
    } catch(e){}
  }
  var q = qp();
  var vid = getVid();
  var payload = {
    visitorId: vid,
    url: location.href,
    path: location.pathname,
    title: document.title,
    referer: document.referrer,
    utm_source: q.utm_source, utm_medium: q.utm_medium, utm_campaign: q.utm_campaign,
    utm_content: q.utm_content, utm_term: q.utm_term,
    fbclid: q.fbclid, gclid: q.gclid, ctwa_clid: q.ctwa_clid || q.ctwaClid,
    tintim_fbid: q.tintim_fbid,
  };
  try { sessionStorage.setItem(LSKEY, JSON.stringify({ vid: vid, t: Date.now() })); } catch(e){}
  post('/track', payload);

  // API pública: bychat.trackableHref(slug) devolve a URL com sid embutido
  window.bychat = {
    visitorId: vid,
    track: function(name, data) { post('/track', { visitorId: vid, event: name, url: location.href, data: data || null }); },
    trackableHref: function(href) {
      try {
        var u = new URL(href, location.href);
        u.searchParams.set('sid', vid);
        return u.toString();
      } catch(e) { return href; }
    },
    // Auto-rewrite: percorre <a data-bychat-track> e adiciona sid na URL
    rewriteLinks: function(selector) {
      var sel = selector || 'a[data-bychat-track]';
      var nodes = document.querySelectorAll(sel);
      for (var i=0;i<nodes.length;i++) {
        nodes[i].href = window.bychat.trackableHref(nodes[i].href);
      }
    }
  };
  // Auto-rewrite ao DOMContentLoaded
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function(){ window.bychat.rewriteLinks(); });
  } else {
    window.bychat.rewriteLinks();
  }
})();
`

export async function pixelRoutes(app: FastifyInstance) {

  // ─── CORS wide-open for public pixel endpoints ───
  function setCors(reply: any) {
    reply.header('Access-Control-Allow-Origin', '*')
    reply.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    reply.header('Access-Control-Allow-Headers', 'Content-Type')
    reply.header('Access-Control-Max-Age', '86400')
  }

  // Preflight
  app.options('/api/pixel/*', async (_req, reply) => {
    setCors(reply)
    return reply.code(204).send()
  })

  // ─── GET /pixel/bychat.js ───────────────────────
  app.get('/pixel/bychat.js', async (req, reply) => {
    const origin = process.env.APP_URL || `${req.protocol}://${req.headers.host}`
    reply.header('Content-Type', 'application/javascript; charset=utf-8')
    reply.header('Cache-Control', 'public, max-age=300')
    reply.header('Access-Control-Allow-Origin', '*')
    return reply.send(PIXEL_JS(origin))
  })

  // ─── POST /api/pixel/track ──────────────────────
  app.post('/api/pixel/track', async (req, reply) => {
    setCors(reply)
    const body = (req.body || {}) as any
    const visitorId = sanitizeStr(body.visitorId, 64)
    if (!visitorId) return reply.code(400).send({ error: 'visitorId obrigatório' })

    const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip
    const ua = (req.headers['user-agent'] as string) || ''
    const deviceType = parseDeviceType(ua)
    const now = new Date()

    const incoming = {
      url:          sanitizeStr(body.url, 500),
      referer:      sanitizeStr(body.referer, 500),
      utmSource:    sanitizeStr(body.utm_source, 100),
      utmMedium:    sanitizeStr(body.utm_medium, 100),
      utmCampaign:  sanitizeStr(body.utm_campaign, 191),
      utmContent:   sanitizeStr(body.utm_content, 191),
      utmTerm:      sanitizeStr(body.utm_term, 191),
      fbclid:       sanitizeStr(body.fbclid),
      gclid:        sanitizeStr(body.gclid),
      ctwaClid:     sanitizeStr(body.ctwa_clid),
      tintimFbid:   sanitizeStr(body.tintim_fbid),
    }

    try {
      const existing = await prisma.pixelVisitor.findUnique({ where: { visitorId } })
      if (!existing) {
        await prisma.pixelVisitor.create({
          data: {
            visitorId,
            firstSeenAt: now,
            lastSeenAt: now,
            totalPageviews: body.event ? 0 : 1,
            totalEvents: body.event ? 1 : 0,
            firstUrl: incoming.url,
            firstReferer: incoming.referer,
            firstUtmSource: incoming.utmSource,
            firstUtmMedium: incoming.utmMedium,
            firstUtmCampaign: incoming.utmCampaign,
            firstUtmContent: incoming.utmContent,
            firstUtmTerm: incoming.utmTerm,
            firstFbclid: incoming.fbclid,
            firstGclid: incoming.gclid,
            firstCtwaClid: incoming.ctwaClid,
            firstTintimFbid: incoming.tintimFbid,
            lastUrl: incoming.url,
            lastUtmSource: incoming.utmSource,
            lastUtmCampaign: incoming.utmCampaign,
            ip,
            userAgent: ua.slice(0, 500),
            deviceType,
          },
        })
      } else {
        await prisma.pixelVisitor.update({
          where: { visitorId },
          data: {
            lastSeenAt: now,
            totalPageviews: body.event ? undefined : { increment: 1 },
            totalEvents: body.event ? { increment: 1 } : undefined,
            lastUrl: incoming.url,
            lastUtmSource: incoming.utmSource,
            lastUtmCampaign: incoming.utmCampaign,
            ip,
            userAgent: ua.slice(0, 500),
            deviceType,
          },
        })
      }
    } catch (err) {
      console.error('[pixel] track error:', err)
    }
    return reply.code(204).send()
  })

  // ─── POST /api/pixel/identify ───────────────────
  // Identifica um visitor como um lead já conhecido (cross-device).
  app.post('/api/pixel/identify', async (req, reply) => {
    setCors(reply)
    const body = (req.body || {}) as any
    const visitorId = sanitizeStr(body.visitorId, 64)
    const leadId = parseInt(body.leadId)
    if (!visitorId || !leadId) return reply.code(400).send({ error: 'visitorId e leadId obrigatórios' })

    try {
      await prisma.pixelVisitor.update({
        where: { visitorId },
        data: { leadId, identifiedAt: new Date() },
      }).catch(() => null)
    } catch (err) {
      console.error('[pixel] identify error:', err)
    }
    return reply.code(204).send()
  })
}
