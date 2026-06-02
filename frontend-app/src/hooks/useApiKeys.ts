import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'

export interface ApiKey {
  id: number
  name: string
  prefix: string
  permissions: string[]
  rateLimit: number
  lastUsedAt: string | null
  expiresAt: string | null
  active: boolean
  totalCalls: number
  createdBy: number | null
  createdAt: string
}

export interface ApiKeyInput {
  name: string
  permissions: string[]
  rateLimit?: number | undefined
  expiresAt?: string | null | undefined
}

export interface ApiKeyUpdateInput {
  name?: string | undefined
  permissions?: string[] | undefined
  rateLimit?: number | undefined
  active?: boolean | undefined
  expiresAt?: string | null | undefined
}

export interface ApiKeyCreateResponse {
  data: ApiKey & { key: string }
  warning?: string
}

export interface ApiKeyLog {
  id: number
  apiKeyId: number
  method: string
  path: string
  statusCode: number
  duration: number
  ip: string
  userAgent: string | null
  createdAt: string
}

export function useApiKeys() {
  return useQuery({
    queryKey: ['api-keys'],
    queryFn: () => api.get<{ data: ApiKey[] }>('/admin/api-keys'),
    staleTime: 60_000,
  })
}

export function useApiKeyPermissions() {
  return useQuery({
    queryKey: ['api-keys', 'permissions'],
    queryFn: () => api.get<{ data: string[] }>('/admin/api-keys/permissions'),
    staleTime: 5 * 60_000,
  })
}

export function useCreateApiKey() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: ApiKeyInput) => api.post<ApiKeyCreateResponse>('/admin/api-keys', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['api-keys'] }),
  })
}

export function useUpdateApiKey() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...input }: { id: number } & ApiKeyUpdateInput) =>
      api.put<{ data: ApiKey }>(`/admin/api-keys/${id}`, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['api-keys'] }),
  })
}

export function useDeleteApiKey() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.delete(`/admin/api-keys/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['api-keys'] }),
  })
}

export function useApiKeyLogs(id: number | null, limit = 100) {
  return useQuery({
    queryKey: ['api-key-logs', id, limit],
    queryFn: () =>
      api.get<{ data: ApiKeyLog[]; total: number; limit: number; offset: number }>(
        `/admin/api-keys/${id}/logs?limit=${limit}`,
      ),
    enabled: id !== null,
    staleTime: 10_000,
  })
}
