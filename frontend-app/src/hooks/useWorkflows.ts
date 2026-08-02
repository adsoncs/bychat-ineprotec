import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'

export interface WorkflowTriggerConfig {
  stageKey?: string | undefined
  oldValue?: string | undefined
  newValue?: string | undefined
  tagName?: string | undefined
  channel?: string | undefined
  source?: string | undefined
  chatbotId?: number | undefined
  /** Fase 23.1: filtro de objeção em lead.lost (lista de LossReason.id). */
  reasonIds?: number[] | undefined
  /**
   * Formulário de origem do lead (meeting.scheduled). Aceita um id ou uma
   * LISTA — um workflow só cobre vários formulários, em vez de exigir um
   * duplicado por formulário (e esquecer os novos).
   */
  formId?: number | number[] | undefined
}

export interface Workflow {
  id: number
  name: string
  description: string | null
  triggerEvent: string
  triggerConfig: WorkflowTriggerConfig | null
  active: boolean
  pauseOnReply: boolean
  reentryPolicy: string
  goalEvent: string | null
  goalConfig: Record<string, unknown> | null
  funnelId: number | null
  chatbotId: number | null
  priority: number
  createdAt: string
  updatedAt: string
  _count: { steps: number; executions: number }
}

export interface WorkflowExecution {
  id: number
  workflowId: number
  leadId: number | null
  status: string
  currentStepId: number | null
  startedAt: string
  completedAt: string | null
  failedAt: string | null
  errorMessage: string | null
}

export interface WorkflowInput {
  name: string
  description?: string | null | undefined
  triggerEvent?: string | undefined
  triggerConfig?: WorkflowTriggerConfig | null | undefined
  active?: boolean | undefined
  pauseOnReply?: boolean | undefined
  reentryPolicy?: string | undefined
  goalEvent?: string | null | undefined
  goalConfig?: Record<string, unknown> | null | undefined
  funnelId?: number | null | undefined
  chatbotId?: number | null | undefined
  priority?: number | undefined
}

export function useWorkflows() {
  return useQuery({
    queryKey: ['workflows'],
    queryFn: () => api.get<{ workflows: Workflow[] }>('/admin/workflows'),
    staleTime: 60_000,
  })
}

export function useWorkflowExecutions(workflowId: number | null) {
  return useQuery({
    queryKey: ['workflow-executions', workflowId],
    queryFn: () => api.get<{ executions: WorkflowExecution[] }>(`/admin/workflows/${workflowId}/executions?limit=20`),
    enabled: workflowId !== null,
    staleTime: 30_000,
  })
}

export function useCreateWorkflow() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: WorkflowInput) => api.post<Workflow>('/admin/workflows', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['workflows'] }),
  })
}

export function useUpdateWorkflow() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...input }: { id: number } & Partial<WorkflowInput>) =>
      api.put<Workflow>(`/admin/workflows/${id}`, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['workflows'] }),
  })
}

export function useToggleWorkflow() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.put<{ ok: true }>(`/admin/workflows/${id}/toggle`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['workflows'] }),
  })
}

export function useDuplicateWorkflow() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.post<Workflow>(`/admin/workflows/${id}/duplicate`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['workflows'] }),
  })
}

export type WorkflowStepType = 'action' | 'wait' | 'condition' | 'branch' | 'goal'

export interface WorkflowStep {
  id: number
  workflowId: number
  type: string
  name: string
  config: unknown
  position: number
  positionX?: number | null
  positionY?: number | null
  nextStepId: number | null
  altStepId: number | null
}

export interface WorkflowDetail extends Workflow {
  steps: WorkflowStep[]
}

export function useWorkflow(id: number | null) {
  return useQuery({
    queryKey: ['workflow', id],
    queryFn: () => api.get<WorkflowDetail>(`/admin/workflows/${id}`),
    enabled: id !== null,
    staleTime: 30_000,
  })
}

export interface CreateStepInput {
  type: string
  name: string
  config?: unknown
  positionX?: number
  positionY?: number
}

// ══════════════════════════════════════════════
// Estatísticas de execução (modo Canvas → Execução)
// ══════════════════════════════════════════════

export interface WorkflowExecutionStats {
  stepStats: { stepId: number; leadsHere: number; totalPassed: number }[]
  edgeStats: { fromStepId: number; toStepId: number; kind: 'next' | 'alt'; count: number }[]
  summary: Record<string, number>
}

export function useWorkflowExecutionStats(id: number | null, enabled: boolean = false) {
  return useQuery({
    queryKey: ['workflow-execution-stats', id],
    queryFn: () => api.get<WorkflowExecutionStats>(`/admin/workflows/${id}/execution-stats`),
    enabled: enabled && id !== null,
    refetchInterval: enabled ? 5000 : false,
    staleTime: 4000,
  })
}

export function useCreateWorkflowStep(workflowId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateStepInput) =>
      api.post<WorkflowStep>(`/admin/workflows/${workflowId}/steps`, input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['workflow', workflowId] })
      void qc.invalidateQueries({ queryKey: ['workflows'] })
    },
  })
}

export function useUpdateWorkflowStep(workflowId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ stepId, ...input }: { stepId: number } & Partial<WorkflowStep>) =>
      api.put<WorkflowStep>(`/admin/workflows/${workflowId}/steps/${stepId}`, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['workflow', workflowId] }),
  })
}

export function useDeleteWorkflowStep(workflowId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (stepId: number) =>
      api.delete<{ ok: true }>(`/admin/workflows/${workflowId}/steps/${stepId}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['workflow', workflowId] })
      void qc.invalidateQueries({ queryKey: ['workflows'] })
    },
  })
}

export function useReorderWorkflowSteps(workflowId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (order: { id: number; position: number }[]) =>
      api.put<{ ok: true }>(`/admin/workflows/${workflowId}/steps/reorder`, { order }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['workflow', workflowId] }),
  })
}

// ══════════════════════════════════════════════
// Canvas Save (buffer local com Save/Discard — Fase 26)
// ══════════════════════════════════════════════

export interface CanvasSaveStep {
  id: number // negativo = novo (gerado client-side); positivo = existente
  type?: string
  name?: string
  config?: unknown
  position?: number
  positionX?: number
  positionY?: number
  nextStepId?: number | null
  altStepId?: number | null
}

export interface CanvasSavePayload {
  steps: CanvasSaveStep[]
  deletedStepIds: number[]
}

export interface CanvasSaveResult {
  steps: WorkflowStep[]
  idMap: Record<string, number> // tempId (negativo) → realId
}

export function useSaveWorkflowCanvas(workflowId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: CanvasSavePayload) =>
      api.post<CanvasSaveResult>(`/admin/workflows/${workflowId}/canvas-save`, payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['workflow', workflowId] })
      void qc.invalidateQueries({ queryKey: ['workflows'] })
    },
  })
}

export function useDeleteWorkflow() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.delete(`/admin/workflows/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['workflows'] }),
  })
}
