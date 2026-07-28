import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'

export interface KanbanFunnelSummary {
  id: number
  name: string
  description: string | null
  isDefault: boolean
  createdAt: string
  stageCount: number
  leadCount: number
  stages: { id: number; key: string; name: string; color: string; leadCount: number }[]
}

export function useKanbanFunnelsSummary() {
  return useQuery({
    queryKey: ['kanban', 'funnels-summary'],
    queryFn: () => api.get<{ funnels: KanbanFunnelSummary[] }>('/admin/kanban/funnels-summary'),
    staleTime: 30_000,
  })
}

export type KanbanRole = 'ADMIN' | 'MANAGER' | 'AGENT' | 'VIEWER'
export interface KanbanPermissionRow {
  role: KanbanRole
  canAdvance: boolean
  canRetreat: boolean
}

export function useKanbanPermissions() {
  return useQuery({
    queryKey: ['kanban', 'permissions'],
    queryFn: () => api.get<{ permissions: KanbanPermissionRow[] }>('/admin/kanban/permissions'),
    staleTime: 60_000,
  })
}

export function useSaveKanbanPermissions() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (permissions: KanbanPermissionRow[]) =>
      api.put<{ ok: true }>('/admin/kanban/permissions', { permissions }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['kanban', 'permissions'] })
      void qc.invalidateQueries({ queryKey: ['kanban'] })
    },
  })
}

export interface KanbanStage {
  id: number
  key: string
  name: string
  color: string
  position: number
  funnelId: number | null
  active: boolean
}

export interface KanbanLead {
  id: number
  empresa: string | null
  nome: string | null
  whatsapp: string | null
  email: string | null
  scores: Record<string, number> | null
  status: string
  source: string | null
  completed: boolean
  createdAt: string
  updatedAt: string
  annotation: string | null
  // Campos personalizados — o card exibe os marcados showInKanban.
  customFields?: Record<string, unknown> | null
  outcome?: 'won' | 'lost' | null
  outcomeAt?: string | null
  tags?: { tag: { id: number; name: string; color: string } }[]
  _activityCount: number
  _metaFormName: string | null
  // Lead Routing F6
  assignedUserId?: number | null
  assignedAt?: string | null
  assignedUser?: { id: number; name: string } | null
  teamId?: number | null
}

export interface KanbanFunnelOption {
  id: number
  name: string
  isDefault: boolean
}

export interface KanbanBoardResponse {
  stages: KanbanStage[]
  leads: Record<string, KanbanLead[]>
  funnels: KanbanFunnelOption[]
  currentFunnelId: number | undefined
  permissions: { canAdvance: boolean; canRetreat: boolean }
}

export interface KanbanBoardFilters {
  funnelId?: number | undefined
  search?: string | undefined
  outcome?: 'open' | 'won' | 'lost' | 'classified' | undefined
  aiScoreLabel?: 'hot' | 'warm' | 'cold' | undefined
  sources?: string[] | undefined
  assignedUserIds?: number[] | undefined
  onlyUnassigned?: boolean | undefined
  tagIds?: number[] | undefined
  dateFrom?: string | undefined
  dateTo?: string | undefined
  hideLost?: boolean | undefined
}

function buildKanbanQuery(f: KanbanBoardFilters): string {
  const p = new URLSearchParams()
  if (f.funnelId !== undefined) p.set('funnelId', String(f.funnelId))
  if (f.search) p.set('search', f.search)
  if (f.outcome) p.set('outcome', f.outcome)
  if (f.aiScoreLabel) p.set('aiScoreLabel', f.aiScoreLabel)
  if (f.sources && f.sources.length > 0) p.set('sources', f.sources.join(','))
  if (f.assignedUserIds && f.assignedUserIds.length > 0) p.set('assignedUserIds', f.assignedUserIds.join(','))
  if (f.onlyUnassigned) p.set('onlyUnassigned', '1')
  if (f.tagIds && f.tagIds.length > 0) p.set('tagIds', f.tagIds.join(','))
  if (f.dateFrom) p.set('dateFrom', f.dateFrom)
  if (f.dateTo) p.set('dateTo', f.dateTo)
  if (f.hideLost) p.set('hideLost', '1')
  const qs = p.toString()
  return qs ? `?${qs}` : ''
}

export function useKanbanBoard(filtersOrFunnelId?: number | KanbanBoardFilters, autoRefresh = true) {
  // Back-compat: chamadas antigas passavam só funnelId como number.
  const filters: KanbanBoardFilters = typeof filtersOrFunnelId === 'number' || filtersOrFunnelId == null
    ? { funnelId: typeof filtersOrFunnelId === 'number' ? filtersOrFunnelId : undefined }
    : filtersOrFunnelId
  const qs = buildKanbanQuery(filters)
  return useQuery({
    queryKey: ['kanban', filters],
    queryFn: () => api.get<KanbanBoardResponse>(`/admin/kanban/board${qs}`),
    staleTime: 15_000,
    refetchInterval: autoRefresh ? 30_000 : false,
    refetchOnWindowFocus: true,
  })
}

/**
 * Mutation otimista: card é movido visualmente antes da resposta.
 * Em erro, rollback para o estado anterior.
 */
export function useMoveLeadStage(funnelId?: number) {
  const qc = useQueryClient()
  const queryKey = ['kanban', funnelId ?? 'default']

  return useMutation({
    mutationFn: ({ leadId, status }: { leadId: number; status: string }) =>
      api.put<{ ok: true }>(`/bychat/leads/${leadId}/status`, { status }),
    onMutate: async ({ leadId, status }) => {
      await qc.cancelQueries({ queryKey })
      const prev = qc.getQueryData<KanbanBoardResponse>(queryKey)
      if (!prev) return { prev: undefined }

      // Encontrar lead na coluna atual
      let movingLead: KanbanLead | undefined
      const nextLeads: Record<string, KanbanLead[]> = {}
      for (const [stageKey, list] of Object.entries(prev.leads)) {
        const idx = list.findIndex((l) => l.id === leadId)
        if (idx >= 0) {
          movingLead = list[idx]
          nextLeads[stageKey] = list.filter((_, i) => i !== idx)
        } else {
          nextLeads[stageKey] = list
        }
      }
      if (!movingLead) return { prev }
      const updated: KanbanLead = { ...movingLead, status }
      nextLeads[status] = [updated, ...(nextLeads[status] ?? [])]
      qc.setQueryData<KanbanBoardResponse>(queryKey, { ...prev, leads: nextLeads })
      return { prev }
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(queryKey, ctx.prev)
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey })
    },
  })
}
