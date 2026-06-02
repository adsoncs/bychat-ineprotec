import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'

export interface AiJourneyConfig {
  id: number
  name: string
  aiStageEnabled: boolean
  aiStageAutoApply: boolean
  aiStageThreshold: number
  aiStagePrompt: string | null
  stages: Array<{ key: string; name: string; position: number }>
}

export interface StageSuggestion {
  id: number
  leadId: number
  funnelId: number
  fromStageKey: string | null
  suggestedStageKey: string
  confidence: number
  reasoning: string | null
  modelUsed: string | null
  status: 'pending' | 'applied' | 'rejected' | 'superseded'
  appliedAt: string | null
  decidedById: number | null
  decidedAt: string | null
  decisionNote: string | null
  createdAt: string
  lead?: { id: number; nome: string | null; whatsapp: string | null; status: string | null }
  funnel?: { id: number; name: string; stages: Array<{ key: string; name: string; color: string }> }
}

export function useAiJourneyConfig(funnelId: number | null) {
  return useQuery({
    queryKey: ['ai-journey-config', funnelId],
    queryFn: () => api.get<{ data: AiJourneyConfig }>(`/admin/ai-journey/config/${funnelId}`),
    enabled: funnelId !== null,
    staleTime: 30_000,
  })
}

export function useUpdateAiJourneyConfig() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ funnelId, ...input }: { funnelId: number; aiStageEnabled?: boolean; aiStageAutoApply?: boolean; aiStageThreshold?: number; aiStagePrompt?: string | null }) =>
      api.put<{ ok: true; data: AiJourneyConfig }>(`/admin/ai-journey/config/${funnelId}`, input),
    onSuccess: (_r, { funnelId }) => {
      void qc.invalidateQueries({ queryKey: ['ai-journey-config', funnelId] })
      void qc.invalidateQueries({ queryKey: ['funnels'] })
    },
  })
}

export function useRunAiJourney() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (leadId: number) => api.post<{ ok: true; queued: boolean }>(`/admin/ai-journey/run/${leadId}`, {}),
    onSuccess: (_r, leadId) => {
      void qc.invalidateQueries({ queryKey: ['lead-stage-suggestions', leadId] })
      void qc.invalidateQueries({ queryKey: ['ai-journey-suggestions'] })
    },
  })
}

export function useStageSuggestions(filters: { status?: string | undefined; funnelId?: number | undefined; limit?: number | undefined } = {}) {
  const p = new URLSearchParams()
  if (filters.status) p.set('status', filters.status)
  if (filters.funnelId) p.set('funnelId', String(filters.funnelId))
  if (filters.limit) p.set('limit', String(filters.limit))
  const qs = p.toString() ? `?${p.toString()}` : ''
  return useQuery({
    queryKey: ['ai-journey-suggestions', filters],
    queryFn: () => api.get<{ data: StageSuggestion[]; total: number }>(`/admin/ai-journey/suggestions${qs}`),
    staleTime: 20_000,
  })
}

export function useLeadStageSuggestions(leadId: number | null) {
  return useQuery({
    queryKey: ['lead-stage-suggestions', leadId],
    queryFn: () => api.get<{ data: StageSuggestion[] }>(`/admin/ai-journey/suggestions/by-lead/${leadId}`),
    enabled: leadId !== null,
    staleTime: 15_000,
  })
}

export function useApplySuggestion() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, note }: { id: number; note?: string }) =>
      api.post<{ ok: true }>(`/admin/ai-journey/suggestions/${id}/apply`, { note }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['ai-journey-suggestions'] })
      void qc.invalidateQueries({ queryKey: ['lead-stage-suggestions'] })
      void qc.invalidateQueries({ queryKey: ['leads'] })
    },
  })
}

export function useRejectSuggestion() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, note }: { id: number; note?: string }) =>
      api.post<{ ok: true }>(`/admin/ai-journey/suggestions/${id}/reject`, { note }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['ai-journey-suggestions'] })
      void qc.invalidateQueries({ queryKey: ['lead-stage-suggestions'] })
    },
  })
}
