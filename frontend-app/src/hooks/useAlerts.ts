// hooks/useAlerts.ts
// Fase 2 dos alertas — a caixa de quem está logado.
//
// O contador tem `refetchInterval` como rede de segurança, não como mecanismo
// principal: quem acende o sino é o evento `alert:raised` no WebSocket (ver
// AlertInbox). O intervalo longo cobre o caso de a aba ter ficado dormindo ou
// a conexão ter caído sem ninguém perceber.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'

export type AlertSeverity = 'info' | 'warning' | 'critical'

export interface AlertItem {
  id: number
  kind: string
  severity: AlertSeverity
  title: string
  body: string | null
  entityType: string | null
  entityId: number | null
  metadata: Record<string, unknown> | null
  /** Quando a condição apareceu pela primeira vez. */
  firstSeenAt: string
  /** Última vez que a condição foi reencontrada. */
  lastSeenAt: string
  /** Quantas verificações confirmaram a condição — "está assim há dias". */
  occurrences: number
  readAt: string | null
  /** Caminho no painel onde o item vive. Null quando não há para onde ir. */
  link: string | null
  /** Ações que encerram a condição, resolvidas no backend por tipo de entidade. */
  acoes: Array<{ action: string; label: string; tom: 'primary' | 'neutral' }>
}

export interface AlertMute {
  id: number
  kind: string | null
  dedupeKey: string | null
  until: string | null
  createdAt: string
}

export function useUnreadAlertCount() {
  return useQuery({
    queryKey: ['alerts', 'unread-count'],
    queryFn: () => api.get<{ count: number }>('/alerts/unread-count'),
    staleTime: 15_000,
    refetchInterval: 120_000,
  })
}

export function useAlerts(enabled = true) {
  return useQuery({
    queryKey: ['alerts', 'list'],
    // 200 é o teto da rota. Com o default de 50 o sino contava 109 e a gaveta
    // abria com 50 — badge que não bate com a lista é a forma mais rápida de a
    // pessoa parar de confiar no sino inteiro.
    queryFn: () => api.get<{ alerts: AlertItem[] }>('/alerts?limit=200'),
    staleTime: 10_000,
    enabled,
  })
}

export function useMarkAlertRead() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.post<{ ok: boolean; unread: number }>(`/alerts/${id}/read`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['alerts'] }),
  })
}

export function useDismissAlert() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.post<{ ok: boolean; unread: number }>(`/alerts/${id}/dismiss`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['alerts'] }),
  })
}

export function useMarkAllAlertsRead() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api.post<{ ok: boolean; marcados: number }>('/alerts/read-all', {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['alerts'] }),
  })
}

/**
 * Age sobre o PROBLEMA, não sobre o alerta.
 *
 * Para reunião, `action` é o desfecho ('completed' | 'no_show'). O alerta some
 * como consequência de a condição ter deixado de existir — não porque alguém
 * fechou o aviso.
 */
export function useAlertAction() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, action }: { id: number; action: string }) =>
      api.post<{ ok: boolean; unread: number }>(`/alerts/${id}/action`, { action }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['alerts'] })
      // A reunião mudou de status: a agenda e a timeline do lead precisam
      // recarregar, senão a pessoa vê o desfecho no sino e o antigo na tela.
      qc.invalidateQueries({ queryKey: ['scheduling-calendar'] })
      qc.invalidateQueries({ queryKey: ['activities'] })
    },
  })
}

/**
 * Parar de receber — por família ou por item.
 *
 * A válvula que protege a confiança no sino: sem ela, o primeiro alerta
 * irrelevante contamina o hábito de abrir a caixa inteira. É sempre de quem
 * pede, nunca dos outros.
 */
export function useMuteAlert() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { kind?: string; alertId?: number; dias?: number }) =>
      api.post<{ ok: boolean; unread: number }>('/alerts/mute', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['alerts'] }),
  })
}

export function useUnmuteAlert() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { kind?: string; dedupeKey?: string }) =>
      api.post<{ ok: boolean; unread: number }>('/alerts/unmute', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['alerts'] }),
  })
}

export function useAlertMutes(enabled = true) {
  return useQuery({
    queryKey: ['alerts', 'mutes'],
    queryFn: () => api.get<{ mutes: AlertMute[] }>('/alerts/mutes'),
    staleTime: 30_000,
    enabled,
  })
}

export interface ItemDoAcervo {
  tipo: string
  rotulo: string
  quantidade: number
  maisAntigoDias: number | null
  motivo: string
}

/**
 * O que a janela de corte deixou de fora.
 *
 * Buscado só com a gaveta aberta: é contexto, não urgência — quem precisa saber
 * está olhando a caixa, e manter isto de pé o tempo todo custaria consulta por
 * nada.
 */
export function useAlertBacklog(enabled = true) {
  return useQuery({
    queryKey: ['alerts', 'backlog'],
    queryFn: () => api.get<{ itens: ItemDoAcervo[]; total: number }>('/alerts/backlog'),
    staleTime: 300_000,
    enabled,
  })
}
