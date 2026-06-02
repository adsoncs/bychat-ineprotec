// Social: enriquece URLs já descobertas (linkedin/instagram/facebook/twitter)
// extraindo meta tags OpenGraph / Twitter Card sem headless browser.
// Funciona quando o perfil é público e expõe og: tags (a maioria dos casos).

import { prisma } from '../../../lib/prisma.js'
import type { Provider, ProviderResult } from '../types.js'

const UAS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)', // permite scraping de OG
  'Twitterbot/1.0',
]

function pickUA() { return UAS[Math.floor(Math.random() * UAS.length)] }
const delay = (ms: number) => new Promise(r => setTimeout(r, ms))

function extractMeta(html: string, prop: string): string | null {
  const re1 = new RegExp(`<meta[^>]+property=["']${prop}["'][^>]+content=["']([^"']+)["']`, 'i')
  const re2 = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${prop}["']`, 'i')
  const re3 = new RegExp(`<meta[^>]+name=["']${prop}["'][^>]+content=["']([^"']+)["']`, 'i')
  return (html.match(re1) || html.match(re2) || html.match(re3))?.[1] || null
}

function extractJsonLd(html: string): any[] {
  const out: any[] = []
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  let m
  while ((m = re.exec(html)) !== null) {
    try { out.push(JSON.parse(m[1].trim())) } catch { /* ignore */ }
  }
  return out
}

async function scrapePage(url: string): Promise<Record<string, string>> {
  try {
    const resp = await fetch(url, {
      headers: {
        'User-Agent': pickUA(),
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
      },
      redirect: 'follow',
    })
    if (!resp.ok) return {}
    const html = await resp.text()
    const out: Record<string, string> = {}

    const title = extractMeta(html, 'og:title') || extractMeta(html, 'twitter:title') ||
      html.match(/<title>([^<]+)<\/title>/)?.[1] || ''
    const desc = extractMeta(html, 'og:description') || extractMeta(html, 'twitter:description') ||
      extractMeta(html, 'description') || ''
    const image = extractMeta(html, 'og:image') || extractMeta(html, 'twitter:image') || ''
    const siteName = extractMeta(html, 'og:site_name') || ''

    if (title) out.title = title.trim().slice(0, 300)
    if (desc) out.description = desc.trim().slice(0, 500)
    if (image) out.image = image
    if (siteName) out.site_name = siteName

    // LinkedIn/Instagram expõem dados estruturados em JSON-LD em alguns casos
    const jsonLd = extractJsonLd(html)
    for (const item of jsonLd) {
      if (item['@type'] === 'Person' || item['@type'] === 'Organization') {
        if (item.name) out.ld_name = String(item.name).slice(0, 200)
        if (item.jobTitle) out.ld_job = String(item.jobTitle).slice(0, 200)
        if (item.worksFor?.name) out.ld_company = String(item.worksFor.name).slice(0, 200)
      }
    }

    return out
  } catch {
    return {}
  }
}

export const socialProvider: Provider = async (seed) => {
  const result: ProviderResult = { facts: [] }

  // Busca URLs já coletadas pelos providers anteriores (google, github, gravatar)
  const existingFacts = await prisma.leadEnrichment.findMany({
    where: {
      leadId: seed.id,
      field: { in: ['linkedin_url', 'instagram_url', 'facebook_url', 'twitter_url', 'youtube_url', 'tiktok_url', 'website', 'company_website_guess'] },
      status: 'active',
    },
  })

  if (!existingFacts.length) return result

  for (const fact of existingFacts) {
    const url = fact.value
    const platform = fact.field.replace('_url', '')
    const meta = await scrapePage(url)
    await delay(1500 + Math.floor(Math.random() * 1000))

    if (!Object.keys(meta).length) continue

    const prefix = `${platform}_profile`
    if (meta.title) result.facts.push({ source: 'social', field: `${prefix}_title`, value: meta.title, confidence: 0.85 })
    if (meta.description) result.facts.push({ source: 'social', field: `${prefix}_bio`, value: meta.description, confidence: 0.8 })
    if (meta.image) result.facts.push({ source: 'social', field: `${prefix}_image`, value: meta.image, confidence: 0.8 })
    if (meta.ld_name) result.facts.push({ source: 'social', field: 'name', value: meta.ld_name, confidence: 0.85 })
    if (meta.ld_job) result.facts.push({ source: 'social', field: 'position', value: meta.ld_job, confidence: 0.85 })
    if (meta.ld_company) result.facts.push({ source: 'social', field: 'company_name', value: meta.ld_company, confidence: 0.8 })
  }

  return result
}
