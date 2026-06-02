// hooks/useTransferRequests.ts
// Reforma F3 — transferências consensuais de lead entre agentes.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'

export interface TransferRequest {
  id: number
  leadId: number
  status: 'pending' | 'accepted' | 'rejected' | 'cancelled' | 'expired'
  reason: string | null
  response: string | null
  requestedAt: string
  respondedAt: string | null
  expiresAt: string
  fromUser: { id: number; name: string; email: string }
  toUser: { id: number; name: string; email: string }
  lead: { id: number; nome: string | null; empresa: string | null; whatsapp: string | null }
}

export interface CreateTransferInput {
  leadId: number
  toUserId: number
  reason?: string
}

export function useIncomingTransferCount() {
  return useQuery({
    queryKey: ['transfer-requests', 'incoming-count'],
    queryFn: () => api.get<{ count: number }>('/atendimento/transfer-requests/incoming/count'),
    staleTime: 15_000,
    refetchInterval: 30_000,
  })
}

export function useTransferRequests(direction: 'incoming' | 'outgoing' = 'incoming', status: string = 'pending') {
  return useQuery({
    queryKey: ['transfer-requests', direction, status],
    queryFn: () =>
      api.get<{ requests: TransferRequest[]; direction: string; status: string }>(
        `/atendimento/transfer-requests?direction=${direction}&status=${status}`,
      ),
    staleTime: 10_000,
  })
}

export function useCreateTransferRequest() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateTransferInput) =>
      api.post<{ request: TransferRequest }>('/atendimento/transfer-requests', input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['transfer-requests'] })
      qc.invalidateQueries({ queryKey: ['leads'] })
    },
  })
}

export function useAcceptTransferRequest() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, response }: { id: number; response?: string }) =>
      api.post<{ ok: boolean }>(`/atendimento/transfer-requests/${id}/accept`, { response }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['transfer-requests'] })
      qc.invalidateQueries({ queryKey: ['leads'] })
      qc.invalidateQueries({ queryKey: ['kanban'] })
      qc.invalidateQueries({ queryKey: ['atendimento'] })
    },
  })
}

export function useRejectTransferRequest() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, response }: { id: number; response?: string }) =>
      api.post<{ ok: boolean }>(`/atendimento/transfer-requests/${id}/reject`, { response }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['transfer-requests'] }),
  })
}

export function useCancelTransferRequest() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) =>
      api.post<{ ok: boolean }>(`/atendimento/transfer-requests/${id}/cancel`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['transfer-requests'] }),
  })
}
