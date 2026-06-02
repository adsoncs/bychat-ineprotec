import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'
import type { UserRole } from './useUsers'

/** Roles editáveis (SUPERADMIN não tem permissão configurável — sempre full access). */
export type EditableRole = Exclude<UserRole, 'SUPERADMIN'>

export interface ModuleInfo {
  id: string
  name: string
  icon: string
  category: string
}

export interface ModulePermission {
  moduleId: string
  role: UserRole
  canView: boolean
  canCreate: boolean
  canEdit: boolean
  canDelete: boolean
}

/** null = herdar do role; true = permitir; false = negar */
export interface UserModuleOverride {
  moduleId: string
  canView: boolean | null
  canCreate: boolean | null
  canEdit: boolean | null
  canDelete: boolean | null
}

const PERMS_KEY = ['module-permissions'] as const
const overridesKey = (userId: number) => ['user-module-overrides', userId] as const

export function useModulePermissions() {
  return useQuery({
    queryKey: PERMS_KEY,
    queryFn: () =>
      api.get<{ modules: ModuleInfo[]; permissions: ModulePermission[] }>(
        '/admin/module-permissions',
      ),
    staleTime: 30_000,
  })
}

export function useSaveModulePermissions() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (permissions: ModulePermission[]) =>
      api.put<{ ok: true; updated: number }>('/admin/module-permissions', { permissions }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: PERMS_KEY })
      void qc.invalidateQueries({ queryKey: ['auth', 'me'] })
    },
  })
}

export function useUserModuleOverrides(userId: number | null) {
  return useQuery({
    queryKey: userId ? overridesKey(userId) : ['user-module-overrides', 'none'],
    queryFn: () =>
      api.get<{ overrides: UserModuleOverride[] }>(
        `/admin/user-module-overrides/${userId}`,
      ),
    enabled: userId !== null,
    staleTime: 30_000,
  })
}

export function useSaveUserModuleOverrides() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ userId, overrides }: { userId: number; overrides: UserModuleOverride[] }) =>
      api.put<{ ok: true }>(`/admin/user-module-overrides/${userId}`, { overrides }),
    onSuccess: (_, vars) => {
      void qc.invalidateQueries({ queryKey: overridesKey(vars.userId) })
    },
  })
}
