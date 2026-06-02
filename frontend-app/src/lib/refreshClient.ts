import { env } from './env'

/**
 * Cliente do refresh token — single-flight.
 *
 * O cookie httpOnly `bh_refresh` é enviado automaticamente pelo browser
 * quando usamos `credentials: 'include'`. Este módulo:
 *
 * - Garante que múltiplas requisições simultâneas que recebem 401 disparem
 *   UMA ÚNICA chamada de /admin/refresh (mutex `pending`).
 * - Persiste o novo access token em localStorage com a chave compartilhada.
 * - Emite o evento `bh:auth:refreshed` para que o resto do app (ex.: token
 *   watcher) possa reagendar timers.
 */

interface RefreshResponse {
  token: string
  user?: { id: number; email: string; name: string; role: string }
}

let pending: Promise<string | null> | null = null

export function refreshAccessToken(): Promise<string | null> {
  if (pending) return pending
  pending = (async () => {
    try {
      const res = await fetch(`${env.apiBase}/admin/refresh`, {
        method: 'POST',
        credentials: 'include',
      })
      if (!res.ok) return null
      const data = (await res.json()) as RefreshResponse
      if (!data?.token) return null
      try {
        localStorage.setItem(env.authTokenKey, data.token)
      } catch {
        // localStorage indisponível — segue, usa token só em memória deste fluxo
      }
      window.dispatchEvent(new CustomEvent('bh:auth:refreshed', { detail: { token: data.token } }))
      return data.token
    } catch {
      return null
    } finally {
      pending = null
    }
  })()
  return pending
}
