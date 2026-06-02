import { env } from './env'
import { refreshAccessToken } from './refreshClient'

/**
 * Cliente HTTP centralizado.
 *
 * - Lê o token JWT (access, ~15min) de localStorage[`bh_token`].
 * - Em 401 tenta **rotacionar via refresh cookie** uma única vez antes de
 *   declarar a sessão expirada — single-flight no refreshClient.
 * - Se o refresh falhar, dispara `bh:auth:expired` para o AuthGate
 *   redirecionar para /app/login.
 */

export class ApiError extends Error {
  status: number
  payload: unknown

  constructor(message: string, status: number, payload: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.payload = payload
  }
}

function getToken(): string | null {
  try {
    return localStorage.getItem(env.authTokenKey)
  } catch {
    return null
  }
}

export function setToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(env.authTokenKey, token)
    else localStorage.removeItem(env.authTokenKey)
  } catch {
    // localStorage indisponível (modo privado, etc) — ignorar silenciosamente
  }
}

interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown
  /** se true, não envia Authorization mesmo se houver token */
  anonymous?: boolean
  /** se true, não dispara `bh:auth:expired` em resposta 401.
   *  útil quando 401 indica credencial inválida no payload (ex.: PUT /admin/me
   *  com `currentPassword` errada) e não sessão expirada. */
  skipAuthExpired?: boolean
}

function isAuthEndpoint(path: string): boolean {
  return path.includes('/admin/login') || path.includes('/admin/refresh')
}

async function executeRequest(path: string, init: RequestInit, anonymous: boolean): Promise<Response> {
  const url = path.startsWith('http') ? path : `${env.apiBase}${path}`
  const headers = new Headers(init.headers)
  if (!anonymous) {
    const token = getToken()
    if (token) headers.set('Authorization', `Bearer ${token}`)
    else headers.delete('Authorization')
  }
  return fetch(url, { ...init, headers })
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { body, anonymous = false, skipAuthExpired = false, headers: rawHeaders, ...rest } = options

  const headers = new Headers(rawHeaders)
  if (body !== undefined && !(body instanceof FormData)) {
    headers.set('Content-Type', 'application/json')
  }

  const init: RequestInit = { ...rest, headers, credentials: rest.credentials ?? 'include' }
  if (body !== undefined) {
    init.body = body instanceof FormData ? body : JSON.stringify(body)
  }

  let res = await executeRequest(path, init, anonymous)

  // 401: tenta refresh uma vez antes de declarar sessão expirada.
  // Pula endpoints de auth (login/refresh): 401 ali = credencial inválida.
  if (res.status === 401 && !skipAuthExpired && !anonymous && !isAuthEndpoint(path)) {
    const newToken = await refreshAccessToken()
    if (newToken) {
      res = await executeRequest(path, init, anonymous)
    }
    if (res.status === 401) {
      window.dispatchEvent(new CustomEvent('bh:auth:expired'))
    }
  }

  const text = await res.text()
  let data: unknown = null
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      data = text
    }
  }

  if (!res.ok) {
    const message =
      data && typeof data === 'object' && 'error' in data && typeof (data).error === 'string'
        ? (data as { error: string }).error
        : `HTTP ${res.status}`
    throw new ApiError(message, res.status, data)
  }

  return data as T
}

export const api = {
  get: <T>(path: string, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    apiRequest<T>(path, { ...options, method: 'GET' }),
  post: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method'>) =>
    apiRequest<T>(path, { ...options, method: 'POST', body }),
  put: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method'>) =>
    apiRequest<T>(path, { ...options, method: 'PUT', body }),
  patch: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method'>) =>
    apiRequest<T>(path, { ...options, method: 'PATCH', body }),
  delete: <T>(path: string, options?: Omit<RequestOptions, 'method'>) =>
    apiRequest<T>(path, { ...options, method: 'DELETE' }),
}
