import { useState, useMemo } from 'preact/hooks'
import { Ticket, BookOpen, Plus, Pencil, Trash2 } from '@/components/ui/icon-set'
import {
  useOfferings,
  useCreateOffering,
  useUpdateOffering,
  useDeleteOffering,
  useEducationalUnits,
  useEducationalLevels,
  useModalities,
  useCourses,
  useCampuses,
  useSelectionProcesses,
  type CourseOffering,
  type CourseOfferingInput,
} from '@/hooks/useEducational'
import { Page } from '@/components/ui/Page'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Skeleton } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { Modal } from '@/components/ui/Modal'
import { Input, Select } from '@/components/ui/Input'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { EduListHero } from '@/components/educational/EduListHero'
import { EduSearchBar } from '@/components/educational/EduSearchBar'
import { ApiError } from '@/lib/apiClient'
import { toast } from '@/lib/toast'

const TURNOS = ['Matutino', 'Vespertino', 'Noturno', 'Integral']

function fmtBrl(n: number | null | undefined): string {
  if (n == null) return '—'
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

export function EducationalOfferingsPage() {
  const [search, setSearch] = useState('')

  const { data, isLoading } = useOfferings()
  const { data: unitsData, isLoading: loadingUnits } = useEducationalUnits()
  const { data: coursesData } = useCourses()
  const { data: modalitiesData } = useModalities()
  const { data: levelsData } = useEducationalLevels()
  const { data: campusesData } = useCampuses()
  const { data: processesData } = useSelectionProcesses()
  const [editing, setEditing] = useState<CourseOffering | null>(null)
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState<CourseOffering | null>(null)

  const offerings = useMemo(() => data?.offerings ?? [], [data])
  const units = unitsData?.units ?? []
  const courses = coursesData?.courses ?? []
  const modalities = modalitiesData?.modalities ?? []
  const levels = levelsData?.levels ?? []
  const campuses = campusesData?.campuses ?? []
  const processes = processesData?.processes ?? []

  const blockingMissing: string[] = []
  if (!loadingUnits) {
    if (units.length === 0) blockingMissing.push('unidade')
    if (courses.length === 0) blockingMissing.push('curso')
    if (modalities.length === 0) blockingMissing.push('modalidade')
  }
  const canCreate = blockingMissing.length === 0

  const totals = useMemo(() => ({
    active: offerings.filter((o) => o.active !== false).length,
    vagas: offerings.reduce((a, o) => a + (o.vagasMaximas ?? 0), 0),
    ocupadas: offerings.reduce((a, o) => a + (o.vagasOcupadas ?? 0), 0),
    inscritos: offerings.reduce((a, o) => a + (o.totalInscricoes ?? o._count?.registrations ?? 0), 0),
  }), [offerings])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return offerings
    return offerings.filter((o) => [
      o.nome, o.complemento, o.course?.nome, o.selectionProcess?.nome,
      o.selectionProcess?.periodoLetivo, o.modality?.nome, o.turno,
      (o.campuses ?? []).map((cc) => cc.campus.nome).join(' '),
    ].some((s) => (s ?? '').toLowerCase().includes(q)))
  }, [offerings, search])

  return (
    <Page
      title="Ofertas de Curso"
      description="Curso × Modalidade × Período × Vagas × Valor"
      actions={
        <Button variant="primary" size="sm" onClick={() => setCreating(true)} disabled={!canCreate}>
          <Plus size={14} /> Nova oferta
        </Button>
      }
    >
      <EduListHero
        icon={<Ticket size={26} />}
        title="Visão geral"
        summary={`${offerings.length} oferta(s) · ${totals.active} ativa(s)`}
        kpis={[
          { value: totals.active, label: 'Ativas', tone: 'accent' },
          { value: totals.vagas, label: 'Vagas totais', tone: 'success' },
          { value: totals.ocupadas, label: 'Ocupadas', tone: 'success' },
          { value: totals.inscritos, label: 'Inscrições', tone: 'warning' },
        ]}
      />

      {!canCreate && blockingMissing.length > 0 && (
        <Card>
          <div class="text-sm text-fg-muted">
            Cadastre ao menos uma {blockingMissing.map((m, i) => (
              <span key={m}>
                {i > 0 && (i === blockingMissing.length - 1 ? ' e ' : ', ')}
                <a
                  href={`/app/educational/${m === 'curso' ? 'courses' : m === 'modalidade' ? 'modalities' : 'units'}`}
                  class="text-accent hover:underline"
                >{m}</a>
              </span>
            ))} antes de criar uma oferta.
          </div>
        </Card>
      )}

      {isLoading && (
        <div class="grid gap-2 grid-cols-1 lg:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} class="h-32 w-full" />)}
        </div>
      )}

      {!isLoading && canCreate && offerings.length === 0 && (
        <EmptyState
          icon={<Ticket size={24} />}
          title="Nenhuma oferta cadastrada"
          description="Crie ofertas de curso (curso × modalidade × período × vagas × valor)"
          action={
            <Button size="sm" variant="primary" onClick={() => setCreating(true)}>
              <Plus size={14} /> Nova oferta
            </Button>
          }
        />
      )}

      {!isLoading && offerings.length > 0 && (
        <>
          <EduSearchBar
            value={search}
            onChange={setSearch}
            placeholder="Buscar por curso, processo, modalidade, turno, campus..."
            total={offerings.length}
            filteredCount={filtered.length}
            itemNoun="oferta(s)"
          />

          {filtered.length === 0 ? (
            <Card>
              <div class="text-xs text-fg-muted italic text-center py-8">
                Nenhum resultado para "{search}"
              </div>
            </Card>
          ) : (
            <div class="grid gap-2 grid-cols-1 lg:grid-cols-2">
              {filtered.map((o) => (
                <OfferingCard
                  key={o.id}
                  offering={o}
                  onEdit={() => setEditing(o)}
                  onDelete={() => setDeleting(o)}
                />
              ))}
            </div>
          )}
        </>
      )}

      {(creating || editing) && (
        <OfferingFormModal
          offering={editing}
          units={units}
          courses={courses}
          modalities={modalities}
          levels={levels}
          campuses={campuses}
          processes={processes}
          onClose={() => { setCreating(false); setEditing(null) }}
        />
      )}

      {deleting && (
        <DeleteOfferingDialog
          offering={deleting}
          onClose={() => setDeleting(null)}
        />
      )}
    </Page>
  )
}

function OfferingCard({
  offering, onEdit, onDelete,
}: { offering: CourseOffering; onEdit: () => void; onDelete: () => void }) {
  const o = offering
  const vagasMax = o.vagasMaximas ?? 0
  const ocupadas = o.vagasOcupadas ?? 0
  const ocupacao = vagasMax > 0 ? Math.min(100, Math.round((ocupadas / vagasMax) * 100)) : null
  const ocupacaoTone =
    ocupacao == null ? 'text-fg-muted'
    : ocupacao >= 90 ? 'text-danger'
    : ocupacao >= 60 ? 'text-warning'
    : 'text-success'
  const inscricoes = o.totalInscricoes ?? o._count?.registrations ?? 0
  const campusList = (o.campuses ?? []).map((cc) => cc.campus.nome).filter(Boolean)
  const campusText =
    campusList.length === 0 ? null
    : campusList.length === 1 ? campusList[0]
    : `${campusList[0]} +${campusList.length - 1}`

  return (
    <Card>
      <div class="flex items-start gap-3 group">
        <span class="size-10 rounded-md bg-accent/15 text-accent grid place-items-center shrink-0">
          <Ticket size={16} />
        </span>
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2 flex-wrap">
            <span class="text-sm font-medium text-fg truncate">{o.nome}</span>
            {o.codigo && (
              <code class="bg-surface-3 px-1.5 py-0.5 rounded text-3xs text-fg-muted font-mono">
                {o.codigo}
              </code>
            )}
            {o.modality?.nome && (
              <span class="bg-accent/15 text-accent text-3xs font-semibold px-2 py-0.5 rounded-full">
                {o.modality.nome}
              </span>
            )}
            <span
              class={
                'text-3xs font-semibold px-2 py-0.5 rounded-full tabular-nums ' +
                (o.active !== false
                  ? 'bg-accent text-fg-on-brand'
                  : 'bg-surface-3 text-fg-muted')
              }
            >
              {o.active !== false ? '● Ativa' : '○ Inativa'}
            </span>
          </div>

          {o.complemento && (
            <div class="text-xs text-fg-muted mt-0.5 truncate">{o.complemento}</div>
          )}

          {o.course?.nome && (
            <div class="text-xs text-fg-muted mt-1 inline-flex items-center gap-1.5">
              <BookOpen size={12} class="shrink-0" />
              <span class="truncate">{o.course.nome}</span>
            </div>
          )}

          {(o.selectionProcess ?? o.turno ?? campusText) && (
            <div class="text-xs text-fg-muted mt-1 flex flex-wrap gap-x-2 gap-y-0.5">
              {o.selectionProcess?.nome && (
                <span>
                  {o.selectionProcess.nome}
                  {o.selectionProcess.periodoLetivo && (
                    <span class="text-fg-muted"> · {o.selectionProcess.periodoLetivo}</span>
                  )}
                </span>
              )}
              {o.turno && <span>· {o.turno}</span>}
              {campusText && <span title={campusList.join(', ')}>· {campusText}</span>}
            </div>
          )}

          <DateRanges o={o} />

          <div class="flex flex-wrap items-center gap-3 mt-2">
            {o.valorMensalidade != null && (
              <div class="text-2xs">
                <span class="text-fg-muted uppercase tracking-wider mr-1">Mensalidade</span>
                <span class="text-fg font-semibold tabular-nums">{fmtBrl(o.valorMensalidade)}</span>
              </div>
            )}
            {vagasMax > 0 ? (
              <div class="text-2xs tabular-nums">
                <span class="text-fg-muted uppercase tracking-wider mr-1">Vagas</span>
                <span class="text-fg font-semibold">{ocupadas}/{vagasMax}</span>
                {ocupacao != null && <span class={`ml-1 ${ocupacaoTone}`}>({ocupacao}%)</span>}
                <span class="text-fg-muted ml-2">{inscricoes} inscriç{inscricoes === 1 ? 'ão' : 'ões'}</span>
              </div>
            ) : inscricoes > 0 ? (
              <div class="text-2xs tabular-nums">
                <span class="text-fg-muted uppercase tracking-wider mr-1">Inscrições</span>
                <span class="text-fg font-semibold">{inscricoes}</span>
              </div>
            ) : null}
            {o.notaCorte != null && (
              <div class="text-2xs">
                <span class="text-fg-muted uppercase tracking-wider mr-1">Nota corte</span>
                <span class="text-fg font-semibold tabular-nums">{o.notaCorte}</span>
              </div>
            )}
          </div>
        </div>
        <div class="flex gap-0.5 shrink-0">
          <button
            type="button"
            class="size-7 rounded grid place-items-center text-accent bg-accent/10 hover:bg-accent/20"
            onClick={onEdit}
            aria-label="Editar"
            title="Editar"
          >
            <Pencil size={12} />
          </button>
          <button
            type="button"
            class="size-7 rounded grid place-items-center text-danger bg-danger/10 hover:bg-danger/20"
            onClick={onDelete}
            aria-label="Excluir"
            title="Excluir"
          >
            <Trash2 size={12} />
          </button>
        </div>
      </div>
    </Card>
  )
}

function DateRanges({ o }: { o: CourseOffering }) {
  const ranges = [
    { label: 'Inscrições', from: o.inicioInscricao, to: o.terminoInscricao },
    { label: 'Matrículas', from: o.inicioMatricula, to: o.terminoMatricula },
    { label: 'Curso',      from: o.inicioCurso,     to: o.terminoCurso },
  ].filter((r) => r.from ?? r.to)
  if (ranges.length === 0) return null
  return (
    <div class="flex flex-wrap gap-x-3 gap-y-0.5 mt-1.5 text-2xs text-fg-muted tabular-nums">
      {ranges.map((r) => (
        <span key={r.label}>
          <span class="text-fg-muted">{r.label}:</span> {fmtDate(r.from)} → {fmtDate(r.to)}
        </span>
      ))}
    </div>
  )
}

function toDateInput(iso: string | null): string {
  if (!iso) return ''
  return iso.slice(0, 10)
}

function OfferingFormModal({
  offering, units, courses, modalities, levels, campuses, processes, onClose,
}: {
  offering: CourseOffering | null
  units: { id: number; nome: string }[]
  courses: { id: number; nome: string }[]
  modalities: { id: number; nome: string }[]
  levels: { id: number; nome: string }[]
  campuses: { id: number; nome: string; cidade?: string | null; estado?: string | null }[]
  processes: { id: number; nome: string; periodoLetivo: string | null }[]
  onClose: () => void
}) {
  const isEdit = !!offering
  const [courseId, setCourseId] = useState(offering?.courseId ?? courses[0]?.id ?? 0)
  const [unitId, setUnitId] = useState(offering?.unitId ?? units[0]?.id ?? 0)
  const [modalityId, setModalityId] = useState(offering?.modalityId ?? modalities[0]?.id ?? 0)
  const [levelId, setLevelId] = useState<number | ''>(offering?.levelId ?? '')
  const [selectionProcessId, setSelectionProcessId] = useState<number | ''>(offering?.selectionProcessId ?? '')
  const [nome, setNome] = useState(offering?.nome ?? '')
  const [complemento, setComplemento] = useState(offering?.complemento ?? '')
  const [turno, setTurno] = useState(offering?.turno ?? '')
  const [vagasMinimas, setVagasMinimas] = useState(offering?.vagasMinimas != null ? String(offering.vagasMinimas) : '')
  const [vagasMaximas, setVagasMaximas] = useState(offering?.vagasMaximas != null ? String(offering.vagasMaximas) : '')
  const [valorMensalidade, setValorMensalidade] = useState(offering?.valorMensalidade != null ? String(offering.valorMensalidade) : '')
  const [valorMatricula, setValorMatricula] = useState(offering?.valorMatricula != null ? String(offering.valorMatricula) : '')
  const [notaCorte, setNotaCorte] = useState(offering?.notaCorte != null ? String(offering.notaCorte) : '')
  const [inicioInscricao, setInicioInscricao] = useState(toDateInput(offering?.inicioInscricao ?? null))
  const [terminoInscricao, setTerminoInscricao] = useState(toDateInput(offering?.terminoInscricao ?? null))
  const [inicioMatricula, setInicioMatricula] = useState(toDateInput(offering?.inicioMatricula ?? null))
  const [terminoMatricula, setTerminoMatricula] = useState(toDateInput(offering?.terminoMatricula ?? null))
  const [inicioCurso, setInicioCurso] = useState(toDateInput(offering?.inicioCurso ?? null))
  const [terminoCurso, setTerminoCurso] = useState(toDateInput(offering?.terminoCurso ?? null))
  const [active, setActive] = useState(offering?.active ?? true)
  const [campusIds, setCampusIds] = useState<number[]>(
    offering?.campuses?.map((cc) => cc.campus.id) ?? [],
  )

  const create = useCreateOffering()
  const update = useUpdateOffering()
  const loading = create.isPending || update.isPending

  function parseFloatOrNull(v: string): number | null {
    const n = parseFloat(v.replace(',', '.'))
    return Number.isFinite(n) ? n : null
  }
  function parseIntOrNull(v: string): number | null {
    const n = parseInt(v)
    return Number.isFinite(n) ? n : null
  }

  function toggleCampus(id: number) {
    setCampusIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id])
  }

  function handleSubmit() {
    if (!nome.trim()) { toast('Nome é obrigatório', 'danger'); return }
    if (!courseId || !unitId || !modalityId) {
      toast('Nome, Curso, Unidade e Modalidade obrigatórios', 'danger')
      return
    }
    const payload: CourseOfferingInput = {
      courseId,
      unitId,
      modalityId,
      levelId: levelId === '' ? null : levelId,
      selectionProcessId: selectionProcessId === '' ? null : selectionProcessId,
      campusIds,
      nome: nome.trim(),
      complemento: complemento.trim() || null,
      turno: turno.trim() || null,
      vagasMinimas: parseIntOrNull(vagasMinimas),
      vagasMaximas: parseIntOrNull(vagasMaximas),
      valorMensalidade: parseFloatOrNull(valorMensalidade),
      valorMatricula: parseFloatOrNull(valorMatricula),
      notaCorte: parseFloatOrNull(notaCorte),
      inicioInscricao: inicioInscricao || null,
      terminoInscricao: terminoInscricao || null,
      inicioMatricula: inicioMatricula || null,
      terminoMatricula: terminoMatricula || null,
      inicioCurso: inicioCurso || null,
      terminoCurso: terminoCurso || null,
      active,
    }
    if (isEdit) {
      update.mutate({ id: offering.id, ...payload }, {
        onSuccess: () => { toast('Oferta atualizada', 'success'); onClose() },
        onError: (e: unknown) => toast((e as Error).message, 'danger'),
      })
    } else {
      create.mutate(payload, {
        onSuccess: () => { toast('Oferta criada', 'success'); onClose() },
        onError: (e: unknown) => toast((e as Error).message, 'danger'),
      })
    }
  }

  return (
    <Modal
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      title={isEdit ? 'Editar Oferta de Curso' : 'Nova Oferta de Curso'}
      size="xl"
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
          onInput={(e) => setNome((e.target as HTMLInputElement).value)}
          placeholder="Ex: Administração Noturno 2026/1"
        />
        <Input
          label="Complemento"
          value={complemento ?? ''}
          onInput={(e) => setComplemento((e.target as HTMLInputElement).value)}
          placeholder="Diferenciação rápida"
        />

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Select
            label="Curso *"
            value={String(courseId)}
            onChange={(e) => setCourseId(Number((e.target as HTMLSelectElement).value))}
          >
            <option value="">—</option>
            {courses.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
          </Select>
          <Select
            label="Unidade *"
            value={String(unitId)}
            onChange={(e) => setUnitId(Number((e.target as HTMLSelectElement).value))}
          >
            <option value="">—</option>
            {units.map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}
          </Select>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Select
            label="Modalidade *"
            value={String(modalityId)}
            onChange={(e) => setModalityId(Number((e.target as HTMLSelectElement).value))}
          >
            <option value="">—</option>
            {modalities.map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}
          </Select>
          <Select
            label="Nível"
            value={levelId === '' ? '' : String(levelId)}
            onChange={(e) => {
              const v = (e.target as HTMLSelectElement).value
              setLevelId(v ? Number(v) : '')
            }}
          >
            <option value="">—</option>
            {levels.map((l) => <option key={l.id} value={l.id}>{l.nome}</option>)}
          </Select>
          <Select
            label="Processo Seletivo"
            value={selectionProcessId === '' ? '' : String(selectionProcessId)}
            onChange={(e) => {
              const v = (e.target as HTMLSelectElement).value
              setSelectionProcessId(v ? Number(v) : '')
            }}
          >
            <option value="">—</option>
            {processes.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nome}{p.periodoLetivo ? ` · ${p.periodoLetivo}` : ''}
              </option>
            ))}
          </Select>
        </div>

        <div>
          <Select
            label="Turno"
            value={turno ?? ''}
            onChange={(e) => setTurno((e.target as HTMLSelectElement).value)}
          >
            <option value="">—</option>
            {TURNOS.map((t) => <option key={t} value={t}>{t}</option>)}
          </Select>
          <div class="text-3xs text-fg-muted mt-1">
            💡 Período letivo é definido no Processo Seletivo
          </div>
        </div>

        <div>
          <label class="block text-xs font-medium text-fg-muted mb-1">
            Campus / Locais de Oferta (pode selecionar vários)
          </label>
          <div class="bg-surface border border-border rounded-md p-2.5 max-h-40 overflow-y-auto">
            {campuses.length === 0 ? (
              <span class="text-xs text-fg-muted">Nenhum campus cadastrado</span>
            ) : (
              campuses.map((c) => (
                <label
                  key={c.id}
                  class="flex items-center gap-2 py-1 text-sm cursor-pointer hover:bg-surface-3 rounded px-1"
                >
                  <input
                    type="checkbox"
                    checked={campusIds.includes(c.id)}
                    onChange={() => toggleCampus(c.id)}
                  />
                  <span class="text-fg">{c.nome}</span>
                  {c.cidade && (
                    <span class="text-fg-muted text-2xs">
                      · {c.cidade}{c.estado ? `/${c.estado}` : ''}
                    </span>
                  )}
                </label>
              ))
            )}
          </div>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Input
            label="Valor mensalidade (R$)"
            type="number"
            step="0.01"
            value={valorMensalidade}
            onInput={(e) => setValorMensalidade((e.target as HTMLInputElement).value)}
          />
          <Input
            label="Valor matrícula (R$)"
            type="number"
            step="0.01"
            value={valorMatricula}
            onInput={(e) => setValorMatricula((e.target as HTMLInputElement).value)}
          />
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Input
            label="Vagas mínimas"
            type="number"
            value={vagasMinimas}
            onInput={(e) => setVagasMinimas((e.target as HTMLInputElement).value)}
          />
          <Input
            label="Vagas máximas"
            type="number"
            value={vagasMaximas}
            onInput={(e) => setVagasMaximas((e.target as HTMLInputElement).value)}
          />
        </div>

        <div>
          <Input
            label="Nota de corte específica desta oferta"
            type="number"
            step="0.01"
            value={notaCorte}
            placeholder="Ex: 700 para Medicina, 450 para Pedagogia — vazio usa a do processo"
            onInput={(e) => setNotaCorte((e.target as HTMLInputElement).value)}
            hint="Aplicado à nota ENEM. Sobrescreve a nota de corte geral do processo quando preenchido."
          />
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Input
            label="Início inscrição"
            type="date"
            value={inicioInscricao}
            onInput={(e) => setInicioInscricao((e.target as HTMLInputElement).value)}
          />
          <Input
            label="Término inscrição"
            type="date"
            value={terminoInscricao}
            onInput={(e) => setTerminoInscricao((e.target as HTMLInputElement).value)}
          />
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Input
            label="Início matrícula"
            type="date"
            value={inicioMatricula}
            onInput={(e) => setInicioMatricula((e.target as HTMLInputElement).value)}
          />
          <Input
            label="Término matrícula"
            type="date"
            value={terminoMatricula}
            onInput={(e) => setTerminoMatricula((e.target as HTMLInputElement).value)}
          />
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Input
            label="Início do curso"
            type="date"
            value={inicioCurso}
            onInput={(e) => setInicioCurso((e.target as HTMLInputElement).value)}
          />
          <Input
            label="Término do curso"
            type="date"
            value={terminoCurso}
            onInput={(e) => setTerminoCurso((e.target as HTMLInputElement).value)}
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

function DeleteOfferingDialog({ offering, onClose }: { offering: CourseOffering; onClose: () => void }) {
  const del = useDeleteOffering()
  const inscricoes = offering.totalInscricoes ?? offering._count?.registrations ?? 0
  const hasDeps = inscricoes > 0

  if (hasDeps) {
    return (
      <Modal
        open
        onOpenChange={(o) => { if (!o) onClose() }}
        title={`Não é possível excluir "${offering.nome}"`}
        size="sm"
        footer={<Button variant="primary" size="sm" onClick={onClose}>Entendi</Button>}
      >
        <div class="space-y-3">
          <p class="text-xs text-fg-muted">
            Existem inscrições vinculadas a esta oferta. Mova-as ou desative-as primeiro,
            ou apenas <strong>desative a oferta</strong> para mantê-la no histórico.
          </p>
          <ul class="space-y-1.5">
            <li class="flex items-center justify-between text-xs px-2 py-1.5 rounded bg-surface border border-border">
              <span class="text-fg">Inscrições</span>
              <span class="text-fg-muted tabular-nums">{inscricoes.toLocaleString('pt-BR')}</span>
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
      title={`Excluir "${offering.nome}"`}
      description="A oferta vai para a lixeira e pode ser restaurada em até 90 dias."
      destructive
      confirmLabel="Excluir"
      loading={del.isPending}
      onConfirm={() => {
        del.mutate(offering.id, {
          onSuccess: () => { toast('Oferta movida para a lixeira', 'success'); onClose() },
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
