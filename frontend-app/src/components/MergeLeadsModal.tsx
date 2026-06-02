import { useState } from 'preact/hooks'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Skeleton } from '@/components/ui/Skeleton'
import { LeadStatusBadge } from '@/components/LeadStatusBadge'
import { useLeadDuplicates, useMergeLeads } from '@/hooks/useLeads'
import { formatDateTime } from '@/lib/format'
import { toast } from '@/lib/toast'

interface Props {
  masterId: number
  masterName: string
  onClose: () => void
  onMerged: () => void
}

export function MergeLeadsModal({ masterId, masterName, onClose, onMerged }: Props) {
  const { data, isLoading } = useLeadDuplicates(masterId)
  const merge = useMergeLeads()
  const [picked, setPicked] = useState<Set<number>>(new Set())

  function toggle(id: number) {
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function submit() {
    if (picked.size === 0) {
      toast('Selecione ao menos 1 lead duplicado', 'danger')
      return
    }
    merge.mutate({ masterId, mergeIds: Array.from(picked) }, {
      onSuccess: (r) => {
        toast(`${r.merged} lead(s) mesclado(s) em "${masterName}"`, 'success')
        onMerged()
      },
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  return (
    <Modal
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      title={`Mesclar duplicatas em "${masterName}"`}
      description="Os leads selecionados são absorvidos pelo lead atual (master). Mensagens, tags e atividades são transferidas. Os duplicados vão para a lixeira."
      size="lg"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose} disabled={merge.isPending}>
            Cancelar
          </Button>
          <Button variant="primary" size="sm" onClick={submit} disabled={merge.isPending || picked.size === 0}>
            {merge.isPending ? 'Mesclando…' : `Mesclar ${picked.size}`}
          </Button>
        </>
      }
    >
      {isLoading && <Skeleton class="h-32 w-full" />}
      {!isLoading && data?.duplicates.length === 0 && (
        <div class="text-sm text-fg-muted text-center py-6">
          Nenhum lead candidato a duplicata foi detectado.
        </div>
      )}
      {!isLoading && data && data.duplicates.length > 0 && (
        <ul class="divide-y divide-border rounded-md border border-border">
          {data.duplicates.map((d) => (
            <li key={d.id} class="p-2.5 flex items-start gap-3">
              <input
                type="checkbox"
                class="mt-1"
                checked={picked.has(d.id)}
                onChange={() => toggle(d.id)}
                aria-label={`Selecionar ${d.nome ?? d.id}`}
              />
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-2 flex-wrap">
                  <span class="text-sm text-fg truncate">{d.empresa ?? d.nome ?? `Lead #${d.id}`}</span>
                  <code class="text-[0.625rem] text-fg-subtle">#{d.id}</code>
                  {d.status && <LeadStatusBadge status={d.status} />}
                </div>
                <div class="text-xs text-fg-muted truncate">
                  {d.whatsapp ?? '—'} · {d.email ?? '—'}
                </div>
                {d.matchedBy.length > 0 && (
                  <div class="text-[0.6875rem] text-fg-subtle mt-0.5">
                    Casou por: {d.matchedBy.join(', ')}
                  </div>
                )}
              </div>
              <span class="text-[0.6875rem] text-fg-subtle whitespace-nowrap">{formatDateTime(d.createdAt)}</span>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  )
}
