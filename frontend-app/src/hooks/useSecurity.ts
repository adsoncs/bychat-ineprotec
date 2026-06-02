import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'

export interface SecurityEvent {
  id: number
  type: string
  severity: string
  ip: string | null
  email: string | null
  details: string | null
  createdAt: string
}

export interface SecurityStats {
  totalEvents24h: number
  criticalEvents24h: number
  loginFails24h: number
  loginSuccess24h: number
  activeBlocks: number
  totalBlocks: number
  topIps: { ip: string; count: number }[]
}

export interface IpBlock {
  id: number
  ip: string
  reason: string
  details: string | null
  auto: boolean
  expiresAt: string | null
  active: boolean
  createdBy: string | null
  createdAt: string
}

export interface SecurityEventsFilters {
  type?: string | undefined
  severity?: string | undefined
  ip?: string | undefined
  from?: string | undefined
  to?: string | undefined
  limit?: number | undefined
  offset?: number | undefined
}

function eventsQuery(f: SecurityEventsFilters): string {
  const p = new URLSearchParams()
  if (f.type) p.set('type', f.type)
  if (f.severity) p.set('severity', f.severity)
  if (f.ip) p.set('ip', f.ip)
  if (f.from) p.set('from', f.from)
  if (f.to) p.set('to', f.to)
  if (f.limit !== undefined) p.set('limit', String(f.limit))
  if (f.offset !== undefined) p.set('offset', String(f.offset))
  const qs = p.toString()
  return qs ? `?${qs}` : ''
}

export function useSecurityStats() {
  return useQuery({
    queryKey: ['security-stats'],
    queryFn: () => api.get<SecurityStats>('/admin/security/stats'),
    staleTime: 30_000,
    refetchInterval: 30_000,
  })
}

export function useSecurityEvents(filters: SecurityEventsFilters = {}) {
  return useQuery({
    queryKey: ['security-events', filters],
    queryFn: () => api.get<{ events: SecurityEvent[]; total: number }>(`/admin/security/events${eventsQuery(filters)}`),
    staleTime: 30_000,
    refetchInterval: 30_000,
  })
}

export function useSecurityBlocks() {
  return useQuery({
    queryKey: ['security-blocks'],
    queryFn: () => api.get<{ blocks: IpBlock[]; total: number }>('/admin/security/blocks?active=true&limit=50'),
    staleTime: 30_000,
    refetchInterval: 30_000,
  })
}

export interface SecurityUser {
  id: number
  email: string
  name: string | null
  role: string
  active: boolean
  lockedAt: string | null
  lockReason: string | null
  loginAttempts: number
  lastLoginAt: string | null
  createdAt: string
}

export function useSecurityUsers() {
  return useQuery({
    queryKey: ['security-users'],
    queryFn: () => api.get<{ users: SecurityUser[] }>('/admin/security/users'),
    staleTime: 30_000,
    refetchInterval: 30_000,
  })
}

export interface BlockIpInput {
  ip: string
  reason?: string | undefined
  details?: string | undefined
  /** duração em minutos; omitir = permanente */
  duration?: number | undefined
}

export function useBlockIp() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: BlockIpInput) => api.post<{ ok: true }>('/admin/security/blocks', input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['security-blocks'] })
      void qc.invalidateQueries({ queryKey: ['security-stats'] })
    },
  })
}

export function useUnblockIp() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.put<{ ok: true }>(`/admin/security/blocks/${id}/unblock`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['security-blocks'] })
      void qc.invalidateQueries({ queryKey: ['security-stats'] })
    },
  })
}

export function useLockUser() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, reason }: { id: number; reason?: string }) =>
      api.put<{ ok: true }>(`/admin/security/users/${id}/lock`, { reason }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['security-users'] }),
  })
}

export function useUnlockUser() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.put<{ ok: true }>(`/admin/security/users/${id}/unlock`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['security-users'] }),
  })
}

export function useResetUserAttempts() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.put<{ ok: true }>(`/admin/security/users/${id}/reset-attempts`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['security-users'] }),
  })
}

export interface SecurityMe {
  ip: string
  email: string
  role: string
}

export function useSecurityMe() {
  return useQuery({
    queryKey: ['security-me'],
    queryFn: () => api.get<SecurityMe>('/admin/security/me'),
    staleTime: 5 * 60_000,
  })
}

export function useSelfUnblock() {
  return useMutation({
    mutationFn: () => api.post<{ ok: true; ip: string; unblocked: number }>('/admin/security/self-unblock'),
  })
}
