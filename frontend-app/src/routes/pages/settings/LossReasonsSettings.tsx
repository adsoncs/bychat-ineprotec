import { useState } from 'preact/hooks'
import { Plus, Trash2, Pencil, Power } from '@/components/ui/icon-set'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Skeleton } from '@/components/ui/Skeleton'
import { Modal } from '@/components/ui/Modal'
import { Input } from '@/components/ui/Input'
import { toast } from '@/lib/toast'
import {
  useLossReasons,
  useCreateLossReason,
  useUpdateLossReason,
  useDeleteLossReason,
  type LossReason,
} from '@/hooks/useLeadOutcome'

export function LossReasonsSettings() {
  const { data, isLoading } = useLossReasons({ includeInactive: true })
  const create = useCreateLossReason()
  const upd = useUpdateLossReason()
  const del = useDeleteLossReason()
  const [editing, setEditing] = useState<LossReason | null>(null)
  const [creating, setCreating] = useState(false)

  function handleToggleActive(r: LossReason) {
    upd.mutate({ id: r.id, active: !r.active }, {
      onSuccess: () => toast(r.active ? 'Motivo desativado' : 'Motivo ativado', 'success'),
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  function handleDelete(r: LossReason) {
    if (!confirm(`Excluir a objeção "${r.name}"? Se houver leads usando, será desativada em vez de excluída.`)) return
    del.mutate(r.id, {
      onSuccess: (resp) => {
        if ((resp as any).softDeleted) toast(`Objeção desativada (em uso por ${(resp as any).leadsUsing} leads)`, 'success')
        else toast('Objeção excluída', 'success')
      },
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  return (
    <div class="space-y-4">
      <Card>
        <div class="flex items-start justify-between gap-3 mb-4">
          <div>
            <div class="text-sm font-semibold text-fg">Objeções</div>
            <p class="text-xs text-fg-muted mt-0.5">
              Catálogo de objeções comerciais usadas ao classificar um lead como Perdido. Aparecem no modal "Marcar Perdido" no lead, kanban e ações em massa.
            </p>
          </div>
          <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
            <Plus size={14} /> Nova objeção
          </Button>
        </div>

        {isLoading ? (
          <Skeleton class="h-32 w-full" />
        ) : (data?.data ?? []).length === 0 ? (
          <p class="text-sm text-fg-muted text-center py-6">Nenhuma objeção cadastrada.</p>
        ) : (
          <ul class="divide-y divide-border">
            {(data?.data ?? []).map((r) => (
              <li key={r.id} class="py-2.5 flex items-center gap-3 flex-wrap">
                <span
                  class="size-3 rounded-full shrink-0"
                  style={{ background: r.color || '#94a3b8' }}
                />
                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-2 flex-wrap">
                    <span class={r.active ? 'text-sm font-medium text-fg truncate' : 'text-sm font-medium text-fg-muted line-through truncate'}>
                      {r.name}
                    </span>
                    <button type="button" onClick={() => handleToggleActive(r)} class="cursor-pointer" title={r.active ? 'Desativar' : 'Ativar'}>
                      <Badge tone={r.active ? 'accent' : 'neutral'}>{r.active ? 'Ativo' : 'Inativo'}</Badge>
                    </button>
                  </div>
                </div>
                <div class="flex gap-1.5 shrink-0 flex-wrap">
                  <Button variant="secondary" size="sm" onClick={() => handleToggleActive(r)} aria-label={r.active ? 'Desativar objeção' : 'Ativar objeção'} title={r.active ? 'Desativar' : 'Ativar'}>
                    <Power size={12} /> {r.active ? 'Desativar' : 'Ativar'}
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => setEditing(r)} aria-label="Editar objeção" title="Editar">
                    <Pencil size={12} /> Editar
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => handleDelete(r)}
                    aria-label="Excluir objeção"
                    title="Excluir"
                    class="!text-danger border-danger/30 hover:bg-danger/10"
                  >
                    <Trash2 size={12} /> Excluir
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {creating && (
        <LossReasonModal
          onClose={() => setCreating(false)}
          onSubmit={async (input) => {
            await create.mutateAsync(input)
            toast('Objeção criada', 'success')
            setCreating(false)
          }}
        />
      )}
      {editing && (
        <LossReasonModal
          initial={editing}
          onClose={() => setEditing(null)}
          onSubmit={async (input) => {
            await upd.mutateAsync({ id: editing.id, ...input })
            toast('Objeção atualizada', 'success')
            setEditing(null)
          }}
        />
      )}
    </div>
  )
}

const SUGGESTED_COLORS = [
  '#10b981', '#0ea5e9', '#6b7280', '#a855f7', '#ef4444',
  '#f59e0b', '#94a3b8', '#22d3ee', '#f97316', '#ec4899',
]

function LossReasonModal({
  initial, onClose, onSubmit,
}: {
  initial?: LossReason
  onClose: () => void
  onSubmit: (input: { name: string; color: string | null; position: number; active: boolean }) => Promise<void>
}) {
  const [name, setName] = useState(initial?.name ?? '')
  const [color, setColor] = useState(initial?.color ?? '#6b7280')
  const [position, setPosition] = useState<number>(initial?.position ?? 0)
  const [active, setActive] = useState<boolean>(initial?.active ?? true)
  const [saving, setSaving] = useState(false)

  async function handleSave() {
    if (!name.trim()) {
      toast('Nome obrigatório', 'danger')
      return
    }
    setSaving(true)
    try {
      await onSubmit({ name: name.trim(), color: color || null, position: position || 0, active })
    } catch (e) {
      toast((e as Error).message, 'danger')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      title={initial ? 'Editar objeção' : 'Nova objeção'}
      size="sm"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>Cancelar</Button>
          <Button variant="primary" size="sm" onClick={handleSave} disabled={saving}>
            {saving ? 'Salvando…' : 'Salvar'}
          </Button>
        </>
      }
    >
      <div class="space-y-3">
        <div>
          <label class="block text-xs font-medium text-fg mb-1">Nome</label>
          <Input
            value={name}
            onInput={(e) => setName((e.target as HTMLInputElement).value)}
            placeholder="Ex: Sem fit com o produto"
            maxLength={100}
          />
        </div>
        <div>
          <label class="block text-xs font-medium text-fg mb-1">Cor</label>
          <div class="flex items-center gap-2 flex-wrap">
            {SUGGESTED_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                class="size-6 rounded-full border-2 transition-all"
                style={{ background: c, borderColor: color === c ? 'var(--color-accent)' : 'transparent' }}
                onClick={() => setColor(c)}
                aria-label={c}
              />
            ))}
            <input
              type="text"
              class="h-8 w-24 px-2 text-xs rounded-md border border-border bg-surface text-fg"
              value={color}
              onInput={(e) => setColor((e.target as HTMLInputElement).value)}
              placeholder="#hex"
            />
          </div>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="block text-xs font-medium text-fg mb-1">Posição</label>
            <Input
              type="number"
              value={String(position)}
              onInput={(e) => setPosition(Number((e.target as HTMLInputElement).value) || 0)}
            />
          </div>
          <div>
            <label class="block text-xs font-medium text-fg mb-1">Status</label>
            <label class="inline-flex items-center gap-2 h-9 text-sm text-fg">
              <input
                type="checkbox"
                checked={active}
                onChange={(e) => setActive((e.target as HTMLInputElement).checked)}
              />
              Ativo
            </label>
          </div>
        </div>
      </div>
    </Modal>
  )
}
