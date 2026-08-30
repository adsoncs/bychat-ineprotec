import { useEffect, useMemo, useState } from 'preact/hooks'
import { ShieldCheck, Save, HelpCircle } from '@/components/ui/icon-set'
import { HowItWorksModal } from '@/components/ui/HowItWorksModal'
import {
  useModulePermissions,
  useSaveModulePermissions,
  useUserModuleOverrides,
  useSaveUserModuleOverrides,
  type ModuleInfo,
  type ModulePermission,
  type UserModuleOverride,
  type EditableRole,
} from '@/hooks/useModulePermissions'
import { useUsers, ROLE_LABELS } from '@/hooks/useUsers'
import { useAuth } from '@/hooks/useAuth'
import { useSystemModules, useToggleSystemModule } from '@/hooks/useRouting'
import { Power, Lock } from '@/components/ui/icon-set'
import { Badge } from '@/components/ui/Badge'
import { ApiError } from '@/lib/apiClient'
import { Page } from '@/components/ui/Page'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Skeleton } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { Select } from '@/components/ui/Input'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/cn'

// Reforma F1: ordem ascendente de poder operacional.
const EDITABLE_ROLES: EditableRole[] = ['VIEWER', 'AGENT', 'MANAGER', 'ADMIN']

// Cores espelhando o legado, via tokens semânticos do app (light/dark-safe).
const ROLE_TONE: Record<EditableRole, { fg: string; bg: string }> = {
  VIEWER: { fg: 'var(--color-fg-on-brand)', bg: 'var(--color-fg-muted)' },
  AGENT: { fg: 'var(--color-fg-on-brand)', bg: 'var(--color-success)' },
  MANAGER: { fg: 'var(--color-fg-on-brand)', bg: 'var(--color-warning)' },
  ADMIN: { fg: 'var(--color-fg-on-brand)', bg: 'var(--color-info)' },
}

const CATEGORY_LABELS: Record<string, string> = {
  overview: 'Visão Geral',
  crm: 'CRM',
  automacao: 'Automação',
  captacao: 'Captação',
  marketing: 'Marketing',
  vendas: 'Vendas',
  canais: 'Canais',
  integracoes: 'Integrações',
  config: 'Configurações',
  admin: 'Administração',
}

const PERM_FIELDS = ['canView', 'canCreate', 'canEdit', 'canDelete'] as const
type PermField = typeof PERM_FIELDS[number]
const FIELD_LABELS: Record<PermField, string> = {
  canView: 'Ver',
  canCreate: 'Criar',
  canEdit: 'Editar',
  canDelete: 'Excluir',
}
// Cor de accent por coluna (espelhando o legado).
const FIELD_ACCENT: Record<PermField, string> = {
  canView: 'var(--color-info)',
  canCreate: 'var(--color-success)',
  canEdit: 'var(--color-warning)',
  canDelete: 'var(--color-danger)',
}

export function ModulePermissionsPage() {
  const { user } = useAuth()
  const isSuperAdmin = user?.role === 'SUPERADMIN'
  const [showHowItWorks, setShowHowItWorks] = useState(false)

  const { data, isLoading } = useModulePermissions()

  if (!isSuperAdmin) {
    return (
      <Page title="Permissões por Módulo">
        <EmptyState
          icon={<ShieldCheck size={24} />}
          title="Apenas Super Admin pode gerenciar permissões"
        />
      </Page>
    )
  }

  return (
    <Page
      title="Permissões por Módulo"
      description="Controle de acesso CRUD por role e por usuário"
      actions={
        <Button variant="ghost" size="sm" onClick={() => setShowHowItWorks(true)}>
          <HelpCircle size={14} /> Como funciona?
        </Button>
      }
    >
      {isLoading || !data ? (
        <div class="space-y-4">
          <Skeleton class="h-64 w-full" />
          <Skeleton class="h-64 w-full" />
        </div>
      ) : (
        <>
          <SystemModulesCard />
          <RolePermissionsCard modules={data.modules} permissions={data.permissions} />
          <UserOverridesCard modules={data.modules} permissions={data.permissions} />
        </>
      )}

      <HowItWorksModal
        open={showHowItWorks}
        onClose={() => setShowHowItWorks(false)}
        title="Como funcionam as Permissões por Módulo?"
        problem={<>
          O <strong>role</strong> (SUPERADMIN/ADMIN/OPERADOR/VIEWER) dá uma base ampla. Mas você
          quase sempre precisa de <strong>controle fino</strong>: "OPERADOR pode ver Leads mas não
          excluir", "VIEWER pode ver relatórios mas nada além". Esta tela controla isso por módulo,
          por papel e (excepcionalmente) por usuário individual.
        </>}
        steps={[
          {
            title: '🧱 Permissões por Role',
            body: <>Tabela com cada <strong>módulo</strong> (Leads, Funis, Cadências, Pagamentos…) nas linhas e cada <strong>papel</strong> nas colunas. Cada célula tem 4 checkboxes: <strong>View, Create, Edit, Delete</strong>. Salve e vale pra todos os usuários daquele papel.</>,
          },
          {
            title: '⚙️ Módulos do sistema',
            body: <>Cada tela do sistema tem um identificador de módulo (ex.: <code>leads</code>, <code>cadences</code>, <code>payments</code>). Se o usuário não tem View no módulo, a tela <strong>nem aparece no menu</strong>. Limpo, sem cair em 403.</>,
          },
          {
            title: '🎯 Overrides por usuário',
            body: <>Excepcionalmente, você pode <strong>override</strong> um usuário específico (ex.: "Maria do OPERADOR ganha permissão de deletar leads, só ela"). Use com parcimônia — overrides são difíceis de auditar depois.</>,
          },
          {
            title: '💾 Salvar é explícito',
            body: <>Mudanças ficam em rascunho até você clicar em <strong>Salvar</strong>. Botão fica destacado quando há diff. Útil pra fazer várias mudanças e aplicar de uma vez — evita inconsistências.</>,
          },
          {
            title: '👁️ SUPERADMIN sempre pode tudo',
            body: <>Não tem como restringir SUPERADMIN — ele é o "root" do sistema. Por isso a recomendação de usar SUPERADMIN só pra 1-2 pessoas técnicas e ADMIN pro resto do time de gestão.</>,
          },
        ]}
        tip={{
          tone: 'info',
          title: '💡 Comece pelo Role, refine com Override',
          body: <>90% dos casos resolvem com permissões de Role. Use Override só quando alguém precisa de algo diferente do papel dele. Se você acaba dando muito Override pro mesmo Role, talvez seja hora de revisar o que esse Role deveria ter.</>,
        }}
      />
    </Page>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Card 1: Permissões por Role

function RolePermissionsCard({
  modules,
  permissions,
}: {
  modules: ModuleInfo[]
  permissions: ModulePermission[]
}) {
  const [activeRole, setActiveRole] = useState<EditableRole>('VIEWER')
  const [draft, setDraft] = useState<ModulePermission[]>(permissions)
  const save = useSaveModulePermissions()

  useEffect(() => { setDraft(permissions) }, [permissions])

  const grouped = useMemo(() => groupByCategory(modules), [modules])

  function getPerm(moduleId: string): ModulePermission {
    return (
      draft.find((p) => p.moduleId === moduleId && p.role === activeRole) ?? {
        moduleId,
        role: activeRole,
        canView: false,
        canCreate: false,
        canEdit: false,
        canDelete: false,
      }
    )
  }

  function setField(moduleId: string, field: PermField, value: boolean) {
    setDraft((prev) => {
      const idx = prev.findIndex((p) => p.moduleId === moduleId && p.role === activeRole)
      if (idx >= 0) {
        const next = [...prev]
        next[idx] = { ...next[idx]!, [field]: value }
        return next
      }
      return [
        ...prev,
        { moduleId, role: activeRole, canView: false, canCreate: false, canEdit: false, canDelete: false, [field]: value },
      ]
    })
  }

  function bulkSet(values: { canView: boolean; canCreate: boolean; canEdit: boolean; canDelete: boolean }) {
    setDraft((prev) => {
      const next = prev.filter((p) => p.role !== activeRole)
      for (const m of modules) {
        next.push({ moduleId: m.id, role: activeRole, ...values })
      }
      return next
    })
  }

  function handleSave() {
    const toSave = draft.filter((p) => p.role === activeRole)
    save.mutate(toSave, {
      onSuccess: () => toast('Permissões salvas com sucesso', 'success'),
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  return (
    <Card class="overflow-hidden p-0">
      <header class="flex flex-wrap items-center justify-between gap-3 p-4 border-b border-border">
        <div class="text-sm font-semibold text-fg">Permissões por Role</div>
        <div class="flex flex-wrap items-center gap-2">
          {EDITABLE_ROLES.map((r) => {
            const active = activeRole === r
            const tone = ROLE_TONE[r]
            return (
              <button
                key={r}
                type="button"
                onClick={() => setActiveRole(r)}
                class="h-8 px-5 rounded-md text-xs font-medium transition-colors"
                style={active
                  ? { background: tone.bg, color: tone.fg }
                  : { background: 'var(--color-surface-3)', color: 'var(--color-fg-muted)' }}
              >
                {ROLE_LABELS[r]}
              </button>
            )
          })}
        </div>
      </header>

      <div class="flex flex-wrap gap-2 px-4 py-3 border-b border-border">
        <BulkButton
          tone="info"
          onClick={() => bulkSet({ canView: true, canCreate: true, canEdit: true, canDelete: true })}
        >
          Todos
        </BulkButton>
        <BulkButton
          tone="danger"
          onClick={() => bulkSet({ canView: false, canCreate: false, canEdit: false, canDelete: false })}
        >
          Nenhum
        </BulkButton>
        <BulkButton
          tone="success"
          onClick={() => bulkSet({ canView: true, canCreate: false, canEdit: false, canDelete: false })}
        >
          Somente leitura
        </BulkButton>
      </div>

      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead>
            <tr class="border-b-2 border-border">
              <th class="text-left px-4 py-2.5 text-xs font-semibold text-fg">Módulo</th>
              {PERM_FIELDS.map((f) => (
                <th key={f} class="text-center px-2 py-2.5 text-xs font-semibold text-fg w-20">
                  {FIELD_LABELS[f]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {grouped.map(({ category, modules: list }) => (
              <CategoryGroup
                key={category}
                category={category}
                modules={list}
                getPerm={getPerm}
                setField={setField}
              />
            ))}
          </tbody>
        </table>
      </div>

      <footer class="p-4 flex justify-end">
        <Button variant="primary" size="sm" onClick={handleSave} disabled={save.isPending}>
          <Save size={14} /> {save.isPending ? 'Salvando…' : 'Salvar Permissões'}
        </Button>
      </footer>
    </Card>
  )
}

function BulkButton({
  tone,
  onClick,
  children,
}: {
  tone: 'info' | 'danger' | 'success'
  onClick: () => void
  children: string
}) {
  const colorVar = tone === 'info' ? '--color-info' : tone === 'danger' ? '--color-danger' : '--color-success'
  return (
    <button
      type="button"
      onClick={onClick}
      class="h-7 px-3 rounded text-2xs font-medium transition-opacity hover:opacity-80"
      style={{
        background: `color-mix(in oklch, var(${colorVar}) 14%, transparent)`,
        color: `var(${colorVar})`,
      }}
    >
      {children}
    </button>
  )
}

function CategoryGroup({
  category,
  modules,
  getPerm,
  setField,
}: {
  category: string
  modules: ModuleInfo[]
  getPerm: (moduleId: string) => ModulePermission
  setField: (moduleId: string, field: PermField, value: boolean) => void
}) {
  return (
    <>
      <tr>
        <td colSpan={5} class="bg-surface-3 px-4 py-2.5 text-xs font-semibold text-fg uppercase tracking-wider">
          {CATEGORY_LABELS[category] ?? category}
        </td>
      </tr>
      {modules.map((m) => {
        const perm = getPerm(m.id)
        return (
          <tr key={m.id} class="border-b border-border last:border-b-0">
            <td class="px-4 py-2.5 text-fg text-xs">
              <span class="mr-1.5">{m.icon}</span>
              {m.name}
            </td>
            {PERM_FIELDS.map((f) => (
              <td key={f} class="text-center px-2 py-2.5">
                <input
                  type="checkbox"
                  checked={perm[f]}
                  onChange={(e) => setField(m.id, f, (e.target as HTMLInputElement).checked)}
                  class="cursor-pointer"
                  style={{
                    width: '18px',
                    height: '18px',
                    accentColor: FIELD_ACCENT[f],
                  }}
                  aria-label={`${FIELD_LABELS[f]} ${m.name}`}
                />
              </td>
            ))}
          </tr>
        )
      })}
    </>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Card 2: Overrides por Usuário

function UserOverridesCard({
  modules,
  permissions,
}: {
  modules: ModuleInfo[]
  permissions: ModulePermission[]
}) {
  const { data: usersData } = useUsers()
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null)
  const { data: overridesData, isLoading } = useUserModuleOverrides(selectedUserId)
  const save = useSaveUserModuleOverrides()
  const [draft, setDraft] = useState<UserModuleOverride[]>([])

  const users = usersData?.users ?? []
  const selectedUser = users.find((u) => u.id === selectedUserId) ?? null

  useEffect(() => {
    if (!overridesData) {
      setDraft([])
      return
    }
    const next: UserModuleOverride[] = modules.map((m) => {
      const existing = overridesData.overrides.find((o) => o.moduleId === m.id)
      return (
        existing ?? {
          moduleId: m.id,
          canView: null,
          canCreate: null,
          canEdit: null,
          canDelete: null,
        }
      )
    })
    setDraft(next)
  }, [overridesData, modules])

  const grouped = useMemo(() => groupByCategory(modules), [modules])
  const rolePermsByModule = useMemo(() => {
    const map = new Map<string, ModulePermission>()
    if (selectedUser) {
      for (const p of permissions) {
        if (p.role === selectedUser.role) map.set(p.moduleId, p)
      }
    }
    return map
  }, [permissions, selectedUser])

  function cycleField(moduleId: string, field: PermField) {
    setDraft((prev) => {
      const idx = prev.findIndex((o) => o.moduleId === moduleId)
      if (idx < 0) return prev
      const current = prev[idx]![field]
      const nextValue: boolean | null = current === null ? true : current === true ? false : null
      const next = [...prev]
      next[idx] = { ...next[idx]!, [field]: nextValue }
      return next
    })
  }

  function handleSave() {
    if (!selectedUserId) return
    save.mutate({ userId: selectedUserId, overrides: draft }, {
      onSuccess: () => toast('Overrides salvos com sucesso', 'success'),
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  return (
    <Card class="overflow-hidden p-0 mt-6">
      <header class="flex flex-wrap items-center justify-between gap-3 p-4 border-b border-border">
        <div class="text-sm font-semibold text-fg">Overrides por Usuário</div>
        <div class="min-w-[12.5rem]">
          <Select
            value={selectedUserId ?? ''}
            onChange={(e) => {
              const v = (e.target as HTMLSelectElement).value
              setSelectedUserId(v ? Number(v) : null)
            }}
          >
            <option value="">Selecionar usuário...</option>
            {users.filter((u) => u.role !== 'SUPERADMIN').map((u) => (
              <option key={u.id} value={u.id}>
                {u.name ?? u.email} ({ROLE_LABELS[u.role]})
              </option>
            ))}
          </Select>
        </div>
      </header>

      <div class="px-4 py-2 border-b border-border text-xs text-fg">
        Cinza = herdar do role | Verde = permitir | Vermelho = negar
      </div>

      {!selectedUserId && (
        <div class="p-8">
          <EmptyState description="Escolha um usuário para visualizar e editar overrides." />
        </div>
      )}

      {selectedUserId && isLoading && (
        <div class="p-4">
          <Skeleton class="h-48 w-full" />
        </div>
      )}

      {selectedUserId && !isLoading && draft.length > 0 && (
        <>
          <div class="overflow-x-auto">
            <table class="w-full text-sm">
              <thead>
                <tr class="border-b-2 border-border">
                  <th class="text-left px-4 py-2.5 text-xs font-semibold text-fg">Módulo</th>
                  {PERM_FIELDS.map((f) => (
                    <th key={f} class="text-center px-2 py-2.5 text-xs font-semibold text-fg w-20">
                      {FIELD_LABELS[f]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {grouped.map(({ category, modules: list }) => (
                  <OverrideCategoryGroup
                    key={category}
                    category={category}
                    modules={list}
                    draft={draft}
                    rolePerms={rolePermsByModule}
                    onCycle={cycleField}
                  />
                ))}
              </tbody>
            </table>
          </div>
          <footer class="p-4 flex justify-end">
            <Button variant="primary" size="sm" onClick={handleSave} disabled={save.isPending}>
              <Save size={14} /> {save.isPending ? 'Salvando…' : 'Salvar Overrides'}
            </Button>
          </footer>
        </>
      )}
    </Card>
  )
}

function OverrideCategoryGroup({
  category,
  modules,
  draft,
  rolePerms,
  onCycle,
}: {
  category: string
  modules: ModuleInfo[]
  draft: UserModuleOverride[]
  rolePerms: Map<string, ModulePermission>
  onCycle: (moduleId: string, field: PermField) => void
}) {
  return (
    <>
      <tr>
        <td colSpan={5} class="bg-surface-3 px-4 py-2.5 text-xs font-semibold text-fg uppercase tracking-wider">
          {CATEGORY_LABELS[category] ?? category}
        </td>
      </tr>
      {modules.map((m) => {
        const o = draft.find((x) => x.moduleId === m.id)
        if (!o) return null
        const rp = rolePerms.get(m.id)
        return (
          <tr key={m.id} class="border-b border-border last:border-b-0">
            <td class="px-4 py-2 text-fg text-xs">
              <span class="mr-1.5">{m.icon}</span>
              {m.name}
            </td>
            {PERM_FIELDS.map((f) => (
              <td key={f} class="text-center px-2 py-2">
                <TriStateButton
                  value={o[f]}
                  roleValue={rp?.[f] ?? false}
                  ariaLabel={`${FIELD_LABELS[f]} ${m.name}`}
                  onClick={() => onCycle(m.id, f)}
                />
              </td>
            ))}
          </tr>
        )
      })}
    </>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Tri-state primitive

type TriState = 'inherit' | 'allow' | 'deny'

function valueToState(v: boolean | null): TriState {
  if (v === null) return 'inherit'
  return v ? 'allow' : 'deny'
}

function TriStateButton({
  value,
  roleValue,
  ariaLabel,
  onClick,
}: {
  value: boolean | null
  roleValue: boolean
  ariaLabel: string
  onClick: () => void
}) {
  const state = valueToState(value)
  const symbol = state === 'inherit' ? '-' : state === 'allow' ? '✓' : '×'
  const labels = { inherit: 'Herdar', allow: 'Sim', deny: 'Não' }
  const colorVar =
    state === 'allow' ? 'var(--color-success)'
      : state === 'deny' ? 'var(--color-danger)'
        : 'var(--color-border)'
  const borderColor = colorVar
  const textColor = state === 'inherit' ? 'var(--color-fg-muted)' : colorVar
  const bg = state === 'inherit'
    ? 'var(--color-surface)'
    : `color-mix(in oklch, ${colorVar} 14%, transparent)`

  return (
    <button
      type="button"
      onClick={onClick}
      class={cn(
        'inline-flex items-center justify-center rounded-full text-3xs font-semibold cursor-pointer',
      )}
      style={{
        width: '32px',
        height: '32px',
        border: `2px solid ${borderColor}`,
        background: bg,
        color: textColor,
      }}
      aria-label={ariaLabel}
      title={`Role: ${roleValue ? 'Sim' : 'Não'} | Override: ${labels[state]}`}
    >
      {symbol}
    </button>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers

function groupByCategory(modules: ModuleInfo[]): { category: string; modules: ModuleInfo[] }[] {
  const map = new Map<string, ModuleInfo[]>()
  for (const m of modules) {
    const list = map.get(m.category) ?? []
    list.push(m)
    map.set(m.category, list)
  }
  return Array.from(map.entries()).map(([category, list]) => ({ category, modules: list }))
}

// Reforma F6: Card de módulos do sistema (ligar/desligar globalmente).
// Desativado = some do menu de TODOS (inclusive SUPERADMIN). Reativar é
// sempre possível por aqui — SUPERADMIN tem acesso ao endpoint list-all.
function SystemModulesCard() {
  const { data, isLoading } = useSystemModules()
  const toggle = useToggleSystemModule()

  if (isLoading || !data) {
    return <Card><div class="p-4"><Skeleton class="h-32 w-full" /></div></Card>
  }

  const handleToggle = async (id: string, name: string, next: boolean, core: boolean, hasUsage: boolean) => {
    if (!next && core) {
      toast(`Módulo "${name}" é core — não pode ser desativado`, 'danger')
      return
    }
    // Endpoint exige confirmName quando módulo tem uso ativo e está sendo desligado
    let confirmName: string | undefined
    if (!next && hasUsage) {
      const typed = window.prompt(`Para desativar "${name}" com dados em uso, digite o nome EXATO do módulo:`)
      if (!typed) return
      confirmName = typed
    }
    try {
      await toggle.mutateAsync({ id, enabled: next, ...(confirmName ? { confirmName } : {}) })
      toast(next ? `Módulo "${name}" reativado` : `Módulo "${name}" desligado`, 'success')
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Falha ao alternar', 'danger')
    }
  }

  // Agrupa por categoria
  const grouped = new Map<string, typeof data.modules>()
  for (const m of data.modules) {
    const list = grouped.get(m.category) ?? []
    list.push(m)
    grouped.set(m.category, list)
  }

  return (
    <Card class="mb-4">
      <div class="p-4">
        <div class="flex items-center gap-2 mb-1">
          <Power size={16} class="text-fg-muted" />
          <h2 class="text-base font-semibold">Módulos do sistema</h2>
        </div>
        <p class="text-xs text-fg-muted mb-4">
          Liga/desliga módulos globalmente. Quando desligado, o módulo some do menu
          de <strong>todos</strong> os usuários (inclusive SUPERADMIN) e endpoints
          relacionados retornam 404. Módulos core (Dashboard, Conversas, Leads, etc.)
          não podem ser desativados.
        </p>

        <div class="space-y-4">
          {Array.from(grouped.entries()).map(([category, modules]) => (
            <div key={category}>
              <div class="text-xs uppercase tracking-wide text-fg-muted mb-2">
                {CATEGORY_LABELS[category] ?? category}
              </div>
              <div class="space-y-1">
                {modules.map((m) => {
                  const usageCount = m.usage?.total ?? 0
                  return (
                    <div
                      key={m.id}
                      class={cn(
                        'flex items-center justify-between gap-2 px-3 py-2 rounded border',
                        m.enabled ? 'border-border bg-surface' : 'border-danger/30 bg-danger/5',
                      )}
                    >
                      <div class="flex-1 min-w-0">
                        <div class="flex items-center gap-2 flex-wrap">
                          <span class="font-medium text-sm">{m.name}</span>
                          <code class="text-2xs text-fg-muted">{m.id}</code>
                          {m.core && (
                            <Badge tone="info" title="Módulo core — não pode ser desligado">
                              <Lock size={10} class="mr-0.5" /> CORE
                            </Badge>
                          )}
                          {!m.enabled && <Badge tone="danger">DESLIGADO</Badge>}
                          {usageCount > 0 && m.enabled && !m.core && (
                            <Badge tone="warning" title="Há dados em uso — desligar exige confirmação por nome">
                              {usageCount} em uso
                            </Badge>
                          )}
                        </div>
                        {m.pages.length > 0 && (
                          <div class="text-xs text-fg-muted truncate mt-0.5">
                            {m.pages.slice(0, 4).join(' · ')}
                            {m.pages.length > 4 && ` +${m.pages.length - 4}`}
                          </div>
                        )}
                      </div>
                      <label class={cn(
                        'inline-flex items-center',
                        m.core ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
                      )}>
                        <input
                          type="checkbox"
                          checked={m.enabled}
                          disabled={m.core || toggle.isPending}
                          onChange={() => handleToggle(m.id, m.name, !m.enabled, m.core, usageCount > 0)}
                          class="sr-only peer"
                        />
                        <div class="relative w-9 h-5 bg-surface-3 rounded-full peer peer-checked:bg-accent transition-colors">
                          <div class={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform ${m.enabled ? 'translate-x-4' : ''}`} />
                        </div>
                      </label>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </Card>
  )
}
