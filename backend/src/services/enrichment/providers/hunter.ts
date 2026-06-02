// Hunter.io: free tier (25 buscas/mês). Descobre padrão de e-mails + empresa a partir do domínio.
// Só executa se HUNTER_API_KEY estiver definido (opcional).

import type { Provider, ProviderResult } from '../types.js'

const FREE_DOMAINS = new Set([
  'gmail.com','hotmail.com','outlook.com','yahoo.com','icloud.com','live.com',
  'bol.com.br','uol.com.br','terra.com.br','msn.com','proton.me','protonmail.com'
])

export const hunterProvider: Provider = async (seed) => {
  const result: ProviderResult = { facts: [] }
  const apiKey = process.env.HUNTER_API_KEY
  if (!apiKey) return result

  const email = (seed.email || '').toLowerCase()
  const domain = email.split('@')[1]
  if (!domain || FREE_DOMAINS.has(domain)) return result

  try {
    const resp = await fetch(`https://api.hunter.io/v2/domain-search?domain=${domain}&limit=5&api_key=${apiKey}`)
    if (!resp.ok) {
      result.errors = [`hunter HTTP ${resp.status}`]
      return result
    }
    const { data } = await resp.json() as any
    if (data?.organization) {
      result.facts.push({ source: 'hunter', field: 'company_name_verified', value: data.organization, confidence: 0.9 })
    }
    if (data?.linkedin) result.facts.push({ source: 'hunter', field: 'company_linkedin', value: data.linkedin, confidence: 0.95 })
    if (data?.twitter) result.facts.push({ source: 'hunter', field: 'company_twitter', value: data.twitter, confidence: 0.9 })
    if (data?.facebook) result.facts.push({ source: 'hunter', field: 'company_facebook', value: data.facebook, confidence: 0.9 })
    if (data?.industry) result.facts.push({ source: 'hunter', field: 'company_industry', value: data.industry, confidence: 0.85 })
    if (data?.country) result.facts.push({ source: 'hunter', field: 'company_country', value: data.country, confidence: 0.9 })
    if (data?.pattern) result.facts.push({ source: 'hunter', field: 'email_pattern', value: data.pattern, confidence: 0.8 })
    if (Array.isArray(data?.emails)) {
      for (const e of data.emails.slice(0, 5)) {
        if (e.value) {
          result.facts.push({
            source: 'hunter',
            field: 'related_email',
            value: JSON.stringify({ email: e.value, name: `${e.first_name || ''} ${e.last_name || ''}`.trim(), position: e.position }),
            confidence: Math.min((e.confidence || 50) / 100, 0.95),
          })
        }
      }
    }
  } catch (err: any) {
    result.errors = [`hunter: ${err.message}`]
  }

  return result
}
