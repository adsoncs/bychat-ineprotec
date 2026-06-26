// Google Custom Search API — 100 queries/dia grátis, estável e sem bloqueio.
// Requer GOOGLE_CSE_KEY + GOOGLE_CSE_CX no .env.
// Se não configurado, retorna vazio silenciosamente (scrapers DDG/Bing viram fallback).

import type { Provider, ProviderResult, EnrichmentFact } from '../types.js'
import { fetchCnpj, buildCnpjFacts } from './brasilApi.js'
import { socialSearchEnabled, corroborateSocialUrl } from '../identity.js'

interface PlatformSpec {
  name: string
  field: string
  hosts: RegExp
  confidence: number
}

const PLATFORMS: PlatformSpec[] = [
  { name: 'linkedin',  field: 'linkedin_url',   hosts: /^https?:\/\/(www\.|br\.)?linkedin\.com\/(in|pub)\//i, confidence: 0.95 },
  { name: 'instagram', field: 'instagram_url',  hosts: /^https?:\/\/(www\.)?instagram\.com\/[^\/\?]+\/?$/i,   confidence: 0.9 },
  { name: 'facebook',  field: 'facebook_url',   hosts: /^https?:\/\/(www\.|pt-br\.|m\.)?facebook\.com\/[^\/\?]+\/?$/i, confidence: 0.85 },
  { name: 'twitter',   field: 'twitter_url',    hosts: /^https?:\/\/(www\.)?(twitter|x)\.com\/[^\/\?]+\/?$/i, confidence: 0.85 },
  { name: 'youtube',   field: 'youtube_url',    hosts: /^https?:\/\/(www\.)?youtube\.com\/(c|channel|user|@)/i, confidence: 0.8 },
  { name: 'tiktok',    field: 'tiktok_url',     hosts: /^https?:\/\/(www\.)?tiktok\.com\/@/i,                  confidence: 0.9 },
  { name: 'lattes',    field: 'lattes_url',     hosts: /lattes\.cnpq\.br/i,                                     confidence: 0.97 },
  { name: 'github',    field: 'github_url',     hosts: /^https?:\/\/github\.com\/[^\/\?]+\/?$/i,                confidence: 0.95 },
]

// Hosts que expõem CNPJ na própria URL (regex captura 14 dígitos)
const CNPJ_URL_HOSTS: RegExp[] = [
  /casadosdados\.com\.br\/solucao\/cnpj\/[^\/]*-?(\d{14})/i,
  /cnpj\.biz\/(\d{14})/i,
  /cnpjs\.rocks\/cnpj\/(\d{14})/i,
  /econodata\.com\.br\/consulta-empresa\/(\d{14})/i,
  /receitaws\.com\.br\/v1\/cnpj\/(\d{14})/i,
  /minhareceita\.org\/(\d{14})/i,
  /(\d{14})/,  // fallback: qualquer sequência de 14 dígitos na URL
]

const FREE_MAIL_DOMAINS = new Set([
  'gmail.com','hotmail.com','outlook.com','yahoo.com','icloud.com','live.com',
  'bol.com.br','uol.com.br','terra.com.br','msn.com','proton.me','protonmail.com',
  'googlemail.com','yahoo.com.br','outlook.com.br'
])

const EMAIL_REGEX = /\b([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})\b/g

function classify(url: string): PlatformSpec | null {
  return PLATFORMS.find(p => p.hosts.test(url)) || null
}

function extractCnpjFromUrl(url: string): string | null {
  for (const re of CNPJ_URL_HOSTS) {
    const m = url.match(re)
    if (m && m[1] && m[1].length === 14) return m[1]
  }
  return null
}

function extractEmails(text: string): string[] {
  if (!text) return []
  const out = new Set<string>()
  let m: RegExpExecArray | null
  EMAIL_REGEX.lastIndex = 0
  while ((m = EMAIL_REGEX.exec(text)) !== null) {
    const email = m[1].toLowerCase()
    // ignorar lixo: imagens renomeadas como email, placeholders
    if (email.length > 80) continue
    if (/\.(png|jpg|jpeg|gif|svg|webp)$/.test(email)) continue
    if (email.includes('example.') || email.includes('sentry.') || email.includes('@w.org')) continue
    out.add(email)
  }
  return [...out]
}

interface CseItem { link: string; title?: string; snippet?: string; pagemap?: any }

async function cseSearch(query: string, key: string, cx: string): Promise<{ items: CseItem[]; error?: string }> {
  try {
    const url = `https://www.googleapis.com/customsearch/v1?key=${key}&cx=${cx}&q=${encodeURIComponent(query)}&num=10&lr=lang_pt&gl=br`
    const resp = await fetch(url)
    if (!resp.ok) {
      const errText = await resp.text().catch(() => '')
      return { items: [], error: `CSE HTTP ${resp.status}: ${errText.slice(0, 200)}` }
    }
    const data = await resp.json() as any
    return { items: (data.items || []) as CseItem[] }
  } catch (err: any) {
    return { items: [], error: `CSE: ${err.message}` }
  }
}

export const googleCseProvider: Provider = async (seed) => {
  const result: ProviderResult = { facts: [] }
  const key = process.env.GOOGLE_CSE_KEY
  const cx = process.env.GOOGLE_CSE_CX
  if (!key || !cx) return result  // silencioso quando não configurado

  // Descoberta SOCIAL por nome só com o toggle ligado (default OFF). CNPJ/email/
  // empresa continuam sempre (são ancorados em dado real, não alucinam).
  const socialOn = await socialSearchEnabled()

  const nome = (seed.nome || '').trim()
  const email = (seed.email || '').trim()
  const empresa = (seed.empresa || '').trim()
  const cidade = (seed.cidade || '').trim()
  const firstName = nome.split(' ')[0]
  const emailLocal = email ? email.split('@')[0] : ''
  const emailDomain = email ? email.split('@')[1] : ''

  // Queries ordenadas por valor esperado. Cada uma conta 1 da cota diária (100/dia).
  const queries: { q: string; confBoost: number; tag: string }[] = []

  // Identidade (redes sociais)
  if (email) queries.push({ q: `"${email}"`, confBoost: 0.05, tag: 'email_lookup' })
  if (nome && nome.split(' ').length >= 2) {
    queries.push({ q: `"${nome}" ${empresa || cidade}`.trim(), confBoost: 0, tag: 'name_social' })
    queries.push({ q: `"${nome}" site:linkedin.com/in`, confBoost: 0.05, tag: 'linkedin' })
    queries.push({ q: `"${nome}" site:instagram.com`, confBoost: 0, tag: 'instagram' })
  }

  // Descoberta de EMAIL (quando não temos)
  if (!email && nome && nome.split(' ').length >= 2) {
    queries.push({ q: `"${nome}" ${empresa ? `"${empresa}"` : ''} (email OR contato OR "@")`.trim(), confBoost: 0, tag: 'email_discovery' })
  }
  // Email corporativo: descobrir outros do mesmo domínio
  if (emailDomain && !FREE_MAIL_DOMAINS.has(emailDomain)) {
    queries.push({ q: `"@${emailDomain}" ${nome || ''}`.trim(), confBoost: 0, tag: 'domain_emails' })
  }

  // Descoberta de EMPRESA / CNPJ / SÓCIOS
  if (nome && nome.split(' ').length >= 2) {
    queries.push({ q: `"${nome}" sócio OR socio cnpj`, confBoost: 0, tag: 'partner_lookup' })
    queries.push({ q: `"${nome}" site:casadosdados.com.br`, confBoost: 0, tag: 'casadosdados' })
  }
  if (empresa && !empresa.match(/\d{14}/)) {
    queries.push({ q: `"${empresa}" cnpj`, confBoost: 0, tag: 'company_cnpj' })
    queries.push({ q: `"${empresa}" site:casadosdados.com.br OR site:cnpj.biz OR site:cnpjs.rocks`, confBoost: 0, tag: 'company_registry' })
  }

  if (!queries.length) return result

  const seen = new Set<string>()
  const seenEmail = new Set<string>()
  const seenCnpj = new Set<string>()
  const errors: string[] = []

  for (const { q, confBoost, tag } of queries) {
    const { items, error } = await cseSearch(q, key, cx)
    if (error) { errors.push(error); continue }

    for (const item of items) {
      const url = item.link
      if (!url) continue

      // 1. Classificação por plataforma social (só com o toggle ligado)
      const cls = socialOn ? classify(url) : null
      if (cls) {
        const factKey = `${cls.field}:${url}`
        if (!seen.has(factKey)) {
          seen.add(factKey)
          // Corroboração: e-mail no handle → FATO; nome → CANDIDATO a verificar.
          const corr = corroborateSocialUrl(seed, url, Math.min(cls.confidence + confBoost, 0.97))
          result.facts.push({
            source: 'google_cse',
            field: cls.field,
            value: url,
            confidence: corr.confidence,
            kind: corr.kind,
            rawData: { query: q, tag, platform: cls.name, title: item.title, corroboration: corr.reason },
            expiresInDays: 30,
          })
        }
      }

      // 2. CNPJ na URL — dispara lookup BrasilAPI inline
      const cnpj = extractCnpjFromUrl(url)
      if (cnpj && !seenCnpj.has(cnpj)) {
        seenCnpj.add(cnpj)
        // Valida contexto: título/snippet mencionam o nome ou empresa?
        const ctx = `${item.title || ''} ${item.snippet || ''}`.toLowerCase()
        const nameMatch = firstName && ctx.includes(firstName.toLowerCase())
        const empresaMatch = empresa && ctx.includes(empresa.toLowerCase().split(' ')[0])
        const conf = nameMatch || empresaMatch ? 0.85 : 0.55
        if (conf >= 0.5) {
          result.facts.push({
            source: 'google_cse',
            field: 'company_cnpj_guess',
            value: cnpj,
            confidence: conf,
            rawData: { query: q, tag, url, title: item.title, snippet: item.snippet },
            expiresInDays: 30,
          })
          // Lookup inline — converte guess em dados reais via BrasilAPI
          const cnpjData = await fetchCnpj(cnpj)
          if (cnpjData) {
            const cnpjFacts = buildCnpjFacts(cnpj, cnpjData, 'google_cse+brasilapi')
            // Atenua confidence se contexto fraco
            for (const f of cnpjFacts) {
              result.facts.push({ ...f, confidence: Math.min(f.confidence, conf + 0.1) } as EnrichmentFact)
            }
          }
        }
      }

      // 3. Emails em título/snippet
      const combined = `${item.title || ''} ${item.snippet || ''}`
      for (const found of extractEmails(combined)) {
        if (seenEmail.has(found)) continue
        seenEmail.add(found)
        if (email && found === email.toLowerCase()) continue // já temos
        const domain = found.split('@')[1] || ''
        const isFree = FREE_MAIL_DOMAINS.has(domain)
        const matchesPerson = firstName && found.toLowerCase().includes(firstName.toLowerCase())
        const matchesCompany = empresa && domain.includes(empresa.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 6))
        const isPrimary = !email && (matchesPerson || matchesCompany)
        const confidence = isPrimary ? 0.75 : (matchesPerson || matchesCompany ? 0.65 : (isFree ? 0.35 : 0.5))
        if (confidence < 0.45) continue
        result.facts.push({
          source: 'google_cse',
          field: isPrimary ? 'email_discovered' : 'related_email',
          value: found,
          confidence,
          rawData: { query: q, tag, url, isFree, matchesPerson, matchesCompany },
          expiresInDays: 30,
        })
      }
    }
  }

  if (errors.length && !result.facts.length) result.errors = errors
  return result
}
