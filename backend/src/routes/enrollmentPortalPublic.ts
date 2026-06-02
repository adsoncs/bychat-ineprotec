// src/routes/enrollmentPortalPublic.ts
// Rota pública HTML do portal de matrículas: /portal/:slug + resolução por customDomain.

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { renderBrandingHead, renderBrandHeader, renderBrandHero, renderBrandFooter } from '../lib/portalBranding.js'

function esc(s: string | null | undefined): string {
  if (!s) return ''
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function escJsonLd(s: string | null | undefined): string {
  // Escape seguro para contexto <script type="application/ld+json">
  if (!s) return ''
  return String(s).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026')
}

function getAppHost(req: FastifyRequest): string {
  const host = (req.headers.host || '').split(',')[0].trim()
  return host
}

// Resolve portal a partir do hostname recebido (para domínios próprios)
async function resolvePortalByHost(host: string) {
  if (!host) return null
  return await prisma.enrollmentPortal.findFirst({
    where: { customDomain: host, active: true },
    select: portalSelect,
  })
}

const portalSelect = {
  id: true, slug: true, nome: true, active: true,
  unit: { select: { nome: true } },
  metaTitle: true, metaDescription: true, ogImageUrl: true,
  customCss: true, customHeadJs: true, customBodyJs: true,
  pixelConfig: true,
  customDomain: true,
  selectionProcessIds: true,
  // Branding visual (aba 🎨 Visual no admin)
  brandLogoUrl: true, brandLogoLink: true, brandFaviconUrl: true,
  brandPrimaryColor: true, brandHeroEnabled: true, brandHeroUrl: true,
  brandHeroTitle: true, brandHeroSubtitle: true, brandHeroOverlayOpacity: true,
  brandFooterText: true, brandFontFamily: true, brandRadiusScale: true,
  landingPage: {
    select: {
      id: true, sections: true, globalStyles: true, customCss: true,
      status: true,
    },
  },
} as const

// Renderiza sections da LP (subset: hero, text, features, image, cta)
// que vão ser exibidas ACIMA do formulário no portal.
function renderLPSections(sections: any): string {
  if (!Array.isArray(sections)) return ''
  const parts: string[] = []
  for (const s of sections) {
    if (!s || !s.type) continue
    if (s.type === 'hero') {
      const title = esc(s.title || '')
      const subtitle = esc(s.subtitle || '')
      const bg = s.backgroundImage ? `background-image:url('${esc(s.backgroundImage)}');background-size:cover;background-position:center` : 'background:linear-gradient(135deg,#1a73e8,#1557b0)'
      parts.push(`<section style="padding:60px 20px;text-align:center;color:#fff;${bg};border-radius:12px;margin-bottom:24px">
        ${title ? `<h2 style="font-size:32px;font-weight:700;margin-bottom:10px;text-shadow:0 2px 4px rgba(0,0,0,.2)">${title}</h2>` : ''}
        ${subtitle ? `<p style="font-size:17px;opacity:.95;max-width:560px;margin:0 auto;text-shadow:0 1px 3px rgba(0,0,0,.25)">${subtitle}</p>` : ''}
      </section>`)
    } else if (s.type === 'text') {
      parts.push(`<section style="padding:20px 0;max-width:640px;margin:0 auto 16px"><div style="font-size:15px;line-height:1.6;color:#1a2332">${esc(s.content || '')}</div></section>`)
    } else if (s.type === 'features') {
      const items = Array.isArray(s.items) ? s.items : []
      if (items.length > 0) {
        parts.push(`<section style="padding:20px 0;margin-bottom:24px">
          ${s.title ? `<h3 style="text-align:center;font-size:20px;font-weight:600;margin-bottom:16px">${esc(s.title)}</h3>` : ''}
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:14px">
            ${items.map((it: any) => `<div style="background:#fff;padding:16px;border-radius:10px;border:1px solid #e5e7eb">
              ${it.icon ? `<div style="font-size:28px;margin-bottom:6px">${esc(it.icon)}</div>` : ''}
              ${it.title ? `<div style="font-weight:600;font-size:14px;margin-bottom:4px">${esc(it.title)}</div>` : ''}
              ${it.description ? `<div style="font-size:12px;color:#6b7280;line-height:1.5">${esc(it.description)}</div>` : ''}
            </div>`).join('')}
          </div>
        </section>`)
      }
    } else if (s.type === 'image') {
      if (s.src) parts.push(`<section style="text-align:center;margin-bottom:20px"><img src="${esc(s.src)}" alt="${esc(s.alt || '')}" style="max-width:100%;height:auto;border-radius:10px"></section>`)
    } else if (s.type === 'video') {
      if (s.embedUrl) parts.push(`<section style="margin-bottom:20px"><div style="position:relative;padding-bottom:56.25%;height:0;overflow:hidden;border-radius:10px"><iframe src="${esc(s.embedUrl)}" style="position:absolute;top:0;left:0;width:100%;height:100%" frameborder="0" allowfullscreen></iframe></div></section>`)
    }
    // outros tipos (testimonials, faq, etc) podem ser adicionados conforme necessidade
  }
  return parts.join('\n')
}

function renderPortalHtml(portal: any, req: FastifyRequest, offeringsForSchema?: any[]): string {
  const host = getAppHost(req)
  const scheme = (req.headers['x-forwarded-proto'] || 'https').toString()
  const canonicalUrl = portal.customDomain
    ? `${scheme}://${portal.customDomain}/`
    : `${scheme}://${host}/portal/${portal.slug}`

  const title = esc(portal.metaTitle || portal.nome)
  const desc = esc(portal.metaDescription || `Inscreva-se em ${portal.nome} — ${portal.unit?.nome || ''}`.trim())
  const ogImage = esc(portal.ogImageUrl || '')
  const customCss = portal.customCss || ''
  const slug = esc(portal.slug)

  // Schema.org JSON-LD — EducationalOccupationalProgram + Course opcional (primeiras ofertas)
  const schemaOrg: any = {
    '@context': 'https://schema.org',
    '@type': 'EducationalOccupationalProgram',
    name: portal.nome,
    description: portal.metaDescription || `${portal.nome} — ${portal.unit?.nome || ''}`.trim(),
    url: canonicalUrl,
    provider: {
      '@type': 'EducationalOrganization',
      name: portal.unit?.nome || portal.nome,
    },
    offers: {
      '@type': 'Offer',
      url: canonicalUrl,
      availability: 'https://schema.org/InStock',
    },
  }
  // Se tem ofertas, adiciona referências como hasCourse
  if (offeringsForSchema && offeringsForSchema.length > 0) {
    schemaOrg.hasCourse = offeringsForSchema.slice(0, 20).map((o: any) => ({
      '@type': 'Course',
      name: o.course?.nome || o.nome,
      description: `Modalidade: ${o.modality?.nome || '-'}. Turno: ${o.turno || '-'}.`,
      provider: { '@type': 'Organization', name: portal.unit?.nome || portal.nome },
      url: canonicalUrl,
    }))
  }

  // Pixels (renderizados no <head>)
  const pixelScripts = renderPixels(portal.pixelConfig)
  // Branding (cor, fonte, favicon, hero, footer) — sobrescreve defaults se configurado
  const brand = renderBrandingHead(portal)

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title}</title>
<meta name="description" content="${desc}">
<link rel="canonical" href="${esc(canonicalUrl)}">
${brand.faviconLink}

<!-- Open Graph -->
<meta property="og:title" content="${title}">
<meta property="og:description" content="${desc}">
${ogImage ? `<meta property="og:image" content="${ogImage}">` : ''}
<meta property="og:type" content="website">
<meta property="og:url" content="${esc(canonicalUrl)}">
<meta property="og:site_name" content="${esc(portal.unit?.nome || portal.nome)}">
<meta property="og:locale" content="pt_BR">

<!-- Twitter Card -->
<meta name="twitter:card" content="${ogImage ? 'summary_large_image' : 'summary'}">
<meta name="twitter:title" content="${title}">
<meta name="twitter:description" content="${desc}">
${ogImage ? `<meta name="twitter:image" content="${ogImage}">` : ''}

<!-- Schema.org -->
<script type="application/ld+json">${escJsonLd(JSON.stringify(schemaOrg))}</script>

${brand.fontLink}

${pixelScripts}

<style>
  ${brand.cssVars}
  :root{--bg:#f6f7fb;--card:#fff;--text:#1a2332;--muted:#6b7280;--border:#e5e7eb;--error:#dc2626;--success:#059669;}
  *{box-sizing:border-box;margin:0;padding:0}
  html,body{background:var(--bg);color:var(--text);line-height:1.5}
  .portal-container{max-width:720px;margin:0 auto;padding:24px 16px}
  .portal-header{text-align:center;margin-bottom:28px}
  .portal-title{font-size:28px;font-weight:700;margin-bottom:8px;color:var(--text)}
  .portal-subtitle{font-size:15px;color:var(--muted)}
  .portal-card{background:var(--card);border-radius:var(--radius);box-shadow:0 2px 8px rgba(0,0,0,0.04);padding:28px;margin-bottom:20px}
  .steps-indicator{display:flex;gap:8px;margin-bottom:24px;justify-content:center;flex-wrap:wrap}
  .step-dot{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--muted);font-weight:500}
  .step-dot .bullet{width:28px;height:28px;border-radius:50%;background:var(--border);color:var(--muted);display:inline-flex;align-items:center;justify-content:center;font-weight:600;font-size:13px;transition:.2s}
  .step-dot.active .bullet{background:var(--primary);color:#fff}
  .step-dot.done .bullet{background:var(--success);color:#fff}
  .step-title{font-size:20px;font-weight:600;margin-bottom:4px}
  .step-desc{font-size:14px;color:var(--muted);margin-bottom:20px}
  .field{margin-bottom:16px}
  .field label{display:block;font-size:13px;font-weight:500;margin-bottom:6px;color:var(--text)}
  .field label .req{color:var(--error)}
  .field input,.field select,.field textarea{width:100%;padding:11px 14px;border:1px solid var(--border);border-radius:8px;font-size:14px;font-family:inherit;transition:border-color .15s,box-shadow .15s;background:#fff}
  .field input:focus,.field select:focus,.field textarea:focus{outline:none;border-color:var(--primary);box-shadow:0 0 0 3px rgba(26,115,232,.1)}
  .field .error{display:none;color:var(--error);font-size:12px;margin-top:4px}
  .field.has-error input,.field.has-error select{border-color:var(--error)}
  .field.has-error .error{display:block}
  .field .hint{color:var(--muted);font-size:11px;margin-top:4px}
  .offering-list{display:grid;gap:10px}
  .offering-card{border:1px solid var(--border);border-radius:8px;padding:14px;cursor:pointer;transition:.15s;background:#fff}
  .offering-card:hover{border-color:var(--primary);background:#f8faff}
  .offering-card.selected{border-color:var(--primary);background:#f0f7ff;box-shadow:0 0 0 2px var(--primary) inset}
  .offering-card .title{font-weight:600;font-size:15px;margin-bottom:4px}
  .offering-card .meta{font-size:12px;color:var(--muted);display:flex;flex-wrap:wrap;gap:12px}
  .offering-card .meta span{display:inline-flex;align-items:center;gap:4px}
  .buttons{display:flex;gap:10px;justify-content:flex-end;margin-top:24px}
  .btn{padding:11px 24px;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;font-family:inherit;border:none;transition:.15s}
  .btn-primary{background:var(--primary);color:#fff}
  .btn-primary:hover{background:var(--primary-dark)}
  .btn-primary:disabled{opacity:.5;cursor:not-allowed}
  .btn-secondary{background:#fff;color:var(--muted);border:1px solid var(--border)}
  .btn-secondary:hover{background:#f9fafb}
  .filters{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;margin-bottom:16px}
  .success-box{background:#ecfdf5;border:1px solid #a7f3d0;border-radius:var(--radius);padding:24px;text-align:center}
  .success-box .icon{font-size:40px;margin-bottom:8px}
  .success-box .code{display:inline-block;background:#fff;padding:8px 18px;border-radius:8px;font-family:ui-monospace,monospace;font-size:17px;font-weight:600;margin:12px 0;color:var(--success);border:1px solid #a7f3d0}
  .loading{display:inline-block;width:16px;height:16px;border:2px solid #fff;border-top-color:transparent;border-radius:50%;animation:spin .7s linear infinite;margin-right:6px;vertical-align:middle}
  @keyframes spin{to{transform:rotate(360deg)}}
  .portal-footer{text-align:center;font-size:11px;color:var(--muted);margin-top:30px}
  .portal-footer a{color:var(--primary);text-decoration:none}
  /* Modo embed: portal renderizado em iframe num site parceiro/LP. Esconde
     header da unidade e footer institucional, ajusta padding pra encaixe limpo. */
  body.embed-mode{background:transparent}
  body.embed-mode .portal-container{padding:8px 4px;max-width:100%}
  body.embed-mode .brand-header,body.embed-mode .portal-footer,body.embed-mode .brand-hero{display:none}
  body.embed-mode .portal-card{box-shadow:none;border:1px solid var(--border)}
  @media(max-width:600px){.portal-container{padding:12px 8px}.portal-card{padding:18px}.portal-title{font-size:22px}}
  ${customCss}
</style>
${portal.customHeadJs ? `<script>${portal.customHeadJs}</script>` : ''}
</head>
<body>
<div class="portal-container">
  ${portal.landingPage && portal.landingPage.status === 'PUBLISHED'
    ? renderLPSections(portal.landingPage.sections)
    : renderBrandHeader(portal, portal.nome, portal.unit?.nome || '') + renderBrandHero(portal)}
  <div id="portal-root"><div class="portal-card"><div style="text-align:center;padding:40px;color:#6b7280"><div class="loading" style="border-color:var(--primary);border-top-color:transparent;width:24px;height:24px"></div><div style="margin-top:10px">Carregando...</div></div></div></div>
  ${renderBrandFooter(portal, 'Portal de Matrículas')}
</div>
<script>
window.__PORTAL_SLUG__ = ${JSON.stringify(slug)};
window.__API_BASE__ = '/api';
window.__PIXEL_CONFIG__ = ${JSON.stringify(portal.pixelConfig || {})};
</script>
<script src="/assets/enrollment-portal.js?v=${Date.now()}"></script>
<!-- Tracking (bt.js): captura pageviews, sessions e cliques. Permite correlação visitor→lead no CRM. -->
<script async src="/api/t/bt.js"></script>
${portal.customBodyJs ? `<script>${portal.customBodyJs}</script>` : ''}
</body>
</html>`
}

// Renderiza snippets de pixel (GA4, Meta, TikTok, LinkedIn)
function renderPixels(config: any): string {
  if (!config || typeof config !== 'object') return ''
  const parts: string[] = []

  // GA4
  if (config.ga4Id) {
    const id = esc(config.ga4Id)
    parts.push(`<!-- GA4 --><script async src="https://www.googletagmanager.com/gtag/js?id=${id}"></script><script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${id}');</script>`)
  }
  // GTM
  if (config.gtmId) {
    const id = esc(config.gtmId)
    parts.push(`<!-- GTM --><script>(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','${id}');</script>`)
  }
  // Meta Pixel
  if (config.metaPixelId) {
    const id = esc(config.metaPixelId)
    parts.push(`<!-- Meta Pixel --><script>!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','${id}');fbq('track','PageView');</script><noscript><img height="1" width="1" style="display:none" src="https://www.facebook.com/tr?id=${id}&ev=PageView&noscript=1"/></noscript>`)
  }
  // TikTok Pixel
  if (config.tiktokPixelId) {
    const id = esc(config.tiktokPixelId)
    parts.push(`<!-- TikTok Pixel --><script>!function(w,d,t){w.TiktokAnalyticsObject=t;var ttq=w[t]=w[t]||[];ttq.methods=["page","track","identify","instances","debug","on","off","once","ready","alias","group","enableCookie","disableCookie"],ttq.setAndDefer=function(t,e){t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}};for(var i=0;i<ttq.methods.length;i++)ttq.setAndDefer(ttq,ttq.methods[i]);ttq.instance=function(t){for(var e=ttq._i[t]||[],n=0;n<ttq.methods.length;n++)ttq.setAndDefer(e,ttq.methods[n]);return e},ttq.load=function(e,n){var i="https://analytics.tiktok.com/i18n/pixel/events.js";ttq._i=ttq._i||{},ttq._i[e]=[],ttq._i[e]._u=i,ttq._t=ttq._t||{},ttq._t[e]=+new Date,ttq._o=ttq._o||{},ttq._o[e]=n||{};var o=document.createElement("script");o.type="text/javascript",o.async=!0,o.src=i+"?sdkid="+e+"&lib="+t;var a=document.getElementsByTagName("script")[0];a.parentNode.insertBefore(o,a)};ttq.load('${id}');ttq.page();}(window,document,'ttq');</script>`)
  }
  // LinkedIn Insight
  if (config.linkedinPartnerId) {
    const id = esc(config.linkedinPartnerId)
    parts.push(`<!-- LinkedIn Insight --><script>_linkedin_partner_id="${id}";window._linkedin_data_partner_ids=window._linkedin_data_partner_ids||[];window._linkedin_data_partner_ids.push(_linkedin_partner_id);(function(l){if(!l){window.lintrk=function(a,b){window.lintrk.q.push([a,b])};window.lintrk.q=[]}var s=document.getElementsByTagName("script")[0];var b=document.createElement("script");b.type="text/javascript";b.async=true;b.src="https://snap.licdn.com/li.lms-analytics/insight.min.js";s.parentNode.insertBefore(b,s);})(window.lintrk);</script>`)
  }
  return parts.join('\n')
}

function renderNotFound(): string {
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><title>Portal não encontrado</title><meta name="robots" content="noindex,nofollow"><style>body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f6f7fb;color:#1a2332;text-align:center}.box{padding:40px;max-width:480px}.box h1{font-size:48px;margin:0 0 8px;color:#6b7280}.box p{color:#6b7280}</style></head><body><div class="box"><h1>404</h1><p>Portal de matrículas indisponível ou desativado.</p></div></body></html>`
}

async function fetchOfferingsForPortal(portal: any): Promise<any[]> {
  const processIds = (portal.selectionProcessIds as any[]) || []
  if (processIds.length === 0) return []
  return await prisma.courseOffering.findMany({
    where: {
      active: true,
      selectionProcessId: { in: processIds.map(Number).filter(Boolean) },
    },
    take: 20,
    select: {
      id: true, nome: true, turno: true,
      course: { select: { nome: true } },
      modality: { select: { nome: true } },
    },
  })
}

// Tenta resolver portal por slug OU por Host header (domínio próprio)
async function resolvePortal(req: FastifyRequest, slug?: string | null) {
  if (slug) {
    if (!/^[a-z0-9-]{3,100}$/.test(slug)) return null
    return await prisma.enrollmentPortal.findUnique({ where: { slug }, select: portalSelect })
  }
  const host = getAppHost(req)
  return await resolvePortalByHost(host)
}

export async function enrollmentPortalPublicRoutes(app: FastifyInstance) {
  // GET /portal/:slug — HTML standalone do portal (rota canônica)
  app.get('/portal/:slug', async (req, reply) => {
    const { slug } = req.params as any
    const portal = await resolvePortal(req, slug)
    if (!portal || !portal.active) {
      reply.code(404).type('text/html').send(renderNotFound())
      return
    }
    const offerings = await fetchOfferingsForPortal(portal).catch(() => [])
    // Permite embedding em iframes de qualquer origem — portais de interesse
    // são pensados pra serem embedados em LPs e sites de parceiros.
    reply.header('Content-Security-Policy', "frame-ancestors *")
    reply.removeHeader('X-Frame-Options')
    reply.type('text/html').send(renderPortalHtml(portal, req, offerings))
  })

  // Hook: se o Host do request for um customDomain de portal, reescreve a URL
  // para /portal/:slug internamente. Assim não colide com o static-files em GET /.
  app.addHook('onRequest', async (req) => {
    const url = (req.raw.url || '').split('?')[0]
    // Só atua na raiz (e sem slug) — paths de API ou assets continuam normais
    if (url !== '/' && url !== '/index.html') return
    const host = getAppHost(req)
    if (!host) return
    // Ignora o domínio principal (evita query desnecessária)
    const primaryHost = (process.env.APP_URL || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '')
    if (primaryHost && host === primaryHost) return

    const portal = await resolvePortalByHost(host)
    if (portal && portal.active) {
      // Reescreve URL pro endpoint de portal — query string preservada
      const query = req.raw.url?.includes('?') ? req.raw.url.slice(req.raw.url.indexOf('?')) : ''
      req.raw.url = `/portal/${portal.slug}${query}`
    }
  })

  // GET /sitemap.xml — SEO
  app.get('/sitemap.xml', async (req, reply) => {
    const host = getAppHost(req)
    const scheme = (req.headers['x-forwarded-proto'] || 'https').toString()
    // Se for customDomain: sitemap daquele portal específico
    const portalByHost = await resolvePortalByHost(host)
    if (portalByHost) {
      const url = `${scheme}://${host}/`
      reply.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${esc(url)}</loc><changefreq>daily</changefreq><priority>1.0</priority></url>
</urlset>`)
      return
    }
    // Caso contrário, lista todos portais ativos (útil para o domínio principal)
    const portals = await prisma.enrollmentPortal.findMany({
      where: { active: true, publishedAt: { not: null } },
      select: { slug: true, customDomain: true, updatedAt: true },
    })
    const base = `${scheme}://${host}`
    const urls = portals.map(p => {
      const loc = p.customDomain ? `${scheme}://${p.customDomain}/` : `${base}/portal/${p.slug}`
      const lastmod = p.updatedAt.toISOString().slice(0, 10)
      return `<url><loc>${esc(loc)}</loc><lastmod>${lastmod}</lastmod><changefreq>weekly</changefreq></url>`
    }).join('\n  ')
    reply.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  ${urls}
</urlset>`)
  })

  // GET /robots.txt
  app.get('/robots.txt', async (req, reply) => {
    const host = getAppHost(req)
    const scheme = (req.headers['x-forwarded-proto'] || 'https').toString()
    const portalByHost = await resolvePortalByHost(host)
    reply.type('text/plain').send(
      portalByHost
        ? `User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /admin\nDisallow: /candidato/\nSitemap: ${scheme}://${host}/sitemap.xml\n`
        : `User-agent: *\nDisallow: /api/\nDisallow: /admin\nDisallow: /candidato/\nAllow: /portal/\nSitemap: ${scheme}://${host}/sitemap.xml\n`
    )
  })
}
