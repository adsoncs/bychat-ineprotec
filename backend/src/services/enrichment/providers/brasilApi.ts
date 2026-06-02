// BrasilAPI: dados de CNPJ (pública, sem chave, ilimitada)
// Também tenta extrair CNPJ do campo "empresa" se vier como texto com números.

import type { Provider, ProviderResult } from '../types.js'

const CORPORATE_DOMAIN_BLOCKLIST = new Set([
  'gmail.com', 'hotmail.com', 'outlook.com', 'outlook.com.br', 'yahoo.com', 'yahoo.com.br',
  'icloud.com', 'live.com', 'bol.com.br', 'uol.com.br', 'terra.com.br', 'msn.com',
  'proton.me', 'protonmail.com',
])

function extractCnpj(text?: string | null): string | null {
  if (!text) return null
  const digits = text.replace(/\D/g, '')
  // CNPJ tem 14 dígitos; encontrar sequência contígua
  const m = text.match(/\b(\d{2})[.\-/]?(\d{3})[.\-/]?(\d{3})[.\-/]?(\d{4})[.\-/]?(\d{2})\b/)
  if (m) return (m[1] + m[2] + m[3] + m[4] + m[5])
  if (digits.length === 14) return digits
  return null
}

export async function fetchCnpj(cnpj: string) {
  try {
    const resp = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`, {
      headers: { 'User-Agent': 'ByChatBeyond/1.0' }
    })
    if (!resp.ok) return null
    return await resp.json() as any
  } catch {
    return null
  }
}

export function buildCnpjFacts(cnpj: string, data: any, source = 'brasilapi'): EnrichmentFactLike[] {
  const facts: EnrichmentFactLike[] = []
  facts.push({ source, field: 'cnpj', value: cnpj, confidence: 1.0, rawData: data })
  if (data.razao_social) facts.push({ source, field: 'company_legal_name', value: data.razao_social, confidence: 1.0 })
  if (data.nome_fantasia) facts.push({ source, field: 'company_trade_name', value: data.nome_fantasia, confidence: 1.0 })
  if (data.cnae_fiscal_descricao) facts.push({ source, field: 'company_sector', value: data.cnae_fiscal_descricao, confidence: 0.9 })
  if (data.capital_social) facts.push({ source, field: 'company_capital', value: String(data.capital_social), confidence: 0.9 })
  if (data.municipio) facts.push({ source, field: 'company_city', value: data.municipio, confidence: 0.95 })
  if (data.uf) facts.push({ source, field: 'company_state', value: data.uf, confidence: 0.95 })
  if (data.cep) facts.push({ source, field: 'company_cep', value: String(data.cep), confidence: 0.9 })
  if (data.ddd_telefone_1) facts.push({ source, field: 'company_phone', value: data.ddd_telefone_1, confidence: 0.85 })
  if (data.email) facts.push({ source, field: 'company_email', value: String(data.email).toLowerCase(), confidence: 0.85 })
  if (data.situacao_cadastral) facts.push({ source, field: 'company_status', value: String(data.descricao_situacao_cadastral || data.situacao_cadastral), confidence: 0.95 })
  if (data.data_inicio_atividade) facts.push({ source, field: 'company_founded', value: String(data.data_inicio_atividade), confidence: 0.95 })
  if (data.qsa && Array.isArray(data.qsa)) {
    for (const socio of data.qsa.slice(0, 10)) {
      if (socio.nome_socio) {
        facts.push({
          source,
          field: 'company_partner',
          value: JSON.stringify({ nome: socio.nome_socio, qualificacao: socio.qualificacao_socio }),
          confidence: 0.9,
        })
      }
    }
  }
  return facts
}

type EnrichmentFactLike = { source: string; field: string; value: string; confidence: number; rawData?: any }

export const brasilApiProvider: Provider = async (seed) => {
  const result: ProviderResult = { facts: [] }

  // 1. CNPJ explícito no campo empresa ou formData
  const cnpjCandidate =
    extractCnpj(seed.empresa) ||
    extractCnpj(seed.formData?.cnpj) ||
    extractCnpj(seed.formData?.documento)

  if (cnpjCandidate) {
    const data = await fetchCnpj(cnpjCandidate)
    if (data) {
      result.facts.push(...buildCnpjFacts(cnpjCandidate, data, 'brasilapi'))
    }
  }

  // 2. Marcar e-mail corporativo (domínio não-pessoal)
  const email = (seed.email || '').toLowerCase()
  const domain = email.split('@')[1]
  if (domain && !CORPORATE_DOMAIN_BLOCKLIST.has(domain)) {
    result.facts.push({ source: 'brasilapi', field: 'email_is_corporate', value: 'true', confidence: 0.9 })
    result.facts.push({ source: 'brasilapi', field: 'email_domain', value: domain, confidence: 1.0 })
    result.facts.push({ source: 'brasilapi', field: 'company_website_guess', value: `https://${domain}`, confidence: 0.6 })
  }

  return result
}
