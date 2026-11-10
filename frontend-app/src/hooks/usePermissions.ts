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
  /** Acesso por portal: `recortado` = vê só parte dos portais do Educacional. */
  acessoPortal?: { recortado: boolean }
  /** Ações com nome próprio que o papel/pacotes liberam (ex.: 'transferencia.mover_funil'). */
  capacidades?: string[]
  /** Configurações › Equipes: transferir leads e pegar leads de outra pessoa. */
  transferencia?: { transferir: boolean; pegarDeOutros: boolean }
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
 * Ação com nome próprio (Papéis e acessos › Ações sensíveis). Diferente do
 * `useCan`, NÃO libera enquanto carrega: são opções extras, que podem aparecer
 * um instante depois sem atrapalhar — e mostrar e tirar seria pior.
 */
export function useCapacidade(id: string): boolean {
  const role = useUserStore((s) => s.user?.role ?? null)
  const { data } = useMyPermissions()
  if (role === 'SUPERADMIN' || role === 'ADMIN') return true
  return !!data?.capacidades?.includes(id)
}

/**
 * Transferir leads/contatos e pegar para si lead de outra pessoa (marcações da
 * equipe e do membro em Configurações › Equipes). Enquanto carrega, transferir
 * vale `true` (é o comportamento de sempre) e pegar de outros, `false`.
 */
export function usePermissoesDeTransferencia(): { transferir: boolean; pegarDeOutros: boolean } {
  const role = useUserStore((s) => s.user?.role ?? null)
  const { data } = useMyPermissions()
  if (role === 'SUPERADMIN' || role === 'ADMIN') return { transferir: true, pegarDeOutros: true }
  return data?.transferencia ?? { transferir: true, pegarDeOutros: false }
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
 * O módulo está LIGADO no cliente? Ao contrário do `useCan`, não abre exceção
 * para SUPERADMIN nem enquanto carrega (devolve `false`): serve para esconder o
 * que só existe com o módulo — ex.: "Matricular pelo painel" num cliente sem
 * Educacional. Aparecer um instante depois é melhor que aparecer e sumir.
 */
export function useModuloLigado(moduleId: string): boolean {
  const { data } = useMyPermissions()
  return !!data?.modules.some((m) => m.id === moduleId && m.active !== false)
}

/**
 * Educacional ligado: o módulo `educacional` e o Portal de Matrículas
 * (`enrollment_portals`). Tudo o que só existe por causa do Educacional e
 * aparece fora das telas dele (ficha do lead, conversa, integrações) usa isto.
 */
export function useEducacionalLigado(): boolean {
  const edu = useModuloLigado('educacional')
  const portais = useModuloLigado('enrollment_portals')
  return edu && portais
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

/**
 * O que a pessoa pode fazer numa tela do Educacional (ou num módulo): Ver,
 * Criar, Editar, Excluir. Os botões de cada tela se escondem por isto — mesma
 * resposta que o backend dá (lib/eduTelas.ts), então nada aparece para depois
 * falhar com "sem permissão".
 */
export function usePodeNaTela(telaId: string) {
  return {
    ver: useCan(telaId, 'view'),
    criar: useCan(telaId, 'create'),
    editar: useCan(telaId, 'edit'),
    excluir: useCan(telaId, 'delete'),
  }
}
