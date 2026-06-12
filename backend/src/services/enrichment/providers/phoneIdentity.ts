// Phone Identity: lookup reverso de telefone/chave PIX → titular (nome + CPF mascarado + banco).
//
// Toggle e credenciais via Settings (Inteligência → Operador → "Identidade do Telefone").
// Sem chave configurada ou enabled=false → no-op (provider devolve {facts:[]}).
//
// Adapters suportados:
//   - 'mock'        — devolve dados falsos para dev/demo (não chama nada externo)
//   - 'custom_http' — POST genérico para o endpoint configurado, espera resposta JSON
//                     { name?: string, cpfMasked?: string, bankName?: string, raw?: any }
//   - 'celcoin'     — placeholder; chamar a API real exige contrato/SDK específico.
//                     Hoje delega para custom_http (operador cola endpoint Celcoin direto).
//
// Cache de 24h em memória por phone_e164 — evita cobrança duplicada em re-enrichments.
// Rate limit interno de 30 req/min por processo.
// Audit log via fastify/pino: { leadId, phoneHash, provider, purpose }.

import crypto from 'crypto'
import type { Provider, ProviderResult, EnrichmentFact } from '../types.js'
import { getPhoneIdentityConfig } from '../../../lib/phoneIdentity.js'

const CACHE_TTL_MS = 24 * 60 * 60 * 1000
const RATE_LIMIT_PER_MIN = 30

const resultCache = new Map<string, { facts: EnrichmentFact[]; expiresAt: number }>()
const rateBucket: { windowStart: number; count: number } = { windowStart: 0, count: 0 }

function hashPhone(e164: string): string {
  return crypto.createHash('sha256').update(e164).digest('hex').slice(0, 16)
}

function normalizeBrazilPhoneE164(raw: string): string | null {
  const d = String(raw || '').replace(/\D/g, '')
  if (!d) return null
  let n = d
  if (n.length === 13 && n.startsWith('55')) n = n.slice(2)
  if (n.length === 12 && n.startsWith('55')) n = n.slice(2)
  if (n.length < 10 || n.length > 11) return null
  return `+55${n}`
}

function checkRateLimit(): boolean {
  const now = Date.now()
  const minuteWindow = Math.floor(now / 60_000) * 60_000
  if (rateBucket.windowStart !== minuteWindow) {
    rateBucket.windowStart = minuteWindow
    rateBucket.count = 0
  }
  if (rateBucket.count >= RATE_LIMIT_PER_MIN) return false
  rateBucket.count++
  return true
}

interface LookupResponse {
  name?: string
  cpfMasked?: string
  bankName?: string
  raw?: any
}

async function lookupMock(phoneE164: string): Promise<LookupResponse> {
  // Determinístico baseado no telefone — útil pra demo/dev sem custo.
  const last4 = phoneE164.slice(-4)
  return {
    name: `Titular Demo ${last4}`,
    cpfMasked: `***.***.${last4.slice(0, 3)}-**`,
    bankName: 'Banco Mock',
    raw: { mock: true },
  }
}

async function lookupCustomHttp(
  phoneE164: string,
  endpoint: string,
  token: string,
  purpose: string,
): Promise<LookupResponse> {
  // SSRF: o endpoint vem de Setting (admin) e recebe um Bearer secreto — se
  // apontar para host interno, vaza o token. Bloqueia destinos internos.
  const { assertUrlIsPublic } = await import('../../../lib/urlSafety.js')
  const pub = await assertUrlIsPublic(endpoint)
  if (!pub.ok) {
    throw new Error(`endpoint de phone-identity bloqueado por segurança: ${pub.reason}`)
  }
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      'User-Agent': 'bychat-beyond/phone-identity',
    },
    body: JSON.stringify({ phone: phoneE164, purpose }),
    signal: AbortSignal.timeout(12_000),
  })
  if (!res.ok) {
    const txt = await res.text().catch(() => '')
    throw new Error(`HTTP ${res.status}: ${txt.substring(0, 200) || res.statusText}`)
  }
  const data = await res.json().catch(() => ({})) as any
  return {
    name: typeof data?.name === 'string' ? data.name : undefined,
    cpfMasked: typeof data?.cpfMasked === 'string' ? data.cpfMasked : undefined,
    bankName: typeof data?.bankName === 'string' ? data.bankName : undefined,
    raw: data,
  }
}

export const phoneIdentityProvider: Provider = async (seed) => {
  const result: ProviderResult = { facts: [] }
  const phoneE164 = normalizeBrazilPhoneE164(seed.whatsapp || '')
  if (!phoneE164) return result

  const config = await getPhoneIdentityConfig()
  if (!config.enabled) return result
  if (config.provider !== 'mock' && (!config.endpoint || !config.token)) {
    return { facts: [], errors: ['phone_identity: endpoint/token não configurados'] }
  }

  // Cache de 24h
  const cacheKey = `${config.provider}:${phoneE164}`
  const cached = resultCache.get(cacheKey)
  const now = Date.now()
  if (cached && cached.expiresAt > now) {
    return { facts: cached.facts }
  }

  if (!checkRateLimit()) {
    return { facts: [], errors: ['phone_identity: rate limit interno (30/min) atingido'] }
  }

  // Audit log (sem PII além do hash do telefone)
  // eslint-disable-next-line no-console
  console.log(`[phone_identity] lookup leadId=${seed.id} phoneHash=${hashPhone(phoneE164)} provider=${config.provider} purpose=${(config.purpose || '').substring(0, 80)}`)

  let lookup: LookupResponse
  try {
    if (config.provider === 'mock') {
      lookup = await lookupMock(phoneE164)
    } else {
      // 'celcoin' hoje delega pro custom_http (operador cola endpoint Celcoin no campo)
      lookup = await lookupCustomHttp(phoneE164, config.endpoint, config.token, config.purpose)
    }
  } catch (e: any) {
    return { facts: [], errors: [`phone_identity: ${e?.message || 'falha de rede'}`] }
  }

  const facts: EnrichmentFact[] = []
  if (lookup.name) {
    facts.push({
      source: 'phone_identity',
      field: 'phone_holder_name',
      value: lookup.name.substring(0, 191),
      confidence: 0.9,
      rawData: { provider: config.provider, purpose: config.purpose },
      expiresInDays: 90,
    })
  }
  if (lookup.cpfMasked) {
    facts.push({
      source: 'phone_identity',
      field: 'phone_holder_cpf_masked',
      value: lookup.cpfMasked.substring(0, 32),
      confidence: 0.95,
      rawData: { provider: config.provider, purpose: config.purpose },
      expiresInDays: 90,
    })
  }
  if (lookup.bankName) {
    facts.push({
      source: 'phone_identity',
      field: 'phone_holder_bank',
      value: lookup.bankName.substring(0, 191),
      confidence: 0.7,
      rawData: { provider: config.provider },
      expiresInDays: 90,
    })
  }

  resultCache.set(cacheKey, { facts, expiresAt: now + CACHE_TTL_MS })
  return { facts }
}
