// src/services/webStackDetect.ts
//
// Radar de Reputação — F1: detector de stack de marketing.
//
// Baixa o HTML público da home de um domínio e identifica o que está instalado.
// O valor comercial está na LACUNA: um site vivo, com CMS recente e tráfego
// evidente, mas sem nenhum pixel de remarketing, é uma empresa que ou não tem
// agência ou tem uma que não faz performance. Isso vira o gancho da abordagem.
//
// Limites deliberados (não afrouxar sem motivo):
//   - só a home, só HTML público, sem login, sem burlar bloqueio;
//   - 1 requisição por domínio, com timeout curto e teto de tamanho;
//   - respeita 403/429 do alvo — bloqueio recebido é registrado, não contornado.
//
// TLS inválido NÃO aborta a leitura: certificado expirado é, ele próprio, um
// sinal forte de abandono técnico — registramos em tlsValid e seguimos.

import https from 'node:https'
import http from 'node:http'
import { prisma } from '../lib/prisma.js'

const TIMEOUT_MS = 15_000
const MAX_BYTES = 2 * 1024 * 1024 // 2 MB de HTML é muito mais que suficiente
const UA = 'Mozilla/5.0 (compatible; ByChatRadar/1.0; +https://bychat.ia.br)'

// ── assinaturas ──────────────────────────────────────────────────────────────

interface Signature {
  name: string
  group: 'pixel' | 'analytics' | 'tagmanager' | 'crm' | 'chat' | 'cms' | 'ecommerce'
  test: RegExp
}

const SIGNATURES: Signature[] = [
  // Pixels de mídia paga — a ausência destes é o sinal principal.
  { name: 'Meta Pixel', group: 'pixel', test: /connect\.facebook\.net|fbq\s*\(\s*['"]init/i },
  { name: 'Google Ads', group: 'pixel', test: /gtag\/js\?id=AW-|googleadservices\.com|googleads\.g\.doubleclick/i },
  { name: 'TikTok Pixel', group: 'pixel', test: /analytics\.tiktok\.com/i },
  { name: 'LinkedIn Insight', group: 'pixel', test: /snap\.licdn\.com/i },
  { name: 'Pinterest Tag', group: 'pixel', test: /pintrk\s*\(|s\.pinimg\.com\/ct/i },
  { name: 'Kwai Pixel', group: 'pixel', test: /kwai.*pixel|s\d?\.kwai\.net/i },

  // Medição
  { name: 'GA4', group: 'analytics', test: /gtag\/js\?id=G-|google-analytics\.com\/g\/collect/i },
  { name: 'Universal Analytics', group: 'analytics', test: /google-analytics\.com\/analytics\.js|ga\s*\(\s*['"]create/i },
  { name: 'Hotjar', group: 'analytics', test: /static\.hotjar\.com|hjSiteSettings/i },
  { name: 'Microsoft Clarity', group: 'analytics', test: /clarity\.ms/i },
  { name: 'Google Tag Manager', group: 'tagmanager', test: /googletagmanager\.com\/gtm\.js|GTM-[A-Z0-9]{4,}/i },

  // Automação / CRM — indica que JÁ existe operação de marketing estruturada
  { name: 'RD Station', group: 'crm', test: /d335luupugsy2\.cloudfront\.net|rdstation/i },
  { name: 'HubSpot', group: 'crm', test: /js\.hs-scripts\.com|hs-analytics\.net/i },
  { name: 'ActiveCampaign', group: 'crm', test: /trackcmp\.net|prism\.app-us1\.com/i },
  { name: 'Mailchimp', group: 'crm', test: /chimpstatic\.com|list-manage\.com/i },

  // Canal de contato rápido
  { name: 'WhatsApp', group: 'chat', test: /wa\.me\/|api\.whatsapp\.com\/send/i },
  { name: 'Crisp', group: 'chat', test: /client\.crisp\.chat/i },
  { name: 'Tawk.to', group: 'chat', test: /embed\.tawk\.to/i },
  { name: 'JivoChat', group: 'chat', test: /code\.jivosite\.com|jivo/i },
  { name: 'Zendesk Chat', group: 'chat', test: /static\.zdassets\.com/i },

  // Plataforma
  { name: 'WordPress', group: 'cms', test: /wp-content|wp-includes/i },
  { name: 'Wix', group: 'cms', test: /static\.parastorage\.com|wixstatic/i },
  { name: 'Webflow', group: 'cms', test: /webflow\.(com|io)/i },
  { name: 'Squarespace', group: 'cms', test: /squarespace\.com/i },
  { name: 'Shopify', group: 'ecommerce', test: /cdn\.shopify\.com|shopifycdn/i },
  { name: 'VTEX', group: 'ecommerce', test: /vteximg\.com\.br|vtexassets\.com/i },
  { name: 'Nuvemshop', group: 'ecommerce', test: /nuvemshop|tiendanube/i },
  { name: 'Tray', group: 'ecommerce', test: /tray\.com\.br|traycdn/i },
  { name: 'WooCommerce', group: 'ecommerce', test: /woocommerce/i },
]

// ── fetch cru ────────────────────────────────────────────────────────────────

export function normalizeDomain(input: string): string {
  return String(input || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/[/?#].*$/, '')
    .slice(0, 191)
}

interface RawFetch {
  html: string
  status: number
  finalUrl: string
  tlsValid: boolean
}

// GET simples seguindo redirects na mão (precisamos saber a URL final e tolerar
// TLS inválido sem derrubar o processo).
function rawGet(url: string, opts: { insecure?: boolean; depth?: number } = {}): Promise<RawFetch> {
  const depth = opts.depth ?? 0
  return new Promise((resolve, reject) => {
    if (depth > 5) return reject(new Error('redirects demais'))
    const u = new URL(url)
    const mod = u.protocol === 'http:' ? http : https
    const req = mod.request(
      {
        protocol: u.protocol,
        hostname: u.hostname,
        port: u.port || (u.protocol === 'http:' ? 80 : 443),
        path: u.pathname + u.search,
        method: 'GET',
        headers: { 'User-Agent': UA, Accept: 'text/html,*/*' },
        timeout: TIMEOUT_MS,
        ...(u.protocol === 'https:' ? { rejectUnauthorized: !opts.insecure } : {}),
      },
      (res) => {
        const status = res.statusCode || 0
        const loc = res.headers.location
        if (status >= 300 && status < 400 && loc) {
          res.resume()
          const next = new URL(loc, url).toString()
          rawGet(next, { ...opts, depth: depth + 1 }).then(resolve, reject)
          return
        }
        let size = 0
        const chunks: Buffer[] = []
        res.on('data', (c: Buffer) => {
          size += c.length
          if (size > MAX_BYTES) { res.destroy(); return }
          chunks.push(c)
        })
        res.on('end', () => resolve({
          html: Buffer.concat(chunks).toString('utf8'),
          status,
          finalUrl: url,
          tlsValid: !opts.insecure,
        }))
        res.on('error', reject)
      },
    )
    req.on('timeout', () => { req.destroy(new Error('timeout')) })
    req.on('error', reject)
    req.end()
  })
}

// ── detecção ─────────────────────────────────────────────────────────────────

export interface StackResult {
  domain: string
  finalUrl: string | null
  httpStatus: number | null
  title: string | null
  tlsValid: boolean
  error: string | null
  detected: { name: string; group: string }[]
  hasMetaPixel: boolean
  hasGoogleAds: boolean
  hasGa4: boolean
  hasGtm: boolean
  hasOtherPixel: boolean
  hasChat: boolean
  hasCrm: boolean
  cms: string | null
  gapScore: number
}

/**
 * O alvo respondeu, mas se recusou a entregar o HTML para um bot (403/401/429,
 * ou 5xx transitório). Nesse caso NÃO sabemos nada sobre o stack dele — e
 * pontuar como "lacuna" é o pior erro possível: sites grandes com WAF (Centauro,
 * Magazine Luiza) apareceriam no topo do ranking como empresas órfãs de
 * marketing. Bloqueio é resultado indeterminado, não oportunidade.
 */
export function isBlocked(status: number | null): boolean {
  return status === 401 || status === 403 || status === 429 || (status !== null && status >= 500)
}

/**
 * 0..100 — tamanho da lacuna de marketing. Quanto maior, mais órfã a empresa
 * parece estar. Um site morto pontua alto mas é qualitativamente diferente de
 * um site vivo sem pixel: quem consome isso deve olhar `error` junto.
 */
export function computeGapScore(r: Omit<StackResult, 'gapScore'>): number {
  // Indeterminado — ver isBlocked. Fica fora do ranking em vez de liderá-lo.
  if (isBlocked(r.httpStatus)) return 0
  if (r.error) return 70 // site fora do ar / domínio morto: lacuna máxima, porém frágil como lead

  let score = 0
  const hasRemarketing = r.hasMetaPixel || r.hasGoogleAds
  if (!hasRemarketing) score += 40          // não faz mídia paga rastreada — o sinal mais forte
  if (!r.hasGa4 && !r.hasGtm) score += 25   // não mede nada
  if (!r.hasChat) score += 15               // sem canal de conversão rápido
  if (!r.hasCrm) score += 10                // sem automação/nutrição
  if (!r.tlsValid) score += 10              // certificado quebrado: abandono técnico visível

  return Math.min(100, score)
}

export async function detectStack(domainInput: string): Promise<StackResult> {
  const domain = normalizeDomain(domainInput)
  const base: Omit<StackResult, 'gapScore'> = {
    domain, finalUrl: null, httpStatus: null, title: null, tlsValid: true, error: null,
    detected: [], hasMetaPixel: false, hasGoogleAds: false, hasGa4: false, hasGtm: false,
    hasOtherPixel: false, hasChat: false, hasCrm: false, cms: null,
  }
  if (!domain || !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)) {
    return { ...base, error: 'domínio inválido', gapScore: 0 }
  }

  let res: RawFetch | null = null
  try {
    res = await rawGet(`https://${domain}`)
  } catch (err: any) {
    // TLS quebrado é sinal, não obstáculo: repete ignorando o certificado.
    if (/certificate|CERT_|self.signed|ERR_TLS/i.test(String(err?.message))) {
      try {
        res = await rawGet(`https://${domain}`, { insecure: true })
        base.tlsValid = false
      } catch { /* cai no fallback http abaixo */ }
    }
    if (!res) {
      try {
        res = await rawGet(`http://${domain}`)
        base.tlsValid = false
      } catch (err2: any) {
        const msg = String(err2?.message || err?.message || 'falha')
        return { ...base, error: msg.slice(0, 255), gapScore: computeGapScore({ ...base, error: msg }) }
      }
    }
  }

  const html = res.html
  const detected = SIGNATURES.filter((s) => s.test.test(html)).map((s) => ({ name: s.name, group: s.group }))
  const has = (g: string) => detected.some((d) => d.group === g)
  const named = (n: string) => detected.some((d) => d.name === n)

  const result: Omit<StackResult, 'gapScore'> = {
    ...base,
    finalUrl: res.finalUrl,
    httpStatus: res.status,
    title: (html.match(/<title[^>]*>([^<]{1,255})<\/title>/i)?.[1] || '').trim().slice(0, 255) || null,
    detected,
    hasMetaPixel: named('Meta Pixel'),
    hasGoogleAds: named('Google Ads'),
    hasGa4: named('GA4') || named('Universal Analytics'),
    hasGtm: named('Google Tag Manager'),
    hasOtherPixel: detected.some((d) => d.group === 'pixel' && !['Meta Pixel', 'Google Ads'].includes(d.name)),
    hasChat: has('chat'),
    hasCrm: has('crm'),
    cms: detected.find((d) => d.group === 'cms' || d.group === 'ecommerce')?.name.toLowerCase() || null,
    // 4xx/5xx: o site respondeu, mas não entregou conteúdo analisável. Marcamos
    // o bloqueio explicitamente para que a UI não o confunda com site morto.
    error: isBlocked(res.status)
      ? `HTTP ${res.status} — bloqueou a leitura (indeterminado)`
      : res.status >= 400 ? `HTTP ${res.status}` : null,
  }

  return { ...result, gapScore: computeGapScore(result) }
}

// ── persistência e lote ──────────────────────────────────────────────────────

export async function scanAndSave(
  domain: string,
  links: { leadId?: number | null; companyId?: number | null } = {},
): Promise<StackResult> {
  const r = await detectStack(domain)
  if (!r.domain) return r

  const data = {
    finalUrl: r.finalUrl, httpStatus: r.httpStatus, title: r.title, tlsValid: r.tlsValid, error: r.error,
    hasMetaPixel: r.hasMetaPixel, hasGoogleAds: r.hasGoogleAds, hasGa4: r.hasGa4, hasGtm: r.hasGtm,
    hasOtherPixel: r.hasOtherPixel, hasChat: r.hasChat, hasCrm: r.hasCrm, cms: r.cms,
    detected: r.detected as any, gapScore: r.gapScore,
    ...(links.leadId !== undefined ? { leadId: links.leadId } : {}),
    ...(links.companyId !== undefined ? { companyId: links.companyId } : {}),
    scannedAt: new Date(),
  }
  await prisma.webStackScan.upsert({
    where: { domain: r.domain },
    create: { domain: r.domain, ...data },
    update: data,
  })
  return r
}

/**
 * Varre uma lista de domínios com concorrência limitada.
 * O teto baixo é intencional: são hosts de terceiros, não nossa infra.
 */
export async function scanMany(
  domains: string[],
  opts: { concurrency?: number; onProgress?: (done: number, total: number) => void } = {},
): Promise<StackResult[]> {
  const unique = [...new Set(domains.map(normalizeDomain).filter(Boolean))]
  const concurrency = Math.max(1, Math.min(opts.concurrency ?? 6, 12))
  const results: StackResult[] = []
  let cursor = 0

  async function worker() {
    while (cursor < unique.length) {
      const i = cursor++
      try {
        results.push(await scanAndSave(unique[i]))
      } catch (err: any) {
        results.push({
          domain: unique[i], finalUrl: null, httpStatus: null, title: null, tlsValid: true,
          error: String(err?.message || err).slice(0, 255), detected: [],
          hasMetaPixel: false, hasGoogleAds: false, hasGa4: false, hasGtm: false,
          hasOtherPixel: false, hasChat: false, hasCrm: false, cms: null, gapScore: 0,
        })
      }
      opts.onProgress?.(results.length, unique.length)
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, unique.length) }, worker))
  return results
}

/**
 * Domínios extraídos dos e-mails corporativos dos leads do CRM.
 * Descarta provedores de e-mail pessoal — gmail.com não é o site da empresa.
 */
const FREE_MAIL = new Set([
  'gmail.com', 'gmail.com.br', 'hotmail.com', 'hotmail.com.br', 'outlook.com', 'outlook.com.br',
  'yahoo.com', 'yahoo.com.br',
  'live.com', 'icloud.com', 'bol.com.br', 'uol.com.br', 'terra.com.br', 'ig.com.br',
  'globo.com', 'msn.com', 'me.com', 'aol.com', 'protonmail.com', 'zipmail.com.br',
])

/**
 * Distância de edição limitada — só precisamos saber se é ≤ max.
 */
function editDistance(a: string, b: string, max = 2): number {
  if (Math.abs(a.length - b.length) > max) return max + 1
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0]
    prev[0] = i
    let rowMin = prev[0]
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j]
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1))
      diag = tmp
      rowMin = Math.min(rowMin, prev[j])
    }
    if (rowMin > max) return max + 1
  }
  return prev[b.length]
}

/**
 * `gmai.com`, `gmsil.com`, `hotmail.comj` — erro de digitação do titular no
 * cadastro, não o site da empresa. Vários desses domínios existem de verdade
 * (typosquatting) e respondem 200 sem nenhum rastreamento, então entrariam no
 * topo do ranking de lacuna como se fossem prospects excelentes.
 */
export function isTypoOfFreeMail(domain: string): boolean {
  for (const free of FREE_MAIL) {
    if (domain === free) return true
    if (editDistance(domain, free, 2) <= 2) return true
  }
  return false
}

export async function domainsFromLeads(limit = 500): Promise<{ domain: string; leadId: number }[]> {
  const leads = await prisma.lead.findMany({
    where: { email: { not: '' } },
    select: { id: true, email: true },
    orderBy: { createdAt: 'desc' },
    take: limit * 3, // folga: boa parte cai fora por e-mail pessoal
  })
  const out: { domain: string; leadId: number }[] = []
  const seen = new Set<string>()
  for (const l of leads) {
    const d = normalizeDomain((l.email.split('@')[1] || ''))
    if (!d || seen.has(d) || isTypoOfFreeMail(d)) continue
    seen.add(d)
    out.push({ domain: d, leadId: l.id })
    if (out.length >= limit) break
  }
  return out
}
