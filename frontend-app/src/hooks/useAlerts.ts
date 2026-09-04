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

/**
 * "Ciente por hoje": tira da minha caixa por um prazo.
 *
 * Substituiu o descarte, que era definitivo — quem descartava não via aquele
 * alerta nunca mais, nem com o problema de pé, nem quando ele reabria. Aqui o
 * alerta volta quando o prazo vence, e só se a condição ainda existir.
 */
export function useAckAlert() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) =>
      api.post<{ ok: boolean; ate: string | null; unread: number }>(`/alerts/${id}/ack`, {}),
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

// ── Saúde do próprio sino (Configurações › Alertas) ─────────────────────────
//
// Existe para responder uma pergunta de produto, não de operação: "algum tipo
// de alerta virou ruído e deve ser desligado?". O instrumento vem antes do
// próximo produtor de propósito — sem ele, cada tipo novo é uma aposta que só
// o cliente paga.

export interface SaudeDoTipo {
  kind: string
  /** O que este tipo significa, em uma linha. */
  oque: string | null
  /** Está ligado nesta instalação. */
  ativo: boolean
  aguardando: number
  abertos: number
  resolvidos: number
  descartes: number
  naoLidos: number
  destinatarios: number
  taxaDescarte: number
  taxaNaoLido: number
  horasAteResolver: number | null
  ocorrenciasMedia: number
  veredicto: 'ruido' | 'irrelevante' | 'saudavel' | 'sem_amostra'
  /** Uma frase dizendo o que fazer. */
  recomendacao: string
}

export function useAlertHealth(dias = 30) {
  return useQuery({
    queryKey: ['alerts', 'health', dias],
    queryFn: () => api.get<{ dias: number; tipos: SaudeDoTipo[] }>(`/alerts/health?dias=${dias}`),
    staleTime: 60_000,
  })
}

export function useToggleAlertProducer() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ kind, ativo }: { kind: string; ativo: boolean }) =>
      api.post<{ ok: boolean; kind: string; ativo: boolean; fechados: number }>(
        `/alerts/producers/${encodeURIComponent(kind)}`, { ativo },
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['alerts'] }),
  })
}

// ── Tela dedicada ───────────────────────────────────────────────────────────

export type EscopoDaLista = 'minha' | 'empresa'

export interface AlertaDaLista extends AlertItem {
  status: string
  firstSeenAt: string
  resolvedAt: string | null
  /** Só na visão da empresa: de quem é a condição e quantos ainda não leram. */
  dono: { id: number; nome: string } | null
  destinatarios: number
  naoLidos: number
}

export interface FiltroDaLista {
  escopo: EscopoDaLista
  status?: string
  kind?: string
  severity?: string
  /** Recorte por quando a condição apareceu — a janela dos resolvidos. */
  desde?: string | undefined
  busca?: string
  limit?: number
  offset?: number
}

function query(f: FiltroDaLista): string {
  const p = new URLSearchParams()
  p.set('escopo', f.escopo)
  for (const k of ['status', 'kind', 'severity', 'busca', 'desde'] as const) {
    const v = f[k]
    if (v) p.set(k, v)
  }
  p.set('limit', String(f.limit ?? 50))
  p.set('offset', String(f.offset ?? 0))
  return p.toString()
}

export function useAlertList(f: FiltroDaLista, enabled = true) {
  return useQuery({
    queryKey: ['alerts', 'list-page', f],
    queryFn: () => api.get<{ itens: AlertaDaLista[]; total: number; limite: number; offset: number }>(
      `/alerts/list?${query(f)}`,
    ),
    staleTime: 15_000,
    enabled,
  })
}

export function useAlertKinds() {
  return useQuery({
    queryKey: ['alerts', 'kinds'],
    queryFn: () => api.get<{ tipos: Array<{ kind: string; total: number }> }>('/alerts/list/kinds'),
    staleTime: 300_000,
  })
}

export interface ItemDoAcervo {
  tipo: string
  rotulo: string
  entityId: number
  entityType: string
  titulo: string
  detalhe: string | null
  dias: number | null
  link: string | null
  dono: string | null
}

export function useAcervoItens(tipo: string | undefined, offset: number, enabled = true) {
  return useQuery({
    queryKey: ['alerts', 'acervo-itens', tipo ?? '', offset],
    queryFn: () => {
      const p = new URLSearchParams({ limit: '50', offset: String(offset) })
      if (tipo) p.set('tipo', tipo)
      return api.get<{ itens: ItemDoAcervo[]; total: number; limite: number; offset: number }>(
        `/alerts/backlog/items?${p.toString()}`,
      )
    },
    staleTime: 60_000,
    enabled,
  })
}
