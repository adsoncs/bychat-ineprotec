/**
 * Instagram Login API for Business — fluxo OAuth direto pelo Instagram
 * (sem depender de Facebook Login + Pages).
 *
 * Docs: https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login
 *
 * Diferente do Facebook Login (lib/meta.ts), este fluxo usa:
 *   - Authorize: https://www.instagram.com/oauth/authorize/
 *   - Token:     https://api.instagram.com/oauth/access_token
 *   - Graph:     https://graph.instagram.com (NÃO graph.facebook.com)
 *   - Scopes:    instagram_business_*
 *
 * Tokens devolvidos são long-lived (60 dias) após troca por ig_exchange_token,
 * e podem ser renovados (até 60 dias adicionais cada vez) via ig_refresh_token.
 */

import { prisma } from './prisma.js'

export const IG_AUTHORIZE_URL = 'https://www.instagram.com/oauth/authorize/'
export const IG_TOKEN_URL = 'https://api.instagram.com/oauth/access_token'
export const IG_GRAPH_URL = 'https://graph.instagram.com'

export const IG_BUSINESS_SCOPES = [
  'instagram_business_basic',
  'instagram_business_manage_messages',
  'instagram_business_manage_comments',
  'instagram_business_content_publish',
  'instagram_business_manage_insights',
] as const

export type InstagramBusinessScope = (typeof IG_BUSINESS_SCOPES)[number]

/** App ID do produto "Instagram API setup with Instagram login" no Meta. */
export async function getInstagramAppId(): Promise<string> {
  if (process.env.IG_APP_ID) return process.env.IG_APP_ID
  const row = await prisma.setting.findUnique({ where: { key: 'instagram.app_id' } })
  const val = row ? (typeof row.value === 'string' ? row.value : String(row.value)) : ''
  if (!val) throw new Error('IG_APP_ID não configurado (env IG_APP_ID ou setting instagram.app_id).')
  return val.replace(/"/g, '')
}

export async function getInstagramAppSecret(): Promise<string> {
  if (process.env.IG_APP_SECRET) return process.env.IG_APP_SECRET
  const row = await prisma.setting.findUnique({ where: { key: 'instagram.app_secret' } })
  const val = row ? (typeof row.value === 'string' ? row.value : String(row.value)) : ''
  if (!val) throw new Error('IG_APP_SECRET não configurado (env IG_APP_SECRET ou setting instagram.app_secret).')
  return val.replace(/"/g, '')
}

/**
 * Redirect URI cadastrada no painel do app no Meta — TEM que bater exatamente
 * (case-sensitive, sem trailing slash extra) ou o Meta rejeita o callback.
 */
export async function getInstagramRedirectUri(req?: { hostname?: string }): Promise<string> {
  if (process.env.IG_REDIRECT_URI) return process.env.IG_REDIRECT_URI
  const row = await prisma.setting.findUnique({ where: { key: 'instagram.redirect_uri' } })
  const val = row ? (typeof row.value === 'string' ? row.value : String(row.value)) : ''
  if (val) return val.replace(/"/g, '')
  // Fallback baseado no host atual / APP_URL.
  const appUrl = process.env.APP_URL || `https://${req?.hostname ?? 'localhost'}`
  return `${appUrl.replace(/\/$/, '')}/api/oauth/instagram/callback`
}

export interface BuildAuthorizeUrlInput {
  state: string
  redirectUri: string
  appId: string
  /** Permite ao usuário também logar via Facebook se a conta IG estiver linkada a Page. */
  enableFbLogin?: boolean
  /** Força reautenticação mesmo se já logado no IG. Default true (UX previsível). */
  forceAuthentication?: boolean
}

export function buildAuthorizeUrl(input: BuildAuthorizeUrlInput): string {
  const params = new URLSearchParams({
    client_id: input.appId,
    redirect_uri: input.redirectUri,
    response_type: 'code',
    scope: IG_BUSINESS_SCOPES.join(','),
    state: input.state,
  })
  if (input.enableFbLogin !== false) params.set('enable_fb_login', '1')
  if (input.forceAuthentication !== false) params.set('force_authentication', '1')
  return `${IG_AUTHORIZE_URL}?${params.toString()}`
}

export interface InstagramTokenResponse {
  access_token: string
  user_id: number | string
  permissions?: string | string[]
}

/**
 * Troca o `code` recebido no callback por um short-lived access token (1h).
 * Usa application/x-www-form-urlencoded conforme docs.
 */
export async function exchangeCodeForToken(input: {
  code: string
  appId: string
  appSecret: string
  redirectUri: string
}): Promise<InstagramTokenResponse> {
  const body = new URLSearchParams({
    client_id: input.appId,
    client_secret: input.appSecret,
    grant_type: 'authorization_code',
    redirect_uri: input.redirectUri,
    code: input.code,
  })
  const res = await fetch(IG_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  const json = (await res.json()) as Record<string, unknown>
  if (!res.ok || !json.access_token) {
    const msg = (json.error_message || json.error_description || json.error || `HTTP ${res.status}`) as string
    throw new Error(`Falha ao trocar code: ${msg}`)
  }
  return json as unknown as InstagramTokenResponse
}

export interface LongLivedTokenResponse {
  access_token: string
  token_type: string
  expires_in: number // segundos
}

/**
 * Troca short-lived (1h) por long-lived (60 dias) via ig_exchange_token.
 * Endpoint: GET graph.instagram.com/access_token
 */
export async function exchangeForLongLivedToken(input: {
  shortLivedToken: string
  appSecret: string
}): Promise<LongLivedTokenResponse> {
  const url = new URL(`${IG_GRAPH_URL}/access_token`)
  url.searchParams.set('grant_type', 'ig_exchange_token')
  url.searchParams.set('client_secret', input.appSecret)
  url.searchParams.set('access_token', input.shortLivedToken)
  const res = await fetch(url)
  const json = (await res.json()) as Record<string, unknown>
  if (!res.ok || !json.access_token) {
    const msg = ((json.error as Record<string, unknown>)?.message || `HTTP ${res.status}`) as string
    throw new Error(`Falha ao gerar long-lived token: ${msg}`)
  }
  return json as unknown as LongLivedTokenResponse
}

/**
 * Renova um long-lived token (mínimo 24h após emissão, válido por +60d).
 */
export async function refreshLongLivedToken(token: string): Promise<LongLivedTokenResponse> {
  const url = new URL(`${IG_GRAPH_URL}/refresh_access_token`)
  url.searchParams.set('grant_type', 'ig_refresh_token')
  url.searchParams.set('access_token', token)
  const res = await fetch(url)
  const json = (await res.json()) as Record<string, unknown>
  if (!res.ok || !json.access_token) {
    const msg = ((json.error as Record<string, unknown>)?.message || `HTTP ${res.status}`) as string
    throw new Error(`Falha ao renovar token: ${msg}`)
  }
  return json as unknown as LongLivedTokenResponse
}

export interface InstagramProfile {
  user_id: string
  username: string
  name?: string
  account_type?: 'BUSINESS' | 'MEDIA_CREATOR' | 'PERSONAL'
  profile_picture_url?: string
}

/** GET graph.instagram.com/v23.0/me?fields=... usando o user access token. */
export async function fetchProfile(token: string): Promise<InstagramProfile> {
  const url = new URL(`${IG_GRAPH_URL}/v23.0/me`)
  url.searchParams.set('fields', 'user_id,username,name,account_type,profile_picture_url')
  url.searchParams.set('access_token', token)
  const res = await fetch(url)
  const json = (await res.json()) as Record<string, unknown>
  if (!res.ok || !json.username) {
    const msg = ((json.error as Record<string, unknown>)?.message || `HTTP ${res.status}`) as string
    throw new Error(`Falha ao buscar perfil: ${msg}`)
  }
  return json as unknown as InstagramProfile
}

// ─────────────────────────────────────────────────────────────────
// State store (CSRF) — array em Setting com TTL 10 min
// ─────────────────────────────────────────────────────────────────

const STATE_KEY = 'instagram.oauth_states'
const STATE_TTL_MS = 10 * 60 * 1000

interface StoredState {
  state: string
  userId?: number
  createdAt: number
}

async function readStates(): Promise<StoredState[]> {
  const row = await prisma.setting.findUnique({ where: { key: STATE_KEY } })
  if (!row) return []
  try {
    const v = typeof row.value === 'string' ? JSON.parse(row.value) : row.value
    return Array.isArray(v) ? (v as StoredState[]) : []
  } catch {
    return []
  }
}

async function writeStates(states: StoredState[]): Promise<void> {
  const value = JSON.stringify(states)
  await prisma.setting.upsert({
    where: { key: STATE_KEY },
    update: { value },
    create: {
      key: STATE_KEY,
      value,
      label: 'Instagram OAuth state CSRF tokens',
      grp: 'channels',
      fieldType: 'json',
    },
  })
}

function pruneExpired(states: StoredState[]): StoredState[] {
  const now = Date.now()
  return states.filter((s) => now - s.createdAt < STATE_TTL_MS)
}

export async function persistOAuthState(state: string, userId?: number): Promise<void> {
  const states = pruneExpired(await readStates())
  states.push({ state, userId, createdAt: Date.now() })
  // limita a 50 entries pra não inflar a row indefinidamente
  await writeStates(states.slice(-50))
}

export async function consumeOAuthState(state: string): Promise<{ valid: boolean; userId?: number }> {
  const states = pruneExpired(await readStates())
  const idx = states.findIndex((s) => s.state === state)
  if (idx === -1) {
    await writeStates(states) // grava só com prune
    return { valid: false }
  }
  const found = states[idx]!
  states.splice(idx, 1)
  await writeStates(states)
  return { valid: true, userId: found.userId }
}
