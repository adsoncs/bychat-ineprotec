import { useState, useMemo } from 'preact/hooks'
import { useLocation } from 'wouter-preact'
import { FileCheck2, Plus, Pencil, Trash2, Copy, Clock, AlertCircle, Settings2 } from 'lucide-preact'
import {
  useSelectionProcesses,
  useCreateSelectionProcess,
  useUpdateSelectionProcess,
  useDeleteSelectionProcess,
  useEducationalUnits,
  useEducationalLevels,
  useEntryModes,
  type SelectionProcess,
  type SelectionProcessInput,
  type EvaluationType,
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
import { dasherize } from '@/lib/slug'

const STATUSES = [
  { value: 'active', label: 'Ativo' },
  { value: 'closed', label: 'Encerrado' },
  { value: 'draft', label: 'Rascunho' },
]

interface Phase {
  label: string
  tone: 'success' | 'warning' | 'muted'
}

function computePhase(p: SelectionProcess): Phase | null {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const ii = p.inicioInscricao  ? new Date(p.inicioInscricao)  : null
  const ti = p.terminoInscricao ? new Date(p.terminoInscricao) : null
  const im = p.inicioMatricula  ? new Date(p.inicioMatricula)  : null
  const tm = p.terminoMatricula ? new Date(p.terminoMatricula) : null
  if (ii && today < ii)                       return { label: 'Aguardando',         tone: 'muted' }
  if (ii && ti && today >= ii && today <= ti) return { label: 'Inscrições abertas', tone: 'success' }
  if (ti && today > ti && im && today < im)   return { label: 'Pré-matrícula',      tone: 'warning' }
  if (im && tm && today >= im && today <= tm) return { label: 'Matrículas abertas', tone: 'success' }
  if (tm && today > tm)                       return { label: 'Encerrado',          tone: 'muted' }
  return null
}

function fmtBrl(n: number | null | undefined): string {
  if (n == null) return '—'
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

export function EducationalSelectionProcessesPage() {
  const [search, setSearch] = useState('')

  const { data, isLoading } = useSelectionProcesses()
  const { data: unitsData, isLoading: loadingUnits } = useEducationalUnits()
  const { data: levelsData } = useEducationalLevels()
  const { data: entryModesData } = useEntryModes(false)
  const [, navigate] = useLocation()
  const [editing, setEditing] = useState<SelectionProcess | null>(null)
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState<SelectionProcess | null>(null)

  const processes = useMemo(() => data?.processes ?? [], [data])
  const units = unitsData?.units ?? []
  const levels = levelsData?.levels ?? []
  const entryModes = entryModesData?.modes ?? []

  const blocking: string[] = []
  if (!loadingUnits) {
    if (units.length === 0) blocking.push('unidade')
    if (entryModes.length === 0) blocking.push('modo de ingresso')
  }
  const canCreate = blocking.length === 0

  const totals = useMemo(() => ({
    active: processes.filter((p) => p.active !== false).length,
    offerings: processes.reduce((a, p) => a + (p._count?.offerings ?? 0), 0),
    registrations: processes.reduce((a, p) => a + (p._count?.registrations ?? 0), 0),
  }), [processes])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return processes
    return processes.filter((p) => [
      p.nome, p.codigo, p.slug, p.periodoLetivo,
      p.entryMode?.name, p.entryMode?.code,
      p.level?.nome, p.unit?.nome, p.descricao,
    ].some((s) => (s ?? '').toLowerCase().includes(q)))
  }, [processes, search])

  return (
    <Page
      title="Processos Seletivos"
      description="Vestibular, ENEM, agendado, análise — cada forma de ingresso é um processo"
      actions={
        <Button variant="primary" size="sm" onClick={() => setCreating(true)} disabled={!canCreate}>
          <Plus size={14} /> Novo processo
        </Button>
      }
    >
      <EduListHero
        icon={<FileCheck2 size={26} />}
        title="Visão geral"
        summary={`${processes.length} processo(s) · ${totals.active} ativo(s)`}
        kpis={[
          { value: totals.active, label: 'Ativos', tone: 'accent' },
          { value: totals.offerings, label: 'Ofertas', tone: 'success' },
          { value: totals.registrations, label: 'Candidatos', tone: 'warning' },
        ]}
      />

      {!canCreate && blocking.length > 0 && (
        <Card>
          <div class="text-sm text-fg-muted">
            Cadastre ao menos uma {blocking.map((b, i) => (
              <span key={b}>
                {i > 0 && (i === blocking.length - 1 ? ' e ' : ', ')}
                <a
                  href={`/app/educational/${b === 'unidade' ? 'units' : 'entry-modes'}`}
                  class="text-accent hover:underline"
                >{b}</a>
              </span>
            ))} antes de criar um processo.
          </div>
        </Card>
      )}

      {isLoading && (
        <div class="grid gap-2 grid-cols-1 lg:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} class="h-32 w-full" />)}
        </div>
      )}

      {!isLoading && canCreate && processes.length === 0 && (
        <EmptyState
          icon={<FileCheck2 size={24} />}
          title="Nenhum processo seletivo cadastrado"
          description="Cada forma de ingresso (Vestibular, ENEM, Agendado, Análise...) é um processo distinto"
          action={
            <Button size="sm" variant="primary" onClick={() => setCreating(true)}>
              <Plus size={14} /> Novo processo
            </Button>
          }
        />
      )}

      {!isLoading && processes.length > 0 && (
        <>
          <EduSearchBar
            value={search}
            onChange={setSearch}
            placeholder="Buscar por nome, código, slug, modo, período..."
            total={processes.length}
            filteredCount={filtered.length}
            itemNoun="processo(s)"
          />

          {filtered.length === 0 ? (
            <Card>
              <div class="text-xs text-fg-subtle italic text-center py-8">
                Nenhum resultado para "{search}"
              </div>
            </Card>
          ) : (
            <div class="grid gap-2 grid-cols-1 lg:grid-cols-2">
              {filtered.map((p) => (
                <ProcessCard
                  key={p.id}
                  process={p}
                  onConfigure={() => navigate(`/educational/selection-processes/${p.id}`)}
                  onEdit={() => setEditing(p)}
                  onDelete={() => setDeleting(p)}
                />
              ))}
            </div>
          )}
        </>
      )}

      {(creating || editing) && (
        <ProcessFormModal
          process={editing}
          units={units}
          levels={levels}
          entryModes={entryModes}
          onClose={() => { setCreating(false); setEditing(null) }}
          onCreated={(created) => navigate(`/educational/selection-processes/${created.id}`)}
        />
      )}

      {deleting && (
        <DeleteProcessDialog
          process={deleting}
          onClose={() => setDeleting(null)}
        />
      )}
    </Page>
  )
}

function ProcessCard({
  process: p, onConfigure, onEdit, onDelete,
}: { process: SelectionProcess; onConfigure: () => void; onEdit: () => void; onDelete: () => void }) {
  const phase = computePhase(p)

  function copySlug(e: Event) {
    e.stopPropagation()
    if (!p.slug) return
    navigator.clipboard.writeText(p.slug).then(
      () => toast('Slug copiado', 'success'),
      () => toast('Erro ao copiar', 'danger'),
    )
  }

  return (
    <Card class={p.active === false ? 'opacity-60' : ''}>
      <div class="flex items-start gap-3 group">
        <span class="size-10 rounded-md bg-accent/15 grid place-items-center shrink-0 text-base">
          {p.entryMode?.icon ?? <FileCheck2 size={16} class="text-accent" />}
        </span>
        <button
          type="button"
          class="min-w-0 flex-1 text-left"
          onClick={onConfigure}
        >
          <div class="flex items-center gap-2 flex-wrap">
            <span class="text-sm font-medium text-fg truncate hover:text-accent">{p.nome}</span>
            {p.codigo && (
              <code class="bg-surface-3 px-1.5 py-0.5 rounded text-[0.625rem] text-fg-muted font-mono">
                {p.codigo}
              </code>
            )}
            <span
              class={
                'text-[0.625rem] font-semibold px-2 py-0.5 rounded-full tabular-nums ' +
                (p.active !== false
                  ? 'bg-accent text-fg-on-brand'
                  : 'bg-surface-3 text-fg-subtle')
              }
            >
              {p.active !== false ? '● Ativo' : '○ Inativo'}
            </span>
          </div>

          {p.slug && (
            <div class="flex items-center gap-1.5 mt-1">
              <code class="bg-surface-3 text-fg-muted px-1.5 py-0.5 rounded text-[0.625rem] font-mono truncate">
                {p.slug}
              </code>
              <button
                type="button"
                class="size-5 rounded grid place-items-center text-accent hover:bg-accent/10 shrink-0"
                onClick={copySlug}
                aria-label="Copiar slug"
                title="Copiar slug"
              >
                <Copy size={10} />
              </button>
            </div>
          )}

          <div class="flex items-center gap-2 mt-1.5 flex-wrap">
            {p.entryMode ? (
              <span class="bg-accent/15 text-accent text-[0.6875rem] font-semibold px-2 py-0.5 rounded-full inline-flex items-center gap-1">
                {p.entryMode.icon && <span>{p.entryMode.icon}</span>}
                {p.entryMode.name}
              </span>
            ) : (
              <span class="bg-danger/15 text-danger text-[0.6875rem] font-semibold px-2 py-0.5 rounded-full inline-flex items-center gap-1">
                <AlertCircle size={10} /> Sem modo
              </span>
            )}
            {phase && <PhasePill phase={phase} />}
          </div>

          <div class="text-xs text-fg-subtle mt-1.5 flex flex-wrap gap-x-2">
            {p.periodoLetivo && <span>{p.periodoLetivo}</span>}
            {p.unit?.nome && <span>· {p.unit.nome}</span>}
            {p.level?.nome && <span>· {p.level.nome}</span>}
          </div>

          <DateRanges p={p} />

          <div class="flex flex-wrap items-center gap-3 mt-2 text-[0.6875rem] tabular-nums">
            {p.taxaInscricao != null && (
              <span>
                <span class="text-fg-subtle uppercase tracking-wider mr-1">Taxa</span>
                <span class="text-fg font-semibold">{fmtBrl(p.taxaInscricao)}</span>
              </span>
            )}
            {p.notaCorte != null && (
              <span>
                <span class="text-fg-subtle uppercase tracking-wider mr-1">Nota corte</span>
                <span class="text-fg font-semibold">{p.notaCorte}</span>
              </span>
            )}
            {p._count && (
              <>
                <span>
                  <span class="text-fg-subtle uppercase tracking-wider mr-1">Ofertas</span>
                  <span class="text-fg-muted">{p._count.offerings}</span>
                </span>
                <span>
                  <span class="text-fg-subtle uppercase tracking-wider mr-1">Candidatos</span>
                  <span class="text-fg-muted">{p._count.registrations}</span>
                </span>
              </>
            )}
          </div>
        </button>
        <div class="flex flex-col items-end gap-1.5 shrink-0">
          <Button
            variant="primary"
            size="sm"
            onClick={onConfigure}
            title="Abrir configuração completa (documentos, redação, temas)"
          >
            <Settings2 size={12} /> Configurar
          </Button>
          <div class="flex gap-0.5">
            <button
              type="button"
              class="size-7 rounded grid place-items-center text-accent bg-accent/10 hover:bg-accent/20"
              onClick={onEdit}
              aria-label="Editar dados básicos"
              title="Editar dados básicos"
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
      </div>
    </Card>
  )
}

function PhasePill({ phase }: { phase: Phase }) {
  const cls =
    phase.tone === 'success' ? 'bg-accent text-fg-on-brand'
    : phase.tone === 'warning' ? 'bg-warning text-white'
    : 'bg-surface-3 text-fg-muted'
  return (
    <span class={`text-[0.6875rem] font-semibold px-2 py-0.5 rounded-full inline-flex items-center gap-1 ${cls}`}>
      <Clock size={10} /> {phase.label}
    </span>
  )
}

function DateRanges({ p }: { p: SelectionProcess }) {
  const ranges = [
    { label: 'Inscrições', from: p.inicioInscricao, to: p.terminoInscricao },
    { label: 'Matrículas', from: p.inicioMatricula, to: p.terminoMatricula },
  ].filter((r) => r.from ?? r.to)
  if (ranges.length === 0) return null
  return (
    <div class="flex flex-wrap gap-x-3 gap-y-0.5 mt-1.5 text-[0.6875rem] text-fg-muted tabular-nums">
      {ranges.map((r) => (
        <span key={r.label}>
          <span class="text-fg-subtle">{r.label}:</span> {fmtDate(r.from)} → {fmtDate(r.to)}
        </span>
      ))}
    </div>
  )
}

function toDateInput(iso: string | null | undefined): string {
  if (!iso) return ''
  return iso.slice(0, 10)
}

function ProcessFormModal({
  process: p, units, levels, entryModes, onClose, onCreated,
}: {
  process: SelectionProcess | null
  units: { id: number; nome: string }[]
  levels: { id: number; nome: string }[]
  entryModes: { id: number; name: string; evaluationType: EvaluationType }[]
  onClose: () => void
  onCreated?: (process: SelectionProcess) => void
}) {
  const isEdit = !!p
  const [unitId, setUnitId] = useState(p?.unitId ?? units[0]?.id ?? 0)
  const [levelId, setLevelId] = useState<number | ''>(p?.levelId ?? '')
  const [entryModeId, setEntryModeId] = useState(p?.entryModeId ?? entryModes[0]?.id ?? 0)
  const [nome, setNome] = useState(p?.nome ?? '')
  const [codigo, setCodigo] = useState(p?.codigo ?? '')
  const [slug, setSlug] = useState(p?.slug ?? '')
  const [periodoLetivo, setPeriodoLetivo] = useState(p?.periodoLetivo ?? '')
  const [descricao, setDescricao] = useState(p?.descricao ?? '')
  const [editalUrl, setEditalUrl] = useState(p?.editalUrl ?? '')
  const [taxaInscricao, setTaxaInscricao] = useState(p?.taxaInscricao != null ? String(p.taxaInscricao) : '')
  const [notaCorte, setNotaCorte] = useState(p?.notaCorte != null ? String(p.notaCorte) : '')
  const [inicioInscricao, setInicioInscricao] = useState(toDateInput(p?.inicioInscricao))
  const [terminoInscricao, setTerminoInscricao] = useState(toDateInput(p?.terminoInscricao))
  const [inicioMatricula, setInicioMatricula] = useState(toDateInput(p?.inicioMatricula))
  const [terminoMatricula, setTerminoMatricula] = useState(toDateInput(p?.terminoMatricula))
  const [status, setStatus] = useState(p?.status ?? 'active')
  const [active, setActive] = useState(p?.active ?? true)

  const create = useCreateSelectionProcess()
  const update = useUpdateSelectionProcess()
  const loading = create.isPending || update.isPending

  const autoSlug = useMemo(() => {
    const parts = [dasherize(nome)]
    if (codigo) parts.push(dasherize(codigo))
    return parts.filter(Boolean).join('-').slice(0, 100)
  }, [nome, codigo])

  function parseFloatOrNull(v: string): number | null {
    const n = parseFloat(v.replace(',', '.'))
    return Number.isFinite(n) ? n : null
  }

  function handleSubmit() {
    if (!nome.trim()) { toast('Nome é obrigatório', 'danger'); return }
    if (!unitId) { toast('Selecione uma unidade', 'danger'); return }
    if (!entryModeId) { toast('Selecione o modo de ingresso', 'danger'); return }

    const payload: SelectionProcessInput = {
      unitId,
      levelId: levelId === '' ? null : levelId,
      entryModeId,
      nome: nome.trim(),
      codigo: codigo.trim() || null,
      slug: slug.trim() || null,
      periodoLetivo: periodoLetivo.trim() || null,
      descricao: descricao.trim() || null,
      editalUrl: editalUrl.trim() || null,
      taxaInscricao: parseFloatOrNull(taxaInscricao),
      notaCorte: parseFloatOrNull(notaCorte),
      inicioInscricao: inicioInscricao || null,
      terminoInscricao: terminoInscricao || null,
      inicioMatricula: inicioMatricula || null,
      terminoMatricula: terminoMatricula || null,
      status,
      active,
    }

    if (isEdit) {
      update.mutate({ id: p.id, ...payload }, {
        onSuccess: () => { toast('Processo atualizado', 'success'); onClose() },
        onError: (e: unknown) => toast((e as Error).message, 'danger'),
      })
    } else {
      create.mutate(payload, {
        onSuccess: (res) => {
          toast('Processo criado — abra para configurar redação, documentos e temas', 'success')
          onClose()
          onCreated?.(res.process)
        },
        onError: (e: unknown) => toast((e as Error).message, 'danger'),
      })
    }
  }

  return (
    <Modal
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      title={isEdit ? 'Editar Processo Seletivo' : 'Novo Processo Seletivo'}
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
      <div class="space-y-5">
        <Section title="Identificação">
          <Input
            label="Nome"
            value={nome}
            onInput={(e) => setNome((e.target as HTMLInputElement).value)}
            placeholder="Ex.: Vestibular 2027/1"
          />
          <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Input
              label="Código"
              value={codigo ?? ''}
              onInput={(e) => setCodigo((e.target as HTMLInputElement).value)}
            />
            <Input
              label="Slug (opcional)"
              value={slug ?? ''}
              onInput={(e) => setSlug((e.target as HTMLInputElement).value)}
              placeholder={autoSlug || 'auto-gerado'}
              hint={slug.trim() ? 'URL pública do portal' : autoSlug ? `Vai virar: ${autoSlug}` : 'URL pública do portal'}
            />
            <Input
              label="Período letivo"
              value={periodoLetivo ?? ''}
              onInput={(e) => setPeriodoLetivo((e.target as HTMLInputElement).value)}
              placeholder="2027/1"
            />
          </div>
          <Textarea
            label="Descrição"
            value={descricao ?? ''}
            onInput={(e) => setDescricao((e.target as HTMLTextAreaElement).value)}
          />
          <Input
            label="URL do edital"
            type="url"
            value={editalUrl ?? ''}
            onInput={(e) => setEditalUrl((e.target as HTMLInputElement).value)}
            placeholder="https://"
          />
        </Section>

        <Section title="Vínculos">
          <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Select
              label="Unidade"
              value={String(unitId)}
              onChange={(e) => setUnitId(Number((e.target as HTMLSelectElement).value))}
            >
              {units.map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}
            </Select>
            <Select
              label="Modo de ingresso"
              value={String(entryModeId)}
              onChange={(e) => setEntryModeId(Number((e.target as HTMLSelectElement).value))}
            >
              {entryModes.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </Select>
            <Select
              label="Nível (opcional)"
              value={levelId === '' ? '' : String(levelId)}
              onChange={(e) => {
                const v = (e.target as HTMLSelectElement).value
                setLevelId(v ? Number(v) : '')
              }}
            >
              <option value="">Sem nível</option>
              {levels.map((l) => <option key={l.id} value={l.id}>{l.nome}</option>)}
            </Select>
          </div>
        </Section>

        <Section title="Operação">
          <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Select
              label="Status"
              value={status}
              onChange={(e) => setStatus((e.target as HTMLSelectElement).value)}
            >
              {STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </Select>
            <Input
              label="Taxa de inscrição (R$)"
              type="number"
              step="0.01"
              value={taxaInscricao}
              onInput={(e) => setTaxaInscricao((e.target as HTMLInputElement).value)}
            />
            <Input
              label="Nota de corte"
              type="number"
              value={notaCorte}
              onInput={(e) => setNotaCorte((e.target as HTMLInputElement).value)}
            />
          </div>
          <label class="flex items-center gap-2 text-sm text-fg-muted">
            <input type="checkbox" checked={active} onChange={(e) => setActive((e.target as HTMLInputElement).checked)} />
            Processo ativo
          </label>
        </Section>

        <Section title="Datas">
          <DateRangeRow
            label="Inscrições"
            from={inicioInscricao} to={terminoInscricao}
            onFrom={setInicioInscricao} onTo={setTerminoInscricao}
          />
          <DateRangeRow
            label="Matrículas"
            from={inicioMatricula} to={terminoMatricula}
            onFrom={setInicioMatricula} onTo={setTerminoMatricula}
          />
        </Section>

        {!isEdit && (
          <div class="rounded-md border border-border bg-surface p-3 text-xs text-fg-muted">
            Após criar, abra o processo para configurar <strong>Documentos exigidos</strong> e <strong>Temas de redação</strong>.
          </div>
        )}
      </div>
    </Modal>
  )
}

function Section({ title, children }: { title: string; children: preact.ComponentChildren }) {
  return (
    <div>
      <div class="text-xs uppercase tracking-wider text-fg-subtle mb-2">{title}</div>
      <div class="space-y-3">{children}</div>
    </div>
  )
}

function DateRangeRow({
  label, from, to, onFrom, onTo,
}: { label: string; from: string; to: string; onFrom: (v: string) => void; onTo: (v: string) => void }) {
  return (
    <div class="grid grid-cols-[6rem_1fr_1fr] items-end gap-3">
      <div class="text-xs text-fg-muted pb-1.5">{label}</div>
      <Input label="De" type="date" value={from} onInput={(e) => onFrom((e.target as HTMLInputElement).value)} />
      <Input label="Até" type="date" value={to} onInput={(e) => onTo((e.target as HTMLInputElement).value)} />
    </div>
  )
}

function DeleteProcessDialog({ process: p, onClose }: { process: SelectionProcess; onClose: () => void }) {
  const del = useDeleteSelectionProcess()
  const registrations = p._count?.registrations ?? 0
  const inUse = registrations > 0

  if (inUse) {
    return (
      <Modal
        open
        onOpenChange={(o) => { if (!o) onClose() }}
        title={`Não é possível excluir "${p.nome}"`}
        size="sm"
        footer={<Button variant="primary" size="sm" onClick={onClose}>Entendi</Button>}
      >
        <div class="space-y-3">
          <p class="text-xs text-fg-muted">
            Existem inscrições vinculadas a este processo. Mova-as ou desative-as primeiro,
            ou apenas <strong>desative o processo</strong> para mantê-lo no histórico.
          </p>
          <ul class="space-y-1.5">
            <li class="flex items-center justify-between text-xs px-2 py-1.5 rounded bg-surface border border-border">
              <span class="text-fg">Inscrições</span>
              <span class="text-fg-muted tabular-nums">{registrations.toLocaleString('pt-BR')}</span>
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
      title={`Excluir "${p.nome}"`}
      description="O processo vai para a lixeira e pode ser restaurado em até 90 dias."
      destructive
      confirmLabel="Excluir"
      loading={del.isPending}
      onConfirm={() => {
        del.mutate(p.id, {
          onSuccess: () => { toast('Processo movido para a lixeira', 'success'); onClose() },
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
