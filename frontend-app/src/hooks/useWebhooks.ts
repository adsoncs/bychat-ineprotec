import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'

export interface Webhook {
  id: number
  name: string
  url: string
  active: boolean
  events: string[]
  maxRetries: number
  timeoutMs: number
  totalSent: number
  totalFailed: number
  lastSentAt: string | null
  lastError: string | null
  createdAt: string
}

export interface WebhookInput {
  name: string
  url: string
  events: string[]
  active?: boolean | undefined
  maxRetries?: number | undefined
  timeoutMs?: number | undefined
  headers?: Record<string, string> | null | undefined
}

export interface WebhookCreateResponse {
  data: Webhook & { secret: string }
  warning?: string
}

export interface WebhookLog {
  id: number
  webhookId: number
  event: string
  url: string
  statusCode: number | null
  duration: number | null
  success: boolean
  attempt: number
  error: string | null
  response: string | null
  requestBody: unknown
  createdAt: string
}

export function useWebhooks() {
  return useQuery({
    queryKey: ['webhooks'],
    queryFn: () => api.get<{ data: Webhook[] }>('/admin/webhooks'),
    staleTime: 60_000,
  })
}

export function useWebhookEvents() {
  return useQuery({
    queryKey: ['webhook-events'],
    queryFn: () => api.get<{ data: string[]; labels: Record<string, string> }>('/admin/webhooks/events'),
    staleTime: 5 * 60_000,
  })
}

export function useCreateWebhook() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: WebhookInput) => api.post<WebhookCreateResponse>('/admin/webhooks', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['webhooks'] }),
  })
}

export function useUpdateWebhook() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...input }: { id: number } & Partial<WebhookInput>) =>
      api.put<{ data: Webhook }>(`/admin/webhooks/${id}`, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['webhooks'] }),
  })
}

export function useDeleteWebhook() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.delete(`/admin/webhooks/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['webhooks'] }),
  })
}

export interface WebhookTestResult {
  success: boolean
  statusCode?: number
  duration?: number
  error?: string
}

export function useTestWebhook() {
  return useMutation({
    mutationFn: (id: number) => api.post<WebhookTestResult>(`/admin/webhooks/${id}/test`),
  })
}

export function useWebhookLogs(id: number | null, limit = 100) {
  return useQuery({
    queryKey: ['webhook-logs', id, limit],
    queryFn: () =>
      api.get<{ data: WebhookLog[]; total: number; limit: number; offset: number }>(
        `/admin/webhooks/${id}/logs?limit=${limit}`,
      ),
    enabled: id !== null,
    staleTime: 10_000,
  })
}

export function useRegenerateWebhookSecret() {
  return useMutation({
    mutationFn: (id: number) =>
      api.post<{ secret: string; warning: string }>(`/admin/webhooks/${id}/regenerate-secret`),
  })
}
