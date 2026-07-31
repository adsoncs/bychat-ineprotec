import type { QueryClient } from '@tanstack/react-query'
import { env } from './env'

/**
 * Realtime: WebSocket + cross-tab sync + revalidação ao voltar online.
 *
 * 1. WebSocket (`/api/ws?token=...`) — escuta eventos do backend
 *    (lead:created, lead:stage_changed, message:received, ...) e dispara
 *    invalidações nas queries TanStack relevantes. Reconecta com backoff.
 *
 * 2. BroadcastChannel — sincroniza mutações entre abas do mesmo navegador.
 *
 * 3. window online — revalida queries quando o navegador volta a navegar.
 */

export type RealtimeEvent =
  | { type: 'invalidate'; queryKey: readonly unknown[] }
  | { type: 'invalidate-all' }

const CHANNEL_NAME = 'bh:realtime'

let channel: BroadcastChannel | null = null

function getChannel(): BroadcastChannel | null {
  if (typeof BroadcastChannel === 'undefined') return null
  channel ??= new BroadcastChannel(CHANNEL_NAME)
  return channel
}

/** Notifica TODAS as outras abas para invalidar a query. */
export function broadcastInvalidate(queryKey: readonly unknown[]): void {
  getChannel()?.postMessage({ type: 'invalidate', queryKey } satisfies RealtimeEvent)
}

export interface RealtimeBusOptions {
  qc: QueryClient
}

/**
 * Inicializa o bus realtime. Retorna função de cleanup.
 */
export function startRealtimeBus({ qc }: RealtimeBusOptions): () => void {
  const ch = getChannel()
  const handlers: (() => void)[] = []

  if (ch) {
    const onMessage = (ev: MessageEvent<RealtimeEvent>) => {
      const data = ev.data
      if (!data) return
      if (data.type === 'invalidate') {
        void qc.invalidateQueries({ queryKey: data.queryKey })
      } else if (data.type === 'invalidate-all') {
        void qc.invalidateQueries()
      }
    }
    ch.addEventListener('message', onMessage)
    handlers.push(() => ch.removeEventListener('message', onMessage))
  }

  if (typeof window !== 'undefined') {
    // Volta a navegar online → revalidar tudo (especialmente queries que
    // estavam paradas durante o offline).
    const onOnline = () => {
      void qc.invalidateQueries()
    }
    window.addEventListener('online', onOnline)
    handlers.push(() => window.removeEventListener('online', onOnline))
  }

  // WebSocket → backend: invalida queries em tempo real
  const wsCleanup = startWebSocket(qc)
  if (wsCleanup) handlers.push(wsCleanup)

  return () => handlers.forEach((h) => h())
}

interface ServerEvent {
  type: string
  payload?: Record<string, unknown>
}

// ── Pub/sub leve para componentes que precisam ouvir eventos brutos do servidor
// (ex: progresso do enrichment, animações específicas). Independente do TanStack invalidation.
type ServerEventListener = (ev: ServerEvent) => void
const eventListeners = new Set<ServerEventListener>()

export function onServerEvent(fn: ServerEventListener): () => void {
  eventListeners.add(fn)
  return () => eventListeners.delete(fn)
}

function emitServerEvent(ev: ServerEvent): void {
  for (const fn of eventListeners) {
    try { fn(ev) } catch { /* ignore listener errors */ }
  }
}

/**
 * Mapeia um evento server→client para queryKeys que devem ser invalidadas.
 * Mantém uma única tabela autoritativa para todos os tipos de evento.
 */
function queryKeysForEvent(ev: ServerEvent): readonly unknown[][] {
  switch (ev.type) {
    case 'lead:created':
    case 'lead:updated':
    case 'lead:deleted':
      return [['leads'], ['kanban'], ['dashboard'], ['supervision']]
    case 'lead:stage_changed':
      return [['leads'], ['kanban'], ['lead-history', ev.payload?.id], ['supervision']]
    case 'message:received':
    case 'message:sent':
      // ['supervision']: o painel gerencial lê os mesmos tickets, agregados.
      return [['ticket-messages', ev.payload?.leadId], ['tickets'], ['supervision']]
    case 'ticket:opened':
    case 'ticket:closed':
    case 'ticket:claimed':
      return [['tickets'], ['ticket-messages', ev.payload?.leadId], ['supervision']]
    case 'meta:lead_received':
      return [['meta-status'], ['leads'], ['dashboard']]
    case 'lead:enrichment_started':
    case 'lead:enrichment_progress':
      return [['intel-overview'], ['intel-lead', ev.payload?.leadId]]
    case 'lead:enrichment_completed':
      return [
        ['intel-overview'],
        ['intel-lead', ev.payload?.leadId],
        ['intel-dossier', ev.payload?.leadId],
        ['intel-promotions', ev.payload?.leadId],
        ['leads'],
      ]
    case 'transfer:requested':
    case 'transfer:accepted':
    case 'transfer:rejected':
    case 'transfer:cancelled':
    case 'transfer:expired':
      return [['transfer-requests'], ['leads'], ['kanban'], ['tickets']]
    case 'cloudapi:template_status':
      // Aprovação/reprovação/pausa de template HSM chegou via webhook ou cron.
      return [['cloud-api-templates']]
    case 'permissions:invalidated':
      // Reforma F4.4: admin mudou permissões → invalida cache pra refletir
      // imediatamente (sidebar, módulos, scope). Sem F5 deps.
      return [['my-permissions']]
    case 'realtime:hello':
    case 'pong':
    case 'chat:typing':
    case 'wa_call:incoming':
    case 'wa_call:answer':
    case 'wa_call:ended':
    case 'wa_call:status':
    case 'wa_call:permission':
      // Eventos ephemeral consumidos por listeners diretos (onServerEvent).
      return []
    default:
      return [['dashboard']]
  }
}

function startWebSocket(qc: QueryClient): (() => void) | null {
  if (typeof window === 'undefined') return null

  let ws: WebSocket | null = null
  let pingInterval: number | null = null
  let reconnectTimer: number | null = null
  let attempts = 0
  let stopped = false

  function buildUrl(): string | null {
    const token = (() => {
      try {
        return localStorage.getItem(env.authTokenKey)
      } catch {
        return null
      }
    })()
    if (!token) return null
    const base = env.apiBase.startsWith('http')
      ? env.apiBase
      : `${window.location.protocol}//${window.location.host}${env.apiBase}`
    const wsBase = base.replace(/^http/, 'ws')
    return `${wsBase}/ws?token=${encodeURIComponent(token)}`
  }

  function connect() {
    if (stopped) return
    const url = buildUrl()
    if (!url) {
      // sem token, tentar de novo em 5s (login pode chegar)
      reconnectTimer = window.setTimeout(connect, 5_000)
      return
    }

    try {
      ws = new WebSocket(url)
    } catch {
      scheduleReconnect()
      return
    }

    ws.addEventListener('open', () => {
      attempts = 0
      pingInterval = window.setInterval(() => {
        try {
          ws?.send(JSON.stringify({ type: 'ping' }))
        } catch {
          // ignore
        }
      }, 30_000)
    })

    ws.addEventListener('message', (msg) => {
      let parsed: ServerEvent
      try {
        parsed = JSON.parse(msg.data as string) as ServerEvent
      } catch {
        return
      }
      const keys = queryKeysForEvent(parsed)
      for (const key of keys) {
        if (!key.length) continue
        void qc.invalidateQueries({ queryKey: key })
      }
      emitServerEvent(parsed)
    })

    ws.addEventListener('close', () => {
      cleanupSocket()
      scheduleReconnect()
    })

    ws.addEventListener('error', () => {
      // o close vai disparar logo em seguida; só registrar
    })
  }

  function cleanupSocket() {
    if (pingInterval) {
      window.clearInterval(pingInterval)
      pingInterval = null
    }
    ws = null
  }

  function scheduleReconnect() {
    if (stopped) return
    attempts = Math.min(attempts + 1, 6)
    const delay = Math.min(1000 * 2 ** attempts, 30_000)
    reconnectTimer = window.setTimeout(connect, delay)
  }

  connect()

  return () => {
    stopped = true
    if (reconnectTimer) window.clearTimeout(reconnectTimer)
    cleanupSocket()
    try {
      ws?.close()
    } catch {
      // ignore
    }
  }
}
