import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'

// ─── Tipos espelhando o schema (B6) ──────────────────────

export interface CadenceStep {
  id: number
  order: number
  dayOffset: number
  hourOffset: number
  channel: string
  templateId: number | null
  isManual: boolean
  isBreakUp: boolean
  conditionJson: unknown
  positionX?: number | null | undefined
  positionY?: number | null | undefined
  nextStepId?: number | null | undefined
  altStepId?: number | null | undefined
}

export interface SalesCadence {
  id: number
  name: string
  description: string | null
  status: string // draft | active | paused | archived
  triggerMode: string // manual | filter
  pauseOnReply: boolean
  exitOnConversion: boolean
  exitOnStatuses: string[] | null
  ownerId: number | null
  teamId: number | null
  team: { id: number; name: string; slug: string; color: string } | null
  createdAt: string
  updatedAt: string
  _count: { steps: number; enrollments: number }
}

export interface SalesCadenceDetail extends SalesCadence {
  steps: CadenceStep[]
}

export interface CadenceInput {
  name: string
  description?: string | null
  teamId?: number | null
  status?: string
  triggerMode?: string
  filterJson?: unknown
  pauseOnReply?: boolean
  exitOnConversion?: boolean
  exitOnStatuses?: string[] | null
  steps?: Omit<CadenceStep, 'id'>[]
}

// ─── IA: gerador de cadência ─────────────────────────────

export type AiCadenceGoal =
  | 'prospect' | 'follow_up_warm' | 'reactivate_dormant' | 'qualify_inbound'
  | 'book_meeting' | 'post_demo' | 'reengage_no_show' | 'event_invite'
  | 'breakup' | 'custom'

export type AiCadenceTone = 'consultative' | 'direct' | 'friendly' | 'formal' | 'urgent'
export type AiCadenceDuration = 'short' | 'medium' | 'long'
export type AiCadenceIntensity = 'light' | 'moderate' | 'aggressive'
export type AiCadenceChannel = 'whatsapp' | 'email' | 'sms' | 'call' | 'linkedin' | 'manual'

export interface AiCadenceGenerateInput {
  goal: AiCadenceGoal
  customGoalDescription?: string
  audience: { industry?: string; targetRole?: string; painPoints?: string }
  offer:    { productName?: string; valueProp?: string }
  tone: AiCadenceTone
  channels: AiCadenceChannel[]
  duration: AiCadenceDuration
  intensity: AiCadenceIntensity
  language?: 'pt-BR' | 'en'
  includeBreakup?: boolean
  refineFrom?: GeneratedCadence
  refineInstruction?: string
}

export interface GeneratedStep {
  order: number
  channel: AiCadenceChannel
  isManual: boolean
  isBreakUp: boolean
  dayOffset: number
  hourOffset: number
  template: {
    name: string
    subject?: string | null
    body: string
    variables: Array<{ key: string; label: string; default?: string }>
  }
  rationale: string
}

export interface GeneratedCadence {
  cadence: {
    name: string
    description: string
    pauseOnReply: boolean
    exitOnConversion: boolean
    exitOnStatuses: string[]
  }
  steps: GeneratedStep[]
  reasoning: {
    summary: string
    bestPractices: string[]
    recommendedNext: string
  }
}

export interface AiCadenceGenerateResult extends GeneratedCadence {
  inputTokens: number
  outputTokens: number
  costUsd: number
  provider: 'anthropic' | 'openai'
  model: string
}

export function useAiCadenceGenerate() {
  return useMutation({
    mutationFn: (input: AiCadenceGenerateInput) =>
      api.post<AiCadenceGenerateResult>('/admin/sales-cadences/ai-generate', input),
  })
}

export function useAiCadenceCommit() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { generated: GeneratedCadence; status?: 'draft' | 'active'; teamId?: number | null }) =>
      api.post<SalesCadenceDetail>('/admin/sales-cadences/ai-generate/commit', input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['sales-cadences'] })
    },
  })
}

// ─── Queries ─────────────────────────────────────────────

export function useSalesCadences() {
  return useQuery({
    queryKey: ['sales-cadences'],
    queryFn: () => api.get<{ items: SalesCadence[] }>('/admin/sales-cadences'),
    staleTime: 60_000,
  })
}

export function useSalesCadence(id: number | null) {
  return useQuery({
    queryKey: ['sales-cadence', id],
    queryFn: () => api.get<SalesCadenceDetail>(`/admin/sales-cadences/${id}`),
    enabled: id !== null,
    staleTime: 30_000,
  })
}

// ─── Mutations ───────────────────────────────────────────

export function useCreateSalesCadence() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: CadenceInput) => api.post<SalesCadenceDetail>('/admin/sales-cadences', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sales-cadences'] }),
  })
}

export function useUpdateSalesCadence() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...input }: { id: number } & Partial<CadenceInput>) =>
      api.put<SalesCadenceDetail>(`/admin/sales-cadences/${id}`, input),
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: ['sales-cadences'] })
      void qc.invalidateQueries({ queryKey: ['sales-cadence', vars.id] })
    },
  })
}

export function useReplaceSalesCadenceSteps(cadenceId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (steps: Omit<CadenceStep, 'id'>[]) =>
      api.put<{ steps: CadenceStep[] }>(`/admin/sales-cadences/${cadenceId}/steps`, { steps }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['sales-cadence', cadenceId] })
      void qc.invalidateQueries({ queryKey: ['sales-cadences'] })
    },
  })
}

export function useDeleteSalesCadence() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.delete(`/admin/sales-cadences/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sales-cadences'] }),
  })
}

// ─── Builder Visual (Fase 26): mutações individuais por step ───────────

export interface CreateCadenceStepInput {
  channel: string
  order?: number
  dayOffset?: number
  hourOffset?: number
  templateId?: number | null
  isManual?: boolean
  isBreakUp?: boolean
  conditionJson?: unknown
  positionX?: number
  positionY?: number
  nextStepId?: number | null
  altStepId?: number | null
}

export function useCreateCadenceStep(cadenceId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateCadenceStepInput) =>
      api.post<CadenceStep>(`/admin/sales-cadences/${cadenceId}/steps`, input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['sales-cadence', cadenceId] })
      void qc.invalidateQueries({ queryKey: ['sales-cadences'] })
    },
  })
}

export function useUpdateCadenceStep(cadenceId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ stepId, ...input }: { stepId: number } & Partial<CadenceStep>) =>
      api.put<CadenceStep>(`/admin/sales-cadences/${cadenceId}/steps/${stepId}`, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sales-cadence', cadenceId] }),
  })
}

export function useDeleteCadenceStep(cadenceId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (stepId: number) =>
      api.delete<{ ok: true }>(`/admin/sales-cadences/${cadenceId}/steps/${stepId}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['sales-cadence', cadenceId] })
      void qc.invalidateQueries({ queryKey: ['sales-cadences'] })
    },
  })
}

// ─── Canvas Save (buffer local com Save/Discard — Fase 26) ────────────

export interface CadenceCanvasSaveStep {
  id: number // negativo = novo, positivo = existente
  order?: number
  dayOffset?: number
  hourOffset?: number
  channel?: string
  templateId?: number | null
  isManual?: boolean
  isBreakUp?: boolean
  conditionJson?: unknown
  positionX?: number
  positionY?: number
  nextStepId?: number | null
  altStepId?: number | null
}

export interface CadenceCanvasSavePayload {
  steps: CadenceCanvasSaveStep[]
  deletedStepIds: number[]
}

export interface CadenceCanvasSaveResult {
  steps: CadenceStep[]
  idMap: Record<string, number>
}

export function useSaveCadenceCanvas(cadenceId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: CadenceCanvasSavePayload) =>
      api.post<CadenceCanvasSaveResult>(`/admin/sales-cadences/${cadenceId}/canvas-save`, payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['sales-cadence', cadenceId] })
      void qc.invalidateQueries({ queryKey: ['sales-cadences'] })
    },
  })
}

// ─── Stats pra modo Execução do canvas ────────────────────────────────

export interface CadenceExecutionStats {
  stepStats: { stepId: number; leadsHere: number; totalPassed: number }[]
  edgeStats: { fromStepId: number; toStepId: number; kind: 'next' | 'alt'; count: number }[]
  summary: Record<string, number>
}

export function useCadenceExecutionStats(id: number | null, enabled: boolean = false) {
  return useQuery({
    queryKey: ['sales-cadence-execution-stats', id],
    queryFn: () => api.get<CadenceExecutionStats>(`/admin/sales-cadences/${id}/execution-stats`),
    enabled: enabled && id !== null,
    refetchInterval: enabled ? 5000 : false,
    staleTime: 4000,
  })
}

export interface OperatorBreakdown {
  userId: number
  name: string | null
  email: string | null
  count: number
}

export interface CadenceMetrics {
  cadenceId: number
  enrolled: number
  byStatus: Record<string, number>
  byExitReason: Record<string, number>
  byReplyClass: Record<string, number>
  byChannel: Record<string, number>
  byOperator: OperatorBreakdown[]
  stepReach: { step: number; count: number }[]
  conversionRate: number
  conversionCount: number
}

export function useCadenceMetrics(id: number | null) {
  return useQuery({
    queryKey: ['sales-cadence-metrics', id],
    queryFn: () => api.get<CadenceMetrics>(`/admin/sales-cadences/${id}/metrics`),
    enabled: id !== null,
    staleTime: 30_000,
  })
}

export interface LeadCadenceEnrollment {
  id: number
  cadenceId: number
  leadId: number
  enrolledAt: string
  currentStep: number
  nextActionAt: string | null
  status: string // active | paused | completed | exited
  exitReason: string | null
  pauseReason: string | null
  lastReplyClass: string | null
  lastActionAt: string | null
  cadence: { id: number; name: string; status: string }
}

export function useLeadCadenceEnrollments(leadId: number | null) {
  return useQuery({
    queryKey: ['lead-cadence-enrollments', leadId],
    queryFn: () => api.get<{ items: LeadCadenceEnrollment[] }>(`/admin/leads/${leadId}/cadence-enrollments`),
    enabled: leadId !== null,
    staleTime: 30_000,
  })
}

export function useEnrollLeadInCadence() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ cadenceId, leadId }: { cadenceId: number; leadId: number }) =>
      api.post(`/admin/sales-cadences/${cadenceId}/enrollments`, { leadId }),
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: ['sales-cadence', vars.cadenceId] })
      void qc.invalidateQueries({ queryKey: ['sales-cadences'] })
      void qc.invalidateQueries({ queryKey: ['lead-cadence-enrollments', vars.leadId] })
    },
  })
}
