import { useState, useMemo } from 'preact/hooks'
import {
  Database, Plus, Pencil, Trash2, Copy, Check, Eye, KanbanSquare, FormInput,
  Info, AlertTriangle,
} from '@/components/ui/icon-set'
import {
  useCustomFields,
  useCreateCustomField,
  useUpdateCustomField,
  useDeleteCustomField,
  useReorderCustomFields,
  type CustomField,
  type CustomFieldInput,
} from '@/hooks/useCustomFields'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Skeleton } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { Badge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'
import { Input, Select, Textarea } from '@/components/ui/Input'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { SortableList } from '@/components/ui/SortableList'
import { toast } from '@/lib/toast'

interface TypeMeta {
  id: string
  label: string
  hasOptions?: boolean
  /** Aliases legado/app para tolerar dados antigos. */
  aliases?: readonly string[]
}

// Source-of-truth: valores do legado/backend default (textarea/checkbox/etc).
// Aliases pegam o que o app novo escrevia (longtext/boolean) para não perder registros.
const TYPE_OPTIONS: TypeMeta[] = [
  { id: 'text',        label: 'Texto curto' },
  { id: 'textarea',    label: 'Texto longo', aliases: ['longtext'] },
  { id: 'number',      label: 'Número' },
  { id: 'currency',    label: 'Moeda (R$)' },
  { id: 'email',       label: 'E-mail' },
  { id: 'phone',       label: 'Telefone' },
  { id: 'url',         label: 'URL' },
  { id: 'date',        label: 'Data' },
  { id: 'datetime',    label: 'Data e hora' },
  { id: 'checkbox',    label: 'Sim/Não (checkbox)', aliases: ['boolean'] },
  { id: 'select',      label: 'Lista (escolha única)', hasOptions: true },
  { id: 'multiselect', label: 'Lista (múltipla escolha)', hasOptions: true },
]

interface GroupMeta {
  id: string
  label: string
  aliases?: readonly string[]
}

const GROUP_OPTIONS: GroupMeta[] = [
  { id: 'contato',     label: 'Contato',           aliases: ['contact'] },
  { id: 'empresa',     label: 'Empresa',           aliases: ['company'] },
  { id: 'financeiro',  label: 'Financeiro',        aliases: ['sales'] },
  { id: 'custom',      label: 'Outros',            aliases: ['general'] },
]

function canonicalType(t: string): string {
  const direct = TYPE_OPTIONS.find((o) => o.id === t)
  if (direct) return direct.id
  const alias = TYPE_OPTIONS.find((o) => o.aliases?.includes(t))
  return alias?.id ?? t
}

function canonicalGroup(g: string): string {
  const direct = GROUP_OPTIONS.find((o) => o.id === g)
  if (direct) return direct.id
  const alias = GROUP_OPTIONS.find((o) => o.aliases?.includes(g))
  return alias?.id ?? 'custom'
}

function groupLabel(id: string): string {
  return GROUP_OPTIONS.find((g) => g.id === canonicalGroup(id))?.label ?? id
}

function typeLabel(id: string): string {
  return TYPE_OPTIONS.find((t) => t.id === canonicalType(id))?.label ?? id
}

function typeHasOptions(id: string): boolean {
  return !!TYPE_OPTIONS.find((t) => t.id === canonicalType(id))?.hasOptions
}

interface OptionItem {
  value: string
  label: string
}

function parseOptions(raw: unknown): OptionItem[] {
  if (!Array.isArray(raw)) return []
  const out: OptionItem[] = []
  for (const item of raw) {
    if (typeof item === 'string') out.push({ value: item, label: item })
    else if (item && typeof item === 'object') {
      const obj = item as { value?: unknown; label?: unknown }
      const v = typeof obj.value === 'string' ? obj.value : ''
      const l = typeof obj.label === 'string' ? obj.label : v
      if (v !== '') out.push({ value: v, label: l })
    }
  }
  return out
}

function parseOptionLine(line: string): OptionItem | null {
  const trimmed = line.trim()
  if (trimmed === '') return null
  const pipe = trimmed.indexOf('|')
  if (pipe > 0) {
    const value = trimmed.slice(0, pipe).trim()
    const label = trimmed.slice(pipe + 1).trim()
    if (value === '') return null
    return { value, label: label !== '' ? label : value }
  }
  return { value: trimmed, label: trimmed }
}

export function CustomFieldsSettings() {
  const { data, isLoading } = useCustomFields(true)
  const [editing, setEditing] = useState<CustomField | null>(null)
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState<CustomField | null>(null)
  const [groupFilter, setGroupFilter] = useState<string>('all')

  const grouped = useMemo(() => {
    const out: Record<string, CustomField[]> = {}
    const fields = data?.fields ?? []
    for (const f of fields) {
      const k = canonicalGroup(f.group || 'custom')
      out[k] ??= []
      out[k].push(f)
    }
    return out
  }, [data])

  const visibleGroups = groupFilter === 'all'
    ? GROUP_OPTIONS.filter((g) => grouped[g.id]?.length)
    : GROUP_OPTIONS.filter((g) => g.id === groupFilter && grouped[g.id]?.length)

  return (
    <div class="space-y-3">
      <div class="flex items-center justify-between gap-2">
        <Select
          value={groupFilter}
          onChange={(e) => setGroupFilter((e.target as HTMLSelectElement).value)}
          class="max-w-xs"
        >
          <option value="all">Todos os grupos</option>
          {GROUP_OPTIONS.map((g) => (
            <option key={g.id} value={g.id}>{g.label}</option>
          ))}
        </Select>
        <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
          <Plus size={14} /> Novo campo
        </Button>
      </div>

      <div class="flex items-start gap-2 rounded-md border border-info/30 bg-info/10 p-3 text-xs text-fg-muted">
        <Info size={16} class="mt-0.5 shrink-0 text-info" />
        <div class="flex-1 leading-relaxed">
          <strong class="text-fg">Código de Integração (API Key)</strong> — cada campo tem um código
          único usado em <strong class="text-fg">API</strong>, <strong class="text-fg">webhooks</strong>,{' '}
          <strong class="text-fg">Meta Ads</strong> e mapeamento de formulários. Exemplo:{' '}
          <code class="rounded bg-surface-2 px-1 py-0.5 text-2xs font-mono">PUT /api/leads/{`{id}`}/custom-fields</code>{' '}
          com body{' '}
          <code class="rounded bg-surface-2 px-1 py-0.5 text-2xs font-mono">{'{ "codigo_do_campo": "valor" }'}</code>.
        </div>
      </div>

      {isLoading && <Skeleton class="h-32 w-full" />}

      {!isLoading && (data?.fields ?? []).length === 0 && (
        <EmptyState
          icon={<Database size={24} />}
          title="Nenhum campo personalizado"
          description="Campos personalizados permitem adicionar dados extras aos leads: CNPJ, cargo, valor do contrato, origem detalhada, etc."
          action={
            <Button size="sm" variant="primary" onClick={() => setCreating(true)}>
              <Plus size={14} /> Criar primeiro campo
            </Button>
          }
        />
      )}

      {!isLoading && visibleGroups.map((g) => (
        <Card key={g.id}>
          <div class="flex items-center justify-between mb-2">
            <div class="text-xs font-semibold uppercase tracking-wider text-fg-muted">{g.label}</div>
            <div class="text-2xs text-fg-muted">{(grouped[g.id] ?? []).length} campo(s)</div>
          </div>
          <CustomFieldsSortable
            fields={grouped[g.id] ?? []}
            onEdit={setEditing}
            onDelete={setDeleting}
          />
        </Card>
      ))}

      {(creating || editing) && (
        <CustomFieldFormModal
          field={editing}
          onClose={() => { setCreating(false); setEditing(null) }}
        />
      )}
      {deleting && <DeleteCustomFieldDialog field={deleting} onClose={() => setDeleting(null)} />}
    </div>
  )
}

function CustomFieldsSortable({
  fields, onEdit, onDelete,
}: { fields: CustomField[]; onEdit: (f: CustomField) => void; onDelete: (f: CustomField) => void }) {
  const reorder = useReorderCustomFields()
  function handleReorder(next: CustomField[]) {
    reorder.mutate(next.map((f, position) => ({ id: f.id, position })), {
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }
  return (
    <SortableList
      items={fields}
      onReorder={handleReorder}
      renderItem={(f) => (
        <div class="flex items-start gap-3 rounded-md border border-border p-3 group bg-surface">
          <div class="min-w-0 flex-1 space-y-1">
            <div class="flex items-center gap-2 flex-wrap">
              <span class="text-sm text-fg font-medium">{f.label}</span>
              {f.required && <Badge tone="warning" solid>obrigatório</Badge>}
              <Badge tone={f.active ? 'accent' : 'neutral'}>{f.active ? 'Ativo' : 'Inativo'}</Badge>
            </div>
            {f.description && (
              <div class="text-2xs text-fg-muted">{f.description}</div>
            )}
            <div class="flex items-center gap-2 flex-wrap text-xs text-fg-muted">
              <KeyChip value={f.key} />
              <span>·</span>
              <span>{typeLabel(f.type)}</span>
            </div>
          </div>
          <div class="flex items-center gap-1.5 text-fg-muted pt-1">
            {f.showInList !== false && <span title="Visível na listagem"><Eye size={12} /></span>}
            {f.showInKanban && <span title="Visível no Kanban"><KanbanSquare size={12} /></span>}
            {f.showInForm !== false && <span title="Visível em formulários públicos"><FormInput size={12} /></span>}
          </div>
          <div class="flex gap-1.5 shrink-0 flex-wrap">
            <Button variant="secondary" size="sm" onClick={() => onEdit(f)} aria-label="Editar campo" title="Editar">
              <Pencil size={12} /> Editar
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => onDelete(f)}
              aria-label="Excluir campo"
              title="Excluir"
              class="!text-danger border-danger/30 hover:bg-danger/10"
            >
              <Trash2 size={12} /> Excluir
            </Button>
          </div>
        </div>
      )}
    />
  )
}

function KeyChip({ value }: { value: string }) {
  const [copied, setCopied] = useState(false)
  function copy(e: MouseEvent) {
    e.stopPropagation()
    if (!value) return
    void navigator.clipboard.writeText(value).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }
  return (
    <span class="inline-flex items-center gap-1 rounded bg-info/10 border border-info/30 pl-1.5 pr-0.5 py-0.5 text-info">
      <code class="font-mono text-2xs">{value}</code>
      <button
        type="button"
        onClick={copy}
        class="size-5 rounded grid place-items-center text-info hover:bg-info/20"
        aria-label="Copiar código"
        title={copied ? 'Copiado!' : 'Copiar'}
      >
        {copied ? <Check size={11} class="text-success" /> : <Copy size={11} />}
      </button>
    </span>
  )
}

function CustomFieldFormModal({ field, onClose }: { field: CustomField | null; onClose: () => void }) {
  const isEdit = !!field
  const initialOptions = parseOptions(field?.options)
  const initialType = canonicalType(field?.type ?? 'text')
  const initialGroup = canonicalGroup(field?.group ?? 'custom')
  const [form, setForm] = useState({
    key: field?.key ?? '',
    label: field?.label ?? '',
    type: initialType,
    group: initialGroup,
    required: field?.required ?? false,
    active: field?.active ?? true,
    description: field?.description ?? '',
    placeholder: field?.placeholder ?? '',
    defaultValue: field?.defaultValue ?? '',
    showInList: field?.showInList !== false,
    showInKanban: field?.showInKanban ?? false,
    showInForm: field?.showInForm !== false,
  })
  const [optionsText, setOptionsText] = useState(
    initialOptions.map((o) => (o.value === o.label ? o.value : `${o.value}|${o.label}`)).join('\n'),
  )
  const [keyTouched, setKeyTouched] = useState(isEdit)
  const [keyCopied, setKeyCopied] = useState(false)

  const create = useCreateCustomField()
  const update = useUpdateCustomField()
  const loading = create.isPending || update.isPending
  const showOptions = typeHasOptions(form.type)
  const showDefault = !showOptions && form.type !== 'checkbox'

  function patch<K extends keyof typeof form>(k: K, v: typeof form[K]) {
    setForm((f) => ({ ...f, [k]: v }))
  }

  function autoKeyFromLabel(label: string): string {
    return label.toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '')
      .slice(0, 100)
  }

  function copyKey() {
    if (!form.key) return
    void navigator.clipboard.writeText(form.key).then(() => {
      setKeyCopied(true)
      setTimeout(() => setKeyCopied(false), 1500)
    })
  }

  function handleSubmit() {
    if (!form.key.trim() || !form.label.trim()) { toast('Key e label obrigatórios', 'danger'); return }
    let parsedOptions: OptionItem[] = []
    if (showOptions) {
      parsedOptions = optionsText.split('\n').map(parseOptionLine).filter((o): o is OptionItem => o !== null)
      const seen = new Set<string>()
      for (const o of parsedOptions) {
        if (seen.has(o.value)) { toast(`Opção duplicada: ${o.value}`, 'danger'); return }
        seen.add(o.value)
      }
      if (parsedOptions.length === 0) { toast('Adicione pelo menos uma opção', 'danger'); return }
    }
    const trimmedDesc = form.description.trim()
    const trimmedPlaceholder = form.placeholder.trim()
    const trimmedDefault = form.defaultValue.trim()
    const payload: CustomFieldInput = {
      key: form.key.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_'),
      label: form.label.trim(),
      type: form.type,
      group: form.group,
      required: form.required,
      active: form.active,
      description: trimmedDesc !== '' ? trimmedDesc : null,
      placeholder: trimmedPlaceholder !== '' ? trimmedPlaceholder : null,
      defaultValue: showDefault && trimmedDefault !== '' ? trimmedDefault : null,
      options: showOptions ? parsedOptions : null,
      showInList: form.showInList,
      showInKanban: form.showInKanban,
      showInForm: form.showInForm,
    }
    if (isEdit) {
      update.mutate({ id: field.id, ...payload }, {
        onSuccess: () => { toast('Campo atualizado', 'success'); onClose() },
        onError: (e: unknown) => toast((e as Error).message, 'danger'),
      })
    } else {
      create.mutate(payload, {
        onSuccess: () => { toast('Campo criado', 'success'); onClose() },
        onError: (e: unknown) => toast((e as Error).message, 'danger'),
      })
    }
  }

  return (
    <Modal
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      title={isEdit ? `Editar "${field.label}"` : 'Novo campo personalizado'}
      size="md"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose} disabled={loading}>Cancelar</Button>
          <Button variant="primary" size="sm" onClick={handleSubmit} disabled={loading}>
            {loading ? 'Salvando…' : (isEdit ? 'Salvar' : 'Criar campo')}
          </Button>
        </>
      }
    >
      <div class="space-y-3">
        <div class="grid gap-3 grid-cols-1 sm:grid-cols-2">
          <div>
            <div class="text-xs font-medium text-fg-muted mb-1">
              Nome do campo <span class="text-danger" aria-label="obrigatório">*</span>
            </div>
            <input
              type="text"
              value={form.label}
              onInput={(e) => {
                const v = (e.target as HTMLInputElement).value
                patch('label', v)
                if (!isEdit && !keyTouched) patch('key', autoKeyFromLabel(v))
              }}
              placeholder="Ex: CNPJ, Cargo, Valor do contrato"
              class="w-full h-9 px-3 rounded-md bg-surface border border-border text-sm text-fg placeholder:text-fg-muted focus:outline-none focus:border-accent"
            />
          </div>
          <Select
            label="Tipo"
            value={form.type}
            onChange={(e) => patch('type', (e.target as HTMLSelectElement).value)}
          >
            {TYPE_OPTIONS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </Select>
        </div>

        {/* Card destacado: Código de Integração */}
        <div class={[
          'rounded-md border p-3',
          isEdit ? 'border-border bg-surface-2' : 'border-warning/40 bg-warning/10',
        ].join(' ')}>
          <div class="flex items-center gap-2 text-xs font-semibold text-fg mb-2">
            {isEdit ? null : <AlertTriangle size={12} class="text-warning" />}
            Código de Integração (API Key)
            <span class="font-normal text-2xs text-fg-muted">
              {isEdit ? '— não editável após a criação' : '— defina antes de criar, não pode ser alterado depois'}
            </span>
          </div>
          {isEdit ? (
            <div class="flex items-stretch gap-2">
              <code class="flex-1 rounded border border-border bg-surface px-2 py-1.5 font-mono text-xs text-info">{form.key}</code>
              <Button type="button" size="sm" variant="secondary" onClick={copyKey}>
                {keyCopied ? <><Check size={12} class="text-success" /> Copiado!</> : <><Copy size={12} /> Copiar</>}
              </Button>
            </div>
          ) : (
            <>
              <input
                type="text"
                value={form.key}
                onInput={(e) => {
                  setKeyTouched(true)
                  patch('key', (e.target as HTMLInputElement).value.toLowerCase().replace(/[^a-z0-9_]/g, '_'))
                }}
                placeholder="auto-gerado do nome (ou digite manualmente)"
                class="w-full h-9 px-3 rounded-md bg-surface border border-border text-sm text-info font-mono placeholder:text-fg-muted focus:outline-none focus:border-accent"
              />
              <div class="text-2xs text-fg-muted mt-1">
                Apenas letras minúsculas, números e underscores. Será usado como identificador em APIs e
                integrações. Ex: <code class="rounded bg-surface px-1 py-0.5 font-mono">cnpj</code>,{' '}
                <code class="rounded bg-surface px-1 py-0.5 font-mono">valor_contrato</code>,{' '}
                <code class="rounded bg-surface px-1 py-0.5 font-mono">cargo</code>.
              </div>
            </>
          )}
        </div>

        <div class="grid gap-3 grid-cols-1 sm:grid-cols-2">
          <Select label="Grupo" value={form.group} onChange={(e) => patch('group', (e.target as HTMLSelectElement).value)}>
            {GROUP_OPTIONS.map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}
          </Select>
          <Input
            label="Placeholder"
            value={form.placeholder}
            onInput={(e) => patch('placeholder', (e.target as HTMLInputElement).value)}
            placeholder="Ex: 00.000.000/0000-00"
            hint="Texto de orientação dentro do input"
          />
        </div>

        <Input
          label="Descrição (ajuda para o operador)"
          value={form.description}
          onInput={(e) => patch('description', (e.target as HTMLInputElement).value)}
          placeholder="Texto explicando o que preencher neste campo"
        />

        {showDefault && (
          <Input
            label="Valor padrão"
            value={form.defaultValue}
            onInput={(e) => patch('defaultValue', (e.target as HTMLInputElement).value)}
            placeholder="(opcional) — preenche automaticamente"
          />
        )}

        {showOptions && (
          <div>
            <Textarea
              label="Opções (uma por linha)"
              value={optionsText}
              onInput={(e) => setOptionsText((e.target as HTMLTextAreaElement).value)}
              rows={4}
              placeholder={'opcao_1\nopcao_2\nvalor_3|Label visível 3'}
              class="font-mono"
            />
            <div class="text-2xs text-fg-muted mt-1">
              Formato: uma opção por linha. Ou{' '}
              <code class="rounded bg-surface-2 px-1 py-0.5 font-mono">valor|Label</code>{' '}
              para diferenciar o valor técnico do label exibido.
            </div>
          </div>
        )}

        <div>
          <div class="text-xs font-semibold text-fg mb-1.5">Visibilidade</div>
          <div class="grid grid-cols-1 sm:grid-cols-3 gap-2 rounded-md border border-border p-2">
            <label class="flex items-center gap-2 text-xs text-fg-muted cursor-pointer">
              <input type="checkbox" checked={form.showInList} onChange={(e) => patch('showInList', (e.target as HTMLInputElement).checked)} />
              <Eye size={12} /> Lista de leads
            </label>
            <label class="flex items-center gap-2 text-xs text-fg-muted cursor-pointer">
              <input type="checkbox" checked={form.showInKanban} onChange={(e) => patch('showInKanban', (e.target as HTMLInputElement).checked)} />
              <KanbanSquare size={12} /> Card do Kanban
            </label>
            <label class="flex items-center gap-2 text-xs text-fg-muted cursor-pointer">
              <input type="checkbox" checked={form.showInForm} onChange={(e) => patch('showInForm', (e.target as HTMLInputElement).checked)} />
              <FormInput size={12} /> Formulários
            </label>
          </div>
        </div>

        <div class="grid grid-cols-2 gap-2">
          <label class="flex items-center gap-2 text-xs text-fg-muted cursor-pointer">
            <input type="checkbox" checked={form.required} onChange={(e) => patch('required', (e.target as HTMLInputElement).checked)} />
            Obrigatório
          </label>
          <label class="flex items-center gap-2 text-xs text-fg-muted cursor-pointer">
            <input type="checkbox" checked={form.active} onChange={(e) => patch('active', (e.target as HTMLInputElement).checked)} />
            Ativo
          </label>
        </div>
      </div>
    </Modal>
  )
}

function DeleteCustomFieldDialog({ field, onClose }: { field: CustomField; onClose: () => void }) {
  const del = useDeleteCustomField()
  return (
    <ConfirmDialog
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      title={`Excluir "${field.label}"`}
      description={`Os valores deste campo nos leads serão preservados, mas a coluna não estará mais disponível em formulários e listagens. Grupo: ${groupLabel(field.group)}.`}
      destructive
      confirmLabel="Excluir"
      loading={del.isPending}
      onConfirm={() => del.mutate(field.id, {
        onSuccess: () => { toast('Campo excluído', 'success'); onClose() },
        onError: (e: unknown) => toast((e as Error).message, 'danger'),
      })}
    />
  )
}
