import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'

export type DueMode = 'immediate' | 'hours' | 'days' | 'business_days' | 'lead_defined'
export type AssigneeMode = 'lead_owner' | 'team' | 'user' | 'round_robin' | 'creator'

export interface ActivityTemplate {
  id: number
  code: string
  name: string
  defaultDescription: string | null
  type: string
  messageTemplateId: number | null
  dueMode: DueMode
  dueValue: number
  assigneeMode: AssigneeMode
  assigneeTeamId: number | null
  assigneeUserId: number | null
  active: boolean
}

export interface StatusSummaryActivity {
  summaryId: number
  activityTemplateId: number
  dueOverrideMode: DueMode | null
  dueOverrideValue: number | null
  titleOverride: string | null
  order: number
  activityTemplate: ActivityTemplate
}

export interface StatusSummary {
  id: number
  code: string
  name: string
  helpText: string | null
  funnelId: number | null
  sector: string | null
  color: string | null
  position: number
  active: boolean
  targetFunnelId: number | null
  targetStageKey: string | null
  setOutcome: 'won' | 'lost' | null
  requireLossReason: boolean
  defaultLossReasonId: number | null
  temperature: 'quente' | 'morno' | 'frio' | null
  closeOpenActivities: boolean
  enrollCadenceId: number | null
  nextSummaryCode: string | null
  autoAdvanceOnDue: boolean
  allowedFromStages: string[] | null
  requiredFields: string[] | null
  activities: StatusSummaryActivity[]
}

export interface LeadStatusHistoryEntry {
  id: number
  leadId: number
  fromCode: string | null
  toCode: string
  changedAt: string
  source: string | null
  note: string | null
  effects: {
    movedStage: { from: string | null; to: string | null } | null
    createdActivityIds: number[]
    closedActivities: number
    outcomeApplied: 'won' | 'lost' | null
  } | null
  toSummary: { id: number; code: string; name: string; color: string | null; sector: string | null } | null
  changedByUser: { id: number; name: string | null; email: string } | null
}

export interface ApplySummaryResult {
  leadId: number
  summaryId: number
  code: string
  previousCode: string | null
  movedStage: { from: string | null; to: string | null } | null
  createdActivityIds: number[]
  closedActivities: number
  outcomeApplied: 'won' | 'lost' | null
  enrolledCadenceId: number | null
}

// ── Catálogo de resumos ──────────────────────────────────

export function useStatusSummaries(opts?: { funnelId?: number | null; includeInactive?: boolean }) {
  const params = new URLSearchParams()
  if (opts?.funnelId != null) params.set('funnelId', String(opts.funnelId))
  if (opts?.includeInactive) params.set('active', 'all')
  const qs = params.toString()

  return useQuery({
    queryKey: ['status-summaries', opts?.funnelId ?? null, opts?.includeInactive ?? false],
    queryFn: () => api.get<{ data: StatusSummary[] }>(`/status-summaries${qs ? `?${qs}` : ''}`),
    staleTime: 60_000,
  })
}

export function useCreateStatusSummary() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: Partial<StatusSummary>) =>
      api.post<{ data: StatusSummary }>('/status-summaries', input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['status-summaries'] }),
  })
}

export function useUpdateStatusSummary() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...input }: Partial<StatusSummary> & { id: number }) =>
      api.put<{ data: StatusSummary }>(`/status-summaries/${id}`, input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['status-summaries'] }),
  })
}

export function useDeleteStatusSummary() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.delete<{ ok: boolean }>(`/status-summaries/${id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['status-summaries'] }),
  })
}

export function useSetSummaryActivities() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, activities }: {
      id: number
      activities: Array<{
        activityTemplateId: number
        dueOverrideMode?: DueMode | null
        dueOverrideValue?: number | null
        titleOverride?: string | null
        order?: number
      }>
    }) => api.put<{ data: StatusSummary }>(`/status-summaries/${id}/activities`, { activities }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['status-summaries'] }),
  })
}

// ── Catálogo de templates de atividade ───────────────────

export function useActivityTemplates(opts?: { includeInactive?: boolean }) {
  return useQuery({
    queryKey: ['activity-templates', opts?.includeInactive ?? false],
    queryFn: () =>
      api.get<{ data: ActivityTemplate[] }>(
        `/activity-templates${opts?.includeInactive ? '?active=all' : ''}`,
      ),
    staleTime: 60_000,
  })
}

export function useCreateActivityTemplate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: Partial<ActivityTemplate>) =>
      api.post<{ data: ActivityTemplate }>('/activity-templates', input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['activity-templates'] }),
  })
}

export function useUpdateActivityTemplate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...input }: Partial<ActivityTemplate> & { id: number }) =>
      api.put<{ data: ActivityTemplate }>(`/activity-templates/${id}`, input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['activity-templates'] }),
  })
}

export function useDeleteActivityTemplate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.delete<{ ok: boolean }>(`/activity-templates/${id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['activity-templates'] }),
  })
}

// ── Aplicar resumo a um lead ─────────────────────────────

export function useApplyStatusSummary() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ leadId, ...input }: {
      leadId: number
      code: string
      note?: string
      lossReasonId?: number | null
      dueAt?: string | null
    }) => api.post<{ data: ApplySummaryResult }>(`/leads/${leadId}/status-summary`, input),
    onSuccess: (_res, vars) => {
      // O resumo mexe em etapa, atividades e outcome de uma vez — invalida tudo
      // que reflete o estado do lead, senão a tela mostra o mundo antigo.
      void qc.invalidateQueries({ queryKey: ['lead', vars.leadId] })
      void qc.invalidateQueries({ queryKey: ['leads'] })
      void qc.invalidateQueries({ queryKey: ['kanban'] })
      void qc.invalidateQueries({ queryKey: ['activities'] })
      void qc.invalidateQueries({ queryKey: ['lead-activities'] })
      void qc.invalidateQueries({ queryKey: ['lead-status-history', vars.leadId] })
    },
  })
}

// ── Relatório por resumo ─────────────────────────────────

export interface SummaryReportRow {
  id: number
  code: string
  name: string
  color: string | null
  sector: string | null
  temperature: 'quente' | 'morno' | 'frio' | null
  /** Vezes que o resumo foi aplicado no período. */
  applied: number
  /** Leads parados neste resumo agora (não depende do período). */
  currentLeads: number
  /** Aplicado menos os que já saíram — quantos ainda não avançaram. */
  stillHere: number
  /** Para onde foram, do mais frequente ao menos. */
  nextSummaries: Array<{ code: string; count: number }>
}

export function useStatusSummaryReport(
  funnelId: number | null,
  filters?: { from?: string; to?: string },
) {
  const params = new URLSearchParams()
  if (funnelId != null) params.set('funnelId', String(funnelId))
  if (filters?.from) params.set('from', filters.from)
  if (filters?.to) params.set('to', filters.to)
  const qs = params.toString()

  return useQuery({
    queryKey: ['status-summary-report', funnelId, filters?.from, filters?.to],
    queryFn: () => api.get<{ data: SummaryReportRow[] }>(`/status-summaries/report${qs ? `?${qs}` : ''}`),
    enabled: funnelId != null,
    staleTime: 30_000,
  })
}

export function useLeadStatusHistory(leadId: number | null) {
  return useQuery({
    queryKey: ['lead-status-history', leadId],
    queryFn: () => api.get<{ data: LeadStatusHistoryEntry[] }>(`/leads/${leadId}/status-history`),
    enabled: leadId != null,
    staleTime: 30_000,
  })
}
