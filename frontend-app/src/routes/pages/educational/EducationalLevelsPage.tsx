import { useMemo, useState } from 'preact/hooks'
import { GraduationCap, Plus, Pencil, Trash2 } from 'lucide-preact'
import {
  useEducationalLevels,
  useCreateEducationalLevel,
  useUpdateEducationalLevel,
  useDeleteEducationalLevel,
  useReorderEducationalLevels,
  type EducationalLevel,
  type EducationalLevelInput,
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

export function EducationalLevelsPage() {
  const { data, isLoading } = useEducationalLevels()
  const reorder = useReorderEducationalLevels()
  const [editing, setEditing] = useState<EducationalLevel | null>(null)
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState<EducationalLevel | null>(null)
  const [search, setSearch] = useState('')

  const levels = useMemo(() => data?.levels ?? [], [data])

  const totals = useMemo(() => ({
    courses: levels.reduce((a, l) => a + (l._count?.courses ?? 0), 0),
    offerings: levels.reduce((a, l) => a + (l._count?.offerings ?? 0), 0),
    processes: levels.reduce((a, l) => a + (l._count?.selectionProcesses ?? 0), 0),
    active: levels.filter((l) => l.active !== false).length,
  }), [levels])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return levels
    return levels.filter((l) =>
      [l.nome, l.codigo, l.descricao].some((s) => (s ?? '').toLowerCase().includes(q)),
    )
  }, [levels, search])

  function handleReorder(newOrder: EducationalLevel[]) {
    if (search.trim()) return
    reorder.mutate(
      newOrder.map((l, idx) => ({ id: l.id, position: idx })),
      { onError: (e: unknown) => toast((e as Error).message, 'danger') },
    )
  }

  return (
    <Page
      title="Níveis de Ensino"
      description="Graduação, Pós, Técnico, Extensão..."
      actions={
        <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
          <Plus size={14} /> Novo nível
        </Button>
      }
    >
      <EduListHero
        icon={<GraduationCap size={26} />}
        title="Visão geral"
        summary={`${levels.length} nível(eis) · ${totals.active} ativo(s)`}
        kpis={[
          { value: totals.courses, label: 'Cursos', tone: 'accent' },
          { value: totals.offerings, label: 'Ofertas', tone: 'success' },
          { value: totals.processes, label: 'Processos', tone: 'warning' },
        ]}
      />

      {isLoading && (
        <div class="grid gap-2 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} class="h-16 w-full" />)}
        </div>
      )}

      {!isLoading && levels.length === 0 && (
        <EmptyState
          icon={<GraduationCap size={24} />}
          title="Nenhum nível de ensino cadastrado"
          description="Defina os níveis (Graduação, Pós, Técnico, Extensão...) para classificar cursos e ofertas"
          action={
            <Button size="sm" variant="primary" onClick={() => setCreating(true)}>
              <Plus size={14} /> Novo nível
            </Button>
          }
        />
      )}

      {!isLoading && levels.length > 0 && (
        <>
          <EduSearchBar
            value={search}
            onChange={setSearch}
            placeholder="Buscar por nome, código, descrição..."
            total={levels.length}
            filteredCount={filtered.length}
          />

          {filtered.length === 0 ? (
            <Card>
              <div class="text-xs text-fg-subtle italic text-center py-8">
                Nenhum resultado para "{search}"
              </div>
            </Card>
          ) : (
            <Card>
              <SortableList
                items={filtered}
                onReorder={handleReorder}
                renderItem={(l) => (
                  <div class="flex items-center gap-3 py-1.5 group">
                    <span class="inline-flex items-center justify-center min-w-6 h-6 px-1.5 rounded-md bg-accent/15 text-accent text-[0.6875rem] font-bold tabular-nums shrink-0">
                      {l.ordem ?? 0}
                    </span>
                    <div class="min-w-0 flex-1">
                      <div class="flex items-center gap-2 flex-wrap">
                        <span class="text-sm font-medium text-fg truncate">{l.nome}</span>
                        {l.codigo && (
                          <span class="font-mono text-[0.6875rem] text-fg-subtle">{l.codigo}</span>
                        )}
                        <span
                          class={
                            'text-[0.625rem] font-semibold px-2 py-0.5 rounded-full tabular-nums ' +
                            (l.active !== false
                              ? 'bg-accent text-fg-on-brand'
                              : 'bg-surface-3 text-fg-subtle')
                          }
                        >
                          {l.active !== false ? '● Ativo' : '○ Inativo'}
                        </span>
                      </div>
                      {l.descricao && (
                        <div class="text-xs text-fg-subtle truncate mt-0.5">{l.descricao}</div>
                      )}
                    </div>
                    {l._count && (
                      <div class="hidden sm:flex items-center gap-3 text-[0.6875rem] text-fg-muted tabular-nums shrink-0">
                        <EduCountPill label="Cursos" n={l._count.courses} />
                        <EduCountPill label="Ofertas" n={l._count.offerings} />
                        <EduCountPill label="Processos" n={l._count.selectionProcesses} />
                      </div>
                    )}
                    <div class="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        type="button"
                        class="size-7 rounded grid place-items-center text-accent bg-accent/10 hover:bg-accent/20"
                        onClick={() => setEditing(l)}
                        aria-label="Editar"
                        title="Editar"
                      >
                        <Pencil size={12} />
                      </button>
                      <button
                        type="button"
                        class="size-7 rounded grid place-items-center text-danger bg-danger/10 hover:bg-danger/20"
                        onClick={() => setDeleting(l)}
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
        <LevelFormModal
          level={editing}
          onClose={() => { setCreating(false); setEditing(null) }}
        />
      )}

      {deleting && (
        <DeleteLevelDialog
          level={deleting}
          onClose={() => setDeleting(null)}
        />
      )}
    </Page>
  )
}


function LevelFormModal({ level, onClose }: { level: EducationalLevel | null; onClose: () => void }) {
  const [nome, setNome] = useState(level?.nome ?? '')
  const [codigo, setCodigo] = useState(level?.codigo ?? '')
  const [codigoTouched, setCodigoTouched] = useState(!!level?.codigo)
  const [descricao, setDescricao] = useState(level?.descricao ?? '')
  const [ordem, setOrdem] = useState(String(level?.ordem ?? 0))
  const [active, setActive] = useState(level?.active ?? true)
  const create = useCreateEducationalLevel()
  const update = useUpdateEducationalLevel()
  const isEdit = !!level
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
    const payload: EducationalLevelInput = {
      nome: nome.trim(),
      codigo: codigo.trim() || null,
      descricao: descricao.trim() || null,
      ordem: Number.isFinite(parseInt(ordem)) ? parseInt(ordem) : 0,
      active,
    }
    if (isEdit) {
      update.mutate({ id: level.id, ...payload }, {
        onSuccess: () => { toast('Nível atualizado', 'success'); onClose() },
        onError: (e: unknown) => toast((e as Error).message, 'danger'),
      })
    } else {
      create.mutate(payload, {
        onSuccess: () => { toast('Nível criado', 'success'); onClose() },
        onError: (e: unknown) => toast((e as Error).message, 'danger'),
      })
    }
  }

  return (
    <Modal
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      title={isEdit ? 'Editar nível' : 'Novo nível'}
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
          placeholder="Ex.: Graduação"
        />
        <div class="grid grid-cols-2 gap-3">
          <Input
            label="Código (opcional)"
            value={codigo ?? ''}
            onInput={(e) => { setCodigo((e.target as HTMLInputElement).value); setCodigoTouched(true) }}
            placeholder="Ex.: GRAD"
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
          Nível ativo
        </label>
      </div>
    </Modal>
  )
}

function DeleteLevelDialog({ level, onClose }: { level: EducationalLevel; onClose: () => void }) {
  const del = useDeleteEducationalLevel()
  const counts = level._count ?? { courses: 0, offerings: 0, selectionProcesses: 0 }
  const deps = [
    { label: 'Cursos', count: counts.courses },
    { label: 'Ofertas', count: counts.offerings },
    { label: 'Processos seletivos', count: counts.selectionProcesses },
  ].filter((d) => d.count > 0)
  const hasDeps = deps.length > 0

  if (hasDeps) {
    return (
      <Modal
        open
        onOpenChange={(o) => { if (!o) onClose() }}
        title={`Não é possível excluir "${level.nome}"`}
        size="sm"
        footer={<Button variant="primary" size="sm" onClick={onClose}>Entendi</Button>}
      >
        <div class="space-y-3">
          <p class="text-xs text-fg-muted">
            Existem registros vinculados a este nível. Remova ou desative-os primeiro,
            ou apenas <strong>desative o nível</strong> para mantê-lo no histórico.
          </p>
          <ul class="space-y-1.5">
            {deps.map((d) => (
              <li
                key={d.label}
                class="flex items-center justify-between text-xs px-2 py-1.5 rounded bg-surface border border-border"
              >
                <span class="text-fg">{d.label}</span>
                <span class="text-fg-muted tabular-nums">{d.count.toLocaleString('pt-BR')}</span>
              </li>
            ))}
          </ul>
        </div>
      </Modal>
    )
  }

  return (
    <ConfirmDialog
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      title={`Excluir "${level.nome}"`}
      description="O nível vai para a lixeira e pode ser restaurado em até 90 dias."
      destructive
      confirmLabel="Excluir"
      loading={del.isPending}
      onConfirm={() => {
        del.mutate(level.id, {
          onSuccess: () => { toast('Nível movido para a lixeira', 'success'); onClose() },
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
