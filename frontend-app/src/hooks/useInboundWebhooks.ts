import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'

export interface InboundMappingRule {
  source: string
  target: string
}

export interface InboundWebhook {
  id: number
  token: string
  name: string
  description: string | null
  active: boolean
  defaultFunnelId: number | null
  defaultStageKey: string | null
  defaultTeamId: number | null
  defaultSource: string | null
  mapping: InboundMappingRule[]
  totalReceived: number
  totalErrors: number
  lastReceivedAt: string | null
  lastError: string | null
  createdAt: string
  updatedAt: string
}

export interface InboundWebhookInput {
  name: string
  description?: string | null
  active?: boolean
  defaultFunnelId?: number | null
  defaultStageKey?: string | null
  defaultTeamId?: number | null
  defaultSource?: string | null
  mapping: InboundMappingRule[]
}

export interface InboundWebhookHit {
  id: number
  webhookId: number
  receivedAt: string
  ip: string | null
  userAgent: string | null
  payload: unknown
  mappedData: { fields: Record<string, string>; customFields: Record<string, unknown> } | null
  success: boolean
  leadId: number | null
  error: string | null
}

export interface LeadFieldOption {
  target: string
  label: string
  type?: string
}

export function useInboundWebhooks() {
  return useQuery({
    queryKey: ['inbound-webhooks'],
    queryFn: () => api.get<{ data: InboundWebhook[] }>('/admin/inbound-webhooks'),
    staleTime: 30_000,
  })
}

export function useInboundWebhookLeadFields() {
  return useQuery({
    queryKey: ['inbound-webhook-lead-fields'],
    queryFn: () => api.get<{ native: LeadFieldOption[]; customFields: LeadFieldOption[]; tracking?: LeadFieldOption[] }>(
      '/admin/inbound-webhooks/lead-fields',
    ),
    staleTime: 5 * 60_000,
  })
}

export function useCreateInboundWebhook() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: InboundWebhookInput) =>
      api.post<{ data: InboundWebhook }>('/admin/inbound-webhooks', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['inbound-webhooks'] }),
  })
}

export function useUpdateInboundWebhook() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...input }: { id: number } & Partial<InboundWebhookInput>) =>
      api.put<{ data: InboundWebhook }>(`/admin/inbound-webhooks/${id}`, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['inbound-webhooks'] }),
  })
}

export function useDeleteInboundWebhook() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.delete(`/admin/inbound-webhooks/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['inbound-webhooks'] }),
  })
}

export function useRegenerateInboundToken() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) =>
      api.post<{ data: InboundWebhook }>(`/admin/inbound-webhooks/${id}/regenerate-token`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['inbound-webhooks'] }),
  })
}

export function useInboundWebhookLastPayload(id: number | null) {
  return useQuery({
    queryKey: ['inbound-webhook-last-payload', id],
    queryFn: () => api.get<{ payload: unknown; receivedAt: string | null }>(
      `/admin/inbound-webhooks/${id}/last-payload`,
    ),
    enabled: id !== null,
    staleTime: 5_000,
  })
}

export function useInboundWebhookHits(id: number | null, limit = 50) {
  return useQuery({
    queryKey: ['inbound-webhook-hits', id, limit],
    queryFn: () => api.get<{ data: InboundWebhookHit[]; total: number; limit: number; offset: number }>(
      `/admin/inbound-webhooks/${id}/hits?limit=${limit}`,
    ),
    enabled: id !== null,
    staleTime: 10_000,
  })
}
