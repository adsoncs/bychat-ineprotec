// Supervisão — painel gerencial do Conversas (backend: routes/supervision.ts).
// As conversas são os mesmos leads da inbox; aqui só mudam o recorte (todos os
// operadores) e o nível de agregação.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'

export type SupervisionBucket = 'raw' | 'inbox' | 'snoozed' | 'resolved'

/** Quem conduz a conversa agora e em que ponto do chatbot ela está. */
export interface BotState {
  driver: 'human' | 'bot' | 'none'
  engine: 'ai_journey' | 'scripted' | null
  phase: string | null
  step: number | null
  pausedAt: string | null
  pausedBy: string | null
}

export interface SupervisionOverview {
  generatedAt: string
  periodDays: number
  buckets: { raw: number; inbox: number; snoozed: number; resolved: number; active: number }
  kpis: {
    activeTotal: number
    unassigned: number
    unread: number
    groups: number
    resolvedToday: number
    resolvedPeriod: number
    humanDriven: number
    botDriven: number
    oldestWaitingMin: number | null
    avgFirstResponseMin: number | null
    avgResolutionMin: number | null
    sampleFirstResponse: number
    sampleResolution: number
  }
  byUser: Array<{ id: number | null; name: string; total: number }>
  byTeam: Array<{ id: number | null; name: string; color: string | null; total: number }>
  byFunnel: Array<{ id: number | null; name: string; total: number }>
  byStage: Array<{ key: string; total: number }>
  byChannel: Array<{ channel: string; total: number }>
}

export interface SupervisionConversation {
  id: number
  nome: string
  empresa: string | null
  whatsapp: string
  email: string | null
  profilePicUrl: string | null
  isGroup: boolean
  bucket: SupervisionBucket
  stageKey: string
  stageName: string
  funnel: { id: number; name: string } | null
  source: string | null
  assignedUser: { id: number; name: string } | null
  team: { id: number; name: string; color: string | null } | null
  unreadMessages: number
  lastMessageAt: string | null
  lastMessage: { body: string; fromMe: boolean; at: string } | null
  channel: { provider: string; instance: string | null; connectionId: number | null; label: string } | null
  bot: BotState
  chatbotId: number | null
  /** minutos desde a última mensagem DO LEAD (null quando a bola está com ele) */
  waitingSinceMin: number | null
  firstResponseMin: number | null
  openMin: number | null
  snoozedUntil: string | null
  conversationOpenedAt: string | null
  conversationClosedAt: string | null
  createdAt: string
}

export interface SupervisionFilters {
  bucket?: string
  userId?: string
  teamId?: string
  funnelId?: string
  channel?: string
  kind?: string
  unread?: string
  stale?: string
  search?: string
  sort?: string
  limit?: number
  offset?: number
  /** YYYY-MM-DD — período dos indicadores de fluxo (resolvidas, tempos) */
  from?: string
  to?: string
}

function toQuery(f: SupervisionFilters): string {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(f)) {
    if (v !== undefined && v !== null && v !== '') p.set(k, String(v))
  }
  const s = p.toString()
  return s ? `?${s}` : ''
}

export function useSupervisionOverview(filters: SupervisionFilters) {
  return useQuery({
    queryKey: ['supervision', 'overview', filters],
    queryFn: () => api.get<SupervisionOverview>(`/supervision/overview${toQuery(filters)}`),
    // Fallback do WebSocket: mesmo sem evento, o painel não envelhece num telão.
    refetchInterval: 60_000,
    staleTime: 15_000,
  })
}

export function useSupervisionConversations(filters: SupervisionFilters) {
  return useQuery({
    queryKey: ['supervision', 'conversations', filters],
    queryFn: () =>
      api.get<{ conversations: SupervisionConversation[]; total: number; limit: number; offset: number }>(
        `/supervision/conversations${toQuery(filters)}`,
      ),
    refetchInterval: 60_000,
    staleTime: 10_000,
  })
}

export interface SupervisionFilterOptions {
  users: Array<{ id: number; name: string }>
  teams: Array<{ id: number; name: string; color: string | null }>
  funnels: Array<{ id: number; name: string }>
  channels: Array<{ value: string; label: string }>
}

export function useSupervisionFilterOptions() {
  return useQuery({
    queryKey: ['supervision', 'filter-options'],
    queryFn: () => api.get<SupervisionFilterOptions>('/supervision/filters'),
    staleTime: 5 * 60_000,
  })
}

/** Ações em lote — o mesmo payload serve para uma conversa ou várias. */
function useSupervisionAction<T>(path: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: T & { leadIds: number[] }) => api.post<any>(`/supervision/conversations/${path}`, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['supervision'] })
      // A inbox do Conversas mostra os mesmos registros.
      void qc.invalidateQueries({ queryKey: ['tickets'] })
    },
  })
}

export const useSupervisionClose = () => useSupervisionAction<Record<string, never>>('close')
export const useSupervisionReopen = () => useSupervisionAction<Record<string, never>>('reopen')
export const useSupervisionResumeBot = () => useSupervisionAction<Record<string, never>>('resume-bot')
export const useSupervisionAssign = () =>
  useSupervisionAction<{ userId?: number | null; teamId?: number | null; reason?: string }>('assign')
export const useSupervisionSnooze = () => useSupervisionAction<{ until: string | null }>('snooze')
