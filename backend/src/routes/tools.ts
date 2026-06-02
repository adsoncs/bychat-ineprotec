// src/routes/tools.ts
// Endpoints utilitários do grupo "Ferramentas": QR Code, URL Inspector.

import { FastifyInstance } from 'fastify'
import QRCode from 'qrcode'
import { adminOnly } from '../lib/auth.js'

// ── QR CODE ────────────────────────────────────

interface QrInput {
  data: string
  format?: 'png' | 'svg'
  size?: number          // 64–1024
  margin?: number        // 0–8
  foreground?: string    // #RRGGBB
  background?: string    // #RRGGBB
  errorCorrection?: 'L' | 'M' | 'Q' | 'H'
}

function sanitizeHexColor(v: any, fallback: string): string {
  if (typeof v !== 'string') return fallback
  const m = v.match(/^#?([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/)
  if (!m) return fallback
  let hex = m[1]
  if (hex.length === 3) hex = hex.split('').map(c => c + c).join('')
  return `#${hex.toUpperCase()}`
}

export async function toolsRoutes(app: FastifyInstance) {

  // POST /api/admin/tools/qrcode — gera QR Code
  // Retorna PNG (binário) ou SVG (text/xml) conforme `format`.
  app.post('/api/admin/tools/qrcode', { preHandler: adminOnly }, async (req, reply) => {
    const body = (req.body as QrInput) || ({} as QrInput)
    const data = String(body.data ?? '').slice(0, 2048).trim()
    if (!data) return reply.code(400).send({ error: 'Campo "data" é obrigatório' })

    const format = body.format === 'svg' ? 'svg' : 'png'
    const size = Math.min(1024, Math.max(64, Number(body.size) || 512))
    const margin = Math.min(8, Math.max(0, Number(body.margin) || 2))
    const foreground = sanitizeHexColor(body.foreground, '#000000')
    const background = sanitizeHexColor(body.background, '#FFFFFF')
    const ec = (['L', 'M', 'Q', 'H'].includes(body.errorCorrection as any) ? body.errorCorrection : 'M') as 'L' | 'M' | 'Q' | 'H'

    const opts: any = {
      errorCorrectionLevel: ec,
      margin,
      color: { dark: foreground, light: background },
    }

    try {
      if (format === 'svg') {
        opts.type = 'svg'
        opts.width = size
        const svg = await QRCode.toString(data, opts)
        return reply
          .type('image/svg+xml; charset=utf-8')
          .header('Cache-Control', 'no-store')
          .send(svg)
      } else {
        opts.type = 'png'
        opts.width = size
        const buf = await QRCode.toBuffer(data, opts)
        return reply
          .type('image/png')
          .header('Cache-Control', 'no-store')
          .send(buf)
      }
    } catch (e: any) {
      return reply.code(500).send({ error: `Falha ao gerar QR: ${e?.message || 'desconhecido'}` })
    }
  })

  // ── URL INSPECTOR ─────────────────────────────
  //
  // POST /api/admin/tools/url-inspect — busca uma URL e devolve relatório
  // de tracking/SEO/social. Sem persistência. Limites de timeout/tamanho
  // protegem contra SSRF de scraping caro.

  app.post('/api/admin/tools/url-inspect', { preHandler: adminOnly }, async (req, reply) => {
    const body = (req.body as any) || {}
    const target = String(body.url ?? '').trim()
    if (!target) return reply.code(400).send({ error: 'url é obrigatória' })

    let parsed: URL
    try { parsed = new URL(target) } catch { return reply.code(400).send({ error: 'URL inválida' }) }
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return reply.code(400).send({ error: 'Somente http(s) é suportado' })
    }

    // UTMs e click IDs da query
    const queryParams: Record<string, string> = {}
    parsed.searchParams.forEach((v, k) => { queryParams[k] = v })
    const utms: Record<string, string | null> = {}
    for (const k of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'utm_id']) {
      utms[k] = parsed.searchParams.get(k)
    }
    const clickIds: Record<string, string | null> = {
      fbclid: parsed.searchParams.get('fbclid'),
      gclid: parsed.searchParams.get('gclid'),
      gbraid: parsed.searchParams.get('gbraid'),
      wbraid: parsed.searchParams.get('wbraid'),
      msclkid: parsed.searchParams.get('msclkid'),
      ttclid: parsed.searchParams.get('ttclid'),
      twclid: parsed.searchParams.get('twclid'),
      ctwa_clid: parsed.searchParams.get('ctwa_clid'),
    }

    // Segue redirecionamentos manualmente para reportar a cadeia
    const redirects: Array<{ from: string; to: string; status: number }> = []
    let currentUrl = parsed.toString()
    let finalStatus = 0
    let html = ''
    let responseHeaders: Record<string, string> = {}
    const t0 = Date.now()

    try {
      for (let i = 0; i < 8; i++) {
        const res = await fetch(currentUrl, {
          method: 'GET',
          redirect: 'manual',
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; ByChatBeyond URL Inspector/1.0)',
            'Accept': 'text/html,*/*;q=0.8',
          },
          signal: AbortSignal.timeout(8_000),
        })
        finalStatus = res.status
        responseHeaders = {}
        res.headers.forEach((v, k) => { responseHeaders[k] = v })

        if (res.status >= 300 && res.status < 400) {
          const loc = res.headers.get('location')
          if (!loc) break
          const next = new URL(loc, currentUrl).toString()
          redirects.push({ from: currentUrl, to: next, status: res.status })
          currentUrl = next
          continue
        }
        // Lê HTML até 1MB
        const reader = res.body?.getReader()
        if (reader) {
          let total = 0
          const decoder = new TextDecoder('utf-8', { fatal: false })
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            total += value.byteLength
            html += decoder.decode(value, { stream: true })
            if (total > 1_048_576) { try { await reader.cancel() } catch {/* ignore */} break }
          }
          html += decoder.decode()
        }
        break
      }
    } catch (e: any) {
      return reply.code(200).send({
        ok: false,
        error: e?.message || 'fetch failed',
        targetUrl: parsed.toString(),
        finalUrl: currentUrl,
        redirects,
        elapsedMs: Date.now() - t0,
      })
    }

    const elapsedMs = Date.now() - t0

    // ── extrai meta tags + OG + Twitter
    function metaContent(html: string, attr: 'name' | 'property', key: string): string | null {
      const re = new RegExp(`<meta[^>]+${attr}=["']${key}["'][^>]*content=["']([^"']+)["']`, 'i')
      const re2 = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]*${attr}=["']${key}["']`, 'i')
      return (html.match(re)?.[1] || html.match(re2)?.[1] || null)
    }
    function pageTitle(html: string): string | null {
      return (html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] || null)
    }
    function pageLang(html: string): string | null {
      return (html.match(/<html[^>]+lang=["']([^"']+)["']/i)?.[1] || null)
    }

    const og = {
      title: metaContent(html, 'property', 'og:title'),
      description: metaContent(html, 'property', 'og:description'),
      image: metaContent(html, 'property', 'og:image'),
      type: metaContent(html, 'property', 'og:type'),
      url: metaContent(html, 'property', 'og:url'),
      siteName: metaContent(html, 'property', 'og:site_name'),
    }
    const twitter = {
      card: metaContent(html, 'name', 'twitter:card'),
      title: metaContent(html, 'name', 'twitter:title'),
      description: metaContent(html, 'name', 'twitter:description'),
      image: metaContent(html, 'name', 'twitter:image'),
    }
    const seo = {
      title: pageTitle(html),
      description: metaContent(html, 'name', 'description'),
      lang: pageLang(html),
      robots: metaContent(html, 'name', 'robots'),
      viewport: metaContent(html, 'name', 'viewport'),
      canonical: (html.match(/<link[^>]+rel=["']canonical["'][^>]*href=["']([^"']+)["']/i)?.[1] || null),
      themeColor: metaContent(html, 'name', 'theme-color'),
    }

    // ── pixels/tags detectados
    const lower = html.toLowerCase()
    const trackers: Array<{ id: string; name: string; pattern: string; ids?: string[] }> = []
    function addIfMatch(id: string, name: string, pattern: string, idsExtractor?: () => string[] | undefined) {
      if (lower.includes(pattern.toLowerCase())) {
        const ids = idsExtractor?.()
        trackers.push({ id, name, pattern, ...(ids && ids.length > 0 ? { ids } : {}) })
      }
    }
    addIfMatch('meta_pixel', 'Meta Pixel (fbq)', 'fbq(', () => {
      const ids = new Set<string>()
      const re = /fbq\s*\(\s*['"]init['"]\s*,\s*['"](\d{10,16})['"]/g
      let m: RegExpExecArray | null
      while ((m = re.exec(html))) ids.add(m[1])
      return Array.from(ids)
    })
    addIfMatch('gtag', 'Google gtag.js', 'gtag(')
    addIfMatch('ga4', 'GA4', 'googletagmanager.com/gtag/js?id=g-', () => {
      const ids = new Set<string>()
      const re = /(?:gtag\s*\(\s*['"]config['"]\s*,\s*['"]|gtag\/js\?id=)(G-[A-Z0-9]+)/gi
      let m: RegExpExecArray | null
      while ((m = re.exec(html))) ids.add(m[1].toUpperCase())
      return Array.from(ids)
    })
    addIfMatch('gtm', 'Google Tag Manager', 'googletagmanager.com/gtm.js', () => {
      const ids = new Set<string>()
      const re = /GTM-[A-Z0-9]{4,10}/g
      let m: RegExpExecArray | null
      while ((m = re.exec(html))) ids.add(m[0])
      return Array.from(ids)
    })
    addIfMatch('ua', 'Google Analytics Universal (legacy)', 'google-analytics.com/analytics.js', () => {
      const ids = new Set<string>()
      const re = /UA-\d{4,10}-\d+/g
      let m: RegExpExecArray | null
      while ((m = re.exec(html))) ids.add(m[0])
      return Array.from(ids)
    })
    addIfMatch('tiktok_pixel', 'TikTok Pixel', 'analytics.tiktok.com/i18n/pixel/events.js')
    addIfMatch('linkedin', 'LinkedIn Insight Tag', 'snap.licdn.com/li.lms-analytics')
    addIfMatch('hotjar', 'Hotjar', 'static.hotjar.com/c/hotjar-')
    addIfMatch('clarity', 'Microsoft Clarity', 'clarity.ms/tag/')
    addIfMatch('rd_station', 'RD Station', 'd335luupugsy2.cloudfront.net/js/rdstation')
    addIfMatch('hubspot', 'HubSpot', 'js.hs-scripts.com')
    addIfMatch('intercom', 'Intercom', 'widget.intercom.io/widget')
    addIfMatch('crisp', 'Crisp Chat', 'client.crisp.chat')
    addIfMatch('pinterest', 'Pinterest Tag', 's.pinimg.com/ct/core.js')

    // ── JSON-LD blocks
    const jsonLd: any[] = []
    const ldRe = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
    let mm: RegExpExecArray | null
    while ((mm = ldRe.exec(html))) {
      try {
        const parsed = JSON.parse(mm[1].trim())
        jsonLd.push(parsed)
      } catch {/* ignore invalid JSON-LD */}
    }

    return {
      ok: true,
      targetUrl: parsed.toString(),
      finalUrl: currentUrl,
      finalStatus,
      elapsedMs,
      redirects,
      headers: {
        contentType: responseHeaders['content-type'] || null,
        cacheControl: responseHeaders['cache-control'] || null,
        server: responseHeaders['server'] || null,
        strictTransport: responseHeaders['strict-transport-security'] ? true : false,
      },
      query: queryParams,
      utms,
      clickIds,
      seo,
      og,
      twitter,
      trackers,
      jsonLd,
    }
  })
}
