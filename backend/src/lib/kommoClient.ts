// src/lib/kommoClient.ts
//
// Cliente HTTP da Kommo CRM (api/v4). Resolve credenciais do banco (Setting
// grp='kommo') com fallback pra env, e oferece:
//   - kommoFetch(path)      → GET autenticado com retry/backoff + rate-limit
//   - kommoPaginate(entity) → async generator que percorre TODAS as páginas
//
// Onde está salvo (Configurações > Integrações > Kommo):
//   - Setting `kommo.subdomain`  (ex: "gerenteineproteccombr")
//   - Setting `kommo.token`      (JWT de longa duração da Kommo)
//   - Setting `kommo.enabled`    ("true"/"false")
//   - .env (fallback/dev): KOMMO_SUBDOMAIN / KOMMO_TOKEN
//
// Rate limit: a Kommo permite ~7 req/s por conta. Espaçamos as chamadas em
// MIN_INTERVAL_MS e tratamos 429 com backoff. O JWT expira — em 401 lançamos
// KommoAuthError pra UI sinalizar "token expirado" sem derrubar a fila.

import { prisma } from './prisma.js'

const SETTINGS_TTL_MS = 60_000
const MIN_INTERVAL_MS = 160 // ~6 req/s — folga sob o teto de 7 req/s da Kommo
const MAX_RETRIES = 4

export interface KommoConfig {
  subdomain: string | null
  token: string | null
  enabled: boolean
}

let cfgCache: { value: KommoConfig; expiresAt: number } | null = null

/** Erro de autenticação (401) — token expirado/inválido. */
export class KommoAuthError extends Error {
  constructor(message = 'Token da Kommo inválido ou expirado (401)') {
    super(message)
    this.name = 'KommoAuthError'
  }
}

function unwrap(value: unknown): string | null {
  if (value === null || value === undefined) return null
  const raw = typeof value === 'string' ? value : String(value)
  const trimmed = raw.replace(/^"|"$/g, '').trim()
  return trimmed || null
}

/** Lê config da Kommo do banco (Setting grp='kommo') → fallback env. Cache 60s. */
export async function getKommoConfig(force = false): Promise<KommoConfig> {
  const now = Date.now()
  if (!force && cfgCache && cfgCache.expiresAt > now) return cfgCache.value

  let subdomain: string | null = null
  let token: string | null = null
  let enabled = false
  try {
    const rows = await prisma.setting.findMany({
      where: { key: { in: ['kommo.subdomain', 'kommo.token', 'kommo.enabled'] } },
    })
    const map = new Map(rows.map((r) => [r.key, r.value]))
    subdomain = unwrap(map.get('kommo.subdomain'))
    token = unwrap(map.get('kommo.token'))
    enabled = unwrap(map.get('kommo.enabled')) === 'true'
  } catch {
    // DB indisponível — cai pro env.
  }
  if (!subdomain) subdomain = process.env.KOMMO_SUBDOMAIN || null
  if (!token) token = process.env.KOMMO_TOKEN || null

  const value: KommoConfig = { subdomain, token, enabled }
  cfgCache = { value, expiresAt: now + SETTINGS_TTL_MS }
  return value
}

export function isKommoConfigured(cfg: KommoConfig): boolean {
  return Boolean(cfg.subdomain && cfg.token)
}

function baseUrl(subdomain: string): string {
  return `https://${subdomain}.kommo.com/api/v4`
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

let lastCallAt = 0
/** Garante o espaçamento mínimo entre chamadas (rate-limit cooperativo). */
async function throttle(): Promise<void> {
  const now = Date.now()
  const wait = lastCallAt + MIN_INTERVAL_MS - now
  if (wait > 0) await sleep(wait)
  lastCallAt = Date.now()
}

/**
 * GET autenticado na Kommo. `path` é relativo à base (ex: "/account",
 * "/leads?limit=250&page=1"). Retorna o JSON já parseado, ou null em 204/empty.
 * Lança KommoAuthError em 401 e Error em demais falhas após os retries.
 */
export async function kommoFetch(path: string, cfg?: KommoConfig): Promise<any> {
  const config = cfg ?? (await getKommoConfig())
  if (!isKommoConfigured(config)) {
    throw new Error('Kommo não configurado (defina kommo.subdomain e kommo.token)')
  }
  const url = `${baseUrl(config.subdomain!)}${path.startsWith('/') ? path : `/${path}`}`

  let attempt = 0
  while (true) {
    attempt++
    await throttle()
    let resp: Response
    try {
      resp = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${config.token}`,
          Accept: 'application/json',
        },
      })
    } catch (err: any) {
      // erro de rede — retry com backoff
      if (attempt > MAX_RETRIES) throw new Error(`Kommo network error: ${err?.message || err}`)
      await sleep(500 * attempt)
      continue
    }

    if (resp.status === 401) throw new KommoAuthError()

    if (resp.status === 429 || resp.status >= 500) {
      if (attempt > MAX_RETRIES) {
        const txt = await resp.text().catch(() => '')
        throw new Error(`Kommo ${resp.status} após ${MAX_RETRIES} tentativas: ${txt.substring(0, 200)}`)
      }
      const retryAfter = parseInt(resp.headers.get('Retry-After') || '0', 10)
      await sleep(retryAfter > 0 ? retryAfter * 1000 : 600 * attempt)
      continue
    }

    if (resp.status === 204) return null
    if (!resp.ok) {
      const txt = await resp.text().catch(() => '')
      throw new Error(`Kommo ${resp.status}: ${txt.substring(0, 200)}`)
    }
    return resp.json().catch(() => null)
  }
}

/**
 * Percorre TODAS as páginas de uma entidade da Kommo, devolvendo os itens em
 * lotes (1 yield por página). `entity` é o nome no `_embedded` (ex: 'leads',
 * 'contacts', 'pipelines', 'tasks', 'users'). `query` são params extras
 * (ex: "with=contacts&filter[updated_at][from]=...").
 *
 * A Kommo devolve até 250/página e um `_links.next` quando há mais. Quando não
 * há mais resultados, o endpoint responde 204 (null) e encerramos.
 */
export async function* kommoPaginate(
  entity: string,
  query = '',
  cfg?: KommoConfig,
  embeddedKeyOverride?: string,
): AsyncGenerator<any[], void, unknown> {
  const config = cfg ?? (await getKommoConfig())
  const limit = 250
  let page = 1
  const sep = query ? '&' : ''
  // A chave do _embedded normalmente é a última parte do path (ex: 'leads/pipelines'
  // → 'pipelines'), mas alguns endpoints divergem ('chats/templates' →
  // 'chat_templates'), então aceitamos override explícito.
  const embeddedKey = embeddedKeyOverride ?? (entity.split('/').pop() as string)
  while (true) {
    const data = await kommoFetch(`/${entity}?limit=${limit}&page=${page}${sep}${query}`, config)
    const items: any[] = data?._embedded?.[embeddedKey] ?? []
    if (items.length === 0) return
    yield items
    if (!data?._links?.next) return
    page++
  }
}

/** Valida o token fazendo GET /account. Retorna info da conta ou lança. */
export async function kommoTestConnection(cfg?: KommoConfig): Promise<{
  id: number
  name: string
  subdomain: string
  currency?: string
}> {
  const data = await kommoFetch('/account', cfg)
  return { id: data?.id, name: data?.name, subdomain: data?.subdomain, currency: data?.currency }
}

/** Invalida o cache de config (chamar após salvar Settings novos). */
export function invalidateKommoConfigCache(): void {
  cfgCache = null
}
