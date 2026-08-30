import { useMemo, useState } from 'preact/hooks'
import { Plus, Pencil, Trash2, Award, Paperclip, Info, BarChart3, Landmark, AlertTriangle } from '@/components/ui/icon-set'
import {
  useEntryModes,
  useCreateEntryMode,
  useUpdateEntryMode,
  useDeleteEntryMode,
  useReorderEntryModes,
  type EntryMode,
  type EntryModeInput,
  type EvaluationType,
  type FormaIngressoCatalogo,
  type CriterioCatalogo,
} from '@/hooks/useEducational'
import { Page } from '@/components/ui/Page'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Skeleton } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { Modal } from '@/components/ui/Modal'
import { Input, Textarea, Select } from '@/components/ui/Input'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { SortableList } from '@/components/ui/SortableList'
import { DocumentRequirementsEditor } from '@/components/educational/DocumentRequirementsEditor'
import { EduListHero } from '@/components/educational/EduListHero'
import { EduSearchBar } from '@/components/educational/EduSearchBar'
import { ApiError } from '@/lib/apiClient'
import { toast } from '@/lib/toast'
import { dasherize } from '@/lib/slug'

const EVALUATION_TYPES: { value: EvaluationType; label: string; hint: string }[] = [
  { value: 'none',            label: 'Aprovação automática',  hint: 'Apenas verificação documental' },
  { value: 'docs',            label: 'Análise documental',     hint: 'Análise de documentos enviados' },
  { value: 'enem',            label: 'ENEM (upload + IA)',     hint: 'Usa a nota do ENEM' },
  { value: 'exam_online',     label: 'Prova online (futura)',  hint: 'Aplicação remota' },
  { value: 'exam_presencial', label: 'Prova presencial (futura)', hint: 'Aplicação no campus' },
]

export function EducationalEntryModesPage() {
  const { data, isLoading } = useEntryModes(true)
  const reorder = useReorderEntryModes()
  const [editing, setEditing] = useState<EntryMode | null>(null)
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState<EntryMode | null>(null)
  const [editingDocsOfId, setEditingDocsOfId] = useState<number | null>(null)
  const [search, setSearch] = useState('')

  const modes = useMemo(() => data?.modes ?? [], [data])
  const catalogo = data?.catalogoCenso
  // Modos sem forma declarada geram vínculo com forma deduzida — e a dedução
  // pode não bater com o que a instituição informa ao INEP.
  const semForma = useMemo(
    () => modes.filter((m) => m.active !== false && !m.censoForma),
    [modes],
  )
  const rotuloDaForma = (codigo: string | null) =>
    (codigo ? catalogo?.formas.find((f) => f.codigo === codigo)?.rotulo ?? codigo : null)

  const totals = useMemo(() => ({
    active: modes.filter((m) => m.active !== false).length,
    processes: modes.reduce((a, m) => a + (m._count?.selectionProcesses ?? 0), 0),
    docs: modes.reduce((a, m) => a + (m.documentRequirements?.length ?? 0), 0),
  }), [modes])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return modes
    return modes.filter((m) =>
      [m.name, m.code, m.description, m.evaluationType]
        .some((s) => (s ?? '').toLowerCase().includes(q)),
    )
  }, [modes, search])

  function handleReorder(newOrder: EntryMode[]) {
    if (search.trim()) return
    reorder.mutate(
      newOrder.map((m, idx) => ({ id: m.id, position: idx })),
      { onError: (e: unknown) => toast((e as Error).message, 'danger') },
    )
  }

  // Pega o objeto fresco a partir do id, pra reagir a mutations que invalidam a query.
  const editingDocsOf = editingDocsOfId != null ? modes.find((m) => m.id === editingDocsOfId) ?? null : null

  return (
    <Page
      title="Modos de Ingresso"
      description="Formas de ingresso oferecidas pela instituição (vestibular, ENEM, transferência, etc) e seus requisitos documentais."
      actions={
        <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
          <Plus size={14} /> Novo modo
        </Button>
      }
    >
      <EduListHero
        icon={<Award size={26} />}
        title="Visão geral"
        summary={`${modes.length} modo(s) · ${totals.active} ativo(s)`}
        kpis={[
          { value: totals.active, label: 'Ativos', tone: 'accent' },
          { value: totals.processes, label: 'Processos', tone: 'success' },
          { value: totals.docs, label: 'Docs total', tone: 'warning' },
        ]}
      />

      {semForma.length > 0 && (
        <Card class="border-warning/40 bg-warning/5">
          <div class="flex items-start gap-2.5">
            <AlertTriangle size={15} class="text-warning mt-0.5 shrink-0" />
            <div class="text-xs text-fg-muted leading-relaxed">
              <span class="font-semibold text-fg">
                {semForma.length} modo(s) sem forma de ingresso declarada no Censo
              </span>
              {' — '}
              {semForma.map((m) => m.name).join(', ')}.
              <div class="mt-1">
                O Censo da Educação Superior aceita 10 formas, e cursos de especialização também
                são registrados nele (Res. CNE/CES 1/2018, art. 6º). Sem a declaração, o vínculo
                do aluno recebe uma forma deduzida, que pode divergir do que a instituição
                informa ao INEP.
              </div>
            </div>
          </div>
        </Card>
      )}

      {isLoading && (
        <div class="grid gap-2 grid-cols-1 lg:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} class="h-24 w-full" />)}
        </div>
      )}

      {!isLoading && modes.length === 0 && (
        <EmptyState
          icon={<Award size={24} />}
          title="Nenhum modo de ingresso cadastrado"
          description="Cadastre Vestibular, ENEM, Mestrado, EaD, etc — cada modo define avaliação, docs e workflow"
          action={
            <Button size="sm" variant="primary" onClick={() => setCreating(true)}>
              <Plus size={14} /> Novo modo
            </Button>
          }
        />
      )}

      {!isLoading && modes.length > 0 && (
        <>
          <EduSearchBar
            value={search}
            onChange={setSearch}
            placeholder="Buscar por nome, code, descrição..."
            total={modes.length}
            filteredCount={filtered.length}
            itemNoun="modo(s)"
          />

          {filtered.length === 0 ? (
            <Card>
              <div class="text-xs text-fg-muted italic text-center py-8">
                Nenhum resultado para "{search}"
              </div>
            </Card>
          ) : (
            <SortableList
              items={filtered}
              onReorder={handleReorder}
              renderItem={(m) => <EntryModeCard
                mode={m}
                formaRotulo={rotuloDaForma(m.censoForma)}
                onEditDocs={() => setEditingDocsOfId(m.id)}
                onEdit={() => setEditing(m)}
                onDelete={() => setDeleting(m)}
              />}
            />
          )}
        </>
      )}

      <Card class="!p-3.5 border-accent/30 bg-accent/5">
        <div class="flex items-start gap-2 text-xs text-fg">
          <Info size={14} class="mt-0.5 shrink-0 text-accent" />
          <span class="leading-relaxed">
            <strong>Como funciona:</strong> aqui você define o conjunto <em>padrão</em> de documentos
            exigidos para cada modo. Esses defaults aplicam-se a todos os processos seletivos que usam
            o modo. Para customizar docs em um processo específico, use o toggle{' '}
            <em>"Customizar"</em> no editor de Processos Seletivos.
          </span>
        </div>
      </Card>

      {(creating || editing) && (
        <EntryModeFormModal
          {...(catalogo ? { catalogo } : {})}
          mode={editing}
          onClose={() => { setCreating(false); setEditing(null) }}
        />
      )}

      {deleting && (
        <DeleteEntryModeDialog
          mode={deleting}
          onClose={() => setDeleting(null)}
        />
      )}

      {editingDocsOf && (
        <Modal
          open
          onOpenChange={(o) => { if (!o) setEditingDocsOfId(null) }}
          title={`Documentos exigidos — ${editingDocsOf.icon ? editingDocsOf.icon + ' ' : ''}${editingDocsOf.name}`}
          size="lg"
          footer={
            <Button variant="secondary" size="sm" onClick={() => setEditingDocsOfId(null)}>Fechar</Button>
          }
        >
          <DocumentRequirementsEditor
            owner={{ kind: 'entry-mode', entryModeId: editingDocsOf.id }}
            requirements={editingDocsOf.documentRequirements ?? []}
            banner={
              <>
                Documentos pedidos por padrão a todo candidato deste modo. Marque <em>"Obrigatório"</em>{' '}
                para travar o envio até aprovação. Cada processo seletivo herda esta lista, mas pode customizar
                individualmente via toggle <em>"Customizar para este processo"</em>.
              </>
            }
          />
        </Modal>
      )}
    </Page>
  )
}

function EntryModeCard({
  mode, onEditDocs, onEdit, onDelete, formaRotulo,
}: {
  mode: EntryMode
  formaRotulo?: string | null
  onEditDocs: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  const m = mode
  const inactive = m.active === false
  const reqs = m.documentRequirements ?? []
  const requiredCount = reqs.filter((r) => r.required).length
  const optionalCount = reqs.length - requiredCount
  const evalLabel = EVALUATION_TYPES.find((e) => e.value === m.evaluationType)?.label ?? m.evaluationType

  return (
    <Card class={inactive ? 'opacity-60' : ''}>
      <div class="flex items-start gap-3 group">
        <span class="size-10 rounded-md bg-accent/15 grid place-items-center shrink-0 text-lg">
          {m.icon ?? <Award size={16} class="text-accent" />}
        </span>
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2 flex-wrap">
            <span class="text-sm font-medium text-fg truncate">{m.name}</span>
            <code class="bg-surface-3 px-1.5 py-0.5 rounded text-3xs text-fg-muted font-mono">
              {m.code}
            </code>
            {inactive && (
              <span class="text-3xs font-bold tracking-wider px-2 py-0.5 rounded-full bg-danger/15 text-danger">
                INATIVO
              </span>
            )}
            {m.requiresClassification && (
              <span class="bg-accent/15 text-accent text-3xs font-semibold px-2 py-0.5 rounded-full inline-flex items-center gap-1">
                <BarChart3 size={10} /> Classificatório
              </span>
            )}
          </div>
          <div class="text-xs text-fg-muted mt-0.5">
            {evalLabel} · ordem {m.ordem}
          </div>
          <div class="mt-1">
            {formaRotulo ? (
              <span class="text-[0.625rem] font-medium px-2 py-0.5 rounded-full bg-success/15 text-success inline-flex items-center gap-1">
                <Landmark size={10} /> Censo: {formaRotulo}
              </span>
            ) : (
              <span class="text-[0.625rem] font-medium px-2 py-0.5 rounded-full bg-warning/15 text-warning inline-flex items-center gap-1">
                <AlertTriangle size={10} /> Sem forma no Censo
              </span>
            )}
          </div>
          {m.description && (
            <div class="text-xs text-fg-muted truncate mt-0.5">{m.description}</div>
          )}
          <div class="flex flex-wrap items-center gap-3 mt-1.5 text-2xs text-fg-muted tabular-nums">
            <span>
              <span class="text-fg-muted uppercase tracking-wider mr-1">Docs</span>
              {reqs.length}
              {reqs.length > 0 && (
                <span class="text-fg-muted ml-1">
                  ({requiredCount}*{optionalCount > 0 ? ` +${optionalCount}` : ''})
                </span>
              )}
            </span>
            <span>
              <span class="text-fg-muted uppercase tracking-wider mr-1">Processos</span>
              {m._count?.selectionProcesses ?? 0}
            </span>
          </div>
        </div>
        <div class="flex gap-0.5 shrink-0">
          <button
            type="button"
            class="size-7 rounded grid place-items-center text-danger bg-danger/10 hover:bg-danger/20"
            onClick={onEditDocs}
            aria-label="Editar documentos"
            title="Editar documentos"
          >
            <Paperclip size={12} />
          </button>
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

function EntryModeFormModal({ mode, onClose, catalogo }: {
  mode: EntryMode | null
  onClose: () => void
  catalogo?: { formas: FormaIngressoCatalogo[]; criterios: CriterioCatalogo[] }
}) {
  const isEdit = !!mode
  const [code, setCode] = useState(mode?.code ?? '')
  const [codeTouched, setCodeTouched] = useState(!!mode?.code)
  const [name, setName] = useState(mode?.name ?? '')
  const [icon, setIcon] = useState(mode?.icon ?? '')
  const [description, setDescription] = useState(mode?.description ?? '')
  const [evaluationType, setEvaluationType] = useState<EvaluationType>(mode?.evaluationType ?? 'docs')
  const [requiresClassification, setRequiresClassification] = useState(mode?.requiresClassification ?? false)
  const [censoForma, setCensoForma] = useState(mode?.censoForma ?? '')
  const [criterio, setCriterio] = useState(mode?.criterioClassificacao ?? '')
  const [ordem, setOrdem] = useState(String(mode?.ordem ?? 0))
  const [active, setActive] = useState(mode?.active ?? true)
  const [extrasJson, setExtrasJson] = useState(
    mode?.defaultFormExtras ? JSON.stringify(mode.defaultFormExtras, null, 2) : '',
  )
  const [extrasError, setExtrasError] = useState<string | null>(null)

  const create = useCreateEntryMode()
  const update = useUpdateEntryMode()
  const loading = create.isPending || update.isPending

  function handleNameChange(v: string) {
    setName(v)
    if (!isEdit && !codeTouched) {
      // EntryMode usa snake_case lowercase em vez de UPPER
      setCode(dasherize(v).replace(/-/g, '_').slice(0, 40))
    }
  }

  function handleCodeChange(v: string) {
    setCode(v.toLowerCase().replace(/[^a-z0-9_]/g, '_'))
    setCodeTouched(true)
  }

  function handleSubmit() {
    const trimCode = code.trim().toLowerCase()
    if (!/^[a-z0-9_]{2,40}$/.test(trimCode)) {
      toast('Código inválido (use letras minúsculas, números e _; 2–40 chars)', 'danger')
      return
    }
    if (!name.trim()) { toast('Nome é obrigatório', 'danger'); return }

    let parsedExtras: unknown = null
    if (extrasJson.trim()) {
      try {
        const parsed: unknown = JSON.parse(extrasJson)
        if (!Array.isArray(parsed)) {
          setExtrasError('JSON deve ser um array de campos')
          return
        }
        parsedExtras = parsed
      } catch {
        setExtrasError('JSON dos campos extras inválido')
        return
      }
    }
    setExtrasError(null)

    const payload: EntryModeInput = {
      code: trimCode,
      name: name.trim(),
      icon: icon.trim() || null,
      description: description.trim() || null,
      evaluationType,
      requiresClassification,
      censoForma: censoForma || null,
      criterioClassificacao: criterio || null,
      defaultFormExtras: parsedExtras,
      ordem: parseInt(ordem) || 0,
      active,
    }
    if (isEdit) {
      update.mutate({ id: mode.id, ...payload }, {
        onSuccess: () => { toast('Modo atualizado', 'success'); onClose() },
        onError: (e: unknown) => toast((e as Error).message, 'danger'),
      })
    } else {
      create.mutate(payload, {
        onSuccess: () => { toast('Modo criado', 'success'); onClose() },
        onError: (e: unknown) => toast((e as Error).message, 'danger'),
      })
    }
  }

  const formaSel = catalogo?.formas.find((f) => f.codigo === censoForma)
  const criterioSel = catalogo?.criterios.find((c) => c.codigo === criterio)
  // Quando a forma sugere critérios, mostra só os coerentes — evita gravar
  // combinação que o painel depois marcaria como incoerente.
  const criteriosVisiveis = formaSel?.criteriosSugeridos.length
    ? (catalogo?.criterios ?? []).filter((c) => formaSel.criteriosSugeridos.includes(c.codigo))
    : (catalogo?.criterios ?? [])

  return (
    <Modal
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      title={isEdit ? 'Editar Modo de Ingresso' : 'Novo Modo de Ingresso'}
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
        <div class="grid grid-cols-[80px_1fr_110px] gap-3">
          <Input
            label="Ícone (emoji)"
            value={icon ?? ''}
            onInput={(e) => setIcon((e.target as HTMLInputElement).value)}
            placeholder="🎓"
            maxLength={6}
            class="text-center text-lg"
          />
          <Input
            label="Nome *"
            value={name}
            onInput={(e) => handleNameChange((e.target as HTMLInputElement).value)}
            placeholder="Ex: Mestrado, Vestibular EaD"
          />
          <Input
            label="Ordem"
            type="number"
            min={0}
            value={ordem}
            onInput={(e) => setOrdem((e.target as HTMLInputElement).value)}
          />
        </div>

        <Input
          label="Code (identificador único) *"
          value={code}
          onInput={(e) => handleCodeChange((e.target as HTMLInputElement).value)}
          placeholder="ex: mestrado, vestibular_ead"
          class="font-mono"
          hint={
            isEdit
              ? 'Letras minúsculas, números e _; usado em integrações. Cuidado ao alterar em modos com processos vinculados.'
              : 'Letras minúsculas, números e _; usado em integrações.'
          }
        />

        <Textarea
          label="Descrição"
          value={description ?? ''}
          rows={2}
          onInput={(e) => setDescription((e.target as HTMLTextAreaElement).value)}
          placeholder="Como o candidato é avaliado, qual o público-alvo, etc."
        />

        <Select
          label="Tipo de avaliação *"
          value={evaluationType}
          onChange={(e) => setEvaluationType((e.target as HTMLSelectElement).value as EvaluationType)}
        >
          {EVALUATION_TYPES.map((t) => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </Select>

        <label class="flex items-center gap-2 text-sm text-fg cursor-pointer">
          <input
            type="checkbox"
            checked={requiresClassification}
            onChange={(e) => setRequiresClassification((e.target as HTMLInputElement).checked)}
          />
          Classifica candidatos
        </label>

        {/* Conformidade: o Censo aceita 10 formas de ingresso, e vários modos
            comerciais podem declarar a mesma (SELECAO_SIMPLIFICADA cobre pós,
            especialização e técnico sem prova). Res. CNE/CES 1/2018, art. 6º
            coloca especialização no Censo da Educação Superior. */}
        <div class="rounded-md border border-border bg-surface-2 p-3 space-y-3">
          <div class="flex items-center gap-2 text-xs font-semibold text-fg">
            <Landmark size={13} class="text-accent" />
            Conformidade — Censo da Educação Superior
          </div>

          <Select
            label="Forma de ingresso declarada no Censo"
            value={censoForma}
            onChange={(e) => {
              const v = (e.target as HTMLSelectElement).value
              setCensoForma(v)
              // Critério incoerente com a forma nova só confundiria: limpa.
              const f = catalogo?.formas.find((x) => x.codigo === v)
              if (f?.criteriosSugeridos.length && criterio && !f.criteriosSugeridos.includes(criterio)) setCriterio('')
            }}
          >
            <option value="">— não declarada (modo interno) —</option>
            {(catalogo?.formas ?? []).map((f) => (
              <option key={f.codigo} value={f.codigo}>{f.rotulo}</option>
            ))}
          </Select>
          {formaSel && (
            <p class="text-[0.6875rem] text-fg-muted leading-relaxed">{formaSel.descricao}</p>
          )}
          {formaSel?.restricao && (
            <p class="text-[0.6875rem] text-warning flex items-start gap-1.5">
              <AlertTriangle size={11} class="mt-0.5 shrink-0" />{formaSel.restricao}
            </p>
          )}
          {!censoForma && (
            <p class="text-[0.6875rem] text-warning flex items-start gap-1.5">
              <AlertTriangle size={11} class="mt-0.5 shrink-0" />
              Sem forma declarada, o vínculo criado por este modo não terá dado válido para o
              Censo — o sistema tentará deduzir a forma, e a dedução pode estar errada.
            </p>
          )}

          <Select
            label="Critério de classificação"
            value={criterio}
            onChange={(e) => setCriterio((e.target as HTMLSelectElement).value)}
          >
            <option value="">— não definido —</option>
            {criteriosVisiveis.map((c) => (
              <option key={c.codigo} value={c.codigo}>{c.rotulo}</option>
            ))}
          </Select>
          {criterioSel && (
            <p class="text-[0.6875rem] text-fg-muted leading-relaxed">{criterioSel.descricao}</p>
          )}
          {criterioSel && criterioSel.avaliacaoEsperada !== evaluationType && (
            <p class="text-[0.6875rem] text-warning flex items-start gap-1.5">
              <AlertTriangle size={11} class="mt-0.5 shrink-0" />
              Este critério normalmente usa avaliação
              {' '}"{EVALUATION_TYPES.find((t) => t.value === criterioSel.avaliacaoEsperada)?.label}"
              , e o modo está em "{EVALUATION_TYPES.find((t) => t.value === evaluationType)?.label}".
            </p>
          )}
        </div>

        <div>
          <label class="block text-xs font-medium text-fg-muted mb-1">
            Campos extras do formulário (JSON)
          </label>
          <textarea
            class="w-full font-mono text-2xs px-2 py-2 rounded-md bg-surface border border-border text-fg focus:outline-none focus:border-accent min-h-32 resize-y"
            value={extrasJson}
            rows={6}
            onInput={(e) => { setExtrasJson((e.target as HTMLTextAreaElement).value); setExtrasError(null) }}
            placeholder='[{"name":"campoX","label":"Pergunta","type":"text","required":true}]'
            spellcheck={false}
          />
          {extrasError ? (
            <span class="text-2xs text-danger">{extrasError}</span>
          ) : (
            <span class="text-2xs text-fg-muted">
              Array de campos que aparecem no portal do candidato quando este modo for selecionado. Cada item
              precisa ao menos de <code class="font-mono">name</code> e <code class="font-mono">type</code>{' '}
              (text, number, checkbox, textarea, date, select). Deixe vazio para nenhum extra.
            </span>
          )}
        </div>

        <label class="flex items-center gap-2 text-sm text-fg-muted">
          <input type="checkbox" checked={active} onChange={(e) => setActive((e.target as HTMLInputElement).checked)} />
          Ativo
        </label>
      </div>
    </Modal>
  )
}

function DeleteEntryModeDialog({ mode, onClose }: { mode: EntryMode; onClose: () => void }) {
  const del = useDeleteEntryMode()
  const inUse = (mode._count?.selectionProcesses ?? 0) > 0

  if (inUse) {
    return (
      <Modal
        open
        onOpenChange={(o) => { if (!o) onClose() }}
        title={`Não é possível excluir "${mode.name}"`}
        size="sm"
        footer={<Button variant="primary" size="sm" onClick={onClose}>Entendi</Button>}
      >
        <div class="space-y-3">
          <p class="text-xs text-fg-muted">
            Existem processos seletivos vinculados a este modo. Mova-os ou desative-os primeiro,
            ou apenas <strong>desative o modo</strong> para mantê-lo no histórico.
          </p>
          <ul class="space-y-1.5">
            <li class="flex items-center justify-between text-xs px-2 py-1.5 rounded bg-surface border border-border">
              <span class="text-fg">Processos seletivos</span>
              <span class="text-fg-muted tabular-nums">{(mode._count?.selectionProcesses ?? 0).toLocaleString('pt-BR')}</span>
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
      title={`Excluir "${mode.name}"`}
      description="O modo de ingresso vai para a lixeira e pode ser restaurado em até 90 dias."
      destructive
      confirmLabel="Excluir"
      loading={del.isPending}
      onConfirm={() => {
        del.mutate(mode.id, {
          onSuccess: () => { toast('Modo movido para a lixeira', 'success'); onClose() },
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
