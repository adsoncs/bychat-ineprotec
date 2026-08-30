import { useMemo, useState } from 'preact/hooks'
import { Building2, Plus, Pencil, Trash2 } from '@/components/ui/icon-set'
import {
  useEducationalUnits,
  useCreateEducationalUnit,
  useUpdateEducationalUnit,
  useDeleteEducationalUnit,
  type EducationalUnit,
  type EducationalUnitInput,
} from '@/hooks/useEducational'
import { Page } from '@/components/ui/Page'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Skeleton } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { Modal } from '@/components/ui/Modal'
import { Input, Textarea } from '@/components/ui/Input'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { EduListHero, EduCountPill } from '@/components/educational/EduListHero'
import { EduSearchBar } from '@/components/educational/EduSearchBar'
import { ApiError } from '@/lib/apiClient'
import { toast } from '@/lib/toast'
import { slugify } from '@/lib/slug'

export function EducationalUnitsPage() {
  const { data, isLoading } = useEducationalUnits()
  const [editing, setEditing] = useState<EducationalUnit | null>(null)
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState<EducationalUnit | null>(null)
  const [search, setSearch] = useState('')

  const units = useMemo(() => data?.units ?? [], [data])

  const totals = useMemo(() => ({
    active: units.filter((u) => u.active !== false).length,
    campuses: units.reduce((a, u) => a + (u._count?.campuses ?? 0), 0),
    courses: units.reduce((a, u) => a + (u._count?.courses ?? 0), 0),
    offerings: units.reduce((a, u) => a + (u._count?.offerings ?? 0), 0),
  }), [units])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return units
    return units.filter((u) =>
      [u.nome, u.codigo, u.descricao].some((s) => (s ?? '').toLowerCase().includes(q)),
    )
  }, [units, search])

  return (
    <Page
      title="Unidades"
      description="Agrupamento organizacional (filial, regional, marca)"
      actions={
        <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
          <Plus size={14} /> Nova unidade
        </Button>
      }
    >
      <EduListHero
        icon={<Building2 size={26} />}
        title="Visão geral"
        summary={`${units.length} unidade(s) · ${totals.active} ativa(s)`}
        kpis={[
          { value: totals.campuses, label: 'Campi', tone: 'accent' },
          { value: totals.courses, label: 'Cursos', tone: 'success' },
          { value: totals.offerings, label: 'Ofertas', tone: 'warning' },
        ]}
      />

      {isLoading && (
        <div class="grid gap-2 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} class="h-16 w-full" />)}
        </div>
      )}

      {!isLoading && units.length === 0 && (
        <EmptyState
          icon={<Building2 size={24} />}
          title="Nenhuma unidade cadastrada"
          description="Crie a primeira unidade para organizar campus, cursos e ofertas"
          action={
            <Button size="sm" variant="primary" onClick={() => setCreating(true)}>
              <Plus size={14} /> Nova unidade
            </Button>
          }
        />
      )}

      {!isLoading && units.length > 0 && (
        <>
          <EduSearchBar
            value={search}
            onChange={setSearch}
            placeholder="Buscar por nome, código, descrição..."
            total={units.length}
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
              <ul class="divide-y divide-border">
                {filtered.map((u) => (
                  <li key={u.id} class="flex items-center gap-3 py-2.5 group">
                    <span class="size-8 rounded-md bg-accent/15 text-accent grid place-items-center shrink-0">
                      <Building2 size={14} />
                    </span>
                    <div class="min-w-0 flex-1">
                      <div class="flex items-center gap-2 flex-wrap">
                        <span class="text-sm font-medium text-fg truncate">{u.nome}</span>
                        {u.codigo && (
                          <span class="font-mono text-2xs text-fg-muted">{u.codigo}</span>
                        )}
                        <span
                          class={
                            'text-3xs font-semibold px-2 py-0.5 rounded-full tabular-nums ' +
                            (u.active !== false
                              ? 'bg-accent text-fg-on-brand'
                              : 'bg-surface-3 text-fg-muted')
                          }
                        >
                          {u.active !== false ? '● Ativa' : '○ Inativa'}
                        </span>
                      </div>
                      {u.descricao && (
                        <div class="text-xs text-fg-muted truncate mt-0.5">{u.descricao}</div>
                      )}
                    </div>
                    {u._count && (
                      <div class="hidden sm:flex items-center gap-3 text-2xs text-fg-muted tabular-nums shrink-0">
                        <EduCountPill label="Campi" n={u._count.campuses} />
                        <EduCountPill label="Cursos" n={u._count.courses} />
                        <EduCountPill label="Ofertas" n={u._count.offerings} />
                      </div>
                    )}
                    <div class="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        type="button"
                        class="size-7 rounded grid place-items-center text-accent bg-accent/10 hover:bg-accent/20"
                        onClick={() => setEditing(u)}
                        aria-label="Editar"
                        title="Editar"
                      >
                        <Pencil size={12} />
                      </button>
                      <button
                        type="button"
                        class="size-7 rounded grid place-items-center text-danger bg-danger/10 hover:bg-danger/20"
                        onClick={() => setDeleting(u)}
                        aria-label="Excluir"
                        title="Excluir"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </>
      )}

      {(creating || editing) && (
        <UnitFormModal
          unit={editing}
          onClose={() => { setCreating(false); setEditing(null) }}
        />
      )}

      {deleting && (
        <DeleteUnitDialog
          unit={deleting}
          onClose={() => setDeleting(null)}
        />
      )}
    </Page>
  )
}

function UnitFormModal({ unit, onClose }: { unit: EducationalUnit | null; onClose: () => void }) {
  const [nome, setNome] = useState(unit?.nome ?? '')
  const [codigo, setCodigo] = useState(unit?.codigo ?? '')
  const [codigoTouched, setCodigoTouched] = useState(!!unit?.codigo)
  const [descricao, setDescricao] = useState(unit?.descricao ?? '')
  const [active, setActive] = useState(unit?.active ?? true)
  const create = useCreateEducationalUnit()
  const update = useUpdateEducationalUnit()
  const isEdit = !!unit
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
    const payload: EducationalUnitInput = {
      nome: nome.trim(),
      codigo: codigo.trim() || null,
      descricao: descricao.trim() || null,
      active,
    }
    if (isEdit) {
      update.mutate({ id: unit.id, ...payload }, {
        onSuccess: () => { toast('Unidade atualizada', 'success'); onClose() },
        onError: (e: unknown) => toast((e as Error).message, 'danger'),
      })
    } else {
      create.mutate(payload, {
        onSuccess: () => { toast('Unidade criada', 'success'); onClose() },
        onError: (e: unknown) => toast((e as Error).message, 'danger'),
      })
    }
  }

  return (
    <Modal
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      title={isEdit ? 'Editar unidade' : 'Nova unidade'}
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
          placeholder="Ex.: Unidade Exemplo"
        />
        <Input
          label="Código (opcional)"
          value={codigo ?? ''}
          onInput={(e) => { setCodigo((e.target as HTMLInputElement).value); setCodigoTouched(true) }}
          hint={!isEdit && !codigoTouched ? 'Auto-gerado pelo nome' : ''}
        />
        <Textarea
          label="Descrição (opcional)"
          value={descricao ?? ''}
          rows={3}
          onInput={(e) => setDescricao((e.target as HTMLTextAreaElement).value)}
        />
        <label class="flex items-center gap-2 text-sm text-fg-muted">
          <input type="checkbox" checked={active} onChange={(e) => setActive((e.target as HTMLInputElement).checked)} />
          Unidade ativa
        </label>
      </div>
    </Modal>
  )
}

function DeleteUnitDialog({ unit, onClose }: { unit: EducationalUnit; onClose: () => void }) {
  const del = useDeleteEducationalUnit()
  const counts = unit._count ?? { campuses: 0, courses: 0, offerings: 0 }
  const deps = [
    { label: 'Campus', count: counts.campuses },
    { label: 'Cursos', count: counts.courses },
    { label: 'Ofertas', count: counts.offerings },
  ].filter((d) => d.count > 0)
  const hasDeps = deps.length > 0

  if (hasDeps) {
    return (
      <Modal
        open
        onOpenChange={(o) => { if (!o) onClose() }}
        title={`Não é possível excluir "${unit.nome}"`}
        size="sm"
        footer={<Button variant="primary" size="sm" onClick={onClose}>Entendi</Button>}
      >
        <div class="space-y-3">
          <p class="text-xs text-fg-muted">
            Existem registros vinculados a esta unidade. Remova ou desative-os primeiro,
            ou apenas <strong>desative a unidade</strong> para mantê-la no histórico.
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
      title={`Excluir "${unit.nome}"`}
      description="A unidade vai para a lixeira e pode ser restaurada em até 90 dias."
      destructive
      confirmLabel="Excluir"
      loading={del.isPending}
      onConfirm={() => {
        del.mutate(unit.id, {
          onSuccess: () => { toast('Unidade movida para a lixeira', 'success'); onClose() },
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
