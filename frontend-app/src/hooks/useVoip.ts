import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'

export interface VoipConfig {
  enabled: boolean
  sigma: {
    baseUrl: string
    user: string
    hasPassword: boolean
    passwordMasked: string
    hasToken: boolean
    tokenMasked: string
    accountCode: string
    defaultCallerId: string
  }
  gravacoes: {
    baseUrl: string
    email: string
    hasPassword: boolean
    passwordMasked: string
    insecureTLS: boolean
  }
  recordings: {
    autoSync: boolean
    syncIntervalMin: number
  }
}

export interface VoipConfigInput {
  enabled?: boolean
  sigma?: Partial<{ baseUrl: string; user: string; password: string; token: string; accountCode: string; defaultCallerId: string }>
  gravacoes?: Partial<{ baseUrl: string; email: string; password: string; insecureTLS: boolean }>
  recordings?: Partial<{ autoSync: boolean; syncIntervalMin: number }>
}

export interface VoipTestResult {
  sigma: { status: boolean; statusInfo: unknown; statusError: string | null; auth: boolean; authMessage: string }
  gravacoes: { login: boolean; message: string }
}

export interface VoipExtensionUser {
  id: number
  name: string
  email: string
  role: string
  voipExtension: string | null
}

export interface VoipCall {
  id: number
  leadId: number | null
  activityId: number | null
  userId: number | null
  userName: string | null
  extension: string | null
  phone: string
  callerId: string | null
  direction: string
  provider: string
  providerCallId: string | null
  uniqueid: string | null
  status: string
  startedAt: string
  answeredAt: string | null
  durationSec: number | null
  recordingUrl: string | null
  source: string
  createdAt: string
  leadName?: string | null
}

export const VOIP_TERMINAL_STATUS = ['completed', 'no_answer', 'busy', 'failed']

export function useVoipConfig() {
  return useQuery({
    queryKey: ['voip-config'],
    queryFn: () => api.get<{ config: VoipConfig }>('/admin/voip/config'),
    staleTime: 30_000,
  })
}

export function useUpdateVoipConfig() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: VoipConfigInput) => api.put<{ ok: true; config: VoipConfig }>('/admin/voip/config', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['voip-config'] }),
  })
}

export function useTestVoipConnection() {
  return useMutation({
    mutationFn: () => api.post<VoipTestResult>('/admin/voip/test', {}),
  })
}

export function useVoipExtensions() {
  return useQuery({
    queryKey: ['voip-extensions'],
    queryFn: () => api.get<{ users: VoipExtensionUser[] }>('/admin/voip/extensions'),
    staleTime: 30_000,
  })
}

export function useUpdateVoipExtensions() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (extensions: Array<{ userId: number; extension: string | null }>) =>
      api.put<{ ok: true; users: VoipExtensionUser[] }>('/admin/voip/extensions', { extensions }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['voip-extensions'] }),
  })
}

export interface VoipCallsParams {
  leadId?: number | undefined
  userId?: number | undefined
  status?: string | undefined
  source?: string | undefined
  from?: string | undefined
  to?: string | undefined
  limit?: number | undefined
}

export function useVoipCalls(params: VoipCallsParams = {}) {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') qs.set(k, String(v))
  }
  const suffix = qs.toString() ? `?${qs.toString()}` : ''
  return useQuery({
    queryKey: ['voip-calls', params],
    queryFn: () => api.get<{ calls: VoipCall[] }>(`/voip/calls${suffix}`),
    staleTime: 15_000,
  })
}

export interface VoipSyncResult {
  imported: number
  updated: number
  recordings: number
  matched: number
  total: number
  error?: string
}

export function useSyncRecordings() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (range: { from?: string; to?: string } = {}) =>
      api.post<{ ok: boolean; result: VoipSyncResult }>('/admin/voip/recordings/sync', range),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['voip-calls'] }),
  })
}

// Click-to-call: dispara ligação do ramal do operador para o lead.
// Polling do status de uma ligação (widget flutuante). Para de refazer quando
// a chamada chega num status terminal.
export function useVoipCall(id: number | null) {
  return useQuery<{ call: VoipCall }>({
    queryKey: ['voip-call', id],
    queryFn: () => api.get<{ call: VoipCall }>(`/voip/calls/${id}`),
    enabled: !!id,
    refetchInterval: (query) => {
      const s = query.state.data?.call?.status
      return s && VOIP_TERMINAL_STATUS.includes(s) ? false : 3000
    },
  })
}

export function useDialLead() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { leadId?: number | undefined; phone: string; callerId?: string | undefined }) =>
      api.post<{ ok: boolean; call: VoipCall; error?: string }>('/voip/calls', input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['voip-calls'] })
      void qc.invalidateQueries({ queryKey: ['lead-activities'] })
    },
  })
}
