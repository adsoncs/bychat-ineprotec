import { useEffect, useMemo, useState } from 'preact/hooks'
import { Plus, Save, Trash2, EyeOff, User, Mail, Phone, Building2, MapPin, Tag, Type, AlignLeft, AlignCenter, AlignRight, List, Hash, Link2, Sparkles, Heading, Image as ImageIcon, CalendarClock, AlertTriangle, CheckCircle2 } from 'lucide-preact'
import { useMeetingTypes } from '@/hooks/useScheduling'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Input, Textarea, Select } from '@/components/ui/Input'
import { SortableList } from '@/components/ui/SortableList'
import { Skeleton } from '@/components/ui/Skeleton'
import { Badge } from '@/components/ui/Badge'
import {
  useForm,
  useUpdateFormFields,
  type FormField,
  type FormFieldOption,
  type FormFieldType,
  type QualifyOutcome,
} from '@/hooks/useForms'
import { useStages } from '@/hooks/useFunnels'
import { useCustomFields, useCreateCustomField, type CustomField } from '@/hooks/useCustomFields'
import { RichText, stripHtml } from '@/components/ui/RichText'
import { toast } from '@/lib/toast'

// Presets de campos comuns — adicionados com 1 clique, já mapeados pro lead.
interface FieldPreset { label: string; type: FormFieldType; mapTo?: string; key?: string; placeholder?: string; icon: any }
const FIELD_PRESETS: FieldPreset[] = [
  { label: 'Nome',     type: 'text',  mapTo: 'nome',     key: 'nome',     placeholder: 'Seu nome completo',  icon: User },
  { label: 'E-mail',   type: 'email', mapTo: 'email',    key: 'email',    placeholder: 'voce@email.com',     icon: Mail },
  { label: 'WhatsApp', type: 'phone', mapTo: 'whatsapp', key: 'whatsapp', placeholder: '(00) 00000-0000',    icon: Phone },
  { label: 'Empresa',  type: 'text',  mapTo: 'empresa',  key: 'empresa',  placeholder: 'Nome da empresa',    icon: Building2 },
  { label: 'Cidade',   type: 'text',  mapTo: 'cidade',   key: 'cidade',   placeholder: 'Sua cidade',         icon: MapPin },
  { label: 'Segmento', type: 'text',  mapTo: 'segmento', key: 'segmento', placeholder: 'Seu segmento',       icon: Tag },
]
// Campos genéricos (sem mapeamento) — viram pergunta livre.
const GENERIC_PRESETS: FieldPreset[] = [
  { label: 'Texto curto', type: 'text',     icon: Type },
  { label: 'Texto longo', type: 'textarea', icon: AlignLeft },
  { label: 'Seleção',     type: 'select',   icon: List },
  { label: 'Número',      type: 'number',   icon: Hash },
  { label: 'URL',         type: 'url',      icon: Link2 },
]
// Blocos de conteúdo (não coletam dado) — headline/copy/ícone/imagem/HTML.
const CONTENT_PRESETS: FieldPreset[] = [
  { label: 'Cabeçalho',   type: 'statement',  key: 'titulo',     icon: Heading },
  { label: 'Imagem',      type: 'statement',  key: 'imagem',     icon: ImageIcon },
  { label: 'Agendamento', type: 'scheduling', key: 'agendamento', icon: CalendarClock },
]

// CustomField.type → FormFieldType (campos do form têm menos tipos que o catálogo).
export function cfTypeToFieldType(t: string): FormFieldType {
  switch (t) {
    case 'textarea': return 'textarea'
    case 'email': return 'email'
    case 'phone': return 'phone'
    case 'url': return 'url'
    case 'number': case 'currency': return 'number'
    case 'select': case 'multiselect': case 'checkbox': return 'select'
    default: return 'text' // text, date, etc. caem em texto
  }
}

interface FormFieldsEditorProps {
  formId: number
  onClose: () => void
}

const FIELD_TYPES: { value: FormFieldType; label: string }[] = [
  { value: 'text', label: 'Texto curto' },
  { value: 'textarea', label: 'Texto longo' },
  { value: 'email', label: 'E-mail' },
  { value: 'phone', label: 'Telefone' },
  { value: 'number', label: 'Número' },
  { value: 'url', label: 'URL' },
  { value: 'select', label: 'Seleção' },
  { value: 'statement', label: 'Cabeçalho / Texto' },
  { value: 'scheduling', label: 'Agendamento' },
  { value: 'hidden', label: 'Oculto' },
]

const MAP_TO_OPTIONS = [
  { value: '', label: 'Sem mapeamento' },
  { value: 'nome', label: 'Nome' },
  { value: 'email', label: 'E-mail' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'empresa', label: 'Empresa' },
  { value: 'cidade', label: 'Cidade' },
  { value: 'segmento', label: 'Segmento' },
]

function genId(): string {
  return `f${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

export function normalizeKey(label: string): string {
  return label
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 80)
}

export function genFieldId(): string { return genId() }

// Monta um FormField a partir de uma base, garantindo chave única no escopo.
export function buildUniqueField(base: Omit<FormField, 'id'>, usedKeys: string[]): FormField {
  const used = new Set(usedKeys)
  let key = base.key || normalizeKey(base.label) || 'campo'
  if (used.has(key)) { let n = 2; while (used.has(`${key}_${n}`)) n++; key = `${key}_${n}` }
  return { ...base, id: genId(), key }
}

export { FIELD_PRESETS, GENERIC_PRESETS }
export type { FieldPreset }

function isFieldArray(v: unknown): v is FormField[] {
  return Array.isArray(v) && v.every((it) => typeof it === 'object' && it !== null && 'id' in it && 'type' in it)
}

export function FormFieldsEditor({ formId, onClose }: FormFieldsEditorProps) {
  const { data, isLoading } = useForm(formId)
  const update = useUpdateFormFields()

  const [fields, setFields] = useState<FormField[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  const [hydrated, setHydrated] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)

  // Hidratação única: refetch em background não pode sobrescrever edits do usuário.
  // Após salvar, useUpdateFormFields invalida a query e mantemos os campos atuais
  // (já consistentes com o backend) sem perder a seleção.
  useEffect(() => {
    if (!data || hydrated) return
    const raw = data.fields
    const next = isFieldArray(raw) ? raw : []
    setFields(next)
    setActiveId(next[0]?.id ?? null)
    setDirty(false)
    setHydrated(true)
  }, [data, hydrated])

  const active = useMemo(() => fields.find((f) => f.id === activeId) ?? null, [fields, activeId])

  function patchField(id: string, partial: Partial<FormField>) {
    setFields((arr) => arr.map((f) => (f.id === id ? { ...f, ...partial } : f)))
    setDirty(true)
  }

  // Adiciona um campo já montado (vindo da paleta: preset, custom field ou criado).
  // Garante chave única no escopo do form (sufixa _2, _3… se colidir).
  function addReadyField(base: Omit<FormField, 'id'>) {
    setFields((arr) => {
      const used = new Set(arr.map((f) => f.key))
      let key = base.key || normalizeKey(base.label) || 'campo'
      if (used.has(key)) { let n = 2; while (used.has(`${key}_${n}`)) n++; key = `${key}_${n}` }
      const f: FormField = { ...base, id: genId(), key }
      setActiveId(f.id)
      return [...arr, f]
    })
    setDirty(true)
  }

  function removeField(id: string) {
    setFields((arr) => {
      const idx = arr.findIndex((f) => f.id === id)
      const next = arr.filter((f) => f.id !== id)
      // Auto-seleciona vizinho (próximo se houver, senão anterior, senão null)
      setActiveId((curr) => {
        if (curr !== id) return curr
        if (next.length === 0) return null
        const target = next[idx] ?? next[idx - 1] ?? next[0]
        return target?.id ?? null
      })
      return next
    })
    setDirty(true)
  }

  function reorder(next: FormField[]) {
    setFields(next)
    setDirty(true)
  }

  function handleSave() {
    const errs = validate(fields)
    if (errs.length > 0) {
      toast(errs[0] ?? 'Há campos inválidos', 'danger')
      return
    }
    update.mutate(
      { id: formId, fields },
      {
        onSuccess: () => {
          toast('Campos salvos', 'success')
          setDirty(false)
        },
        onError: (e: unknown) => toast((e as Error).message, 'danger'),
      },
    )
  }

  return (
    <Modal
      open
      onOpenChange={(o) => {
        if (!o) onClose()
      }}
      title={data ? `Editar campos — ${data.name}` : 'Editar campos'}
      description="Arraste para reordenar, clique para editar. As alterações só afetam novas submissões."
      size="xl"
      unconstrained
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose} disabled={update.isPending}>
            Fechar
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={handleSave}
            disabled={!dirty || update.isPending}
          >
            <Save size={14} /> {update.isPending ? 'Salvando…' : 'Salvar campos'}
          </Button>
        </>
      }
    >
      {isLoading && <Skeleton class="h-64 w-full" />}
      {!isLoading && (
        <div class="grid gap-4 lg:grid-cols-[18rem_1fr]">
          <FieldsListColumn
            fields={fields}
            activeId={activeId}
            onSelect={setActiveId}
            onAdd={() => setPaletteOpen(true)}
            onReorder={reorder}
          />
          <FieldEditorColumn
            field={active}
            onPatch={(p) => active && patchField(active.id, p)}
            onRemove={() => active && removeField(active.id)}
          />
        </div>
      )}
      {paletteOpen && (
        <AddFieldPalette
          usedKeys={fields.map((f) => f.key)}
          onClose={() => setPaletteOpen(false)}
          onPick={(base) => { addReadyField(base); setPaletteOpen(false) }}
        />
      )}
    </Modal>
  )
}

// ── Paleta "Adicionar campo": comuns + catálogo de personalizados + criar novo ──
export function AddFieldPalette({ usedKeys, onClose, onPick }: {
  usedKeys: string[]
  onClose: () => void
  onPick: (base: Omit<FormField, 'id'>) => void
}) {
  const { data, isLoading } = useCustomFields()
  const createCf = useCreateCustomField()
  const [tab, setTab] = useState<'common' | 'custom' | 'new'>('common')
  // criar novo
  const [nLabel, setNLabel] = useState('')
  const [nType, setNType] = useState('text')
  const used = new Set(usedKeys)

  const customFields = useMemo(() => {
    const list = (data?.fields ?? []).filter((f) => f.active && f.showInForm !== false)
    return list
  }, [data])

  function pickPreset(p: FieldPreset) {
    onPick({
      type: p.type,
      key: p.key ?? normalizeKey(p.label),
      label: p.label,
      required: !!p.mapTo, // comuns mapeados nascem obrigatórios
      ...(p.placeholder ? { placeholder: p.placeholder } : {}),
      ...(p.mapTo ? { mapTo: p.mapTo } : {}),
      ...(p.type === 'select' ? { options: [] } : {}),
    })
  }

  function pickCustomField(cf: CustomField) {
    const opts = Array.isArray(cf.options) ? (cf.options as FormFieldOption[]) : undefined
    onPick({
      type: cfTypeToFieldType(cf.type),
      key: cf.key,
      label: cf.label,
      required: !!cf.required,
      mapTo: `cf_${cf.key}`,
      ...(cf.placeholder ? { placeholder: cf.placeholder } : {}),
      ...(opts ? { options: opts } : {}),
    })
  }

  function createAndPick() {
    if (!nLabel.trim()) { toast('Dê um nome ao campo', 'danger'); return }
    createCf.mutate(
      { key: normalizeKey(nLabel), label: nLabel.trim(), type: nType, showInForm: true, group: 'custom' },
      {
        onSuccess: ({ field }) => { toast('Campo personalizado criado', 'success'); pickCustomField(field) },
        onError: (e: unknown) => toast((e as Error).message, 'danger'),
      },
    )
  }

  return (
    <Modal open onOpenChange={(o) => { if (!o) onClose() }} title="Adicionar campo" size="lg"
      description="Use um campo comum, um campo personalizado do catálogo, ou crie um novo.">
      <nav class="flex items-center gap-1 border-b border-border mb-3">
        <PaletteTab active={tab === 'common'} onClick={() => setTab('common')}>Comuns</PaletteTab>
        <PaletteTab active={tab === 'custom'} onClick={() => setTab('custom')}>Personalizados</PaletteTab>
        <PaletteTab active={tab === 'new'} onClick={() => setTab('new')}><Sparkles size={12} class="inline mr-1" />Criar novo</PaletteTab>
      </nav>

      {tab === 'common' && (
        <div class="space-y-3">
          <div>
            <div class="text-[0.6875rem] font-semibold uppercase tracking-wider text-fg-subtle mb-1.5">Dados do lead (mapeados)</div>
            <div class="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {FIELD_PRESETS.map((p) => (
                <PresetButton key={p.label} preset={p} disabled={!!p.key && used.has(p.key)} onClick={() => pickPreset(p)} />
              ))}
            </div>
          </div>
          <div>
            <div class="text-[0.6875rem] font-semibold uppercase tracking-wider text-fg-subtle mb-1.5">Campos genéricos</div>
            <div class="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {GENERIC_PRESETS.map((p) => (
                <PresetButton key={p.label} preset={p} onClick={() => pickPreset(p)} />
              ))}
            </div>
          </div>
          <div>
            <div class="text-[0.6875rem] font-semibold uppercase tracking-wider text-fg-subtle mb-1.5">Conteúdo (sem coletar dado)</div>
            <div class="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {CONTENT_PRESETS.map((p) => (
                <PresetButton key={p.label} preset={p} onClick={() => pickPreset(p)} />
              ))}
            </div>
          </div>
        </div>
      )}

      {tab === 'custom' && (
        <div class="space-y-2">
          {isLoading && <Skeleton class="h-24 w-full" />}
          {!isLoading && customFields.length === 0 && (
            <p class="text-sm text-fg-muted text-center py-4">Nenhum campo personalizado disponível. Crie um na aba "Criar novo".</p>
          )}
          <div class="grid gap-2 sm:grid-cols-2">
            {customFields.map((cf) => {
              const already = used.has(cf.key)
              return (
                <button key={cf.id} type="button" disabled={already} onClick={() => pickCustomField(cf)}
                  class={`text-left rounded-md border p-2.5 transition-colors ${already ? 'border-border bg-surface-2 opacity-50 cursor-not-allowed' : 'border-border bg-surface hover:bg-surface-2'}`}>
                  <div class="flex items-center gap-2">
                    <span class="flex-1 truncate text-sm font-medium text-fg">{cf.label}</span>
                    <Badge tone="info">{cf.type}</Badge>
                  </div>
                  <div class="mt-0.5 truncate text-[0.6875rem] text-fg-subtle"><code>cf_{cf.key}</code>{already ? ' · já adicionado' : ''}</div>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {tab === 'new' && (
        <div class="space-y-3">
          <p class="text-[0.6875rem] text-fg-subtle">O campo é salvo no catálogo global e fica disponível em todo o sistema (leads, kanban, outros formulários).</p>
          <div class="grid gap-3 sm:grid-cols-2">
            <Input label="Nome do campo" value={nLabel} onInput={(e) => setNLabel((e.target as HTMLInputElement).value)} placeholder="Ex.: Cargo, CNPJ, Faturamento" />
            <Select label="Tipo" value={nType} onChange={(e) => setNType((e.target as HTMLSelectElement).value)}>
              <option value="text">Texto curto</option>
              <option value="textarea">Texto longo</option>
              <option value="number">Número</option>
              <option value="email">E-mail</option>
              <option value="phone">Telefone</option>
              <option value="url">URL</option>
              <option value="date">Data</option>
              <option value="select">Seleção</option>
              <option value="currency">Moeda</option>
            </Select>
          </div>
          <div class="flex justify-end">
            <Button size="sm" onClick={createAndPick} disabled={createCf.isPending}>
              <Plus size={14} /> {createCf.isPending ? 'Criando…' : 'Criar e adicionar'}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  )
}

function PaletteTab({ active, onClick, children }: { active: boolean; onClick: () => void; children: any }) {
  return (
    <button type="button" onClick={onClick}
      class={`h-8 px-3 -mb-px text-sm font-medium border-b-2 transition-colors ${active ? 'border-accent text-fg' : 'border-transparent text-fg-muted hover:text-fg'}`}>
      {children}
    </button>
  )
}

function PresetButton({ preset, onClick, disabled }: { preset: FieldPreset; onClick: () => void; disabled?: boolean }) {
  const Icon = preset.icon
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      class={`flex items-center gap-2 rounded-md border p-2.5 text-left transition-colors ${disabled ? 'border-border bg-surface-2 opacity-50 cursor-not-allowed' : 'border-border bg-surface hover:bg-accent/5 hover:border-accent'}`}>
      <Icon size={16} class="shrink-0 text-fg-muted" />
      <span class="truncate text-sm text-fg">{preset.label}{disabled ? ' ✓' : ''}</span>
    </button>
  )
}

interface FieldsListColumnProps {
  fields: FormField[]
  activeId: string | null
  onSelect: (id: string) => void
  onAdd: () => void
  onReorder: (next: FormField[]) => void
}

function FieldsListColumn({ fields, activeId, onSelect, onAdd, onReorder }: FieldsListColumnProps) {
  return (
    <aside class="flex flex-col gap-2">
      <div class="flex items-center justify-between">
        <h4 class="text-xs font-semibold uppercase tracking-wider text-fg-muted">
          Campos ({fields.length})
        </h4>
        <Button variant="ghost" size="sm" onClick={onAdd}>
          <Plus size={12} /> Adicionar
        </Button>
      </div>
      {fields.length === 0 ? (
        <p class="text-xs text-fg-subtle">Nenhum campo. Clique em "Adicionar" para começar.</p>
      ) : (
        <SortableList
          items={fields}
          onReorder={onReorder}
          renderItem={(f) => (
            <button
              type="button"
              onClick={() => onSelect(f.id)}
              class={`group w-full rounded-md border px-2.5 py-1.5 text-left transition-colors ${
                activeId === f.id
                  ? 'border-accent bg-accent/10'
                  : 'border-border bg-surface hover:bg-surface-3'
              }`}
            >
              <div class="flex items-center gap-2">
                <span class="flex-1 truncate text-sm text-fg">{stripHtml(f.label) || (f.type === 'statement' ? '(bloco de conteúdo)' : '(sem rótulo)')}</span>
                {f.required && <Badge tone="info">obrig.</Badge>}
                {f.type === 'hidden' && <EyeOff size={12} class="text-fg-subtle" />}
              </div>
              <div class="mt-0.5 truncate text-[0.6875rem] text-fg-subtle">
                <code>{f.key || '—'}</code> · {labelForType(f.type)}
              </div>
            </button>
          )}
        />
      )}
    </aside>
  )
}

interface FieldEditorColumnProps {
  field: FormField | null
  onPatch: (partial: Partial<FormField>) => void
  onRemove: () => void
  funnels?: { id: number; name: string }[] | undefined
}

// Campos nativos do lead que o select "Mapear para" oferece.
const NATIVE_MAP_KEYS = new Set(['nome', 'email', 'whatsapp', 'empresa', 'cidade', 'segmento'])

export function FieldEditorColumn({ field, onPatch, onRemove, funnels = [] }: FieldEditorColumnProps) {
  const mtItems = useMeetingTypes().data?.items?.filter((m) => m.active) ?? []
  const cfList = useCustomFields().data?.fields ?? []
  const createCf = useCreateCustomField()
  if (!field) {
    return (
      <div class="grid h-full place-items-center rounded-md border border-dashed border-border p-8 text-center">
        <p class="text-sm text-fg-muted">Selecione um campo na lista para editar.</p>
      </div>
    )
  }

  const isSelect = field.type === 'select'
  const isHidden = field.type === 'hidden'
  const isStatement = field.type === 'statement'
  const isScheduling = field.type === 'scheduling'
  const isInput = !isHidden && !isStatement && !isScheduling

  // Vínculo com o CRM: o dado só chega na ficha do lead quando o campo está
  // mapeado para um campo nativo, ou para um campo personalizado (mapTo "cf_x",
  // ou a própria chave casa com um CustomField ativo). Sem isso, a resposta fica
  // só no histórico do formulário (formData) — é o "dado perdido" que evitamos.
  const cfKeys = new Set(cfList.filter((c) => c.active).map((c) => c.key))
  const mt = field.mapTo
  const linkedCustomKey = (mt && mt.startsWith('cf_')) ? mt.slice(3) : ((!mt && cfKeys.has(field.key)) ? field.key : null)
  const linkedCustom = linkedCustomKey ? cfList.find((c) => c.key === linkedCustomKey) ?? null : null
  const mappedToCrm = isInput && (
    (!!mt && NATIVE_MAP_KEYS.has(mt)) ||
    (!!mt && cfKeys.has(mt)) ||
    !!linkedCustom
  )
  // Pode virar campo personalizado: é input que coleta dado, tem chave/rótulo e
  // ainda não está vinculado a lugar nenhum do CRM.
  const canPersistViaCustom = isInput && !mappedToCrm && !!field.key && !!stripHtml(field.label).trim()

  function createAsCustomField() {
    if (!field) return
    const opts = isSelect && Array.isArray(field.options) && field.options.length ? field.options : undefined
    createCf.mutate(
      {
        key: field.key,
        label: stripHtml(field.label).trim() || field.key,
        type: field.type,
        showInForm: true,
        showInList: true,
        group: 'custom',
        ...(opts ? { options: opts } : {}),
      },
      {
        onSuccess: ({ field: cf }) => { onPatch({ mapTo: `cf_${cf.key}` }); toast('Campo personalizado criado e vinculado ao CRM', 'success') },
        onError: (e: unknown) => toast((e as Error).message || 'Falha ao criar campo personalizado', 'danger'),
      },
    )
  }

  return (
    <div class="space-y-3 rounded-md border border-border bg-surface p-4">
      <div class="flex items-start justify-between gap-2">
        <h4 class="text-sm font-semibold text-fg">{isStatement ? 'Editar bloco de conteúdo' : 'Editar campo'}</h4>
        <Button variant="ghost" size="sm" onClick={onRemove}>
          <Trash2 size={12} /> Remover
        </Button>
      </div>

      <div class="grid gap-3 sm:grid-cols-2">
        {isStatement ? (
          <div class="sm:col-span-2">
            <RichText
              label="Headline / Título"
              value={field.label}
              onChange={(html) => onPatch({ label: html })}
              placeholder="Ex.: Bem-vindo! (use B / I para formatar)"
            />
          </div>
        ) : (
          <Input
            label="Rótulo"
            value={field.label}
            onInput={(e) => {
              const label = (e.target as HTMLInputElement).value
              const next: Partial<FormField> = { label }
              if (!field.key) next.key = normalizeKey(label) || 'bloco'
              onPatch(next)
            }}
          />
        )}
        <Select
          label="Tipo"
          value={field.type}
          onChange={(e) => {
            const next = (e.target as HTMLSelectElement).value as FormFieldType
            const patch: Partial<FormField> = { type: next }
            if (next === 'select' && !field.options) patch.options = []
            if (next === 'statement') { patch.required = false; patch.mapTo = undefined; if (!field.key) patch.key = 'bloco' }
            if (next === 'scheduling') { patch.required = false; patch.mapTo = undefined; if (!field.key) patch.key = 'agendamento' }
            onPatch(patch)
          }}
        >
          {FIELD_TYPES.map((t) => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </Select>
        {isInput && (
          <Select
            label="Mapear para"
            hint="Preenche o campo correspondente do lead."
            value={field.mapTo ?? ''}
            onChange={(e) => onPatch({ mapTo: ((e.target as HTMLSelectElement).value || undefined) })}
          >
            {MAP_TO_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </Select>
        )}
        {isInput && (
          <Input
            label="Chave (slug)"
            hint="Identificador interno enviado ao backend."
            value={field.key}
            onInput={(e) => onPatch({ key: normalizeKey((e.target as HTMLInputElement).value) })}
            placeholder="ex.: nome, email"
          />
        )}
      </div>

      {/* ── Vínculo com o CRM: garante que o dado digitado pelo lead não se perca ── */}
      {canPersistViaCustom && (
        <div class="space-y-2 rounded-md border border-warning/40 bg-warning/10 p-3">
          <div class="flex items-start gap-2">
            <AlertTriangle size={14} class="mt-0.5 shrink-0 text-warning" />
            <p class="text-[0.6875rem] leading-relaxed text-fg-muted">
              Este campo <strong>não está vinculado ao CRM</strong>. As respostas ficam só no histórico do formulário e <strong>não aparecem na ficha do lead</strong>. Crie um campo personalizado para nunca perder esse dado.
            </p>
          </div>
          <Button size="sm" variant="secondary" onClick={createAsCustomField} disabled={createCf.isPending}>
            <Sparkles size={12} /> {createCf.isPending ? 'Criando…' : 'Criar campo personalizado e salvar'}
          </Button>
        </div>
      )}
      {isInput && linkedCustom && (
        <div class="flex items-center gap-2 rounded-md border border-success/40 bg-success/10 p-2.5">
          <CheckCircle2 size={14} class="shrink-0 text-success" />
          <p class="text-[0.6875rem] text-fg-muted">
            Vinculado ao campo personalizado <strong>{linkedCustom.label}</strong> — as respostas vão para a ficha do lead. <code class="text-fg-subtle">cf_{linkedCustom.key}</code>
          </p>
        </div>
      )}

      {/* ── Campo de agendamento ── */}
      {isScheduling && (
        <div class="space-y-2 rounded-md border border-border bg-surface-2 p-3">
          <Select
            label="Tipo de reunião"
            hint="O lead escolhe data/hora deste tipo. Dados já preenchidos (nome/e-mail/telefone) não são pedidos de novo."
            value={field.meetingSlug ?? ''}
            onChange={(e) => onPatch({ meetingSlug: (e.target as HTMLSelectElement).value || undefined })}
          >
            <option value="">— selecione —</option>
            {mtItems.map((m) => <option key={m.id} value={m.slug}>{m.name}</option>)}
          </Select>
          {mtItems.length === 0 && <p class="text-[0.6875rem] text-fg-subtle">Nenhum tipo de reunião ativo. <a href="/app/scheduling" target="_blank" rel="noreferrer" class="text-accent hover:underline">Criar um →</a></p>}
          <p class="text-[0.6875rem] text-fg-subtle">A etapa de destino ao concluir o agendamento e o disparo de conversão são configurados na aba <strong>Agendamento</strong>.</p>
        </div>
      )}

      {/* ── Bloco de conteúdo (statement) ── */}
      {isStatement && (
        <div class="space-y-3">
          <div>
            <span class="text-xs font-medium text-fg-muted">Alinhamento</span>
            <div class="mt-1 inline-flex rounded-md border border-border overflow-hidden">
              {([['left', AlignLeft], ['center', AlignCenter], ['right', AlignRight]] as const).map(([a, Ico]) => (
                <button key={a} type="button" title={a}
                  onClick={() => onPatch({ align: a })}
                  class={`size-8 grid place-items-center ${(field.align ?? 'center') === a ? 'bg-accent text-white' : 'bg-surface text-fg-muted hover:bg-surface-2'}`}>
                  <Ico size={14} />
                </button>
              ))}
            </div>
          </div>
          <RichText
            label="Texto / Copy"
            value={field.helpText ?? ''}
            onChange={(html) => onPatch({ helpText: html })}
            placeholder="Descrição, instrução ou mensagem (formatável)."
            minHeight="4rem"
          />
          <div class="grid gap-3 sm:grid-cols-2">
            <Input
              label="Ícone (emoji)"
              value={field.icon ?? ''}
              onInput={(e) => onPatch({ icon: (e.target as HTMLInputElement).value })}
              placeholder="👋 🚀 ✅"
              hint="Cole um emoji para destacar o bloco."
            />
            <Input
              label="Imagem (URL)"
              value={field.imageUrl ?? ''}
              onInput={(e) => onPatch({ imageUrl: (e.target as HTMLInputElement).value })}
              placeholder="https://…/imagem.png"
            />
          </div>
          <Textarea
            label="HTML livre (opcional)"
            rows={3}
            value={field.html ?? ''}
            onInput={(e) => onPatch({ html: (e.target as HTMLTextAreaElement).value })}
            placeholder="<p>Conteúdo personalizado…</p>"
            hint="Renderizado no bloco. Use para formatação rica, vídeos embed, etc."
          />
        </div>
      )}

      {isInput && (
        <Input
          label="Placeholder (opcional)"
          value={field.placeholder ?? ''}
          onInput={(e) => onPatch({ placeholder: (e.target as HTMLInputElement).value })}
        />
      )}

      {isInput && (
        <Input
          label="Texto de ajuda (opcional)"
          value={field.helpText ?? ''}
          onInput={(e) => onPatch({ helpText: (e.target as HTMLInputElement).value })}
          hint="Subtítulo abaixo da pergunta — usado sobretudo no modo conversacional."
        />
      )}

      {isHidden && (
        <Input
          label="Valor padrão"
          value={field.defaultValue ?? ''}
          onInput={(e) => onPatch({ defaultValue: (e.target as HTMLInputElement).value })}
        />
      )}

      {isInput && (
        <label class="flex items-center gap-2 text-sm text-fg">
          <input
            type="checkbox"
            checked={field.required}
            onInput={(e) => onPatch({ required: (e.target as HTMLInputElement).checked })}
          />
          Obrigatório
        </label>
      )}

      {isSelect && (
        <SelectOptionsEditor
          options={field.options ?? []}
          onChange={(options) => onPatch({ options })}
        />
      )}

      {/* ── Pergunta de qualificação (só seleção) ── */}
      {isSelect && (
        <div class="rounded-md border border-border bg-surface-2 p-3 space-y-2">
          <label class="flex items-start gap-2 cursor-pointer">
            <input type="checkbox" class="size-4 mt-0.5 accent-accent shrink-0"
              checked={!!field.isQualifier}
              onInput={(e) => onPatch({ isQualifier: (e.target as HTMLInputElement).checked })} />
            <span>
              <span class="block text-sm font-medium text-fg">Usar como pergunta de qualificação</span>
              <span class="block text-[0.6875rem] text-fg-subtle mt-0.5">Marque as respostas "positivas"; ao responder, o lead vai pra etapa positiva ou negativa (definidas em Destino &amp; Conversão).</span>
            </span>
          </label>
          {field.isQualifier && (
            <div class="space-y-3 pt-1">
              <div class="space-y-1">
                <span class="text-[0.6875rem] font-medium text-fg-muted">Respostas positivas</span>
                {(field.options ?? []).length === 0 && <p class="text-[0.6875rem] text-fg-subtle">Adicione opções acima primeiro.</p>}
                {(field.options ?? []).map((o, i) => {
                  const pos = field.positiveValues ?? []
                  const checked = pos.includes(o.value)
                  return (
                    <label key={i} class="flex items-center gap-2 text-sm cursor-pointer">
                      <input type="checkbox" class="size-4 accent-accent" checked={checked}
                        onInput={(e) => {
                          const on = (e.target as HTMLInputElement).checked
                          const next = on ? [...pos.filter((v) => v !== o.value), o.value] : pos.filter((v) => v !== o.value)
                          onPatch({ positiveValues: next })
                        }} />
                      {o.label || o.value || '(sem rótulo)'} {checked && <span class="text-[0.625rem] text-success">positiva</span>}
                    </label>
                  )
                })}
              </div>

              <QualifyOutcomeEditor title="Se POSITIVO" tone="positive" funnels={funnels}
                value={field.qualifyPositive ?? {}} onChange={(o) => onPatch({ qualifyPositive: o })} />
              <QualifyOutcomeEditor title="Se NEGATIVO" tone="negative" funnels={funnels}
                value={field.qualifyNegative ?? {}} onChange={(o) => onPatch({ qualifyNegative: o })} />
              <p class="text-[0.625rem] text-fg-subtle">Com várias perguntas de qualificação, vale a regra <strong>"negativo vence"</strong>: a primeira resposta negativa decide funil e finalização.</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// Editor de um resultado de qualificação (positivo ou negativo): funil + etapa de
// destino e o que fazer ao atingir (continuar o form ou finalizar com msg/URL).
function QualifyOutcomeEditor({ title, tone, funnels, value, onChange }: {
  title: string
  tone: 'positive' | 'negative'
  funnels: { id: number; name: string }[]
  value: QualifyOutcome
  onChange: (o: QualifyOutcome) => void
}) {
  const funnelId = value.funnelId ?? null
  const { data: stagesData } = useStages(funnelId)
  const stages = (stagesData?.stages ?? []).filter((s) => s.active)
  const set = (partial: Partial<QualifyOutcome>) => onChange({ ...value, ...partial })
  const finish = !!value.finish
  const action = value.finishAction === 'redirect' ? 'redirect' : 'message'
  const accent = tone === 'positive' ? 'border-success/40' : 'border-danger/40'
  return (
    <div class={`rounded-md border ${accent} bg-surface p-3 space-y-2`}>
      <span class="text-[0.6875rem] font-semibold uppercase tracking-wider text-fg-muted">{title}</span>
      <div class="grid gap-2 sm:grid-cols-2">
        <Select label="Funil de destino" value={funnelId == null ? '' : String(funnelId)}
          onChange={(e) => { const v = (e.target as HTMLSelectElement).value; set({ funnelId: v ? Number(v) : null, stageKey: null }) }}>
          <option value="">Funil do formulário</option>
          {funnels.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
        </Select>
        <Select label="Etapa" value={value.stageKey ?? ''} disabled={!funnelId}
          onChange={(e) => set({ stageKey: (e.target as HTMLSelectElement).value || null })}>
          <option value="">{funnelId ? '— manter etapa —' : 'Escolha um funil'}</option>
          {stages.map((s) => <option key={s.id} value={s.key}>{s.name}</option>)}
        </Select>
      </div>
      <div class="inline-flex rounded-md border border-border overflow-hidden text-xs">
        <button type="button" class={`h-7 px-2.5 ${!finish ? 'bg-accent text-fg-on-brand' : 'bg-surface text-fg-muted hover:text-fg'}`} onClick={() => set({ finish: false })}>Continuar o formulário</button>
        <button type="button" class={`h-7 px-2.5 ${finish ? 'bg-accent text-fg-on-brand' : 'bg-surface text-fg-muted hover:text-fg'}`} onClick={() => set({ finish: true })}>Finalizar aqui</button>
      </div>
      {finish && (
        <div class="space-y-2">
          <div class="inline-flex rounded-md border border-border overflow-hidden text-xs">
            <button type="button" class={`h-7 px-2.5 ${action === 'message' ? 'bg-accent text-fg-on-brand' : 'bg-surface text-fg-muted hover:text-fg'}`} onClick={() => set({ finishAction: 'message' })}>Mostrar mensagem</button>
            <button type="button" class={`h-7 px-2.5 ${action === 'redirect' ? 'bg-accent text-fg-on-brand' : 'bg-surface text-fg-muted hover:text-fg'}`} onClick={() => set({ finishAction: 'redirect' })}>Redirecionar</button>
          </div>
          {action === 'redirect' ? (
            <Input label="URL de redirecionamento" value={value.redirectUrl ?? ''}
              onInput={(e) => set({ redirectUrl: (e.target as HTMLInputElement).value })}
              placeholder="/obrigado ou https://site.com/obrigado"
              hint="Tokens {{nome}}/{{email}}/{{whatsapp}} são interpolados." />
          ) : (
            <RichText label="Mensagem de finalização (vazio = mensagem padrão do form)" value={value.message ?? ''}
              onChange={(html) => set({ message: html })} minHeight="4rem" />
          )}
        </div>
      )}
    </div>
  )
}

interface SelectOptionsEditorProps {
  options: FormFieldOption[]
  onChange: (options: FormFieldOption[]) => void
}

function SelectOptionsEditor({ options, onChange }: SelectOptionsEditorProps) {
  function patch(idx: number, patchOpt: Partial<FormFieldOption>) {
    const next = options.map((o, i) => (i === idx ? { ...o, ...patchOpt } : o))
    onChange(next)
  }
  function remove(idx: number) {
    onChange(options.filter((_, i) => i !== idx))
  }
  function add() {
    onChange([...options, { value: '', label: '' }])
  }

  return (
    <div class="space-y-2 rounded-md border border-border bg-surface-2 p-3">
      <div class="flex items-center justify-between">
        <span class="text-xs font-medium text-fg-muted">Opções da seleção</span>
        <Button variant="ghost" size="sm" onClick={add}>
          <Plus size={12} /> Adicionar opção
        </Button>
      </div>
      {options.length === 0 && (
        <p class="text-xs text-fg-subtle">Nenhuma opção. Adicione ao menos uma.</p>
      )}
      <div class="space-y-2">
        {options.length > 0 && (
          <div class="grid grid-cols-[1fr_1fr_2rem] gap-2 text-[0.6875rem] text-fg-subtle">
            <span>Rótulo</span>
            <span>Valor</span>
            <span class="sr-only">Ações</span>
          </div>
        )}
        {options.map((o, i) => (
          <div key={i} class="grid grid-cols-[1fr_1fr_2rem] items-center gap-2">
            <Input
              value={o.label}
              onInput={(e) => patch(i, { label: (e.target as HTMLInputElement).value })}
              placeholder="Ex.: Pequena empresa"
            />
            <Input
              value={o.value}
              onInput={(e) => patch(i, { value: (e.target as HTMLInputElement).value })}
              placeholder="Ex.: pequena"
            />
            <Button variant="ghost" size="sm" onClick={() => remove(i)} aria-label="Remover opção">
              <Trash2 size={12} />
            </Button>
          </div>
        ))}
      </div>
    </div>
  )
}

function labelForType(type: FormFieldType): string {
  return FIELD_TYPES.find((t) => t.value === type)?.label ?? type
}

function validate(fields: FormField[]): string[] {
  const errs: string[] = []
  const keys = new Set<string>()
  for (const f of fields) {
    // Conteúdo/agendamento não coletam dado de texto: não exigem rótulo.
    if (f.type !== 'statement' && f.type !== 'scheduling' && !f.label.trim()) errs.push(`Campo sem rótulo`)
    if (!f.key.trim()) errs.push(`Campo "${f.label || 'bloco'}" sem chave`)
    if (keys.has(f.key)) errs.push(`Chave duplicada: ${f.key}`)
    keys.add(f.key)
    if (f.type === 'select' && (!f.options || f.options.length === 0)) {
      errs.push(`Seleção "${f.label}" precisa ter ao menos uma opção`)
    }
    if (f.type === 'scheduling' && !f.meetingSlug) {
      errs.push(`Campo de agendamento sem tipo de reunião selecionado`)
    }
  }
  return errs
}
