import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'

export interface DashboardFilters {
  dateFrom?: string | undefined
  dateTo?: string | undefined
  funnelId?: number | undefined
}

export interface DashboardStage {
  key: string
  name: string
  color: string
  count: number
}

export interface DashboardFunnel {
  id: number
  name: string
  isDefault: boolean
  totalLeads: number
  stages: DashboardStage[]
}

export interface DashboardRecentLead {
  id: number
  nome: string | null
  empresa: string | null
  scores: Record<string, number> | null
  status: string | null
  createdAt: string
  source: string | null
  funnelId: number | null
}

export interface DashboardSource {
  source: string
  count: number
}

export interface DashboardLpStats {
  total: number
  published: number
  totalViews: number
  totalSubmissions: number
  pages: { id: number; title: string; slug: string; status: string; views: number; submissions: number }[]
}

export interface DashboardFormStats {
  total: number
  active: number
  totalSubmissions: number
  forms: { id: number; name: string; active: boolean; submissions: number }[]
}

export interface DashboardResponse {
  leads: {
    total: number
    today: number
    thisWeek: number
    avgScore: number
    avgPillars: Record<string, number>
    avgProbability: number | null
    byStatus: Record<string, number>
    bySource: DashboardSource[]
    daily: Record<string, number>
    recent: DashboardRecentLead[]
    /** Fase 24: cada submissão de Form/Meta/Portal/API/Make = 1 evento de aquisição. */
    submissions?: number
    /** Fase 24: inscrições - duplicados pending_review (pessoas distintas pós-revisão). */
    uniqueLeads?: number
    /** Fase 24: aguardando decisão em /app/leads/duplicates. */
    duplicatesPending?: number
    /** Fase 24: marcados pelo operador como manter separados. */
    duplicatesKeptSeparate?: number
  }
  funnels: DashboardFunnel[]
  activities: {
    pending: number
    overdue: number
  }
  landingPages: DashboardLpStats
  forms: DashboardFormStats
  metaForms: { total: number; active: number }
  chatbots: { total: number; byChannel: Record<string, number> }
  templates: { total: number; active: number; byChannel: Record<string, number> }
  tracking: { visitors: number }
  tags: { id: number; name: string; color: string; count: number }[]
}

function buildQuery(filters: DashboardFilters): string {
  const params = new URLSearchParams()
  if (filters.dateFrom) params.set('dateFrom', filters.dateFrom)
  if (filters.dateTo) params.set('dateTo', filters.dateTo)
  if (filters.funnelId !== undefined) params.set('funnelId', String(filters.funnelId))
  const qs = params.toString()
  return qs ? `?${qs}` : ''
}

export function useDashboard(filters: DashboardFilters = {}) {
  return useQuery({
    queryKey: ['dashboard', filters],
    queryFn: () => api.get<DashboardResponse>(`/admin/dashboard${buildQuery(filters)}`),
    staleTime: 30_000,
  })
}
