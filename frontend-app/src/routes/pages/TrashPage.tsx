import { useEffect, useMemo, useState } from 'preact/hooks'
import { Trash2, Undo2, AlertTriangle, ChevronDown, HelpCircle } from '@/components/ui/icon-set'
import { HowItWorksModal } from '@/components/ui/HowItWorksModal'
import {
  useTrashItems,
  useTrashStats,
  useTrashItem,
  useRestoreTrashItem,
  useBulkRestoreTrashItems,
  useDeleteTrashItem,
  usePurgeExpiredTrash,
  TRASH_TYPE_LABELS,
  TRASH_TYPE_TONES,
  type TrashItem,
} from '@/hooks/useTrash'
import { useAuth } from '@/hooks/useAuth'
import { Page } from '@/components/ui/Page'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Skeleton } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { Modal } from '@/components/ui/Modal'
import { Select } from '@/components/ui/Input'
import { SearchInput } from '@/components/ui/SearchInput'
import { Badge } from '@/components/ui/Badge'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/cn'

const PAGE_SIZE = 100

export function TrashPage() {
  const { user } = useAuth()
  const isSuperAdmin = user?.role === 'SUPERADMIN'

  if (!isSuperAdmin) {
    return (
      <Page title="Lixeira">
        <EmptyState
          icon={<Trash2 size={24} />}
          title="Acesso restrito"
          description="Apenas Super Administradores podem acessar a lixeira."
        />
      </Page>
    )
  }

  return <TrashPageContent />
}

function TrashPageContent() {
  const [entityType, setEntityType] = useState<string>('')
  const [searchInput, setSearchInput] = useState('')
  const [searchDebounced, setSearchDebounced] = useState('')
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [detailId, setDetailId] = useState<number | null>(null)
  const [confirmRestore, setConfirmRestore] = useState<TrashItem | null>(null)
  const [confirmRestoreBulk, setConfirmRestoreBulk] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<TrashItem | null>(null)
  const [showHowItWorks, setShowHowItWorks] = useState(false)
  const [confirmPurge, setConfirmPurge] = useState(false)

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => setSearchDebounced(searchInput), 400)
    return () => clearTimeout(t)
  }, [searchInput])

  const filters = useMemo(
    () => ({
      entityType: entityType || undefined,
      search: searchDebounced || undefined,
      limit: PAGE_SIZE,
    }),
    [entityType, searchDebounced],
  )

  const { data: itemsData, isLoading } = useTrashItems(filters)
  const { data: statsData } = useTrashStats()
  const restore = useRestoreTrashItem()
  const bulkRestore = useBulkRestoreTrashItems()
  const del = useDeleteTrashItem()
  const purge = usePurgeExpiredTrash()

  const items = itemsData?.items ?? []
  const total = itemsData?.total ?? 0
  const stats = statsData

  // Limpa seleção quando filtros mudam
  useEffect(() => { setSelectedIds(new Set()) }, [entityType, searchDebounced])

  function toggleOne(id: number, checked: boolean) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (checked) next.add(id); else next.delete(id)
      return next
    })
  }

  function toggleAll(checked: boolean) {
    setSelectedIds(checked ? new Set(items.map((i) => i.id)) : new Set())
  }

  function clearFilters() {
    setEntityType('')
    setSearchInput('')
  }

  function handleRestoreOne(item: TrashItem) {
    restore.mutate(item.id, {
      onSuccess: (r) => toast(`"${r.entityLabel}" restaurado (novo ID: ${r.restoredId})`, 'success'),
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
      onSettled: () => setConfirmRestore(null),
    })
  }

  function handleBulkRestore() {
    const ids = Array.from(selectedIds)
    if (ids.length === 0) return
    bulkRestore.mutate(ids, {
      onSuccess: (r) => {
        const msg = r.failed > 0
          ? `${r.restored} restaurado(s), ${r.failed} falha(s)`
          : `${r.restored} item(ns) restaurado(s)`
        toast(msg, r.failed > 0 ? 'warning' : 'success')
        setSelectedIds(new Set())
      },
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
      onSettled: () => setConfirmRestoreBulk(false),
    })
  }

  function handleDelete(item: TrashItem) {
    del.mutate(item.id, {
      onSuccess: () => toast('Item excluído permanentemente', 'success'),
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
      onSettled: () => setConfirmDelete(null),
    })
  }

  function handlePurge() {
    purge.mutate(undefined, {
      onSuccess: (r) => toast(`${r.purged} item(ns) expirado(s) removido(s)`, 'success'),
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
      onSettled: () => setConfirmPurge(false),
    })
  }

  const hasSelection = selectedIds.size > 0
  const allChecked = items.length > 0 && items.every((i) => selectedIds.has(i.id))

  return (
    <Page
      title="Lixeira"
      description="Itens excluídos permanecem 90 dias antes da remoção definitiva."
      actions={
        <div class="flex gap-2">
          <Button variant="ghost" size="sm" onClick={() => setShowHowItWorks(true)}>
            <HelpCircle size={14} /> Como funciona?
          </Button>
          {hasSelection && (
            <Button variant="primary" size="sm" onClick={() => setConfirmRestoreBulk(true)}>
              <Undo2 size={14} /> Restaurar {selectedIds.size}
            </Button>
          )}
          <Button variant="secondary" size="sm" onClick={() => setConfirmPurge(true)}>
            Limpar expirados
          </Button>
        </div>
      }
    >
      {/* Stats — cards uniformes clicáveis por tipo (paridade com admin.js:545-559) */}
      <div class="grid gap-3 grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        <StatCard label="Na lixeira" value={stats?.total ?? '—'} tone="danger" />
        <StatCard label="Restaurados" value={stats?.restored ?? '—'} tone="success" />
        {stats?.byType.map((t) => (
          <StatCard
            key={t.type}
            label={TRASH_TYPE_LABELS[t.type] ?? t.type}
            value={t.count}
            tone={TRASH_TYPE_TONES[t.type] ?? 'info'}
            active={entityType === t.type}
            onClick={() => setEntityType(entityType === t.type ? '' : t.type)}
          />
        ))}
      </div>

      {/* Filters */}
      <Card class="p-3">
        <div class="flex flex-wrap gap-3 items-center">
          <Select
            value={entityType}
            onChange={(e) => setEntityType((e.target as HTMLSelectElement).value)}
          >
            <option value="">Todos os tipos</option>
            {Object.entries(TRASH_TYPE_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </Select>
          <SearchInput
            value={searchInput}
            onChange={setSearchInput}
            placeholder="Buscar por nome…"
            class="flex-1 min-w-48"
          />
          {(entityType || searchInput) && (
            <Button variant="secondary" size="sm" onClick={clearFilters}>Limpar filtros</Button>
          )}
          <span class="text-xs text-fg-muted ml-auto">{total} item(ns)</span>
        </div>
      </Card>

      {/* Table */}
      <Card class="p-0 overflow-hidden">
        {isLoading && (
          <div class="p-4 space-y-2">
            {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} class="h-10 w-full" />)}
          </div>
        )}
        {!isLoading && items.length === 0 && (
          <div class="p-8">
            <EmptyState
              icon={<Trash2 size={24} />}
              title="Nenhum item na lixeira"
              description={entityType || searchInput ? 'Tente limpar os filtros.' : 'Quando você excluir algo, ele aparece aqui.'}
            />
          </div>
        )}
        {!isLoading && items.length > 0 && (
          <div class="overflow-x-auto">
            <table class="w-full text-sm">
              <thead>
                <tr class="border-b border-border bg-surface-3">
                  <th class="w-10 text-center px-3 py-2">
                    <input
                      type="checkbox"
                      checked={allChecked}
                      onChange={(e) => toggleAll((e.target as HTMLInputElement).checked)}
                      class="size-4 cursor-pointer accent-accent"
                      aria-label="Selecionar todos"
                    />
                  </th>
                  <th class="text-left px-3 py-2 text-xs font-semibold text-fg-muted">Tipo</th>
                  <th class="text-left px-3 py-2 text-xs font-semibold text-fg-muted">Item</th>
                  <th class="text-left px-3 py-2 text-xs font-semibold text-fg-muted">Excluído por</th>
                  <th class="text-left px-3 py-2 text-xs font-semibold text-fg-muted">Data</th>
                  <th class="text-left px-3 py-2 text-xs font-semibold text-fg-muted">Expira em</th>
                  <th class="w-20 px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <TrashRow
                    key={item.id}
                    item={item}
                    selected={selectedIds.has(item.id)}
                    onToggle={(checked) => toggleOne(item.id, checked)}
                    onView={() => setDetailId(item.id)}
                    onRestore={() => setConfirmRestore(item)}
                    onDelete={() => setConfirmDelete(item)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Aviso */}
      <div class="rounded-md border border-warning/30 bg-warning/10 p-3 text-xs text-fg flex items-start gap-2">
        <AlertTriangle size={14} class="mt-0.5 shrink-0 text-warning" />
        <span>
          Itens permanecem na lixeira por <strong>90 dias</strong>. Após esse período, são removidos automaticamente e não podem ser recuperados.
        </span>
      </div>

      {/* Modals */}
      {detailId !== null && (
        <TrashDetailModal id={detailId} onClose={() => setDetailId(null)} onRestore={(item) => { setDetailId(null); setConfirmRestore(item) }} />
      )}
      {confirmRestore && (
        <ConfirmDialog
          open
          onOpenChange={(o) => { if (!o) setConfirmRestore(null) }}
          title={`Restaurar "${confirmRestore.entityLabel}"`}
          description="O item será recriado no sistema com um novo ID."
          confirmLabel="Restaurar"
          loading={restore.isPending}
          onConfirm={() => handleRestoreOne(confirmRestore)}
        />
      )}
      {confirmRestoreBulk && (
        <ConfirmDialog
          open
          onOpenChange={(o) => { if (!o) setConfirmRestoreBulk(false) }}
          title={`Restaurar ${selectedIds.size} item(ns)`}
          description="Cada item será recriado com um novo ID. Falhas individuais não interrompem o lote."
          confirmLabel="Restaurar todos"
          loading={bulkRestore.isPending}
          onConfirm={handleBulkRestore}
        />
      )}
      {confirmDelete && (
        <ConfirmDialog
          open
          onOpenChange={(o) => { if (!o) setConfirmDelete(null) }}
          title={`Excluir "${confirmDelete.entityLabel}"`}
          description="Esta ação NÃO pode ser desfeita. O item será perdido para sempre."
          destructive
          confirmLabel="Excluir permanentemente"
          loading={del.isPending}
          onConfirm={() => handleDelete(confirmDelete)}
        />
      )}
      {confirmPurge && (
        <ConfirmDialog
          open
          onOpenChange={(o) => { if (!o) setConfirmPurge(false) }}
          title="Limpar itens expirados"
          description="Remove definitivamente todos os itens com mais de 90 dias na lixeira."
          destructive
          confirmLabel="Limpar expirados"
          loading={purge.isPending}
          onConfirm={handlePurge}
        />
      )}

      <HowItWorksModal
        open={showHowItWorks}
        onClose={() => setShowHowItWorks(false)}
        title="Como funciona a Lixeira?"
        problem={<>
          Excluir é definitivo? Não — no Attrae, exclusão é "soft delete": o item sai da lista
          normal mas <strong>fica na lixeira por 90 dias</strong>. Apagou um lead importante?
          Deletou cadência por engano? Tem como recuperar. Depois dos 90 dias, vira definitivo.
        </>}
        steps={[
          {
            title: '🗂️ Filtre por tipo',
            body: <>Lead, Cadência, Etiqueta, Chatbot, Atividade, Formulário, Funil… Todo tipo de item excluído aparece aqui, agrupado. Cards no topo mostram quantos de cada tipo.</>,
          },
          {
            title: '↩️ Restaurar 1 ou em lote',
            body: <>Selecione um (ou vários) e clique em <strong>Restaurar</strong>. Item volta pra lista normal com todos os dados originais. Dependências também voltam (se possível).</>,
          },
          {
            title: '🔍 Detalhe do item',
            body: <>Clique pra ver o que estava nele antes de excluir. Útil pra confirmar "é isso mesmo?" antes de restaurar. Mostra quem excluiu, quando, e snapshot dos dados.</>,
          },
          {
            title: '🧹 Limpar expirados',
            body: <>Itens com 90+ dias na lixeira <strong>já estão programados pra remoção definitiva</strong>. Botão <strong>Limpar expirados</strong> antecipa essa limpeza (útil em auditorias ou conformidade LGPD).</>,
          },
          {
            title: '⏳ Após 90 dias',
            body: <>O sistema remove sozinho. Não dá pra recuperar mais — vira lixo permanente. Se precisar de retenção maior, configure em <strong>Configurações › Lixeira</strong> ou guarde backup externo.</>,
          },
        ]}
        tip={{
          tone: 'info',
          title: '💡 Quando usar restauração',
          body: <>"Vendedor excluiu lead errado", "Cadência foi apagada antes do fim do mês de relatório", "Tag importante foi removida". Em vez de criar do zero, restaure — preserva o histórico original (data de criação, conversas, IDs externos).</>,
        }}
      />
    </Page>
  )
}

type StatTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info'

const STAT_VALUE_COLORS: Record<StatTone, string> = {
  neutral: 'text-fg-muted',
  accent: 'text-accent',
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-danger',
  info: 'text-info',
}

function StatCard({
  label, value, tone, active, onClick,
}: {
  label: string
  value: string | number
  tone: StatTone
  active?: boolean
  onClick?: () => void
}) {
  const valueClass = STAT_VALUE_COLORS[tone]
  const isInteractive = !!onClick
  const Tag = isInteractive ? 'button' : 'div'
  return (
    <Tag
      type={isInteractive ? 'button' : undefined}
      onClick={onClick}
      class={cn(
        'rounded-lg border bg-surface-2 p-4 text-center transition-colors',
        isInteractive && 'cursor-pointer hover:bg-surface-3',
        active ? 'border-accent ring-1 ring-accent' : 'border-border',
      )}
    >
      <div class={cn('text-2xl font-semibold tabular-nums', valueClass)}>{value}</div>
      <div class="text-xs text-fg-muted mt-1 truncate">{label}</div>
    </Tag>
  )
}

function TrashRow({
  item, selected, onToggle, onView, onRestore, onDelete,
}: {
  item: TrashItem
  selected: boolean
  onToggle: (checked: boolean) => void
  onView: () => void
  onRestore: () => void
  onDelete: () => void
}) {
  const deletedDate = new Date(item.createdAt)
  const expiresDate = new Date(item.expiresAt)
  const daysLeft = Math.max(0, Math.ceil((expiresDate.getTime() - Date.now()) / 86400000))
  const expireTone = daysLeft < 7 ? 'danger' : daysLeft < 30 ? 'warning' : 'success'

  return (
    <tr class={cn('border-b border-border last:border-b-0 hover:bg-surface-3', selected && 'bg-accent/5')}>
      <td class="text-center px-3 py-2">
        <input
          type="checkbox"
          checked={selected}
          onChange={(e) => onToggle((e.target as HTMLInputElement).checked)}
          class="size-4 cursor-pointer accent-accent"
          aria-label={`Selecionar ${item.entityLabel}`}
        />
      </td>
      <td class="px-3 py-2">
        <Badge tone={TRASH_TYPE_TONES[item.entityType] ?? 'info'} solid>
          {TRASH_TYPE_LABELS[item.entityType] ?? item.entityType}
        </Badge>
      </td>
      <td class="px-3 py-2">
        <button
          type="button"
          onClick={onView}
          class="text-left text-fg hover:text-accent font-medium"
        >
          {item.entityLabel}
        </button>
        <div class="text-2xs text-fg-muted">ID original: {item.entityId}</div>
      </td>
      <td class="px-3 py-2 text-fg-muted">{item.deletedByName ?? '—'}</td>
      <td class="px-3 py-2 text-fg-muted text-xs whitespace-nowrap">
        {deletedDate.toLocaleDateString('pt-BR')} {deletedDate.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
      </td>
      <td class="px-3 py-2">
        <Badge tone={expireTone} solid>{daysLeft} dias</Badge>
      </td>
      <td class="px-3 py-2">
        <RowActions onView={onView} onRestore={onRestore} onDelete={onDelete} />
      </td>
    </tr>
  )
}

function RowActions({ onView, onRestore, onDelete }: {
  onView: () => void
  onRestore: () => void
  onDelete: () => void
}) {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    function close() { setOpen(false) }
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [open])

  return (
    <div class="relative inline-block">
      <button
        type="button"
        class="inline-flex items-center gap-1 h-7 px-2 rounded-md text-xs text-fg-muted hover:text-fg hover:bg-surface-2 border border-border"
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o) }}
      >
        Ações <ChevronDown size={12} />
      </button>
      {open && (
        <div
          class="absolute right-0 top-full mt-1 w-44 rounded-md border border-border bg-surface-2 shadow-lg py-1 z-10"
          onClick={(e) => e.stopPropagation()}
        >
          <ActionButton onClick={() => { setOpen(false); onView() }}>Ver detalhes</ActionButton>
          <ActionButton tone="success" onClick={() => { setOpen(false); onRestore() }}>Restaurar</ActionButton>
          <ActionButton tone="danger" onClick={() => { setOpen(false); onDelete() }}>Excluir permanentemente</ActionButton>
        </div>
      )}
    </div>
  )
}

function ActionButton({ children, tone, onClick }: {
  children: preact.ComponentChildren
  tone?: 'success' | 'danger'
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      class={cn(
        'block w-full text-left px-3 py-1.5 text-xs hover:bg-surface-3',
        tone === 'success' && 'text-accent',
        tone === 'danger' && 'text-danger',
        !tone && 'text-fg',
      )}
    >
      {children}
    </button>
  )
}

function TrashDetailModal({ id, onClose, onRestore }: {
  id: number
  onClose: () => void
  onRestore: (item: TrashItem) => void
}) {
  const { data, isLoading, error } = useTrashItem(id)
  const item = data?.item

  return (
    <Modal
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      title={item ? `Detalhes — ${item.entityLabel}` : 'Detalhes do item'}
      size="lg"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose}>Fechar</Button>
          {item && (
            <Button variant="primary" size="sm" onClick={() => onRestore(item)}>
              <Undo2 size={14} /> Restaurar
            </Button>
          )}
        </>
      }
    >
      {isLoading && <Skeleton class="h-48 w-full" />}
      {error && <div class="text-sm text-danger">Erro ao carregar detalhes.</div>}
      {item && <TrashItemDetailBody item={item} />}
    </Modal>
  )
}

function TrashItemDetailBody({ item }: { item: { entityType: string; entityLabel: string; entityId: number; deletedByName: string | null; reason: string | null; createdAt: string; expiresAt: string; snapshot: Record<string, unknown> | null } }) {
  const deletedDate = new Date(item.createdAt)
  const expiresDate = new Date(item.expiresAt)
  const summary = renderSnapshotSummary(item.entityType, item.snapshot)

  return (
    <div class="space-y-4">
      <div class="flex items-center gap-2">
        <Badge tone={TRASH_TYPE_TONES[item.entityType] ?? 'info'} solid>
          {TRASH_TYPE_LABELS[item.entityType] ?? item.entityType}
        </Badge>
        <span class="text-xs text-fg-muted">ID original: {item.entityId}</span>
      </div>

      {summary && <div class="text-sm text-fg">{summary}</div>}

      <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs bg-surface-3 rounded-md p-3">
        <div><span class="text-fg-muted">Excluído por: </span><span class="text-fg">{item.deletedByName ?? '—'}</span></div>
        <div><span class="text-fg-muted">Data: </span><span class="text-fg">{deletedDate.toLocaleString('pt-BR')}</span></div>
        <div><span class="text-fg-muted">Expira em: </span><span class="text-fg">{expiresDate.toLocaleDateString('pt-BR')}</span></div>
        <div><span class="text-fg-muted">Motivo: </span><span class="text-fg">{item.reason ?? 'Não informado'}</span></div>
      </div>

      {item.snapshot && (
        <details class="rounded-md border border-border bg-surface">
          <summary class="cursor-pointer px-3 py-2 text-xs font-medium text-fg-muted hover:text-fg">
            Ver snapshot completo (JSON)
          </summary>
          <pre class="text-2xs font-mono text-fg-muted p-3 overflow-auto max-h-80 border-t border-border">{JSON.stringify(item.snapshot, null, 2)}</pre>
        </details>
      )}
    </div>
  )
}

function renderSnapshotSummary(entityType: string, snap: Record<string, unknown> | null): preact.ComponentChildren {
  if (!snap) return null

  function arrLen(key: string): number {
    const v = snap![key]
    return Array.isArray(v) ? v.length : 0
  }
  function str(key: string): string {
    const v = snap![key]
    return typeof v === 'string' && v.length > 0 ? v : '—'
  }

  if (entityType === 'lead') {
    return (
      <div class="space-y-2">
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
          <div><span class="text-fg-muted">Empresa: </span>{str('empresa')}</div>
          <div><span class="text-fg-muted">Nome: </span>{str('nome')}</div>
          <div><span class="text-fg-muted">WhatsApp: </span>{str('whatsapp')}</div>
          <div><span class="text-fg-muted">Email: </span>{str('email')}</div>
          <div><span class="text-fg-muted">Status: </span>{str('status')}</div>
          <div><span class="text-fg-muted">Segmento: </span>{str('segmento')}</div>
        </div>
        <div class="text-xs text-fg-muted">
          {arrLen('messages')} mensagens · {arrLen('events')} eventos · {arrLen('activities')} atividades · {arrLen('tags')} tags · {arrLen('detectedSales')} vendas
        </div>
      </div>
    )
  }
  if (entityType === 'funnel') {
    return <div>Funil: <strong>{str('name')}</strong> · {arrLen('stages')} etapas</div>
  }
  if (entityType === 'chatbot') {
    return <div>Chatbot: <strong>{str('name')}</strong> · canal {str('channel')} · {arrLen('questions')} perguntas</div>
  }
  if (entityType === 'workflow') {
    return <div>Fluxo: <strong>{str('name')}</strong> · gatilho {str('triggerEvent')} · {arrLen('steps')} passos</div>
  }
  if (entityType === 'user') {
    return <div>Usuário: <strong>{str('name')}</strong> ({str('email')}) · papel {str('role')}</div>
  }
  return null
}
