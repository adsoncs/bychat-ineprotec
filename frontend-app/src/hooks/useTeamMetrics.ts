import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'

export interface TeamMetricsOperator {
  userId: number
  name: string | null
  email: string | null
  active: boolean
  capacity: number
  workStatus: 'available' | 'away' | 'busy' | 'offline'
  // Volume
  leadsAttended: number
  leadsResolved: number
  leadsWon: number
  leadsLost: number
  // Conversão
  resolutionRate: number
  winRate: number
  // Tempos
  avgWaitTimeMs: number | null
  avgHandlingTimeMs: number | null
  avgFirstResponseMs: number | null
  // Qualidade da carteira
  avgPriorityScore: number | null
  // Receita
  revenue: number
  salesCount: number
  avgTicket: number
  // Atividade/produtividade
  messagesSent: number
  activitiesCreated: number
  activitiesCompleted: number
  activitiesPending: number
  activitiesOverdue: number
  avgActivityCompletionMs: number | null
  stageMoves: number
  cadenceManualSteps: number
}

export interface TeamMetricsTotals {
  operators: number
  leadsAttended: number
  leadsResolved: number
  leadsWon: number
  leadsLost: number
  winRate: number
  revenue: number
  salesCount: number
  avgTicket: number
  messagesSent: number
  activitiesCreated: number
  activitiesCompleted: number
  activitiesOverdue: number
  stageMoves: number
  cadenceManualSteps: number
  avgWaitTimeMs: number | null
  avgHandlingTimeMs: number | null
  avgFirstResponseMs: number | null
}

export interface TeamMetricsResponse {
  from: string
  to: string
  filters: {
    teamId: number | null
    userId: number | null
    funnelId: number | null
    qualificationSource: string | null
  }
  operators: TeamMetricsOperator[]
  totals: TeamMetricsTotals
}

export interface TeamMetricsParams {
  from?: string
  to?: string
  teamId?: number | null
  userId?: number | null
  funnelId?: number | null
  qualificationSource?: string | null
}

export function useTeamMetrics(params: TeamMetricsParams) {
  const search = new URLSearchParams()
  if (params.from) search.set('from', params.from)
  if (params.to) search.set('to', params.to)
  if (params.teamId) search.set('teamId', String(params.teamId))
  if (params.userId) search.set('userId', String(params.userId))
  if (params.funnelId) search.set('funnelId', String(params.funnelId))
  if (params.qualificationSource) search.set('qualificationSource', params.qualificationSource)
  const qs = search.toString()
  return useQuery({
    queryKey: ['team-metrics', params],
    queryFn: () => api.get<TeamMetricsResponse>(`/admin/team-metrics${qs ? `?${qs}` : ''}`),
    staleTime: 30_000,
  })
}

// ── Drill-down por operador ────────────────────────────────────────────

export interface OperatorBreakdownResponse {
  userId: number
  from: string
  to: string
  outcomes: Record<string, number> // { won, lost, open }
  lossReasons: { reasonId: number; name: string; color: string | null; count: number }[]
  qualificationSources: { source: string; count: number }[]
  revenueTimeline: { date: string; value: number }[]
}

export function useOperatorBreakdown(
  userId: number | null,
  params: { from?: string; to?: string },
) {
  const search = new URLSearchParams()
  if (params.from) search.set('from', params.from)
  if (params.to) search.set('to', params.to)
  const qs = search.toString()
  return useQuery({
    queryKey: ['team-metrics-operator-breakdown', userId, params],
    queryFn: () =>
      api.get<OperatorBreakdownResponse>(
        `/admin/team-metrics/operator/${userId}/breakdown${qs ? `?${qs}` : ''}`,
      ),
    enabled: userId !== null,
    staleTime: 30_000,
  })
}

// ── Workload atual ─────────────────────────────────────────────────────

export interface WorkloadItem {
  userId: number
  name: string | null
  email: string | null
  capacity: number
  workStatus: 'available' | 'away' | 'busy' | 'offline'
  lastSeenAt: string | null
  activeLeads: number
  activitiesPending: number
  activitiesOverdue: number
  utilization: number // 0-100+
}

export interface WorkloadResponse {
  items: WorkloadItem[]
}

export function useTeamWorkload(teamId?: number | null) {
  const qs = teamId ? `?teamId=${teamId}` : ''
  return useQuery({
    queryKey: ['team-metrics-workload', teamId ?? null],
    queryFn: () => api.get<WorkloadResponse>(`/admin/team-metrics/workload${qs}`),
    staleTime: 30_000,
    refetchInterval: 60_000, // refresca a cada minuto pra refletir entrada/saída de leads
  })
}
