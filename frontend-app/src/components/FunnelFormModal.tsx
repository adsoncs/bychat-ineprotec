import { useState } from 'preact/hooks'
import {
  useCreateFunnel,
  useUpdateFunnel,
  type FunnelListItem,
} from '@/hooks/useFunnels'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Input, Textarea } from '@/components/ui/Input'
import { toast } from '@/lib/toast'

export interface FunnelFormModalProps {
  funnel: FunnelListItem | null
  funnels: FunnelListItem[]
  namePlaceholder?: string
  onClose: () => void
  onCreated?: (funnel: FunnelListItem) => void
}

export function FunnelFormModal({
  funnel,
  funnels,
  namePlaceholder,
  onClose,
  onCreated,
}: FunnelFormModalProps) {
  const [name, setName] = useState(funnel?.name ?? '')
  const [description, setDescription] = useState(funnel?.description ?? '')
  const [active, setActive] = useState(funnel?.active ?? true)
  const [copyFromId, setCopyFromId] = useState('')
  const create = useCreateFunnel()
  const update = useUpdateFunnel()
  const isEdit = !!funnel
  const loading = create.isPending || update.isPending

  function handleSubmit() {
    if (!name.trim()) { toast('Nome é obrigatório', 'danger'); return }
    if (isEdit) {
      update.mutate({ id: funnel.id, name: name.trim(), description: description || null, active }, {
        onSuccess: () => { toast('Funil atualizado', 'success'); onClose() },
        onError: (e: unknown) => toast((e as Error).message, 'danger'),
      })
    } else {
      const payload: { name: string; description: string | null; copyFromId?: number } = {
        name: name.trim(),
        description: description || null,
      }
      if (copyFromId) payload.copyFromId = Number(copyFromId)
      create.mutate(payload, {
        onSuccess: (created) => {
          toast('Funil criado com etapas padrão', 'success')
          onCreated?.(created)
          onClose()
        },
        onError: (e: unknown) => toast((e as Error).message, 'danger'),
      })
    }
  }

  return (
    <Modal
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      title={isEdit ? 'Editar funil' : 'Novo funil'}
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
          label="Nome do funil"
          value={name}
          placeholder={namePlaceholder ?? 'Ex: Funil Imobiliário'}
          onInput={(e) => setName((e.target as HTMLInputElement).value)}
        />
        <Textarea
          label="Descrição (opcional)"
          value={description ?? ''}
          placeholder="Descrição curta"
          onInput={(e) => setDescription((e.target as HTMLTextAreaElement).value)}
        />
        {!isEdit && funnels.length > 0 && (
          <label class="flex flex-col gap-1">
            <span class="text-xs font-medium text-fg-muted">Copiar etapas de</span>
            <select
              class="h-9 px-2 rounded-md bg-surface border border-border text-sm text-fg focus:outline-none focus:border-accent"
              value={copyFromId}
              onChange={(e) => setCopyFromId((e.target as HTMLSelectElement).value)}
            >
              <option value="">Criar etapas padrão (Novo, Contatado, Fechado, Perdido)</option>
              {funnels.map((f) => (
                <option key={f.id} value={f.id}>
                  Copiar de: {f.name} ({f._count.stages} etapa{f._count.stages === 1 ? '' : 's'})
                </option>
              ))}
            </select>
          </label>
        )}
        {isEdit && (
          <label class="flex items-center gap-2 text-sm text-fg-muted">
            <input type="checkbox" checked={active} onChange={(e) => setActive((e.target as HTMLInputElement).checked)} />
            Funil ativo
          </label>
        )}
      </div>
    </Modal>
  )
}
