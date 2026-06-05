import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'

// Reforma F1: ordem reflete hierarquia operacional (do mais amplo ao mais restrito).
// AGENT é papel operacional puro (scope=own); MANAGER lidera setor (scope=team).
export type UserRole = 'SUPERADMIN' | 'ADMIN' | 'MANAGER' | 'AGENT' | 'VIEWER'

export interface AdminUser {
  id: number
  email: string
  name: string | null
  role: UserRole
  active: boolean
  lastLoginAt: string | null
  lastSeenAt: string | null
  createdAt: string
  workStatus?: 'available' | 'away' | 'busy' | 'offline'
  workStatusUpdatedAt?: string | null
  capacity?: number
  notifyWhatsapp?: string | null
}

export interface UserCreateInput {
  email: string
  name: string
  password: string
  role?: UserRole | undefined
}

export interface UserUpdateInput {
  email?: string | undefined
  name?: string | undefined
  role?: UserRole | undefined
  active?: boolean | undefined
  password?: string | undefined
  capacity?: number | undefined
  notifyWhatsapp?: string | null | undefined
}

export interface UserAuditEntry {
  id: number
  action: string
  actorName: string | null
  actorId: number | null
  changes: Record<string, unknown> | null
  createdAt: string
}

export function useUsers() {
  return useQuery({
    queryKey: ['admin-users'],
    queryFn: () => api.get<{ users: AdminUser[] }>('/admin/users'),
    staleTime: 30_000,
  })
}

export function useUserAudit(id: number | null) {
  return useQuery({
    queryKey: ['admin-users-audit', id],
    queryFn: () => api.get<{ data: UserAuditEntry[] }>(`/admin/users/${id}/audit`),
    enabled: id !== null,
    staleTime: 30_000,
  })
}

export function useCreateUser() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: UserCreateInput) => api.post<AdminUser>('/admin/users', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-users'] }),
  })
}

export function useUpdateUser() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...input }: { id: number } & UserUpdateInput) =>
      api.put<AdminUser>(`/admin/users/${id}`, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-users'] }),
  })
}

export function useDeleteUser() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.delete<{ ok: true }>(`/admin/users/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-users'] }),
  })
}

export const ROLE_LABELS: Record<UserRole, string> = {
  SUPERADMIN: 'Super Admin',
  ADMIN: 'Admin',
  MANAGER: 'Gestor',
  AGENT: 'Agente',
  VIEWER: 'Visualizador',
}

export const ROLE_TONES: Record<UserRole, 'danger' | 'warning' | 'info' | 'success' | 'neutral'> = {
  SUPERADMIN: 'danger',
  ADMIN: 'warning',
  MANAGER: 'info',
  AGENT: 'success',
  VIEWER: 'neutral',
}
