import { useMemo, useState } from 'preact/hooks'
import { Search } from 'lucide-preact'
import { useModules, useModuleUsage, useToggleModule, type SystemModule } from '@/hooks/useModules'
import { Skeleton } from '@/components/ui/Skeleton'
import { Modal } from '@/components/ui/Modal'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { toast } from '@/lib/toast'

type StatusFilter = 'all' | 'active' | 'inactive' | 'core'

const CATEGORY_LABELS: Record<string, string> = {
  overview: 'Visão Geral',
  crm: 'CRM',
  automacao: 'Automação',
  captacao: 'Captação',
  marketing: 'Marketing',
  vendas: 'Vendas',
  canais: 'Canais',
  integracoes: 'Integrações',
  educacional: 'Educacional',
  config: 'Configuração',
  admin: 'Administração',
}

const CATEGORY_ORDER = [
  'overview', 'crm', 'canais', 'captacao', 'marketing', 'automacao',
  'vendas', 'educacional', 'integracoes', 'config', 'admin',
]

function normalize(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
}

export function ModulesSettings() {
  const { data, isLoading } = useModules()
  const toggle = useToggleModule()

  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState<string>('all')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [activating, setActivating] = useState<SystemModule | null>(null)
  const [deactivatingSimple, setDeactivatingSimple] = useState<SystemModule | null>(null)
  const [dangerousDeactivate, setDangerousDeactivate] = useState<SystemModule | null>(null)

  const all = useMemo<SystemModule[]>(() => data?.modules ?? [], [data])
  const totalEnabled = all.filter((m) => m.enabled).length
  const totalCore = all.filter((m) => m.core).length
  const totalInactive = all.length - totalEnabled

  const presentCats = useMemo(
    () => CATEGORY_ORDER.filter((c) => all.some((m) => m.category === c)),
    [all],
  )

  const filtered = useMemo(() => {
    const q = normalize(search.trim())
    return all.filter((m) => {
      if (categoryFilter !== 'all' && m.category !== categoryFilter) return false
      if (statusFilter === 'active' && (!m.enabled || m.core)) return false
      if (statusFilter === 'inactive' && (m.enabled || m.core)) return false
      if (statusFilter === 'core' && !m.core) return false
      if (q && !normalize(`${m.name} ${m.description ?? ''} ${m.id}`).includes(q)) return false
      return true
    })
  }, [all, categoryFilter, statusFilter, search])

  function handleToggleClick(m: SystemModule) {
    if (m.core) return
    if (!m.enabled) {
      setActivating(m)
      return
    }
    if ((m.usage?.total ?? 0) === 0) {
      setDeactivatingSimple(m)
      return
    }
    setDangerousDeactivate(m)
  }

  function doToggle(m: SystemModule, enabled: boolean, confirmName: string | null) {
    const payload: { id: string; enabled: boolean; confirmName?: string | undefined } = { id: m.id, enabled }
    if (confirmName) payload.confirmName = confirmName
    toggle.mutate(payload, {
      onSuccess: () => toast(`Módulo ${m.name} ${enabled ? 'ativado' : 'desativado'}`, 'success'),
      onError: (e) => toast(`Erro: ${e.message}`, 'danger'),
    })
  }

  return (
    <div class="space-y-3.5">
      {/* Banner gradient com KPIs */}
      <div class="rounded-xl border border-border p-[18px_22px] flex items-center gap-[18px] flex-wrap bg-gradient-to-br from-accent/10 to-surface-2">
        <div class="text-3xl">🧩</div>
        <div class="flex-1 min-w-[12.5rem]">
          <div class="text-sm font-semibold text-fg">Módulos do sistema</div>
          <div class="text-xs text-fg-muted mt-0.5">
            {all.length} no total · {totalEnabled} ativos · {totalCore} nativos (sempre ligados)
          </div>
        </div>
        <div class="flex items-center">
          <div class="text-center px-3.5">
            <div class="text-2xl font-bold leading-none text-accent">{totalEnabled}</div>
            <div class="text-[0.625rem] text-fg-muted uppercase tracking-wider mt-1">Ativos</div>
          </div>
          <div class="w-px h-8 bg-border" />
          <div class="text-center px-3.5">
            <div class="text-2xl font-bold leading-none text-info">{totalCore}</div>
            <div class="text-[0.625rem] text-fg-muted uppercase tracking-wider mt-1">Nativos</div>
          </div>
          <div class="w-px h-8 bg-border" />
          <div class="text-center px-3.5">
            <div class="text-2xl font-bold leading-none text-warning">{totalInactive}</div>
            <div class="text-[0.625rem] text-fg-muted uppercase tracking-wider mt-1">Inativos</div>
          </div>
        </div>
      </div>

      {/* Filtros */}
      <div class="flex items-center gap-2.5 flex-wrap">
        <div class="relative flex-1 min-w-60">
          <Search size={14} class="absolute left-3 top-1/2 -translate-y-1/2 text-fg-subtle pointer-events-none" />
          <input
            type="search"
            value={search}
            onInput={(e) => setSearch((e.target as HTMLInputElement).value)}
            placeholder="Buscar por nome, descrição ou id..."
            autocomplete="off"
            class="w-full h-10 pl-9 pr-3 rounded-lg bg-surface border border-border text-sm text-fg focus:outline-none focus:border-accent"
          />
        </div>
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter((e.target as HTMLSelectElement).value)}
          class="h-10 px-3 rounded-lg bg-surface border border-border text-sm text-fg focus:outline-none focus:border-accent"
          aria-label="Filtrar por categoria"
        >
          <option value="all">Todas as categorias</option>
          {presentCats.map((c) => (
            <option key={c} value={c}>{CATEGORY_LABELS[c] ?? c}</option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter((e.target as HTMLSelectElement).value as StatusFilter)}
          class="h-10 px-3 rounded-lg bg-surface border border-border text-sm text-fg focus:outline-none focus:border-accent"
          aria-label="Filtrar por status"
        >
          <option value="all">Todos os status</option>
          <option value="active">Ativos</option>
          <option value="inactive">Inativos</option>
          <option value="core">Essenciais</option>
        </select>
        <span class="text-[0.6875rem] text-fg-muted whitespace-nowrap">
          {filtered.length} de {all.length}
        </span>
      </div>

      {isLoading && <Skeleton class="h-32 w-full" />}

      {!isLoading && (
        <div class="rounded-xl border border-border bg-surface-2 overflow-hidden">
          <div class="overflow-x-auto">
            <table class="w-full text-sm" style={{ minWidth: '48.75rem' }}>
              <thead class="bg-surface text-fg-muted text-[0.6875rem]">
                <tr class="border-b border-border">
                  <th class="px-3 py-2.5 text-left font-semibold uppercase tracking-wider">Módulo</th>
                  <th class="px-3 py-2.5 text-left font-semibold uppercase tracking-wider">Identificador</th>
                  <th class="px-3 py-2.5 text-left font-semibold uppercase tracking-wider">Categoria</th>
                  <th class="px-3 py-2.5 text-center font-semibold uppercase tracking-wider">Status</th>
                  <th class="px-3 py-2.5 text-right font-semibold uppercase tracking-wider">Ação</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={5} class="text-center py-8 text-fg-muted italic text-sm">
                      Nenhum módulo encontrado
                    </td>
                  </tr>
                )}
                {filtered.map((m) => (
                  <ModuleRow key={m.id} module={m} onToggle={() => handleToggleClick(m)} disabled={toggle.isPending} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Confirm: Ativar */}
      {activating && (
        <ConfirmDialog
          open
          onOpenChange={(o) => { if (!o) setActivating(null) }}
          title={`Ativar o módulo "${activating.name}"?`}
          description="O módulo será habilitado para os usuários ADMIN e MANAGER. Nenhum dado é pré-criado — o cadastro é feito por demanda."
          confirmLabel="Ativar"
          loading={toggle.isPending}
          onConfirm={() => {
            doToggle(activating, true, null)
            setActivating(null)
          }}
        />
      )}

      {/* Confirm: Desativar sem uso */}
      {deactivatingSimple && (
        <ConfirmDialog
          open
          onOpenChange={(o) => { if (!o) setDeactivatingSimple(null) }}
          title={`Desativar o módulo "${deactivatingSimple.name}"?`}
          description="Os dados NÃO serão apagados — apenas o acesso será revogado. Você pode reativar a qualquer momento."
          confirmLabel="Desativar"
          destructive
          loading={toggle.isPending}
          onConfirm={() => {
            doToggle(deactivatingSimple, false, null)
            setDeactivatingSimple(null)
          }}
        />
      )}

      {/* Modal type-to-confirm: Desativar com uso */}
      {dangerousDeactivate && (
        <DangerousDeactivateModal
          module={dangerousDeactivate}
          onClose={() => setDangerousDeactivate(null)}
          onConfirm={(name) => {
            doToggle(dangerousDeactivate, false, name)
            setDangerousDeactivate(null)
          }}
          loading={toggle.isPending}
        />
      )}
    </div>
  )
}

function ModuleRow({
  module: m, onToggle, disabled,
}: {
  module: SystemModule
  onToggle: () => void
  disabled: boolean
}) {
  const isActive = !!m.enabled
  const isCore = !!m.core
  const dimmed = !isActive && !isCore

  const statusBadge = isCore ? (
    <span class="inline-block text-[0.625rem] font-semibold px-2.5 py-[3px] rounded-full bg-accent text-fg-on-brand">
      🔒 Nativo
    </span>
  ) : isActive ? (
    <span class="inline-block text-[0.625rem] font-semibold px-2.5 py-[3px] rounded-full bg-accent text-fg-on-brand">
      ● Ativo
    </span>
  ) : (
    <span class="inline-block text-[0.625rem] font-semibold px-2.5 py-[3px] rounded-full bg-surface text-fg-muted">
      ○ Inativo
    </span>
  )

  const actionCell = isCore ? (
    <span class="text-fg-subtle text-[0.6875rem] italic">sempre ativo</span>
  ) : isActive ? (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      class="px-3 py-1.5 rounded border border-danger/40 bg-transparent text-danger text-[0.6875rem] font-medium cursor-pointer hover:bg-danger/10 disabled:opacity-60"
    >
      Desativar
    </button>
  ) : (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      class="px-3 py-1.5 rounded bg-accent text-fg-on-brand text-[0.6875rem] font-medium cursor-pointer hover:opacity-90 disabled:opacity-60"
    >
      Ativar
    </button>
  )

  return (
    <tr class={`border-b border-border last:border-0 hover:bg-surface ${dimmed ? 'opacity-70' : ''}`}>
      <td class="px-3 py-2.5">
        <div class="flex items-center gap-2.5">
          <div
            class={`shrink-0 w-9 h-9 rounded-lg flex items-center justify-center text-lg ${
              isActive || isCore ? 'bg-accent/15 text-accent' : 'bg-surface text-fg-muted'
            }`}
          >
            {m.icon || '🧩'}
          </div>
          <div class="min-w-0">
            <div class="font-medium text-fg">{m.name}</div>
            {m.description && (
              <div class="text-[0.6875rem] text-fg-muted mt-0.5 line-clamp-1">{m.description}</div>
            )}
          </div>
        </div>
      </td>
      <td class="px-3 py-2.5 font-mono text-[0.6875rem] text-fg-muted">{m.id}</td>
      <td class="px-3 py-2.5 text-fg-muted">{CATEGORY_LABELS[m.category] ?? m.category ?? '—'}</td>
      <td class="px-3 py-2.5 text-center">{statusBadge}</td>
      <td class="px-3 py-2.5 text-right">{actionCell}</td>
    </tr>
  )
}

function DangerousDeactivateModal({
  module: m, onClose, onConfirm, loading,
}: {
  module: SystemModule
  onClose: () => void
  onConfirm: (name: string) => void
  loading: boolean
}) {
  const { data } = useModuleUsage(m.id)
  const usage = data?.usage ?? m.usage ?? { total: 0, items: [] }
  const [confirmName, setConfirmName] = useState('')
  const matches = confirmName.trim() === m.name

  return (
    <Modal
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      title="🛑 Desativar módulo em uso"
      size="md"
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            class="px-4 py-2 rounded-lg border border-border bg-transparent text-fg-muted text-sm cursor-pointer disabled:opacity-60"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => matches && onConfirm(m.name)}
            disabled={!matches || loading}
            class={`px-4 py-2 rounded-lg text-white text-sm font-semibold cursor-pointer disabled:cursor-not-allowed ${
              matches ? 'bg-danger hover:opacity-90' : 'bg-fg-subtle/50'
            }`}
          >
            {loading ? 'Desativando…' : 'Desativar módulo'}
          </button>
        </>
      }
    >
      <div class="space-y-3.5">
        <p class="text-sm text-fg leading-relaxed m-0">
          O módulo <strong>{m.name}</strong> está em uso ativo. Existem registros vinculados:
        </p>

        <ul class="m-0 px-3.5 py-3 pl-7 rounded-lg border border-danger/30 bg-danger/10 text-sm text-fg space-y-1">
          {usage.items.length === 0 ? (
            <li>(sem detalhes)</li>
          ) : (
            usage.items.map((it) => (
              <li key={it.label}>
                <strong class="text-fg">{it.count}</strong> {it.label}
              </li>
            ))
          )}
        </ul>

        <div class="rounded-lg border border-warning/40 bg-warning/10 px-3.5 py-2.5 text-xs text-fg leading-relaxed">
          <strong>O que acontece ao desativar:</strong>
          <ul class="mt-1.5 ml-4 space-y-0.5 list-disc">
            <li>Os dados acima <strong>não são apagados</strong>, mas:</li>
            <li>operadores perdem acesso à UI deste módulo</li>
            <li>portais públicos vinculados param de aceitar novas operações</li>
            <li>workflows ativos vinculados deixam de disparar</li>
            <li>você pode reativar a qualquer momento — tudo volta como estava</li>
          </ul>
        </div>

        <div>
          <label class="text-xs text-fg-muted block mb-1.5">
            Para confirmar, digite{' '}
            <code class="px-2 py-0.5 rounded bg-surface text-danger font-semibold">{m.name}</code>{' '}
            abaixo:
          </label>
          <input
            type="text"
            value={confirmName}
            onInput={(e) => setConfirmName((e.target as HTMLInputElement).value)}
            autocomplete="off"
            autofocus
            placeholder="Nome do módulo"
            class="w-full h-10 px-3 rounded-md bg-surface border border-border text-sm text-fg focus:outline-none focus:border-accent"
          />
        </div>
      </div>
    </Modal>
  )
}
