import { useState } from 'preact/hooks'
import { Ticket, Plus, Pencil, Trash2 } from 'lucide-preact'
import { Card } from '@/components/ui/Card'
import { Skeleton } from '@/components/ui/Skeleton'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Input, Select } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { EmptyState } from '@/components/ui/EmptyState'
import {
  useCoupons, useCreateCoupon, useUpdateCoupon, useDeleteCoupon,
  type Coupon, type CouponInput,
} from '@/hooks/usePaymentsDashboard'
import { toast } from '@/lib/toast'

const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

export function CouponsTab() {
  const [search, setSearch] = useState('')
  const { data, isLoading } = useCoupons(search ? { search } : {})
  const [editing, setEditing] = useState<Coupon | null>(null)
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState<Coupon | null>(null)
  const remove = useDeleteCoupon()

  const items = data?.items ?? []

  function handleDelete() {
    if (!deleting) return
    remove.mutate(deleting.id, {
      onSuccess: () => { toast('Cupom excluído', 'success'); setDeleting(null) },
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  return (
    <div class="space-y-3">
      <div class="flex items-center justify-between gap-3 flex-wrap">
        <Input
          value={search}
          onInput={(e) => setSearch((e.target as HTMLInputElement).value)}
          placeholder="Buscar código ou descrição"
          class="max-w-xs"
        />
        <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
          <Plus size={14} /> Novo cupom
        </Button>
      </div>

      {isLoading && <Skeleton class="h-40 w-full" />}

      {!isLoading && items.length === 0 && (
        <EmptyState
          icon={<Ticket size={24} />}
          title="Nenhum cupom cadastrado"
          description="Crie códigos de desconto para campanhas. A aplicação no checkout entra em uma fase futura — por enquanto a estrutura é só pra organizar campanhas."
          action={
            <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
              <Plus size={14} /> Criar primeiro cupom
            </Button>
          }
        />
      )}

      {!isLoading && items.length > 0 && (
        <Card>
          <div class="overflow-x-auto">
            <table class="w-full text-sm">
              <thead>
                <tr class="text-left text-xs text-fg-subtle border-b border-border">
                  <th class="py-2 pr-3">Código</th>
                  <th class="py-2 pr-3">Tipo / Valor</th>
                  <th class="py-2 pr-3">Validade</th>
                  <th class="py-2 pr-3">Uso</th>
                  <th class="py-2 pr-3">Status</th>
                  <th class="py-2 pr-3"></th>
                </tr>
              </thead>
              <tbody>
                {items.map((c) => <CouponRow key={c.id} c={c} onEdit={() => setEditing(c)} onDelete={() => setDeleting(c)} />)}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {(creating || editing) && (
        <CouponModal
          coupon={editing}
          onClose={() => { setCreating(false); setEditing(null) }}
        />
      )}

      {deleting && (
        <ConfirmDialog
          open
          onOpenChange={(o) => { if (!o) setDeleting(null) }}
          title={`Excluir cupom "${deleting.code}"?`}
          description={deleting.usageCount > 0
            ? `Este cupom já foi usado ${deleting.usageCount} vez(es). Considere desativar em vez de excluir.`
            : 'Esta ação não pode ser desfeita.'}
          confirmLabel="Excluir"
          destructive
          onConfirm={handleDelete}
        />
      )}
    </div>
  )
}

function CouponRow({ c, onEdit, onDelete }: { c: Coupon; onEdit: () => void; onDelete: () => void }) {
  const valueLabel = c.type === 'percent' ? `${c.value}%` : fmt(c.value)
  const validity =
    c.validFrom || c.validUntil
      ? `${c.validFrom ? new Date(c.validFrom).toLocaleDateString('pt-BR') : '—'} até ${c.validUntil ? new Date(c.validUntil).toLocaleDateString('pt-BR') : 'sem fim'}`
      : 'Sem limite de data'

  return (
    <tr class="border-b border-border/40">
      <td class="py-2 pr-3">
        <code class="text-sm font-mono font-medium text-fg">{c.code}</code>
        {c.description && <div class="text-[0.6875rem] text-fg-subtle">{c.description}</div>}
      </td>
      <td class="py-2 pr-3">
        <div class="text-sm text-fg">{valueLabel}</div>
        <div class="text-[0.6875rem] text-fg-subtle">
          {c.type === 'percent' ? 'Percentual' : 'Valor fixo'}
          {c.minAmount && ` · mín ${fmt(c.minAmount)}`}
        </div>
      </td>
      <td class="py-2 pr-3 text-xs text-fg-muted">{validity}</td>
      <td class="py-2 pr-3 text-xs">
        <div class="tabular-nums">{c.usageCount} / {c.usageLimit ?? '∞'}</div>
        <div class="text-[0.6875rem] text-fg-subtle">{c.perUserLimit} por candidato</div>
      </td>
      <td class="py-2 pr-3">
        <Badge tone={c.active ? 'success' : 'info'}>{c.active ? 'Ativo' : 'Inativo'}</Badge>
      </td>
      <td class="py-2 pr-3">
        <div class="flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={onEdit}><Pencil size={11} /></Button>
          {c.usageCount === 0 && (
            <Button variant="ghost" size="sm" onClick={onDelete}><Trash2 size={11} class="text-danger" /></Button>
          )}
        </div>
      </td>
    </tr>
  )
}

function CouponModal({ coupon, onClose }: { coupon: Coupon | null; onClose: () => void }) {
  const isEdit = !!coupon
  const create = useCreateCoupon()
  const update = useUpdateCoupon()

  const [code, setCode] = useState(coupon?.code ?? '')
  const [description, setDescription] = useState(coupon?.description ?? '')
  const [type, setType] = useState<'percent' | 'fixed'>(coupon?.type ?? 'percent')
  const [value, setValue] = useState(coupon?.value?.toString() ?? '10')
  const [minAmount, setMinAmount] = useState(coupon?.minAmount?.toString() ?? '')
  const [maxDiscount, setMaxDiscount] = useState(coupon?.maxDiscount?.toString() ?? '')
  const [usageLimit, setUsageLimit] = useState(coupon?.usageLimit?.toString() ?? '')
  const [perUserLimit, setPerUserLimit] = useState(coupon?.perUserLimit?.toString() ?? '1')
  const [validFrom, setValidFrom] = useState(coupon?.validFrom?.slice(0, 10) ?? '')
  const [validUntil, setValidUntil] = useState(coupon?.validUntil?.slice(0, 10) ?? '')
  const [active, setActive] = useState(coupon?.active ?? true)

  function handleSave() {
    if (!code.trim() || code.trim().length < 3) { toast('Código mín 3 caracteres', 'danger'); return }
    const v = Number(value)
    if (!Number.isFinite(v) || v <= 0) { toast('Valor inválido', 'danger'); return }
    if (type === 'percent' && v > 100) { toast('Percentual máx 100%', 'danger'); return }

    const payload: CouponInput = {
      code: code.trim().toUpperCase(),
      description: description.trim() || null,
      type, value: v,
      minAmount: minAmount ? Number(minAmount) : null,
      maxDiscount: maxDiscount ? Number(maxDiscount) : null,
      usageLimit: usageLimit ? parseInt(usageLimit) : null,
      perUserLimit: parseInt(perUserLimit) || 1,
      validFrom: validFrom || null,
      validUntil: validUntil || null,
      active,
    }

    const onSuccess = () => { toast(isEdit ? 'Cupom atualizado' : 'Cupom criado', 'success'); onClose() }
    const onError = (e: unknown) => toast((e as Error).message, 'danger')

    if (isEdit && coupon) {
      update.mutate({ id: coupon.id, ...payload }, { onSuccess, onError })
    } else {
      create.mutate(payload, { onSuccess, onError })
    }
  }

  const loading = create.isPending || update.isPending

  return (
    <Modal
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      title={isEdit ? `Editar ${coupon!.code}` : 'Novo cupom'}
      size="lg"
      footer={
        <div class="flex justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={onClose} disabled={loading}>Cancelar</Button>
          <Button variant="primary" size="sm" onClick={handleSave} disabled={loading}>{loading ? 'Salvando…' : 'Salvar'}</Button>
        </div>
      }
    >
      <div class="space-y-3">
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Input
            label="Código *"
            value={code}
            onInput={(e) => setCode((e.target as HTMLInputElement).value)}
            placeholder="EX: PROMO10"
            disabled={isEdit}
            hint={isEdit ? 'Código não pode ser alterado após criação' : 'A-Z, 0-9, hífen ou underscore'}
          />
          <div class="flex items-end pb-2">
            <label class="flex items-center gap-2 text-sm text-fg-muted">
              <input type="checkbox" checked={active} onChange={(e) => setActive((e.target as HTMLInputElement).checked)} />
              Ativo
            </label>
          </div>
        </div>
        <Input
          label="Descrição interna"
          value={description}
          onInput={(e) => setDescription((e.target as HTMLInputElement).value)}
          placeholder="Ex: Campanha de Black Friday"
        />
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Select label="Tipo *" value={type} onChange={(e) => setType((e.target as HTMLSelectElement).value as any)}>
            <option value="percent">Percentual (%)</option>
            <option value="fixed">Valor fixo (R$)</option>
          </Select>
          <Input
            label={type === 'percent' ? 'Percentual *' : 'Valor R$ *'}
            type="number"
            value={value}
            onInput={(e) => setValue((e.target as HTMLInputElement).value)}
            placeholder={type === 'percent' ? '10' : '20.00'}
          />
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Input
            label="Valor mínimo (R$, opcional)"
            type="number"
            value={minAmount}
            onInput={(e) => setMinAmount((e.target as HTMLInputElement).value)}
            placeholder="50.00"
            hint="Só aplica se o valor da inscrição for ≥ esse"
          />
          {type === 'percent' && (
            <Input
              label="Desconto máximo (R$, opcional)"
              type="number"
              value={maxDiscount}
              onInput={(e) => setMaxDiscount((e.target as HTMLInputElement).value)}
              placeholder="30.00"
              hint="Teto para o desconto percentual"
            />
          )}
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Input
            label="Limite de uso total"
            type="number"
            value={usageLimit}
            onInput={(e) => setUsageLimit((e.target as HTMLInputElement).value)}
            placeholder="vazio = ilimitado"
          />
          <Input
            label="Limite por candidato"
            type="number"
            value={perUserLimit}
            onInput={(e) => setPerUserLimit((e.target as HTMLInputElement).value)}
            placeholder="1"
          />
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Input label="Válido a partir de" type="date" value={validFrom} onInput={(e) => setValidFrom((e.target as HTMLInputElement).value)} />
          <Input label="Válido até" type="date" value={validUntil} onInput={(e) => setValidUntil((e.target as HTMLInputElement).value)} />
        </div>
        <div class="text-[0.6875rem] text-fg-subtle bg-info/10 border border-info/30 rounded-md p-2.5">
          ⓘ A estrutura está pronta, mas o cupom <strong>ainda não é aplicado no checkout</strong>. Use esta tela para organizar campanhas; a integração entra em fase futura.
        </div>
      </div>
    </Modal>
  )
}
