import { useState } from 'preact/hooks'
import { Modal } from '@/components/ui/Modal'
import { Select, Textarea } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { toast } from '@/lib/toast'
import { ApiError } from '@/lib/apiClient'
import { useAgents } from '@/hooks/useRouting'
import { useCreateTransferRequest } from '@/hooks/useTransferRequests'
import { useUserStore } from '@/stores/user'

interface Props {
  leadId: number
  leadLabel: string
  onClose: () => void
}

export function TransferLeadModal({ leadId, leadLabel, onClose }: Props) {
  const { data: agentsData } = useAgents()
  const create = useCreateTransferRequest()
  const me = useUserStore((s) => s.user)
  const [toUserId, setToUserId] = useState<number | ''>('')
  const [reason, setReason] = useState('')

  const candidates = (agentsData?.agents ?? []).filter(
    (a) => a.active && a.id !== (me?.id ? Number(me.id) : 0) && a.role !== 'VIEWER',
  )

  const handleSubmit = async () => {
    if (typeof toUserId !== 'number') {
      toast('Escolha um agente', 'danger')
      return
    }
    try {
      const trimmed = reason.trim()
      await create.mutateAsync(trimmed ? { leadId, toUserId, reason: trimmed } : { leadId, toUserId })
      toast('Pedido de transferência enviado', 'success')
      onClose()
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : 'Falha ao solicitar'
      toast(msg, 'danger')
    }
  }

  return (
    <Modal
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      title="Transferir lead"
      description={`${leadLabel} → o agente alvo recebe pedido e aceita/recusa.`}
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose} disabled={create.isPending}>Cancelar</Button>
          <Button variant="primary" size="sm" onClick={handleSubmit} disabled={create.isPending}>
            {create.isPending ? 'Enviando…' : 'Solicitar transferência'}
          </Button>
        </>
      }
    >
      <div class="space-y-3">
        <Select
          label="Para quem"
          value={toUserId === '' ? '' : String(toUserId)}
          onChange={(e) => {
            const v = (e.currentTarget as HTMLSelectElement).value
            setToUserId(v === '' ? '' : parseInt(v))
          }}
        >
          <option value="">— Selecionar agente —</option>
          {candidates.map((a) => (
            <option key={a.id} value={String(a.id)}>{a.name} ({a.role})</option>
          ))}
        </Select>
        <Textarea
          label="Motivo (opcional)"
          value={reason}
          onInput={(e) => setReason((e.currentTarget as HTMLTextAreaElement).value)}
          maxLength={255}
          rows={3}
          placeholder="Ex.: cliente pediu outro consultor; estou de folga amanhã; lead da sua região..."
        />
        <div class="text-xs text-fg-muted bg-surface-2 border border-border rounded p-2">
          A transferência só efetiva quando o agente aceitar. Auto-cancela em 24h se não responder.
        </div>
      </div>
    </Modal>
  )
}
