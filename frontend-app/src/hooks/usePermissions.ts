import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'
import { useUserStore } from '@/stores/user'

export interface ModulePermission {
  canView: boolean
  canCreate: boolean
  canEdit: boolean
  canDelete: boolean
}

export interface ModuleDef {
  id: string
  name: string
  icon: string
  category: string
  pages: string[]
  /** Se o módulo está ATIVADO no tenant (independente do role do usuário). */
  active: boolean
}

export interface MyPermissionsResponse {
  permissions: Record<string, ModulePermission>
  modules: ModuleDef[]
}

export type PermAction = 'view' | 'create' | 'edit' | 'delete'

const ACTION_KEY: Record<PermAction, keyof ModulePermission> = {
  view: 'canView',
  create: 'canCreate',
  edit: 'canEdit',
  delete: 'canDelete',
}

export function useMyPermissions() {
  const userId = useUserStore((s) => s.user?.id ?? null)
  return useQuery({
    queryKey: ['my-permissions', userId],
    queryFn: () => api.get<MyPermissionsResponse>('/admin/my-permissions'),
    enabled: userId !== null,
    staleTime: 60_000,
    // Sem permissões do backend = fail-open (igual ao legado).
    retry: 1,
  })
}

/**
 * Hook utilitário para checar permissão em uma ação de um módulo.
 *
 * SUPERADMIN sempre retorna true; sem dados ainda (loading) também retorna
 * true para evitar flash de UI vazia.
 */
export function useCan(moduleId: string | undefined, action: PermAction = 'view'): boolean {
  const role = useUserStore((s) => s.user?.role ?? null)
  const { data, isLoading } = useMyPermissions()

  if (role === 'SUPERADMIN') return true
  if (!moduleId) return true
  if (isLoading || !data) return true // fail-open enquanto carrega
  const perm = data.permissions[moduleId]
  if (!perm) return false
  return !!perm[ACTION_KEY[action]]
}

/**
 * Diz se um módulo está ATIVADO no tenant — reflete o estado real, sem
 * bypass por role. SUPERADMIN também vê `false` quando o módulo está
 * desativado (precisamos disso pra esconder UI que aponta pra módulo off).
 *
 * `null` durante carregamento — útil pra UI evitar flash.
 */
export function useIsModuleActive(moduleId: string | undefined): boolean | null {
  const { data, isLoading } = useMyPermissions()
  if (!moduleId) return true
  if (isLoading || !data) return null
  const mod = data.modules.find((m) => m.id === moduleId)
  return mod ? mod.active : false
}

/**
 * Resultado consolidado pra UI decidir o que renderizar.
 *
 * Casos:
 *   { status: 'loading' }            — esperando permissões carregarem
 *   { status: 'inactive' }           — módulo desativado no tenant
 *   { status: 'denied' }             — sem permissão (canView=false)
 *   { status: 'allowed' }            — pode ver
 *
 * Componentes de página devem usar isso pra mostrar telas customizadas.
 */
export interface ModuleAccess {
  status: 'loading' | 'inactive' | 'denied' | 'allowed'
}

export function useModuleAccess(moduleId: string | undefined, action: PermAction = 'view'): ModuleAccess {
  const role = useUserStore((s) => s.user?.role ?? null)
  const { data, isLoading } = useMyPermissions()

  if (!moduleId) return { status: 'allowed' }
  if (role === 'SUPERADMIN') return { status: 'allowed' }
  if (isLoading || !data) return { status: 'loading' }
  // Módulo desativado vem omitido em `modules[]` pra não-SUPERADMIN.
  const isActive = data.modules.some((m) => m.id === moduleId)
  if (!isActive) return { status: 'inactive' }
  const perm = data.permissions[moduleId]
  if (!perm || !perm[ACTION_KEY[action]]) return { status: 'denied' }
  return { status: 'allowed' }
}
