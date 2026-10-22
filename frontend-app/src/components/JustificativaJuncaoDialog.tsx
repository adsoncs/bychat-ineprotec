// Junção manual de fichas com processos diferentes (curso ou forma de
// ingresso): o servidor responde 409 pedindo o porquê; esta caixa coleta e
// reenvia. A justificativa fica no histórico do lead e na auditoria de quem
// juntou (backend: routes/leads.ts › POST /leads/merge).

import { useState } from 'preact/hooks'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Textarea } from '@/components/ui/Input'
import { ApiError } from '@/lib/apiClient'

/** O erro da mesclagem é o pedido de justificativa? Devolve o motivo. */
export function pedeJustificativa(e: unknown): string | null {
  if (e instanceof ApiError && e.status === 409 && (e.payload as any)?.precisaJustificativa) return String((e.payload as any).motivo || '')
  return null
}

export function JustificativaJuncaoDialog({ motivo, loading, onCancel, onConfirm }: {
  motivo: string
  loading?: boolean | undefined
  onCancel: () => void
  onConfirm: (justificativa: string) => void
}) {
  const [texto, setTexto] = useState('')
  const ok = texto.trim().length >= 10
  return (
    <Modal open onOpenChange={(o) => { if (!o) onCancel() }} title="Juntar processos diferentes?"
      description="Cada processo (curso + forma de ingresso) costuma ter a sua ficha, com a sua etapa no funil. Juntar deixa os dois numa ficha só."
      size="md"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onCancel} disabled={!!loading}>Cancelar</Button>
          <Button size="sm" onClick={() => onConfirm(texto.trim())} disabled={!ok || !!loading} loading={!!loading}>Juntar mesmo assim</Button>
        </>
      }>
      <div class="space-y-3 text-sm">
        <div class="rounded-md border border-warning/30 bg-warning/5 p-2 text-xs">{motivo}</div>
        <Textarea label="Por que juntar?" hint="Mínimo de 10 caracteres. Fica no histórico do lead e no seu histórico de ações." rows={3}
          value={texto} onInput={(e) => setTexto((e.currentTarget as HTMLTextAreaElement).value)} />
      </div>
    </Modal>
  )
}
