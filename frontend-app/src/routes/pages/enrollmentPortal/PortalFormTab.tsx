import { useEffect, useMemo, useState } from 'preact/hooks'
import {
  ListChecks, Plus, Trash2, Save, AlertCircle, GripVertical, ChevronUp, ChevronDown, Eye, EyeOff,
} from 'lucide-preact'
import {
  useUpdateEnrollmentPortal,
  type EnrollmentPortal,
  type PortalFormConfig,
  type PortalStep,
  type PortalField,
  type PortalFieldType,
} from '@/hooks/useEnrollmentPortals'
import { useEntryModes, useSelectionProcesses } from '@/hooks/useEducational'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input, Select } from '@/components/ui/Input'
import { Badge } from '@/components/ui/Badge'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/cn'
import { SimpleFormEditor } from './PortalFormBlocks'
import {
  applyInformativeBlocks,
  blocksFromFormConfig,
  formConfigFromBlocks,
  modesFromSelectedSps,
  type FormBlock,
} from './portalBlocks'

type EditorMode = 'simple' | 'advanced'
const MODE_KEY = 'portalFormEditorMode'

const FIELD_TYPES: { value: PortalFieldType; label: string }[] = [
  { value: 'text',            label: 'Texto' },
  { value: 'textarea',        label: 'Texto longo' },
  { value: 'email',           label: 'E-mail' },
  { value: 'phone',           label: 'Telefone' },
  { value: 'cpf',             label: 'CPF' },
  { value: 'rg',              label: 'RG' },
  { value: 'cep',             label: 'CEP' },
  { value: 'date',            label: 'Data' },
  { value: 'number',          label: 'Número' },
  { value: 'select',          label: 'Seleção' },
  { value: 'offering-picker', label: '📚 Seletor de curso/oferta' },
]

const DEFAULT_CONFIG: PortalFormConfig = {
  steps: [
    {
      id: 'step-personal',
      name: 'Dados pessoais',
      fields: [
        { type: 'text',  name: 'nome',     label: 'Nome completo', required: true },
        { type: 'email', name: 'email',    label: 'E-mail',        required: true },
        { type: 'phone', name: 'whatsapp', label: 'WhatsApp',      required: true },
        { type: 'cpf',   name: 'cpf',      label: 'CPF',           required: true },
      ],
    },
    {
      id: 'step-offering',
      name: 'Curso e oferta',
      fields: [
        { type: 'offering-picker', name: 'offeringId', label: 'Curso', required: true },
      ],
    },
  ],
}

export function PortalFormTab({ portal }: { portal: EnrollmentPortal }) {
  const update = useUpdateEnrollmentPortal()
  const { data: modesData } = useEntryModes()
  const allModes = useMemo(
    () => (modesData?.modes ?? []).filter((m) => m.active !== false),
    [modesData?.modes],
  )
  const { data: spData } = useSelectionProcesses({})
  const processes = useMemo(() => spData?.processes ?? [], [spData?.processes])

  const [editorMode, setEditorMode] = useState<EditorMode>(() => {
    const saved = typeof localStorage !== 'undefined' ? localStorage.getItem(MODE_KEY) : null
    return saved === 'advanced' ? 'advanced' : 'simple'
  })

  const [config, setConfig] = useState<PortalFormConfig>(portal.formConfig ?? DEFAULT_CONFIG)
  const [blocks, setBlocks] = useState<FormBlock[]>(() => blocksFromFormConfig(portal.formConfig, portal))
  const [previewMode, setPreviewMode] = useState<string>('')
  const [dirty, setDirty] = useState(false)

  const detectedModes = useMemo(
    () => modesFromSelectedSps(processes, portal.selectionProcessIds, allModes),
    [processes, portal.selectionProcessIds, allModes],
  )

  useEffect(() => {
    setConfig(portal.formConfig ?? DEFAULT_CONFIG)
    setBlocks(blocksFromFormConfig(portal.formConfig, portal))
    setDirty(false)
  }, [portal.formConfig, portal])

  function persistMode(next: EditorMode) {
    setEditorMode(next)
    try { localStorage.setItem(MODE_KEY, next) } catch { /* ignore */ }
  }

  function handleBlocksChange(next: FormBlock[]) {
    setBlocks(next)
    setDirty(true)
    // mantém config sincronizado para se trocar de modo sem perder dados
    const compiled = formConfigFromBlocks(next, detectedModes)
    setConfig({ steps: compiled.steps })
  }

  function updateConfig(next: PortalFormConfig) {
    setConfig(next)
    setDirty(true)
  }

  function addStep() {
    const id = `step-${Date.now().toString(36)}`
    updateConfig({
      ...config,
      steps: [...config.steps, { id, name: `Etapa ${config.steps.length + 1}`, fields: [] }],
    })
  }

  function removeStep(idx: number) {
    if (config.steps.length <= 1) {
      toast('O formulário precisa ter pelo menos uma etapa', 'danger')
      return
    }
    updateConfig({ ...config, steps: config.steps.filter((_, i) => i !== idx) })
  }

  function moveStep(from: number, to: number) {
    if (to < 0 || to >= config.steps.length) return
    const next = config.steps.slice()
    const [s] = next.splice(from, 1)
    if (s) next.splice(to, 0, s)
    updateConfig({ ...config, steps: next })
  }

  function updateStep(idx: number, patch: Partial<PortalStep>) {
    updateConfig({
      ...config,
      steps: config.steps.map((s, i) => i === idx ? { ...s, ...patch } : s),
    })
  }

  function addField(stepIdx: number) {
    const step = config.steps[stepIdx]
    if (!step) return
    const newField: PortalField = {
      type: 'text',
      name: `campo_${step.fields.length + 1}`,
      label: 'Novo campo',
      required: false,
    }
    updateStep(stepIdx, { fields: [...step.fields, newField] })
  }

  function removeField(stepIdx: number, fieldIdx: number) {
    const step = config.steps[stepIdx]
    if (!step) return
    updateStep(stepIdx, { fields: step.fields.filter((_, i) => i !== fieldIdx) })
  }

  function updateField(stepIdx: number, fieldIdx: number, patch: Partial<PortalField>) {
    const step = config.steps[stepIdx]
    if (!step) return
    updateStep(stepIdx, {
      fields: step.fields.map((f, i) => i === fieldIdx ? { ...f, ...patch } : f),
    })
  }

  function moveField(stepIdx: number, from: number, to: number) {
    const step = config.steps[stepIdx]
    if (!step || to < 0 || to >= step.fields.length) return
    const next = step.fields.slice()
    const [f] = next.splice(from, 1)
    if (f) next.splice(to, 0, f)
    updateStep(stepIdx, { fields: next })
  }

  function toggleVisibleMode(stepIdx: number, fieldIdx: number, code: string) {
    const step = config.steps[stepIdx]
    const field = step?.fields[fieldIdx]
    if (!field) return
    const current = field.visibleWhen?.entryMode ?? []
    const nextList = current.includes(code) ? current.filter((c) => c !== code) : [...current, code]
    const visibleWhen = nextList.length > 0 ? { ...(field.visibleWhen ?? {}), entryMode: nextList } : undefined
    const nextField: PortalField = visibleWhen
      ? { ...field, visibleWhen }
      : (() => {
          const { visibleWhen: _drop, ...rest } = field
          void _drop
          return rest
        })()
    updateField(stepIdx, fieldIdx, nextField)
  }

  function handleReset() {
    setConfig(portal.formConfig ?? DEFAULT_CONFIG)
    setBlocks(blocksFromFormConfig(portal.formConfig, portal))
    setDirty(false)
  }

  function handleSave() {
    let toSave: PortalFormConfig = config
    let extras: ReturnType<typeof applyInformativeBlocks> = {}

    if (editorMode === 'simple') {
      const compiled = formConfigFromBlocks(blocks, detectedModes)
      toSave = { steps: compiled.steps }
      // Preserva flags informativas no formConfig para round-trip
      const withMeta = compiled as PortalFormConfig & { _informativeBlocks?: unknown }
      if (withMeta._informativeBlocks) {
        (toSave as PortalFormConfig & { _informativeBlocks?: unknown })._informativeBlocks = withMeta._informativeBlocks
      }
      extras = applyInformativeBlocks(blocks)
    }

    // Validações
    for (const step of toSave.steps) {
      if (!step.name.trim()) { toast('Toda etapa precisa de um nome', 'danger'); return }
      const seen = new Set<string>()
      for (const f of step.fields) {
        if (!f.name.trim()) { toast(`Campo sem nome em "${step.name}"`, 'danger'); return }
        if (!/^[a-z][a-z0-9_]*$/i.test(f.name)) {
          toast(`Nome técnico inválido: "${f.name}" — use letras, números e _`, 'danger')
          return
        }
        if (seen.has(f.name)) { toast(`Nome de campo duplicado em "${step.name}": ${f.name}`, 'danger'); return }
        seen.add(f.name)
        if (!f.label.trim()) { toast(`Rótulo vazio em "${f.name}"`, 'danger'); return }
      }
    }

    update.mutate({ id: portal.id, formConfig: toSave, ...extras }, {
      onSuccess: () => { toast('Formulário salvo', 'success'); setDirty(false) },
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  return (
    <div class="space-y-3">
      <Card>
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div class="min-w-0 flex-1">
            <div class="text-sm font-semibold text-fg flex items-center gap-2">
              <ListChecks size={14} /> Estrutura do formulário
            </div>
            <div class="text-xs text-fg-muted mt-0.5">
              {editorMode === 'simple'
                ? `${blocks.filter((b) => b.enabled).length} bloco(s) ativo(s)`
                : `${config.steps.length} etapa(s) · ${config.steps.reduce((a, s) => a + s.fields.length, 0)} campo(s)`}
              {dirty && <span class="text-warning ml-2">· alterações não salvas</span>}
            </div>
          </div>
          <div class="flex gap-2">
            {dirty && (
              <Button variant="secondary" size="sm" onClick={handleReset} disabled={update.isPending}>
                Descartar
              </Button>
            )}
            <Button variant="primary" size="sm" onClick={handleSave} disabled={!dirty || update.isPending}>
              <Save size={12} /> {update.isPending ? 'Salvando…' : 'Salvar formulário'}
            </Button>
          </div>
        </div>
      </Card>

      {editorMode === 'simple' ? (
        <SimpleFormEditor
          blocks={blocks}
          modes={detectedModes}
          processes={processes}
          portal={{ selectionProcessIds: portal.selectionProcessIds, slug: portal.slug }}
          onChange={handleBlocksChange}
          onSwitchAdvanced={() => persistMode('advanced')}
        />
      ) : (
        <AdvancedSection
          modes={allModes}
          previewMode={previewMode}
          setPreviewMode={setPreviewMode}
          config={config}
          onAddStep={addStep}
          onUpdateStep={updateStep}
          onRemoveStep={removeStep}
          onMoveStep={moveStep}
          onAddField={addField}
          onRemoveField={removeField}
          onUpdateField={updateField}
          onMoveField={moveField}
          onToggleVisibleMode={toggleVisibleMode}
          onSwitchSimple={() => persistMode('simple')}
        />
      )}
    </div>
  )
}

interface AdvancedSectionProps {
  modes: { code: string; name: string; icon: string | null }[]
  previewMode: string
  setPreviewMode: (v: string) => void
  config: PortalFormConfig
  onAddStep: () => void
  onUpdateStep: (idx: number, patch: Partial<PortalStep>) => void
  onRemoveStep: (idx: number) => void
  onMoveStep: (from: number, to: number) => void
  onAddField: (stepIdx: number) => void
  onRemoveField: (stepIdx: number, fieldIdx: number) => void
  onUpdateField: (stepIdx: number, fieldIdx: number, patch: Partial<PortalField>) => void
  onMoveField: (stepIdx: number, from: number, to: number) => void
  onToggleVisibleMode: (stepIdx: number, fieldIdx: number, code: string) => void
  onSwitchSimple: () => void
}

function AdvancedSection({
  modes, previewMode, setPreviewMode, config,
  onAddStep, onUpdateStep, onRemoveStep, onMoveStep,
  onAddField, onRemoveField, onUpdateField, onMoveField, onToggleVisibleMode,
  onSwitchSimple,
}: AdvancedSectionProps) {
  return (
    <>
      <div class="rounded-md border border-warning/30 bg-warning/10 p-3 text-xs text-warning flex items-center justify-between gap-3 flex-wrap">
        <div>
          ⚙ <strong>Modo avançado:</strong> editor cru de etapas e campos. Recomendado apenas para casos complexos.
        </div>
        <Button size="sm" variant="ghost" onClick={onSwitchSimple} class="border border-warning/40 text-warning">
          ← Voltar ao modo simples
        </Button>
      </div>

      {modes.length > 0 && (
        <Card>
          <div class="flex items-center gap-3 flex-wrap">
            <div class="text-xs uppercase tracking-wider text-fg-subtle inline-flex items-center gap-1">
              {previewMode ? <Eye size={12} /> : <EyeOff size={12} />}
              Preview do modo
            </div>
            <Select value={previewMode} onChange={(e) => setPreviewMode((e.target as HTMLSelectElement).value)}>
              <option value="">— sem preview (todos visíveis) —</option>
              {modes.map((m) => (
                <option key={m.code} value={m.code}>{m.icon ?? ''} {m.name}</option>
              ))}
            </Select>
            <span class="text-[0.6875rem] text-fg-subtle">
              Campos com regra de visibilidade são marcados como ocultos quando o modo selecionado não corresponde.
            </span>
          </div>
        </Card>
      )}

      <div class="space-y-3">
        {config.steps.map((step, idx) => (
          <StepCard
            key={step.id}
            step={step}
            index={idx}
            total={config.steps.length}
            modes={modes}
            previewMode={previewMode}
            onUpdate={(patch) => onUpdateStep(idx, patch)}
            onRemove={() => onRemoveStep(idx)}
            onMoveUp={() => onMoveStep(idx, idx - 1)}
            onMoveDown={() => onMoveStep(idx, idx + 1)}
            onAddField={() => onAddField(idx)}
            onRemoveField={(fi) => onRemoveField(idx, fi)}
            onUpdateField={(fi, patch) => onUpdateField(idx, fi, patch)}
            onMoveField={(from, to) => onMoveField(idx, from, to)}
            onToggleVisibleMode={(fi, code) => onToggleVisibleMode(idx, fi, code)}
          />
        ))}
      </div>

      <Button variant="secondary" size="sm" onClick={onAddStep}>
        <Plus size={12} /> Adicionar etapa
      </Button>

      <Card>
        <div class="flex items-start gap-2 text-xs text-fg-muted">
          <AlertCircle size={14} class="text-info shrink-0 mt-0.5" />
          <div>
            <strong>Como funciona:</strong> O formulário público segue a ordem das etapas. Use o "Seletor de curso/oferta"
            para que o sistema descubra automaticamente o <em>modo de ingresso</em> do candidato — campos com regra de
            visibilidade aparecem só quando o modo escolhido coincide.
          </div>
        </div>
      </Card>
    </>
  )
}

interface StepCardProps {
  step: PortalStep
  index: number
  total: number
  modes: { code: string; name: string; icon: string | null }[]
  previewMode: string
  onUpdate: (patch: Partial<PortalStep>) => void
  onRemove: () => void
  onMoveUp: () => void
  onMoveDown: () => void
  onAddField: () => void
  onRemoveField: (fieldIdx: number) => void
  onUpdateField: (fieldIdx: number, patch: Partial<PortalField>) => void
  onMoveField: (from: number, to: number) => void
  onToggleVisibleMode: (fieldIdx: number, code: string) => void
}

function StepCard({
  step, index, total, modes, previewMode,
  onUpdate, onRemove, onMoveUp, onMoveDown,
  onAddField, onRemoveField, onUpdateField, onMoveField, onToggleVisibleMode,
}: StepCardProps) {
  return (
    <Card>
      <div class="flex items-center gap-3 mb-3 flex-wrap">
        <span class="size-7 rounded-full bg-accent text-fg-on-brand grid place-items-center text-xs font-semibold shrink-0">
          {index + 1}
        </span>
        <Input
          value={step.name}
          onInput={(e) => onUpdate({ name: (e.target as HTMLInputElement).value })}
          placeholder="Nome da etapa"
          class="flex-1 min-w-32"
        />
        <div class="flex gap-1 shrink-0">
          {index > 0 && (
            <button
              type="button"
              class="size-7 rounded grid place-items-center text-fg-muted hover:text-fg hover:bg-surface-3"
              onClick={onMoveUp}
              aria-label="Mover para cima"
            ><ChevronUp size={14} /></button>
          )}
          {index < total - 1 && (
            <button
              type="button"
              class="size-7 rounded grid place-items-center text-fg-muted hover:text-fg hover:bg-surface-3"
              onClick={onMoveDown}
              aria-label="Mover para baixo"
            ><ChevronDown size={14} /></button>
          )}
          <button
            type="button"
            class="size-7 rounded grid place-items-center text-fg-muted hover:text-danger hover:bg-surface-3"
            onClick={onRemove}
            aria-label="Remover etapa"
            title="Remover etapa"
          ><Trash2 size={12} /></button>
        </div>
      </div>

      {step.fields.length === 0 && (
        <div class="text-xs text-fg-subtle text-center py-3 border border-dashed border-border rounded-md">
          Sem campos. Clique em "Adicionar campo" abaixo.
        </div>
      )}

      <ul class="space-y-2">
        {step.fields.map((field, fi) => (
          <FieldRow
            key={fi}
            field={field}
            index={fi}
            total={step.fields.length}
            modes={modes}
            hidden={isHiddenInPreview(field, previewMode)}
            onUpdate={(patch) => onUpdateField(fi, patch)}
            onRemove={() => onRemoveField(fi)}
            onMoveUp={() => onMoveField(fi, fi - 1)}
            onMoveDown={() => onMoveField(fi, fi + 1)}
            onToggleVisibleMode={(code) => onToggleVisibleMode(fi, code)}
          />
        ))}
      </ul>

      <div class="mt-2">
        <Button variant="secondary" size="sm" onClick={onAddField}>
          <Plus size={12} /> Adicionar campo
        </Button>
      </div>
    </Card>
  )
}

function isHiddenInPreview(field: PortalField, previewMode: string): boolean {
  if (!previewMode) return false
  const rule = field.visibleWhen?.entryMode
  if (!rule || rule.length === 0) return false
  return !rule.includes(previewMode)
}

interface FieldRowProps {
  field: PortalField
  index: number
  total: number
  modes: { code: string; name: string; icon: string | null }[]
  hidden: boolean
  onUpdate: (patch: Partial<PortalField>) => void
  onRemove: () => void
  onMoveUp: () => void
  onMoveDown: () => void
  onToggleVisibleMode: (code: string) => void
}

function FieldRow({
  field, index, total, modes, hidden,
  onUpdate, onRemove, onMoveUp, onMoveDown, onToggleVisibleMode,
}: FieldRowProps) {
  const [showRules, setShowRules] = useState(false)
  const rule = field.visibleWhen?.entryMode ?? []
  const hasRule = rule.length > 0
  const isOfferingPicker = field.type === 'offering-picker'

  return (
    <li class={cn(
      'rounded-md border border-border bg-surface',
      hidden && 'opacity-40',
    )}>
      {hidden && (
        <div class="px-3 py-1 text-[0.6875rem] text-fg-subtle bg-surface-3 border-b border-border inline-flex items-center gap-1 rounded-t-md">
          <EyeOff size={10} /> Oculto no preview do modo selecionado
        </div>
      )}

      <div class="flex flex-wrap items-center gap-2 p-2">
        <div class="flex flex-col gap-0.5 shrink-0">
          {index > 0 && (
            <button
              type="button"
              class="size-5 grid place-items-center text-fg-subtle hover:text-fg"
              onClick={onMoveUp}
              aria-label="Subir"
            ><ChevronUp size={10} /></button>
          )}
          {index === 0 && index < total - 1 && (
            <span class="size-5 grid place-items-center text-fg-subtle/40">
              <GripVertical size={10} />
            </span>
          )}
          {index < total - 1 && (
            <button
              type="button"
              class="size-5 grid place-items-center text-fg-subtle hover:text-fg"
              onClick={onMoveDown}
              aria-label="Descer"
            ><ChevronDown size={10} /></button>
          )}
        </div>

        <Select
          value={field.type}
          onChange={(e) => onUpdate({ type: (e.target as HTMLSelectElement).value as PortalFieldType })}
          class="w-44 shrink-0"
        >
          {FIELD_TYPES.map((t) => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </Select>

        <Input
          value={field.name}
          onInput={(e) => onUpdate({ name: (e.target as HTMLInputElement).value })}
          placeholder="nome_tecnico"
          class="w-36 shrink-0 font-mono text-xs"
        />

        <Input
          value={field.label}
          onInput={(e) => onUpdate({ label: (e.target as HTMLInputElement).value })}
          placeholder="Rótulo exibido"
          class="flex-1 min-w-32"
        />

        <label class="flex items-center gap-1.5 text-xs text-fg-muted cursor-pointer whitespace-nowrap shrink-0">
          <input
            type="checkbox"
            checked={!!field.required}
            onChange={(e) => onUpdate({ required: (e.target as HTMLInputElement).checked })}
          />
          Obrigatório
        </label>

        {isOfferingPicker ? (
          <span
            class="text-[0.6875rem] text-fg-subtle px-2 py-1 rounded border border-border bg-surface-3 shrink-0"
            title="O seletor de curso já define o modo de ingresso, então não aceita regra de visibilidade por modo (dependência circular)"
          >
            🎯 —
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setShowRules((v) => !v)}
            class={cn(
              'inline-flex items-center gap-1 h-7 px-2 rounded border text-[0.6875rem] font-medium shrink-0',
              hasRule
                ? 'border-accent bg-accent/10 text-accent'
                : 'border-border text-fg-muted hover:text-fg',
            )}
            title="Regra de visibilidade por modo de ingresso"
          >
            🎯 {hasRule ? rule.length : 'Regra'}
          </button>
        )}

        <button
          type="button"
          class="size-7 rounded grid place-items-center text-fg-muted hover:text-danger hover:bg-surface-3 shrink-0"
          onClick={onRemove}
          aria-label="Remover campo"
          title="Remover campo"
        ><Trash2 size={11} /></button>
      </div>

      {showRules && !isOfferingPicker && (
        <div class="px-3 py-2 border-t border-border bg-surface-3/50">
          <div class="text-[0.6875rem] text-fg-muted mb-1.5">
            Visível apenas quando o modo de ingresso for:
          </div>
          {modes.length === 0 ? (
            <span class="text-[0.6875rem] text-fg-subtle italic">Nenhum modo de ingresso cadastrado</span>
          ) : (
            <div class="flex flex-wrap gap-1.5">
              {modes.map((m) => {
                const on = rule.includes(m.code)
                return (
                  <button
                    key={m.code}
                    type="button"
                    onClick={() => onToggleVisibleMode(m.code)}
                    class={cn(
                      'h-7 px-3 rounded-full border text-[0.6875rem] font-medium',
                      on
                        ? 'bg-accent text-fg-on-brand border-accent'
                        : 'bg-surface text-fg-muted border-border hover:text-fg',
                    )}
                  >
                    {m.icon ?? ''} {m.name}
                  </button>
                )
              })}
            </div>
          )}
          <div class="text-[0.625rem] text-fg-subtle mt-2">
            {hasRule
              ? `Visível em ${rule.length} modo(s)`
              : 'Nenhum selecionado = sempre visível'}
          </div>
        </div>
      )}

      {field.type === 'select' && (
        <div class="px-3 pb-2 -mt-1">
          <Input
            label="Opções (separadas por vírgula)"
            value={(field.options ?? []).join(', ')}
            onInput={(e) => {
              const v = (e.target as HTMLInputElement).value
              const opts = v.split(',').map((s) => s.trim()).filter(Boolean)
              onUpdate({ options: opts })
            }}
            placeholder="Opção 1, Opção 2, Opção 3"
            hint="Lista de opções para o select"
          />
        </div>
      )}
    </li>
  )
}

void Badge
