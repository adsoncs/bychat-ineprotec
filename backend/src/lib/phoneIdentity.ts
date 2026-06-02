// src/lib/phoneIdentity.ts
//
// Configuração da fonte de enriquecimento "Identidade do Telefone" (lookup
// reverso de chave PIX/telefone → titular). Lido pelo provider
// services/enrichment/providers/phoneIdentity.ts.
//
// Settings (UI → Inteligência → Operador → "Identidade do Telefone"):
//   - enrichment.phone_identity.enabled    (bool, default false)
//   - enrichment.phone_identity.provider   (string: 'mock' | 'custom_http' | 'celcoin', default 'mock')
//   - enrichment.phone_identity.endpoint   (string — URL do PSP/serviço)
//   - enrichment.phone_identity.token      (string — criptografado em repouso)
//   - enrichment.phone_identity.purpose    (string — finalidade declarada LGPD)
//
// Cache 60s. Após salvar pela UI, mudança propaga em até 60s ou imediato via
// clearPhoneIdentityCache() chamado pela rota de settings.

import { prisma } from './prisma.js'
import { decryptToken } from '../services/cloudApi.js'

export type PhoneIdentityProvider = 'mock' | 'custom_http' | 'celcoin'

export interface PhoneIdentityConfig {
  enabled: boolean
  provider: PhoneIdentityProvider
  endpoint: string
  token: string
  purpose: string
}

const DEFAULT: PhoneIdentityConfig = {
  enabled: false,
  provider: 'mock',
  endpoint: '',
  token: '',
  purpose: '',
}

const TTL_MS = 60_000
let cache: { value: PhoneIdentityConfig; expiresAt: number } | null = null

function unwrap(raw: any): string {
  if (raw === null || raw === undefined) return ''
  if (typeof raw === 'string') return raw.replace(/^"|"$/g, '').trim()
  if (typeof raw === 'boolean') return raw ? 'true' : 'false'
  return String(raw)
}

function asBool(raw: any): boolean {
  const s = unwrap(raw).toLowerCase()
  return s === 'true' || s === '1' || s === 'yes'
}

function asProvider(raw: any): PhoneIdentityProvider {
  const v = unwrap(raw).toLowerCase()
  if (v === 'custom_http' || v === 'celcoin') return v
  return 'mock'
}

export async function getPhoneIdentityConfig(): Promise<PhoneIdentityConfig> {
  const now = Date.now()
  if (cache && cache.expiresAt > now) return cache.value

  try {
    const rows = await prisma.setting.findMany({
      where: { key: { in: [
        'enrichment.phone_identity.enabled',
        'enrichment.phone_identity.provider',
        'enrichment.phone_identity.endpoint',
        'enrichment.phone_identity.token',
        'enrichment.phone_identity.purpose',
      ] } },
    })
    const byKey = new Map(rows.map(r => [r.key, r.value]))

    const tokenCipher = unwrap(byKey.get('enrichment.phone_identity.token'))
    let token = ''
    if (tokenCipher) {
      try { token = decryptToken(tokenCipher) } catch { token = '' }
    }

    const value: PhoneIdentityConfig = {
      enabled: asBool(byKey.get('enrichment.phone_identity.enabled')),
      provider: asProvider(byKey.get('enrichment.phone_identity.provider')),
      endpoint: unwrap(byKey.get('enrichment.phone_identity.endpoint')),
      token,
      purpose: unwrap(byKey.get('enrichment.phone_identity.purpose')),
    }
    cache = { value, expiresAt: now + TTL_MS }
    return value
  } catch {
    cache = { value: DEFAULT, expiresAt: now + TTL_MS }
    return DEFAULT
  }
}

export function clearPhoneIdentityCache(): void {
  cache = null
}
