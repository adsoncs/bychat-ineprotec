import { useMemo, useState } from 'preact/hooks'
import { Plus, Trash2, GripVertical, Pencil, Check, X } from '@/components/ui/icon-set'
import {
  useDocumentTypes,
  useCreateDocRequirement,
  useUpdateDocRequirement,
  useDeleteDocRequirement,
  type DocumentRequirement,
  type DocOwner,
} from '@/hooks/useEducational'
import { Button } from '@/components/ui/Button'
import { Input, Select } from '@/components/ui/Input'
import { Skeleton } from '@/components/ui/Skeleton'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { toast } from '@/lib/toast'

interface Props {
  /** Quem possui essa matriz de documentos. */
  owner: DocOwner
  /** Lista atual (vinda do GET pai). Se null, mostra skeleton. */
  requirements: DocumentRequirement[] | null | undefined
  /** Pode editar? Quando false, esconde botões de ação. */
  readonly?: boolean
  /** Texto do banner contextual no topo (ex.: "Herdando do modo X"). */
  banner?: preact.ComponentChildren
  /** Para SP: ação de clonar defaults do modo. Quando definido, mostra botão. */
  onCloneFromMode?: (() => void) | undefined
  /** Disabled enquanto clone está em flight. */
  cloneLoading?: boolean
}

export function DocumentRequirementsEditor({
  owner, requirements, readonly = false, banner, onCloneFromMode, cloneLoading = false,
}: Props) {
  const { data: typesData, isLoading: loadingTypes } = useDocumentTypes()
  const create = useCreateDocRequirement(owner)
  const update = useUpdateDocRequirement(owner)
  const remove = useDeleteDocRequirement(owner)
  const [adding, setAdding] = useState(false)
  const [deleting, setDeleting] = useState<DocumentRequirement | null>(null)
  const [editingId, setEditingId] = useState<number | null>(null)

  const reqs = useMemo(() => requirements ?? [], [requirements])
  const types = useMemo(() => typesData?.types ?? [], [typesData])
  const usedIds = useMemo(() => new Set(reqs.map((r) => r.documentTypeId)), [reqs])
  const availableTypes = useMemo(() => types.filter((t) => !usedIds.has(t.id)), [types, usedIds])

  const empty = !loadingTypes && reqs.length === 0

  return (
    <div class="space-y-3">
      {banner && <div class="rounded-md border border-border bg-surface p-3 text-xs text-fg-muted">{banner}</div>}

      {empty && (
        <div class="rounded-md border border-dashed border-border p-6 text-center">
          <div class="text-sm text-fg-muted">Nenhum documento exigido.</div>
          {!readonly && (
            <div class="flex gap-2 justify-center mt-3">
              {onCloneFromMode && (
                <Button size="sm" variant="secondary" onClick={onCloneFromMode} disabled={cloneLoading}>
                  {cloneLoading ? 'Clonando…' : 'Clonar do modo de ingresso'}
                </Button>
              )}
              <Button size="sm" variant="primary" onClick={() => setAdding(true)} disabled={availableTypes.length === 0}>
                <Plus size={14} /> Adicionar documento
              </Button>
            </div>
          )}
        </div>
      )}

      {reqs.length > 0 && (
        <ul class="divide-y divide-border rounded-md border border-border">
          {reqs.map((r) => (
            <li key={r.id} class="p-2.5 flex items-start gap-3 bg-surface">
              <GripVertical size={14} class="text-fg-muted mt-1 shrink-0" />
              <span class="text-xs text-fg-muted tabular-nums w-6 mt-1">{r.ordem}</span>
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2 flex-wrap">
                  <span class="text-sm text-fg truncate">
                    {r.documentType?.name ?? `#${r.documentTypeId}`}
                  </span>
                  {r.documentType?.code && (
                    <code class="text-3xs text-fg-muted">{r.documentType.code}</code>
                  )}
                  {r.required && <span class="text-3xs uppercase text-warning">obrigatório</span>}
                </div>
                {editingId === r.id ? (
                  <EditRow
                    requirement={r}
                    onSave={(payload) => {
                      update.mutate({ reqId: r.id, ...payload }, {
                        onSuccess: () => { toast('Documento atualizado', 'success'); setEditingId(null) },
                        onError: (e: unknown) => toast((e as Error).message, 'danger'),
                      })
                    }}
                    onCancel={() => setEditingId(null)}
                    saving={update.isPending}
                  />
                ) : (
                  r.helpText && (
                    <div class="text-xs text-fg-muted mt-0.5 truncate">{r.helpText}</div>
                  )
                )}
              </div>
              {!readonly && editingId !== r.id && (
                <div class="flex gap-0.5 shrink-0">
                  <button
                    type="button"
                    class="size-7 rounded grid place-items-center text-fg-muted hover:text-fg hover:bg-surface-3"
                    onClick={() => setEditingId(r.id)}
                    aria-label="Editar"
                  >
                    <Pencil size={11} />
                  </button>
                  <button
                    type="button"
                    class="size-7 rounded grid place-items-center text-fg-muted hover:text-danger hover:bg-surface-3"
                    onClick={() => setDeleting(r)}
                    aria-label="Remover"
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {!readonly && reqs.length > 0 && (
        <div>
          <Button size="sm" variant="secondary" onClick={() => setAdding(true)} disabled={availableTypes.length === 0}>
            <Plus size={12} /> Adicionar documento
          </Button>
          {availableTypes.length === 0 && (
            <span class="text-2xs text-fg-muted ml-2">
              Todos os tipos do catálogo já foram adicionados.
            </span>
          )}
        </div>
      )}

      {loadingTypes && reqs.length === 0 && <Skeleton class="h-16 w-full" />}

      {adding && (
        <AddRequirementModal
          types={availableTypes}
          onClose={() => setAdding(false)}
          onSubmit={(payload) => {
            create.mutate(payload, {
              onSuccess: () => { toast('Documento adicionado', 'success'); setAdding(false) },
              onError: (e: unknown) => toast((e as Error).message, 'danger'),
            })
          }}
          saving={create.isPending}
        />
      )}

      {deleting && (
        <ConfirmDialog
          open
          onOpenChange={(o) => { if (!o) setDeleting(null) }}
          title={`Remover "${deleting.documentType?.name ?? '#' + deleting.documentTypeId}"?`}
          description="O documento sai dessa exigência. Esta ação é imediata."
          destructive
          confirmLabel="Remover"
          loading={remove.isPending}
          onConfirm={() => remove.mutate(deleting.id, {
            onSuccess: () => { toast('Documento removido', 'success'); setDeleting(null) },
            onError: (e: unknown) => toast((e as Error).message, 'danger'),
          })}
        />
      )}
    </div>
  )
}

function EditRow({
  requirement, onSave, onCancel, saving,
}: {
  requirement: DocumentRequirement
  onSave: (p: { required: boolean; ordem: number; helpText: string | null }) => void
  onCancel: () => void
  saving: boolean
}) {
  const [required, setRequired] = useState(requirement.required)
  const [ordem, setOrdem] = useState(String(requirement.ordem))
  const [helpText, setHelpText] = useState(requirement.helpText ?? '')

  return (
    <div class="mt-1 grid grid-cols-1 sm:grid-cols-[auto_5rem_1fr_auto] gap-2 items-end">
      <label class="flex items-center gap-2 text-xs text-fg-muted whitespace-nowrap">
        <input type="checkbox" checked={required} onChange={(e) => setRequired((e.target as HTMLInputElement).checked)} />
        Obrigatório
      </label>
      <Input
        label="Ordem"
        type="number"
        value={ordem}
        onInput={(e) => setOrdem((e.target as HTMLInputElement).value)}
      />
      <Input
        label="Ajuda (opcional)"
        value={helpText}
        onInput={(e) => setHelpText((e.target as HTMLInputElement).value)}
        placeholder="Texto exibido ao candidato"
      />
      <div class="flex gap-0.5">
        <button
          type="button"
          class="size-7 rounded grid place-items-center text-success hover:bg-surface-3"
          onClick={() => onSave({
            required,
            ordem: parseInt(ordem) || 0,
            helpText: helpText.trim() || null,
          })}
          disabled={saving}
          aria-label="Salvar"
        >
          <Check size={12} />
        </button>
        <button
          type="button"
          class="size-7 rounded grid place-items-center text-fg-muted hover:bg-surface-3"
          onClick={onCancel}
          disabled={saving}
          aria-label="Cancelar"
        >
          <X size={12} />
        </button>
      </div>
    </div>
  )
}

function AddRequirementModal({
  types, onClose, onSubmit, saving,
}: {
  types: { id: number; code: string; name: string; category: string }[]
  onClose: () => void
  onSubmit: (p: { documentTypeId: number; required: boolean; ordem: number; helpText: string | null }) => void
  saving: boolean
}) {
  const [documentTypeId, setDocumentTypeId] = useState(types[0]?.id ?? 0)
  const [required, setRequired] = useState(true)
  const [ordem, setOrdem] = useState('0')
  const [helpText, setHelpText] = useState('')

  function handleSubmit() {
    if (!documentTypeId) return
    onSubmit({
      documentTypeId,
      required,
      ordem: parseInt(ordem) || 0,
      helpText: helpText.trim() || null,
    })
  }

  // Modal manual mais leve — usar Modal teria que passar muita prop.
  return (
    <div
      class="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4"
      role="dialog"
      aria-label="Adicionar documento"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div class="w-full max-w-md rounded-lg border border-border bg-surface-2 p-4 space-y-3 shadow-lg">
        <div class="text-sm font-semibold text-fg">Adicionar documento</div>
        <Select
          label="Tipo"
          value={String(documentTypeId)}
          onChange={(e) => setDocumentTypeId(Number((e.target as HTMLSelectElement).value))}
        >
          {types.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.category})</option>)}
        </Select>
        <div class="grid grid-cols-2 gap-3">
          <label class="flex items-center gap-2 text-xs text-fg-muted self-end pb-1.5">
            <input type="checkbox" checked={required} onChange={(e) => setRequired((e.target as HTMLInputElement).checked)} />
            Obrigatório
          </label>
          <Input
            label="Ordem"
            type="number"
            value={ordem}
            onInput={(e) => setOrdem((e.target as HTMLInputElement).value)}
          />
        </div>
        <Input
          label="Texto de ajuda (opcional)"
          value={helpText}
          onInput={(e) => setHelpText((e.target as HTMLInputElement).value)}
        />
        <div class="flex justify-end gap-2 pt-2">
          <Button variant="secondary" size="sm" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button variant="primary" size="sm" onClick={handleSubmit} disabled={saving || !documentTypeId}>
            {saving ? 'Adicionando…' : 'Adicionar'}
          </Button>
        </div>
      </div>
    </div>
  )
}
