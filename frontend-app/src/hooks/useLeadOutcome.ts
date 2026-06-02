import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'

export interface LossReason {
  id: number
  name: string
  color: string | null
  position: number
  active: boolean
  createdAt: string
  updatedAt: string
}

const KEY_LOSS_REASONS = ['loss-reasons'] as const

function inv(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: ['leads'] })
  void qc.invalidateQueries({ queryKey: ['lead'] })
  void qc.invalidateQueries({ queryKey: ['kanban'] })
  void qc.invalidateQueries({ queryKey: ['activities'] })
  void qc.invalidateQueries({ queryKey: ['lead-activities'] })
}

// ── Loss reasons ─────────────────────────────────────────

export function useLossReasons(opts?: { includeInactive?: boolean }) {
  return useQuery({
    queryKey: opts?.includeInactive ? ['loss-reasons', 'all'] : KEY_LOSS_REASONS,
    queryFn: () =>
      api.get<{ data: LossReason[] }>(
        opts?.includeInactive ? '/loss-reasons?active=all' : '/loss-reasons',
      ),
    staleTime: 60_000,
  })
}

export function useCreateLossReason() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { name: string; color?: string | null; position?: number; active?: boolean }) =>
      api.post<{ data: LossReason }>('/loss-reasons', input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['loss-reasons'] })
    },
  })
}

export function useUpdateLossReason() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...input }: { id: number; name?: string; color?: string | null; position?: number; active?: boolean }) =>
      api.put<{ data: LossReason }>(`/loss-reasons/${id}`, input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['loss-reasons'] })
    },
  })
}

export function useDeleteLossReason() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.delete<{ ok?: boolean; data?: LossReason; softDeleted?: boolean }>(`/loss-reasons/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['loss-reasons'] })
    },
  })
}

// ── Lead outcome (won/lost/reopen) ───────────────────────

export interface MarkWonInput {
  id: number
  value?: number | null
  note?: string | null
}

export interface MarkLostInput {
  id: number
  reasonId?: number | null
  note?: string | null
}

export function useMarkLeadWon() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, value, note }: MarkWonInput) =>
      api.post<{ ok: true; cancelledActivities: number }>(`/bychat/leads/${id}/won`, { value, note }),
    onSuccess: () => inv(qc),
  })
}

export function useMarkLeadLost() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, reasonId, note }: MarkLostInput) =>
      api.post<{ ok: true; cancelledActivities: number }>(`/bychat/leads/${id}/lost`, { reasonId, note }),
    onSuccess: () => inv(qc),
  })
}

export function useReopenLead() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) =>
      api.post<{ ok: true; previousOutcome: string | null }>(`/bychat/leads/${id}/reopen`, {}),
    onSuccess: () => inv(qc),
  })
}

export function useBulkMarkWon() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { ids: number[]; value?: number | null; note?: string | null }) =>
      api.post<{ ok: true; processed: number; failed: number }>('/bychat/leads/bulk/won', input),
    onSuccess: () => inv(qc),
  })
}

export function useBulkMarkLost() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { ids: number[]; reasonId?: number | null; note?: string | null }) =>
      api.post<{ ok: true; processed: number; failed: number }>('/bychat/leads/bulk/lost', input),
    onSuccess: () => inv(qc),
  })
}
