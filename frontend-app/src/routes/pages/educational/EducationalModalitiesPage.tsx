import { useMemo, useState } from 'preact/hooks'
import { Layers, Plus, Pencil, Trash2 } from '@/components/ui/icon-set'
import {
  useModalities,
  useCreateModality,
  useUpdateModality,
  useDeleteModality,
  useReorderModalities,
  type Modality,
  type ModalityInput,
} from '@/hooks/useEducational'
import { Page } from '@/components/ui/Page'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Skeleton } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { Modal } from '@/components/ui/Modal'
import { Input, Textarea } from '@/components/ui/Input'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { SortableList } from '@/components/ui/SortableList'
import { EduListHero, EduCountPill } from '@/components/educational/EduListHero'
import { EduSearchBar } from '@/components/educational/EduSearchBar'
import { ApiError } from '@/lib/apiClient'
import { toast } from '@/lib/toast'
import { slugify } from '@/lib/slug'

export function EducationalModalitiesPage() {
  const { data, isLoading } = useModalities()
  const reorder = useReorderModalities()
  const [editing, setEditing] = useState<Modality | null>(null)
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState<Modality | null>(null)
  const [search, setSearch] = useState('')

  const modalities = useMemo(() => data?.modalities ?? [], [data])

  const totals = useMemo(() => ({
    active: modalities.filter((m) => m.active !== false).length,
    used: modalities.filter((m) => (m._count?.offerings ?? 0) > 0).length,
    offerings: modalities.reduce((a, m) => a + (m._count?.offerings ?? 0), 0),
  }), [modalities])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return modalities
    return modalities.filter((m) =>
      [m.nome, m.codigo, m.descricao].some((s) => (s ?? '').toLowerCase().includes(q)),
    )
  }, [modalities, search])

  function handleReorder(newOrder: Modality[]) {
    if (search.trim()) return
    reorder.mutate(
      newOrder.map((m, idx) => ({ id: m.id, position: idx })),
      { onError: (e: unknown) => toast((e as Error).message, 'danger') },
    )
  }

  return (
    <Page
      title="Modalidades"
      description="Presencial, EAD, Semipresencial, Híbrido..."
      actions={
        <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
          <Plus size={14} /> Nova modalidade
        </Button>
      }
    >
      <EduListHero
        icon={<Layers size={26} />}
        title="Visão geral"
        summary={`${modalities.length} modalidade(s) · ${totals.active} ativa(s)`}
        kpis={[
          { value: totals.active, label: 'Ativas', tone: 'accent' },
          { value: totals.used, label: 'Em uso', tone: 'success' },
          { value: totals.offerings, label: 'Ofertas', tone: 'warning' },
        ]}
      />

      {isLoading && (
        <div class="grid gap-2 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} class="h-16 w-full" />)}
        </div>
      )}

      {!isLoading && modalities.length === 0 && (
        <EmptyState
          icon={<Layers size={24} />}
          title="Nenhuma modalidade cadastrada"
          description="Defina as modalidades (Presencial, EAD, Semipresencial, Híbrido...) das suas ofertas"
          action={
            <Button size="sm" variant="primary" onClick={() => setCreating(true)}>
              <Plus size={14} /> Nova modalidade
            </Button>
          }
        />
      )}

      {!isLoading && modalities.length > 0 && (
        <>
          <EduSearchBar
            value={search}
            onChange={setSearch}
            placeholder="Buscar por nome, código, descrição..."
            total={modalities.length}
            filteredCount={filtered.length}
          />

          {filtered.length === 0 ? (
            <Card>
              <div class="text-xs text-fg-muted italic text-center py-8">
                Nenhum resultado para "{search}"
              </div>
            </Card>
          ) : (
            <Card>
              <SortableList
                items={filtered}
                onReorder={handleReorder}
                renderItem={(m) => (
                  <div class="flex items-center gap-3 py-1.5 group">
                    <span class="inline-flex items-center justify-center min-w-6 h-6 px-1.5 rounded-md bg-accent/15 text-accent text-2xs font-bold tabular-nums shrink-0">
                      {m.ordem ?? 0}
                    </span>
                    <div class="min-w-0 flex-1">
                      <div class="flex items-center gap-2 flex-wrap">
                        <span class="text-sm font-medium text-fg truncate">{m.nome}</span>
                        {m.codigo && (
                          <span class="font-mono text-2xs text-fg-muted">{m.codigo}</span>
                        )}
                        <span
                          class={
                            'text-3xs font-semibold px-2 py-0.5 rounded-full tabular-nums ' +
                            (m.active !== false
                              ? 'bg-accent text-fg-on-brand'
                              : 'bg-surface-3 text-fg-muted')
                          }
                        >
                          {m.active !== false ? '● Ativa' : '○ Inativa'}
                        </span>
                      </div>
                      {m.descricao && (
                        <div class="text-xs text-fg-muted truncate mt-0.5">{m.descricao}</div>
                      )}
                    </div>
                    {m._count && (
                      <div class="hidden sm:flex items-center gap-3 text-2xs text-fg-muted tabular-nums shrink-0">
                        <EduCountPill label="Ofertas" n={m._count.offerings} />
                      </div>
                    )}
                    <div class="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        type="button"
                        class="size-7 rounded grid place-items-center text-accent bg-accent/10 hover:bg-accent/20"
                        onClick={() => setEditing(m)}
                        aria-label="Editar"
                        title="Editar"
                      >
                        <Pencil size={12} />
                      </button>
                      <button
                        type="button"
                        class="size-7 rounded grid place-items-center text-danger bg-danger/10 hover:bg-danger/20"
                        onClick={() => setDeleting(m)}
                        aria-label="Excluir"
                        title="Excluir"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                )}
              />
            </Card>
          )}
        </>
      )}

      {(creating || editing) && (
        <ModalityFormModal
          modality={editing}
          onClose={() => { setCreating(false); setEditing(null) }}
        />
      )}

      {deleting && (
        <DeleteModalityDialog
          modality={deleting}
          onClose={() => setDeleting(null)}
        />
      )}
    </Page>
  )
}

function ModalityFormModal({ modality, onClose }: { modality: Modality | null; onClose: () => void }) {
  const [nome, setNome] = useState(modality?.nome ?? '')
  const [codigo, setCodigo] = useState(modality?.codigo ?? '')
  const [codigoTouched, setCodigoTouched] = useState(!!modality?.codigo)
  const [descricao, setDescricao] = useState(modality?.descricao ?? '')
  const [ordem, setOrdem] = useState(String(modality?.ordem ?? 0))
  const [active, setActive] = useState(modality?.active ?? true)
  const create = useCreateModality()
  const update = useUpdateModality()
  const isEdit = !!modality
  const loading = create.isPending || update.isPending

  function handleNomeChange(v: string) {
    setNome(v)
    if (!isEdit && !codigoTouched) {
      setCodigo(slugify(v))
    }
  }

  function handleSubmit() {
    if (!nome.trim()) {
      toast('Nome é obrigatório', 'danger')
      return
    }
    const payload: ModalityInput = {
      nome: nome.trim(),
      codigo: codigo.trim() || null,
      descricao: descricao.trim() || null,
      ordem: Number.isFinite(parseInt(ordem)) ? parseInt(ordem) : 0,
      active,
    }
    if (isEdit) {
      update.mutate({ id: modality.id, ...payload }, {
        onSuccess: () => { toast('Modalidade atualizada', 'success'); onClose() },
        onError: (e: unknown) => toast((e as Error).message, 'danger'),
      })
    } else {
      create.mutate(payload, {
        onSuccess: () => { toast('Modalidade criada', 'success'); onClose() },
        onError: (e: unknown) => toast((e as Error).message, 'danger'),
      })
    }
  }

  return (
    <Modal
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      title={isEdit ? 'Editar modalidade' : 'Nova modalidade'}
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose} disabled={loading}>Cancelar</Button>
          <Button variant="primary" size="sm" onClick={handleSubmit} disabled={loading}>
            {loading ? 'Salvando…' : 'Salvar'}
          </Button>
        </>
      }
    >
      <div class="space-y-3">
        <Input
          label="Nome"
          value={nome}
          onInput={(e) => handleNomeChange((e.target as HTMLInputElement).value)}
          placeholder="Ex.: Presencial"
        />
        <div class="grid grid-cols-2 gap-3">
          <Input
            label="Código (opcional)"
            value={codigo ?? ''}
            onInput={(e) => { setCodigo((e.target as HTMLInputElement).value); setCodigoTouched(true) }}
            placeholder="Ex.: PRESENCIAL"
            hint={!isEdit && !codigoTouched ? 'Auto-gerado pelo nome' : ''}
          />
          <Input
            label="Ordem"
            type="number"
            value={ordem}
            onInput={(e) => setOrdem((e.target as HTMLInputElement).value)}
          />
        </div>
        <Textarea
          label="Descrição (opcional)"
          value={descricao ?? ''}
          onInput={(e) => setDescricao((e.target as HTMLTextAreaElement).value)}
        />
        <label class="flex items-center gap-2 text-sm text-fg-muted">
          <input type="checkbox" checked={active} onChange={(e) => setActive((e.target as HTMLInputElement).checked)} />
          Modalidade ativa
        </label>
      </div>
    </Modal>
  )
}

function DeleteModalityDialog({ modality, onClose }: { modality: Modality; onClose: () => void }) {
  const del = useDeleteModality()
  const offerings = modality._count?.offerings ?? 0
  const hasDeps = offerings > 0

  if (hasDeps) {
    return (
      <Modal
        open
        onOpenChange={(o) => { if (!o) onClose() }}
        title={`Não é possível excluir "${modality.nome}"`}
        size="sm"
        footer={<Button variant="primary" size="sm" onClick={onClose}>Entendi</Button>}
      >
        <div class="space-y-3">
          <p class="text-xs text-fg-muted">
            Existem ofertas vinculadas. Remova ou troque a modalidade nelas, ou apenas
            <strong> desative</strong> para mantê-la no histórico.
          </p>
          <ul class="space-y-1.5">
            <li class="flex items-center justify-between text-xs px-2 py-1.5 rounded bg-surface border border-border">
              <span class="text-fg">Ofertas</span>
              <span class="text-fg-muted tabular-nums">{offerings.toLocaleString('pt-BR')}</span>
            </li>
          </ul>
        </div>
      </Modal>
    )
  }

  return (
    <ConfirmDialog
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      title={`Excluir "${modality.nome}"`}
      description="A modalidade vai para a lixeira e pode ser restaurada em até 90 dias."
      destructive
      confirmLabel="Excluir"
      loading={del.isPending}
      onConfirm={() => {
        del.mutate(modality.id, {
          onSuccess: () => { toast('Modalidade movida para a lixeira', 'success'); onClose() },
          onError: (e: unknown) => {
            if (e instanceof ApiError && (e.payload as { dependencies?: unknown })?.dependencies) {
              toast('Há dependências bloqueando a exclusão', 'danger')
            } else {
              toast((e as Error).message, 'danger')
            }
          },
        })
      }}
    />
  )
}
