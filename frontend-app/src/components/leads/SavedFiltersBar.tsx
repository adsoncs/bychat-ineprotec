// Barra de Filtros Salvos — dropdown de seleção, salvar/atualizar, resetar.
// Funciona para qualquer scope (atualmente só 'leads' que cobre /app/leads e
// /app/kanban). O componente NÃO conhece a forma dos filtros — só repassa o
// objeto opaco para o consumidor aplicar.

import { useState, useMemo } from 'preact/hooks'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import {
  Bookmark, BookmarkPlus, ChevronDown, RotateCcw, Lock, Globe, Trash2, Pencil,
} from 'lucide-preact'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/cn'
import {
  useSavedFilters, useCreateSavedFilter, useUpdateSavedFilter, useDeleteSavedFilter,
  type SavedFilter, type FilterVisibility,
} from '@/hooks/useSavedFilters'

interface Props {
  scope: string
  /** Filtros atualmente aplicados (passa pro botão "Salvar"). */
  currentFilters: Record<string, unknown>
  /** Como saber se o que está aplicado é "vazio" (não mostra Salvar/Resetar). */
  hasActiveFilters: boolean
  /** Aplica um filtro salvo (consumidor seta seu state). */
  onApply: (filters: Record<string, unknown>, savedFilter: SavedFilter) => void
  /** Limpa tudo (consumidor reseta state + back-end /applied-filter). */
  onReset: () => void
  /** ID do usuário logado (pra mostrar botões de editar/excluir só dos próprios). */
  currentUserId?: number | undefined
}

export function SavedFiltersBar({
  scope, currentFilters, hasActiveFilters, onApply, onReset, currentUserId,
}: Props) {
  const { data, isLoading } = useSavedFilters(scope)
  const createMut = useCreateSavedFilter()
  const updateMut = useUpdateSavedFilter()
  const deleteMut = useDeleteSavedFilter()

  const [saveModalOpen, setSaveModalOpen] = useState(false)
  const [editingFilter, setEditingFilter] = useState<SavedFilter | null>(null)
  const [deletingFilter, setDeletingFilter] = useState<SavedFilter | null>(null)
  const [appliedId, setAppliedId] = useState<number | null>(null)

  const filters = data?.filters ?? []
  const { mine, others } = useMemo(() => {
    const mine: SavedFilter[] = []
    const others: SavedFilter[] = []
    for (const f of filters) {
      if (currentUserId != null && f.createdById === currentUserId) mine.push(f)
      else others.push(f)
    }
    return { mine, others }
  }, [filters, currentUserId])

  function handleApply(f: SavedFilter) {
    setAppliedId(f.id)
    onApply(f.filters, f)
    toast(`Filtro "${f.name}" aplicado`, 'success')
  }

  function handleReset() {
    setAppliedId(null)
    onReset()
  }

  async function handleSave(name: string, visibility: FilterVisibility) {
    try {
      const res = await createMut.mutateAsync({ scope, name, filters: currentFilters, visibility })
      setAppliedId(res.filter.id)
      toast(`Filtro "${name}" salvo`, 'success')
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Falha ao salvar', 'danger')
    }
  }

  async function handleUpdate(filter: SavedFilter, name: string, visibility: FilterVisibility) {
    try {
      await updateMut.mutateAsync({ id: filter.id, scope, name, visibility })
      toast(`Filtro "${name}" atualizado`, 'success')
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Falha ao atualizar', 'danger')
    }
  }

  async function handleDelete() {
    if (!deletingFilter) return
    try {
      await deleteMut.mutateAsync({ id: deletingFilter.id, scope })
      if (appliedId === deletingFilter.id) setAppliedId(null)
      toast(`Filtro "${deletingFilter.name}" excluído`, 'success')
      setDeletingFilter(null)
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Falha ao excluir', 'danger')
    }
  }

  const appliedFilter = appliedId != null ? filters.find((f) => f.id === appliedId) : undefined

  return (
    <>
      <div class="flex items-center gap-1.5 flex-wrap">
        {/* Dropdown de filtros salvos */}
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button
              type="button"
              class="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md border border-border bg-surface text-xs font-medium text-fg hover:bg-surface-2"
              disabled={isLoading}
            >
              <Bookmark size={12} />
              {appliedFilter ? appliedFilter.name : 'Filtros salvos'}
              <ChevronDown size={11} class="text-fg-subtle" />
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              align="start"
              sideOffset={4}
              class="z-50 min-w-[260px] max-h-[400px] overflow-y-auto rounded-md border border-border bg-surface-2 shadow-lg p-1"
            >
              {filters.length === 0 && (
                <div class="px-3 py-4 text-xs text-fg-subtle text-center">
                  Nenhum filtro salvo ainda. Configure os filtros abaixo e clique em <strong>Salvar</strong>.
                </div>
              )}

              {mine.length > 0 && (
                <>
                  <div class="px-2 pt-1 pb-0.5 text-[0.625rem] font-semibold text-fg-subtle uppercase">
                    Meus filtros
                  </div>
                  {mine.map((f) => (
                    <SavedFilterRow
                      key={f.id}
                      filter={f}
                      isApplied={appliedId === f.id}
                      canManage
                      onApply={() => handleApply(f)}
                      onEdit={() => setEditingFilter(f)}
                      onDelete={() => setDeletingFilter(f)}
                    />
                  ))}
                </>
              )}
              {others.length > 0 && (
                <>
                  {mine.length > 0 && <div class="my-1 h-px bg-border" />}
                  <div class="px-2 pt-1 pb-0.5 text-[0.625rem] font-semibold text-fg-subtle uppercase">
                    Filtros públicos do time
                  </div>
                  {others.map((f) => (
                    <SavedFilterRow
                      key={f.id}
                      filter={f}
                      isApplied={appliedId === f.id}
                      canManage={false}
                      onApply={() => handleApply(f)}
                      onEdit={() => {}}
                      onDelete={() => {}}
                    />
                  ))}
                </>
              )}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>

        {/* Salvar */}
        <button
          type="button"
          class="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md border border-border bg-surface text-xs font-medium text-fg-muted hover:text-fg hover:bg-surface-2 disabled:opacity-40"
          onClick={() => setSaveModalOpen(true)}
          disabled={!hasActiveFilters}
          title={hasActiveFilters ? 'Salvar combinação atual' : 'Configure ao menos um filtro pra salvar'}
        >
          <BookmarkPlus size={12} />
          Salvar
        </button>

        {/* Resetar */}
        {hasActiveFilters && (
          <button
            type="button"
            class="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md border border-border bg-surface text-xs font-medium text-fg-muted hover:text-danger hover:border-danger hover:bg-danger/5"
            onClick={handleReset}
            title="Limpa todos os filtros (também remove o filtro fixado)"
          >
            <RotateCcw size={12} />
            Resetar
          </button>
        )}
      </div>

      {saveModalOpen && (
        <SaveFilterModal
          onClose={() => setSaveModalOpen(false)}
          onSave={(name, visibility) => { void handleSave(name, visibility); setSaveModalOpen(false) }}
          loading={createMut.isPending}
        />
      )}
      {editingFilter && (
        <SaveFilterModal
          initial={{ name: editingFilter.name, visibility: editingFilter.visibility }}
          onClose={() => setEditingFilter(null)}
          onSave={(name, visibility) => { void handleUpdate(editingFilter, name, visibility); setEditingFilter(null) }}
          loading={updateMut.isPending}
          mode="edit"
        />
      )}
      {deletingFilter && (
        <ConfirmDialog
          open
          onOpenChange={(v) => { if (!v) setDeletingFilter(null) }}
          title="Excluir filtro salvo?"
          description={`"${deletingFilter.name}" será removido${deletingFilter.visibility === 'public' ? ' do time todo' : ''}. Não pode ser desfeito.`}
          confirmLabel="Excluir"
          destructive
          loading={deleteMut.isPending}
          onConfirm={handleDelete}
        />
      )}
    </>
  )
}

function SavedFilterRow({
  filter, isApplied, canManage, onApply, onEdit, onDelete,
}: {
  filter: SavedFilter
  isApplied: boolean
  canManage: boolean
  onApply: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  return (
    <div class={cn(
      'flex items-center gap-1 px-2 py-1.5 rounded-sm group',
      isApplied ? 'bg-accent/10' : 'hover:bg-surface-3',
    )}>
      <button
        type="button"
        class="flex-1 min-w-0 flex items-center gap-1.5 text-left"
        onClick={onApply}
      >
        {filter.visibility === 'public' ? (
          <Globe size={10} class="text-fg-subtle shrink-0" />
        ) : (
          <Lock size={10} class="text-fg-subtle shrink-0" />
        )}
        <span class={cn('text-xs truncate', isApplied ? 'font-semibold text-accent' : 'text-fg')}>
          {filter.name}
        </span>
        {filter.createdByName && (
          <span class="text-[0.625rem] text-fg-subtle truncate hidden sm:inline">
            · {filter.createdByName}
          </span>
        )}
      </button>
      {canManage && (
        <div class="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            type="button"
            class="size-6 grid place-items-center rounded text-fg-subtle hover:text-fg hover:bg-surface-2"
            onClick={(e) => { e.stopPropagation(); onEdit() }}
            title="Renomear / mudar visibilidade"
            aria-label="Editar"
          >
            <Pencil size={11} />
          </button>
          <button
            type="button"
            class="size-6 grid place-items-center rounded text-fg-subtle hover:text-danger hover:bg-surface-2"
            onClick={(e) => { e.stopPropagation(); onDelete() }}
            title="Excluir filtro"
            aria-label="Excluir"
          >
            <Trash2 size={11} />
          </button>
        </div>
      )}
    </div>
  )
}

function SaveFilterModal({
  initial, onClose, onSave, loading, mode = 'create',
}: {
  initial?: { name: string; visibility: FilterVisibility }
  onClose: () => void
  onSave: (name: string, visibility: FilterVisibility) => void
  loading: boolean
  mode?: 'create' | 'edit'
}) {
  const [name, setName] = useState(initial?.name ?? '')
  const [visibility, setVisibility] = useState<FilterVisibility>(initial?.visibility ?? 'private')

  return (
    <Modal
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      title={mode === 'edit' ? 'Editar filtro salvo' : 'Salvar combinação como filtro'}
      description={mode === 'edit' ? 'Renomeie ou mude a visibilidade.' : 'Dê um nome e escolha se o filtro fica privado (só você) ou público (todos do time).'}
      size="sm"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose} disabled={loading}>Cancelar</Button>
          <Button
            variant="primary" size="sm"
            onClick={() => name.trim() && onSave(name.trim(), visibility)}
            disabled={loading || !name.trim()}
          >
            {loading ? 'Salvando…' : (mode === 'edit' ? 'Atualizar' : 'Salvar')}
          </Button>
        </>
      }
    >
      <div class="space-y-3">
        <Input
          label="Nome do filtro"
          value={name}
          onInput={(e) => setName((e.target as HTMLInputElement).value)}
          placeholder="Ex.: Meus leads quentes, Sem responsável - urgente"
          maxLength={120}
        />
        <div>
          <label class="text-xs font-medium text-fg-muted block mb-1.5">Visibilidade</label>
          <div class="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setVisibility('private')}
              class={cn(
                'flex items-start gap-2 p-2.5 rounded-md border text-left',
                visibility === 'private'
                  ? 'border-accent bg-accent/5'
                  : 'border-border bg-surface hover:border-fg-subtle',
              )}
            >
              <Lock size={14} class={visibility === 'private' ? 'text-accent mt-0.5' : 'text-fg-muted mt-0.5'} />
              <div class="min-w-0 flex-1">
                <div class={cn('text-xs font-medium', visibility === 'private' ? 'text-accent' : 'text-fg')}>
                  Privado
                </div>
                <div class="text-[0.6875rem] text-fg-muted">Só você vê</div>
              </div>
            </button>
            <button
              type="button"
              onClick={() => setVisibility('public')}
              class={cn(
                'flex items-start gap-2 p-2.5 rounded-md border text-left',
                visibility === 'public'
                  ? 'border-accent bg-accent/5'
                  : 'border-border bg-surface hover:border-fg-subtle',
              )}
            >
              <Globe size={14} class={visibility === 'public' ? 'text-accent mt-0.5' : 'text-fg-muted mt-0.5'} />
              <div class="min-w-0 flex-1">
                <div class={cn('text-xs font-medium', visibility === 'public' ? 'text-accent' : 'text-fg')}>
                  Público
                </div>
                <div class="text-[0.6875rem] text-fg-muted">Todos do time veem</div>
              </div>
            </button>
          </div>
        </div>
      </div>
    </Modal>
  )
}
