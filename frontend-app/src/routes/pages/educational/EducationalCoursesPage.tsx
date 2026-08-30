import { useState, useMemo } from 'preact/hooks'
import { BookOpen, Plus, Pencil, Trash2 } from '@/components/ui/icon-set'
import {
  useCourses,
  useCreateCourse,
  useUpdateCourse,
  useDeleteCourse,
  useEducationalUnits,
  useEducationalLevels,
  type Course,
  type CourseInput,
} from '@/hooks/useEducational'
import { Page } from '@/components/ui/Page'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Skeleton } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { Modal } from '@/components/ui/Modal'
import { Input, Textarea, Select } from '@/components/ui/Input'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { EduListHero } from '@/components/educational/EduListHero'
import { EduSearchBar } from '@/components/educational/EduSearchBar'
import { ApiError } from '@/lib/apiClient'
import { toast } from '@/lib/toast'
import { slugify } from '@/lib/slug'

export function EducationalCoursesPage() {
  const { data, isLoading } = useCourses()
  const { data: unitsData, isLoading: loadingUnits } = useEducationalUnits()
  const { data: levelsData } = useEducationalLevels()
  const [editing, setEditing] = useState<Course | null>(null)
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState<Course | null>(null)
  const [search, setSearch] = useState('')

  const courses = useMemo(() => data?.courses ?? [], [data])
  const units = unitsData?.units ?? []
  const levels = levelsData?.levels ?? []
  const noUnits = !loadingUnits && units.length === 0

  const totals = useMemo(() => ({
    active: courses.filter((c) => c.active !== false).length,
    units: new Set(courses.map((c) => c.unitId).filter(Boolean)).size,
    offerings: courses.reduce((a, c) => a + (c._count?.offerings ?? 0), 0),
  }), [courses])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return courses
    return courses.filter((c) =>
      [c.nome, c.codigo, c.descricao, c.level?.nome, c.unit?.nome]
        .some((s) => (s ?? '').toLowerCase().includes(q)),
    )
  }, [courses, search])

  return (
    <Page
      title="Cursos"
      description="Catálogo mestre de cursos — cada um pode ter várias ofertas"
      actions={
        <Button variant="primary" size="sm" onClick={() => setCreating(true)} disabled={noUnits}>
          <Plus size={14} /> Novo curso
        </Button>
      }
    >
      <EduListHero
        icon={<BookOpen size={26} />}
        title="Visão geral"
        summary={`${courses.length} curso(s) · ${totals.active} ativo(s)`}
        kpis={[
          { value: totals.units, label: 'Unidades', tone: 'accent' },
          { value: totals.active, label: 'Ativos', tone: 'success' },
          { value: totals.offerings, label: 'Ofertas', tone: 'warning' },
        ]}
      />

      {noUnits && (
        <Card>
          <div class="text-sm text-fg-muted">
            Cadastre uma <a href="/app/educational/units" class="text-accent hover:underline">unidade</a> antes
            de adicionar um curso.
          </div>
        </Card>
      )}

      {isLoading && (
        <div class="grid gap-2 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} class="h-20 w-full" />)}
        </div>
      )}

      {!isLoading && !noUnits && courses.length === 0 && (
        <EmptyState
          icon={<BookOpen size={24} />}
          title="Nenhum curso cadastrado"
          description="Cadastre o catálogo mestre de cursos — depois crie ofertas vinculadas a ele"
          action={
            <Button size="sm" variant="primary" onClick={() => setCreating(true)}>
              <Plus size={14} /> Novo curso
            </Button>
          }
        />
      )}

      {!isLoading && courses.length > 0 && (
        <>
          <EduSearchBar
            value={search}
            onChange={setSearch}
            placeholder="Buscar por nome, código, nível, unidade..."
            total={courses.length}
            filteredCount={filtered.length}
            itemNoun="curso(s)"
          />

          {filtered.length === 0 ? (
            <Card>
              <div class="text-xs text-fg-muted italic text-center py-8">
                Nenhum resultado para "{search}"
              </div>
            </Card>
          ) : (
            <div class="grid gap-2 grid-cols-1 lg:grid-cols-2">
              {filtered.map((c) => (
                <Card key={c.id}>
                  <div class="flex items-start gap-3 group">
                    <span class="size-10 rounded-md bg-accent/15 text-accent grid place-items-center shrink-0">
                      <BookOpen size={16} />
                    </span>
                    <div class="min-w-0 flex-1">
                      <div class="flex items-center gap-2 flex-wrap">
                        <span class="text-sm font-medium text-fg truncate">{c.nome}</span>
                        {c.codigo && (
                          <code class="bg-surface-3 px-1.5 py-0.5 rounded text-3xs text-fg-muted font-mono">
                            {c.codigo}
                          </code>
                        )}
                        {c.level?.nome && (
                          <span class="bg-accent/15 text-accent text-3xs font-semibold px-2 py-0.5 rounded-full">
                            {c.level.nome}
                          </span>
                        )}
                        <span
                          class={
                            'text-3xs font-semibold px-2 py-0.5 rounded-full tabular-nums ' +
                            (c.active !== false
                              ? 'bg-accent text-fg-on-brand'
                              : 'bg-surface-3 text-fg-muted')
                          }
                        >
                          {c.active !== false ? '● Ativo' : '○ Inativo'}
                        </span>
                      </div>
                      {c.unit && (
                        <div class="text-xs text-fg-muted mt-0.5">{c.unit.nome}</div>
                      )}
                      <CourseMeta c={c} />
                      {c.descricao && <div class="text-xs text-fg-muted truncate mt-1">{c.descricao}</div>}
                      {c._count != null && (
                        <div class="mt-2">
                          <span class="bg-warning/15 text-warning text-2xs font-semibold px-2 py-0.5 rounded-full tabular-nums">
                            {c._count.offerings} oferta(s)
                          </span>
                        </div>
                      )}
                    </div>
                    <div class="flex gap-0.5 shrink-0">
                      <button
                        type="button"
                        class="size-7 rounded grid place-items-center text-accent bg-accent/10 hover:bg-accent/20"
                        onClick={() => setEditing(c)}
                        aria-label="Editar"
                        title="Editar"
                      >
                        <Pencil size={12} />
                      </button>
                      <button
                        type="button"
                        class="size-7 rounded grid place-items-center text-danger bg-danger/10 hover:bg-danger/20"
                        onClick={() => setDeleting(c)}
                        aria-label="Excluir"
                        title="Excluir"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </>
      )}

      {(creating || editing) && (
        <CourseFormModal
          course={editing}
          units={units}
          levels={levels}
          onClose={() => { setCreating(false); setEditing(null) }}
        />
      )}

      {deleting && (
        <DeleteCourseDialog
          course={deleting}
          onClose={() => setDeleting(null)}
        />
      )}
    </Page>
  )
}

function CourseMeta({ c }: { c: Course }) {
  const parts: string[] = []
  if (c.duracaoMeses) parts.push(`${c.duracaoMeses}m`)
  if (c.cargaHoraria) parts.push(`${c.cargaHoraria}h`)
  if (parts.length === 0) return null
  return <div class="text-2xs text-fg-muted tabular-nums mt-0.5">Duração {parts.join(' · ')}</div>
}

function CourseFormModal({
  course, units, levels, onClose,
}: {
  course: Course | null
  units: { id: number; nome: string }[]
  levels: { id: number; nome: string }[]
  onClose: () => void
}) {
  const isEdit = !!course
  const initialUnitId = course?.unitId ?? units[0]?.id ?? 0
  const [unitId, setUnitId] = useState(initialUnitId)
  const [levelId, setLevelId] = useState<number | ''>(course?.levelId ?? '')
  const [nome, setNome] = useState(course?.nome ?? '')
  const [codigo, setCodigo] = useState(course?.codigo ?? '')
  const [codigoTouched, setCodigoTouched] = useState(!!course?.codigo)
  const [descricao, setDescricao] = useState(course?.descricao ?? '')
  const [duracaoMeses, setDuracaoMeses] = useState(course?.duracaoMeses != null ? String(course.duracaoMeses) : '')
  const [cargaHoraria, setCargaHoraria] = useState(course?.cargaHoraria != null ? String(course.cargaHoraria) : '')
  const [active, setActive] = useState(course?.active ?? true)
  const create = useCreateCourse()
  const update = useUpdateCourse()
  const loading = create.isPending || update.isPending

  function handleNomeChange(v: string) {
    setNome(v)
    if (!isEdit && !codigoTouched) {
      setCodigo(slugify(v))
    }
  }

  function parseIntOrNull(v: string): number | null {
    const n = parseInt(v)
    return Number.isFinite(n) && n > 0 ? n : null
  }

  function handleSubmit() {
    if (!nome.trim()) { toast('Nome é obrigatório', 'danger'); return }
    if (!unitId) { toast('Selecione uma unidade', 'danger'); return }
    const payload: CourseInput = {
      unitId,
      levelId: levelId === '' ? null : levelId,
      nome: nome.trim(),
      codigo: codigo.trim() || null,
      descricao: descricao.trim() || null,
      duracaoMeses: parseIntOrNull(duracaoMeses),
      cargaHoraria: parseIntOrNull(cargaHoraria),
      active,
    }
    if (isEdit) {
      update.mutate({ id: course.id, ...payload }, {
        onSuccess: () => { toast('Curso atualizado', 'success'); onClose() },
        onError: (e: unknown) => toast((e as Error).message, 'danger'),
      })
    } else {
      create.mutate(payload, {
        onSuccess: () => { toast('Curso criado', 'success'); onClose() },
        onError: (e: unknown) => toast((e as Error).message, 'danger'),
      })
    }
  }

  return (
    <Modal
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      title={isEdit ? 'Editar Curso' : 'Novo Curso'}
      size="lg"
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
          label="Nome *"
          value={nome}
          onInput={(e) => handleNomeChange((e.target as HTMLInputElement).value)}
          placeholder="Ex: Administração"
        />
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Select
            label="Unidade *"
            value={String(unitId)}
            onChange={(e) => setUnitId(Number((e.target as HTMLSelectElement).value))}
          >
            <option value="">— Selecione —</option>
            {units.map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}
          </Select>
          <Select
            label="Nível de Ensino"
            value={levelId === '' ? '' : String(levelId)}
            onChange={(e) => {
              const v = (e.target as HTMLSelectElement).value
              setLevelId(v ? Number(v) : '')
            }}
          >
            <option value="">— Nenhum —</option>
            {levels.map((l) => <option key={l.id} value={l.id}>{l.nome}</option>)}
          </Select>
        </div>
        <Input
          label="Código"
          value={codigo ?? ''}
          onInput={(e) => { setCodigo((e.target as HTMLInputElement).value); setCodigoTouched(true) }}
          hint={!isEdit && !codigoTouched ? 'Auto-gerado pelo nome' : ''}
        />
        <Textarea
          label="Descrição"
          value={descricao ?? ''}
          rows={3}
          onInput={(e) => setDescricao((e.target as HTMLTextAreaElement).value)}
        />
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Input
            label="Duração (meses)"
            type="number"
            value={duracaoMeses}
            onInput={(e) => setDuracaoMeses((e.target as HTMLInputElement).value)}
          />
          <Input
            label="Carga Horária"
            type="number"
            value={cargaHoraria}
            onInput={(e) => setCargaHoraria((e.target as HTMLInputElement).value)}
          />
        </div>
        <label class="flex items-center gap-2 text-sm text-fg-muted">
          <input type="checkbox" checked={active} onChange={(e) => setActive((e.target as HTMLInputElement).checked)} />
          Ativo
        </label>
      </div>
    </Modal>
  )
}

function DeleteCourseDialog({ course, onClose }: { course: Course; onClose: () => void }) {
  const del = useDeleteCourse()
  const offerings = course._count?.offerings ?? 0
  const hasDeps = offerings > 0

  if (hasDeps) {
    return (
      <Modal
        open
        onOpenChange={(o) => { if (!o) onClose() }}
        title={`Não é possível excluir "${course.nome}"`}
        size="sm"
        footer={<Button variant="primary" size="sm" onClick={onClose}>Entendi</Button>}
      >
        <div class="space-y-3">
          <p class="text-xs text-fg-muted">
            Existem ofertas vinculadas a este curso. Mova-as ou desative-as primeiro,
            ou apenas <strong>desative o curso</strong> para mantê-lo no histórico.
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
      title={`Excluir "${course.nome}"`}
      description="O curso vai para a lixeira e pode ser restaurado em até 90 dias."
      destructive
      confirmLabel="Excluir"
      loading={del.isPending}
      onConfirm={() => {
        del.mutate(course.id, {
          onSuccess: () => { toast('Curso movido para a lixeira', 'success'); onClose() },
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
