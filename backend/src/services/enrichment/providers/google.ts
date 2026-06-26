// Google scraper — extrai URLs de redes sociais via dorks no HTML de resultados.
// 100% grátis mas frágil: delays + UA rotation + tratamento de captcha.
// Em caso de captcha ou 429, marca erro e devolve o que já pegou.

import { prisma } from '../../../lib/prisma.js'
import type { Provider, ProviderResult } from '../types.js'
import { socialSearchEnabled, corroborateSocialUrl } from '../identity.js'

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:124.0) Gecko/20100101 Firefox/124.0',
]

function pickUA() { return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)] }
function delay(ms: number) { return new Promise(r => setTimeout(r, ms)) }

type SearchResult = { urls: string[]; blocked: boolean; engine: string }

// DuckDuckGo HTML: primário. Detecta bloqueio (status 202 + "anomaly" na página).
async function searchDDG(query: string): Promise<SearchResult> {
  try {
    const resp = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
      headers: {
        'User-Agent': pickUA(),
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
      }
    })
    const html = await resp.text()
    const blocked = resp.status === 202 || /anomaly|captcha/i.test(html)
    if (blocked) return { urls: [], blocked: true, engine: 'ddg' }

    const urls = new Set<string>()
    const re = /uddg=([^&"]+)/g
    let m
    while ((m = re.exec(html)) !== null) {
      try {
        const decoded = decodeURIComponent(m[1])
        if (decoded.startsWith('http')) urls.add(decoded)
      } catch { /* ignore */ }
    }
    const re2 = /<a[^>]+href="(https?:\/\/[^"]+)"/g
    while ((m = re2.exec(html)) !== null) {
      if (!m[1].includes('duckduckgo.com') && !m[1].includes('uddg=')) urls.add(m[1])
    }
    return { urls: [...urls].slice(0, 15), blocked: false, engine: 'ddg' }
  } catch {
    return { urls: [], blocked: false, engine: 'ddg' }
  }
}

// Bing HTML: fallback quando DDG está bloqueado (tolera mais scraping).
async function searchBing(query: string): Promise<SearchResult> {
  try {
    const resp = await fetch(`https://www.bing.com/search?q=${encodeURIComponent(query)}&setlang=pt-br`, {
      headers: {
        'User-Agent': pickUA(),
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
      }
    })
    const html = await resp.text()
    const blocked = !resp.ok || /captcha|unusual traffic/i.test(html)
    if (blocked) return { urls: [], blocked: true, engine: 'bing' }

    const urls = new Set<string>()
    // Bing: <cite> tem o domínio, <a href> tem URL real
    const re = /<a[^>]+href="(https?:\/\/[^"]+)"/g
    let m
    while ((m = re.exec(html)) !== null) {
      const u = m[1]
      if (u.includes('bing.com') || u.includes('microsoft.com') || u.includes('msn.com')) continue
      urls.add(u)
    }
    return { urls: [...urls].slice(0, 15), blocked: false, engine: 'bing' }
  } catch {
    return { urls: [], blocked: false, engine: 'bing' }
  }
}

async function search(query: string): Promise<SearchResult> {
  const ddg = await searchDDG(query)
  if (!ddg.blocked && ddg.urls.length > 0) return ddg
  // Se DDG retornou vazio OU bloqueou, tenta Bing
  await delay(1500)
  const bing = await searchBing(query)
  if (bing.urls.length > 0) return bing
  return ddg.blocked ? ddg : bing
}

interface PlatformSpec {
  name: string
  field: string
  hosts: RegExp
  confidence: number
}

const PLATFORMS: PlatformSpec[] = [
  { name: 'linkedin',  field: 'linkedin_url',   hosts: /^https?:\/\/(www\.|br\.)?linkedin\.com\/(in|pub)\//i, confidence: 0.9 },
  { name: 'instagram', field: 'instagram_url',  hosts: /^https?:\/\/(www\.)?instagram\.com\/[^\/\?]+\/?$/i,   confidence: 0.85 },
  { name: 'facebook',  field: 'facebook_url',   hosts: /^https?:\/\/(www\.|pt-br\.|m\.)?facebook\.com\/[^\/\?]+\/?$/i, confidence: 0.8 },
  { name: 'twitter',   field: 'twitter_url',    hosts: /^https?:\/\/(www\.)?(twitter|x)\.com\/[^\/\?]+\/?$/i, confidence: 0.8 },
  { name: 'youtube',   field: 'youtube_url',    hosts: /^https?:\/\/(www\.)?youtube\.com\/(c|channel|user|@)/i, confidence: 0.75 },
  { name: 'tiktok',    field: 'tiktok_url',     hosts: /^https?:\/\/(www\.)?tiktok\.com\/@/i,                  confidence: 0.85 },
  { name: 'lattes',    field: 'lattes_url',     hosts: /lattes\.cnpq\.br/i,                                     confidence: 0.95 },
  { name: 'github',    field: 'github_url',     hosts: /^https?:\/\/github\.com\/[^\/\?]+\/?$/i,                confidence: 0.9 },
]

function classify(url: string): { field: string; source: string; confidence: number } | null {
  for (const p of PLATFORMS) {
    if (p.hosts.test(url)) return { field: p.field, source: p.name, confidence: p.confidence }
  }
  return null
}

export const googleProvider: Provider = async (seed) => {
  const result: ProviderResult = { facts: [] }

  // Toggle (default OFF): sem ele, NÃO há descoberta social por nome — o vetor de
  // alucinação (anexar qualquer homônimo) some. Admin liga em Inteligência.
  if (!(await socialSearchEnabled())) return result

  // Se google_cse já trouxe URLs de redes sociais neste lead, pula scraping (evita bloqueio)
  if (process.env.GOOGLE_CSE_KEY && process.env.GOOGLE_CSE_CX) {
    const cseHits = await prisma.leadEnrichment.count({
      where: {
        leadId: seed.id,
        source: 'google_cse',
        field: { in: ['linkedin_url', 'instagram_url', 'facebook_url', 'twitter_url'] },
        status: 'active',
      },
    })
    if (cseHits > 0) return result
  }

  const queries: { q: string; confBoost: number }[] = []

  const nome = (seed.nome || '').trim()
  const email = (seed.email || '').trim()
  const empresa = (seed.empresa || '').trim()
  const cidade = (seed.cidade || '').trim()

  if (email) queries.push({ q: `"${email}"`, confBoost: 0.1 })
  if (nome && nome.split(' ').length >= 2) {
    queries.push({ q: `"${nome}" ${empresa || cidade}`.trim(), confBoost: 0.05 })
    queries.push({ q: `"${nome}" site:linkedin.com/in`, confBoost: 0.1 })
    queries.push({ q: `"${nome}" site:instagram.com`, confBoost: 0 })
  }

  if (!queries.length) return result

  const seen = new Set<string>()
  let blockedCount = 0
  for (const { q, confBoost } of queries) {
    const sr = await search(q)
    if (sr.blocked) blockedCount++
    for (const url of sr.urls) {
      const cls = classify(url)
      if (!cls) continue
      const key = `${cls.field}:${url}`
      if (seen.has(key)) continue
      seen.add(key)
      // Corroboração de identidade: só vira FATO com âncora forte (e-mail no handle);
      // casamento por nome (mesmo nome completo) vira CANDIDATO a verificar — nunca
      // fato automático. Isto mata o "achou qualquer jose_xavier e colou como real".
      const corr = corroborateSocialUrl(seed, url, Math.min(cls.confidence + confBoost, 0.95))
      result.facts.push({
        source: 'google',
        field: cls.field,
        value: url,
        confidence: corr.confidence,
        kind: corr.kind,
        rawData: { query: q, platform: cls.source, engine: sr.engine, corroboration: corr.reason },
      })
    }
    // delay maior entre queries (4-7s) para reduzir bloqueios
    await delay(4000 + Math.floor(Math.random() * 3000))
  }

  if (!result.facts.length) {
    result.errors = blockedCount === queries.length
      ? ['google: buscadores bloquearam (rate limit). Tente novamente em 5-10 min.']
      : ['google: nenhum resultado relevante (nome comum ou perfis pouco expostos)']
  }
  return result
}
