// hooks/useRouting.ts
// Lead Routing F3 — hooks react-query para o painel /app/cadastros/routing.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'

export interface RoutingAgent {
  id: number
  name: string
  email: string
  role: 'SUPERADMIN' | 'ADMIN' | 'MANAGER' | 'VIEWER'
  active: boolean
  workStatus: string
  capacity: number
  isAgent: boolean
  lastSeenAt: string | null
  agentProfile: {
    id: number
    active: boolean
    weight: number
    maxDailyLeads: number | null
    vacationUntil: string | null
    notes: string | null
    updatedAt: string
  } | null
  openLeadCount: number
  teamCount: number
}

export interface WorkingHourEntry {
  id?: number
  weekday: number
  startTime: string
  endTime: string
  timezone: string
}

// ── Agentes ──────────────────────────────────────────────────────────
export function useAgents() {
  return useQuery({
    queryKey: ['routing', 'agents'],
    queryFn: () => api.get<{ agents: RoutingAgent[] }>('/admin/agents'),
    staleTime: 15_000,
  })
}

export interface UpdateAgentInput {
  isAgent?: boolean
  weight?: number
  maxDailyLeads?: number | null
  vacationUntil?: string | null
  notes?: string | null
  active?: boolean
}

export function useUpdateAgent(userId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: UpdateAgentInput) =>
      api.patch<{ agent: RoutingAgent }>(`/admin/agents/${userId}`, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['routing', 'agents'] })
      qc.invalidateQueries({ queryKey: ['routing', 'agent', userId] })
    },
  })
}

// ── Working hours do agente ──────────────────────────────────────────
export function useAgentWorkingHours(userId: number | null) {
  return useQuery({
    queryKey: ['routing', 'agent-wh', userId],
    queryFn: () =>
      api.get<{ workingHours: WorkingHourEntry[] }>(`/admin/agents/${userId}/working-hours`),
    enabled: !!userId,
    staleTime: 15_000,
  })
}

export function useSaveAgentWorkingHours(userId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (workingHours: WorkingHourEntry[]) =>
      api.put<{ workingHours: WorkingHourEntry[] }>(`/admin/agents/${userId}/working-hours`, {
        workingHours,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['routing', 'agent-wh', userId] })
    },
  })
}

// ── Skills do agente (F5) ────────────────────────────────────────────
export interface SkillEntry {
  id?: number
  skill: string
  level: number
}

export function useAgentSkills(userId: number | null) {
  return useQuery({
    queryKey: ['routing', 'agent-skills', userId],
    queryFn: () =>
      api.get<{ skills: SkillEntry[] }>(`/admin/agents/${userId}/skills`),
    enabled: !!userId,
    staleTime: 15_000,
  })
}

export function useSaveAgentSkills(userId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (skills: SkillEntry[]) =>
      api.put<{ skills: SkillEntry[] }>(`/admin/agents/${userId}/skills`, { skills }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['routing', 'agent-skills', userId] })
      qc.invalidateQueries({ queryKey: ['routing', 'skills-catalog'] })
    },
  })
}

export function useSkillsCatalog() {
  return useQuery({
    queryKey: ['routing', 'skills-catalog'],
    queryFn: () => api.get<{ skills: string[] }>('/admin/routing/skills'),
    staleTime: 60_000,
  })
}

// ── Working hours do setor ───────────────────────────────────────────
export function useTeamWorkingHours(teamId: number | null) {
  return useQuery({
    queryKey: ['routing', 'team-wh', teamId],
    queryFn: () =>
      api.get<{ workingHoursEnabled: boolean; workingHours: WorkingHourEntry[] }>(
        `/admin/teams/${teamId}/working-hours`,
      ),
    enabled: !!teamId,
    staleTime: 15_000,
  })
}

export function useSaveTeamWorkingHours(teamId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { workingHours: WorkingHourEntry[]; workingHoursEnabled?: boolean }) =>
      api.put<{ workingHoursEnabled: boolean; workingHours: WorkingHourEntry[] }>(
        `/admin/teams/${teamId}/working-hours`,
        input,
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['routing', 'team-wh', teamId] })
    },
  })
}

// ── Política global ──────────────────────────────────────────────────
export function useRoutingFeatureFlag() {
  return useQuery({
    queryKey: ['routing', 'feature-flag'],
    queryFn: () => api.get<{ enabled: boolean; label: string }>('/admin/routing/feature-flag'),
    staleTime: 30_000,
  })
}

export function useToggleRoutingFeatureFlag() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (enabled: boolean) =>
      api.post<{ enabled: boolean }>('/admin/routing/feature-flag', { enabled }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['routing', 'feature-flag'] })
    },
  })
}

export function useOutOfHoursTeam() {
  return useQuery({
    queryKey: ['routing', 'ooh-team'],
    queryFn: () => api.get<{ teamId: number | null }>('/admin/routing/out-of-hours-team'),
    staleTime: 30_000,
  })
}

export function useSetOutOfHoursTeam() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (teamId: number | null) =>
      api.post<{ teamId: number | null }>('/admin/routing/out-of-hours-team', { teamId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['routing', 'ooh-team'] })
    },
  })
}

// ── Times (já existe useTeams? — reuso simples direto) ───────────────
export interface RoutingTeam {
  id: number
  name: string
  slug: string
  color: string
  active: boolean
  routingMode: string
  memberCount: number
}

export function useRoutingTeams() {
  return useQuery({
    queryKey: ['routing', 'teams'],
    queryFn: () => api.get<{ teams: RoutingTeam[] }>('/admin/teams'),
    staleTime: 30_000,
  })
}

// ── SLA (F10) ────────────────────────────────────────────────────────
export function useSlaTarget() {
  return useQuery({
    queryKey: ['routing', 'sla', 'target'],
    queryFn: () => api.get<{ minutes: number }>('/admin/routing/sla'),
    staleTime: 30_000,
  })
}

export function useSetSlaTarget() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (minutes: number) => api.post<{ minutes: number }>('/admin/routing/sla', { minutes }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['routing', 'sla'] }),
  })
}

export interface SlaAgentMetric {
  userId: number
  name: string
  attended: number
  responded: number
  pending: number
  slaMet: number
  slaMissed: number
  slaPercent: number | null
  avgFirstResponseMin: number | null
}

export interface SlaMetricsResponse {
  rangeDays: number
  slaMinutes: number
  totals: {
    attended: number
    responded: number
    slaMet: number
    slaMissed: number
    slaPercent: number | null
  }
  agents: SlaAgentMetric[]
}

export function useSlaMetrics(period: { from: string; to: string }) {
  const q = `from=${period.from}&to=${period.to}`
  return useQuery({
    queryKey: ['routing', 'sla', 'metrics', q],
    queryFn: () => api.get<SlaMetricsResponse>(`/admin/routing/sla/metrics?${q}`),
    staleTime: 60_000,
  })
}

// ── Shift handover (F6) ──────────────────────────────────────────────
export interface ShiftConfig {
  enabled: boolean
  toleranceMinutes: number
}

export function useShiftConfig() {
  return useQuery({
    queryKey: ['routing', 'shift'],
    queryFn: () => api.get<ShiftConfig>('/admin/routing/shift'),
    staleTime: 30_000,
  })
}

export function useUpdateShiftConfig() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: Partial<ShiftConfig>) =>
      api.post<{ ok: boolean }>('/admin/routing/shift', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['routing', 'shift'] }),
  })
}

// ── Transfer timeout (F6) ────────────────────────────────────────────
export function useTransferTimeout() {
  return useQuery({
    queryKey: ['routing', 'transfer-timeout'],
    queryFn: () => api.get<{ hours: number }>('/admin/routing/transfer-timeout'),
    staleTime: 30_000,
  })
}

export function useSetTransferTimeout() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (hours: number) =>
      api.post<{ hours: number }>('/admin/routing/transfer-timeout', { hours }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['routing', 'transfer-timeout'] }),
  })
}

// ── Módulos do sistema (F6) ──────────────────────────────────────────
// Reuso do endpoint existente /api/admin/modules + listModulesWithStatus.
// Estrutura combina ModuleDefinition (id/name/category/icon/pages/core/defaultEnabled)
// com flag enabled + usage counts. Os campos active/isCore espelham core/enabled.
export interface SystemModule {
  id: string
  name: string
  category: string
  icon: string
  core: boolean
  defaultEnabled: boolean
  pages: string[]
  enabled: boolean
  usage?: { total: number; items?: Array<{ table: string; count: number }> }
}

export function useSystemModules() {
  return useQuery({
    queryKey: ['admin', 'modules'],
    queryFn: () => api.get<{ modules: SystemModule[] }>('/admin/modules'),
    staleTime: 30_000,
  })
}

export function useToggleSystemModule() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, enabled, confirmName }: { id: string; enabled: boolean; confirmName?: string }) =>
      api.post<{ ok: boolean; enabled: boolean }>(`/admin/modules/${id}/toggle`, { enabled, confirmName }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'modules'] })
      qc.invalidateQueries({ queryKey: ['my-permissions'] })
    },
  })
}

// ── Simulator + Logs (F9) ────────────────────────────────────────────
export interface RoutingSimContext {
  source?: string
  utmSource?: string
  utmMedium?: string
  utmCampaign?: string
  utmContent?: string
  utmTerm?: string
  formId?: number | null
  chatbotId?: number | null
  instanceName?: string
  tag?: string
}

export interface SimulationConditionResult {
  field: string
  op: string
  expected: unknown
  fieldValue: unknown
  matched: boolean
}

export interface SimulationRuleResult {
  ruleId: number
  order: number
  name: string
  enabled: boolean
  matched: boolean
  skipped: 'disabled' | 'invalid' | null
  action: RuleAction | null
  conditions: SimulationConditionResult[]
}

export interface RoutingDecision {
  teamId: number | null
  userId: number | null
  ruleId: number | null
  ruleName: string | null
}

export interface SimulationResponse {
  inspection: {
    context: RoutingSimContext
    rules: SimulationRuleResult[]
    winnerRuleId: number | null
  }
  decision: RoutingDecision
}

export function useSimulateRouting() {
  return useMutation({
    mutationFn: (context: RoutingSimContext) =>
      api.post<SimulationResponse>('/admin/routing/simulate', { context }),
  })
}

export interface RoutingLogEntry {
  id: number
  leadId: number
  type: string
  title: string
  metadata: Record<string, unknown> | null
  createdAt: string
  lead: { id: number; empresa: string | null; nome: string | null; assignedUserId: number | null; teamId: number | null } | null
}

export function useRoutingLogs(filterType: 'all' | 'rule' | 'escalation' = 'all', limit = 50) {
  return useQuery({
    queryKey: ['routing', 'logs', filterType, limit],
    queryFn: () => api.get<{ logs: RoutingLogEntry[] }>(`/admin/routing/logs?type=${filterType}&limit=${limit}`),
    staleTime: 10_000,
  })
}

// ── Escalation (F8) ──────────────────────────────────────────────────
export interface EscalationConfig {
  enabled: boolean
  minutes: number
  reassignOnOffline: boolean
}

export function useEscalationConfig() {
  return useQuery({
    queryKey: ['routing', 'escalation'],
    queryFn: () => api.get<EscalationConfig>('/admin/routing/escalation'),
    staleTime: 30_000,
  })
}

export function useUpdateEscalationConfig() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: Partial<EscalationConfig>) =>
      api.post<{ ok: boolean }>('/admin/routing/escalation', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['routing', 'escalation'] }),
  })
}

// ── Routing Rules (F4) ───────────────────────────────────────────────
export type RuleConditionOp = 'eq' | 'neq' | 'contains' | 'startsWith' | 'in' | 'notIn' | 'exists' | 'missing'

export interface RuleCondition {
  field: string
  op: RuleConditionOp
  value: unknown
}

export type RuleAction =
  | { type: 'team'; teamId: number }
  | { type: 'user'; userId: number }
  | { type: 'skill'; skill: string; teamId: number }

export interface RoutingRule {
  id: number
  order: number
  name: string
  enabled: boolean
  conditions: RuleCondition[]
  action: RuleAction
  description: string | null
  matchedCount: number
  lastMatchedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface RoutingRuleInput {
  name: string
  enabled?: boolean
  conditions: RuleCondition[]
  action: RuleAction
  description?: string | null
}

export function useRoutingRules() {
  return useQuery({
    queryKey: ['routing', 'rules'],
    queryFn: () => api.get<{ rules: RoutingRule[] }>('/admin/routing/rules'),
    staleTime: 15_000,
  })
}

export function useCreateRoutingRule() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: RoutingRuleInput) =>
      api.post<{ rule: RoutingRule }>('/admin/routing/rules', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['routing', 'rules'] }),
  })
}

export function useUpdateRoutingRule(ruleId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: Partial<RoutingRuleInput>) =>
      api.patch<{ rule: RoutingRule }>(`/admin/routing/rules/${ruleId}`, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['routing', 'rules'] }),
  })
}

export function useDeleteRoutingRule() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (ruleId: number) =>
      api.delete<{ deleted: boolean }>(`/admin/routing/rules/${ruleId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['routing', 'rules'] }),
  })
}

// Toggle simples de enabled — não exige conhecer o ruleId no construtor (recebe no mutate).
export function useToggleRoutingRule() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ ruleId, enabled }: { ruleId: number; enabled: boolean }) =>
      api.patch<{ rule: RoutingRule }>(`/admin/routing/rules/${ruleId}`, { enabled }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['routing', 'rules'] }),
  })
}

export function useReorderRoutingRules() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (ruleIds: number[]) =>
      api.post<{ ok: boolean }>('/admin/routing/rules/reorder', { ruleIds }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['routing', 'rules'] }),
  })
}
