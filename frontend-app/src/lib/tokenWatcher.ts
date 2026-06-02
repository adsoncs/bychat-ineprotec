import { env } from './env'
import { refreshAccessToken } from './refreshClient'

/**
 * Watcher proativo do access token.
 *
 * Decodifica `exp` do JWT e agenda um refresh ~60s antes da expiração
 * (com piso de 5s). Reagenda a si mesmo quando um refresh acontece. Para
 * sessões em múltiplas abas, o `storage` event de `bh_token` em outras abas
 * também reagenda (a primeira aba que faz refresh propaga o novo token).
 *
 * Não roda setInterval — só timeouts pontuais. Custo zero quando idle.
 */

const REFRESH_LEAD_MS = 60_000
const MIN_DELAY_MS = 5_000

let timer: number | null = null
let started = false

function decodeExpMs(token: string): number | null {
  try {
    const parts = token.split('.')
    const payloadPart = parts[1]
    if (!payloadPart) return null
    const b64 = payloadPart.replace(/-/g, '+').replace(/_/g, '/')
    const json = atob(b64.padEnd(b64.length + ((4 - (b64.length % 4)) % 4), '='))
    const payload = JSON.parse(json) as { exp?: number }
    if (typeof payload.exp !== 'number') return null
    return payload.exp * 1000
  } catch {
    return null
  }
}

function clearTimer() {
  if (timer !== null) {
    window.clearTimeout(timer)
    timer = null
  }
}

function scheduleRefresh() {
  clearTimer()
  let token: string | null = null
  try {
    token = localStorage.getItem(env.authTokenKey)
  } catch {
    token = null
  }
  if (!token) return
  const expMs = decodeExpMs(token)
  if (!expMs) return

  const delay = Math.max(MIN_DELAY_MS, expMs - Date.now() - REFRESH_LEAD_MS)
  timer = window.setTimeout(() => {
    timer = null
    // refreshAccessToken já trata o erro internamente (retorna null em falha).
    // O evento bh:auth:refreshed dispara reagendamento; se falhar, o próximo
    // 401 em apiRequest cuidará via interceptor.
    void refreshAccessToken()
  }, delay)
}

export function startTokenWatcher(): void {
  if (started) {
    scheduleRefresh()
    return
  }
  started = true

  window.addEventListener('bh:auth:refreshed', scheduleRefresh)
  window.addEventListener('bh:auth:expired', clearTimer)

  // Outras abas: novo token vindo de outro lugar reagenda; logout (newValue=null) limpa.
  window.addEventListener('storage', (e: StorageEvent) => {
    if (e.key !== env.authTokenKey) return
    if (e.newValue) scheduleRefresh()
    else clearTimer()
  })

  // Reagenda ao voltar pra aba (timer pode ter sido pausado pelo browser).
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') scheduleRefresh()
  })

  scheduleRefresh()
}

export function stopTokenWatcher(): void {
  clearTimer()
}
