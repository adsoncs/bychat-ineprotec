import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'

export interface SystemEmailVariable {
  name: string
  description: string
}

export interface SystemEmailTemplate {
  id: number
  key: string
  name: string
  description: string | null
  subject: string
  htmlBody: string
  enabled: boolean
  variables: SystemEmailVariable[] | null
  category: 'system' | 'lifecycle' | 'auth' | 'manual' | string
  updatedById: number | null
  createdAt: string
  updatedAt: string
}

const KEY = ['system-emails'] as const

export function useSystemEmails() {
  return useQuery({
    queryKey: KEY,
    queryFn: () => api.get<SystemEmailTemplate[]>('/admin/system-emails'),
    staleTime: 30_000,
  })
}

export function useUpdateSystemEmail() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ key, ...input }: { key: string; subject?: string; htmlBody?: string; enabled?: boolean }) =>
      api.put<SystemEmailTemplate>(`/admin/system-emails/${key}`, input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: KEY }),
  })
}

export function useResetSystemEmail() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (key: string) => api.post<SystemEmailTemplate>(`/admin/system-emails/${key}/reset`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: KEY }),
  })
}

export function usePreviewSystemEmail() {
  return useMutation({
    mutationFn: ({ key, vars }: { key: string; vars?: Record<string, unknown> }) =>
      api.post<{ subject: string; html: string; enabled: boolean }>(`/admin/system-emails/${key}/preview`, { vars }),
  })
}

export function useSendTestSystemEmail() {
  return useMutation({
    mutationFn: ({ key, to }: { key: string; to: string }) =>
      api.post<{ ok: true }>(`/admin/system-emails/${key}/send-test`, { to }),
  })
}
