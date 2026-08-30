import { useState } from 'preact/hooks'
import { Plus, Megaphone } from '@/components/ui/icon-set'
import {
  useLeadCadenceEnrollments,
  useSalesCadences,
  useEnrollLeadInCadence,
  type LeadCadenceEnrollment,
} from '@/hooks/useSalesCadences'
import { Button } from '@/components/ui/Button'
import { Skeleton } from '@/components/ui/Skeleton'
import { Modal } from '@/components/ui/Modal'
import { Select } from '@/components/ui/Input'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/cn'
import { cadenceExitReasonLabel, cadencePauseReasonLabel, cadenceReplyClassLabel } from '@/lib/cadenceLabels'

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  active:    { label: 'Ativa',    cls: 'bg-success/15 text-success border-success/40' },
  paused:    { label: 'Pausada',  cls: 'bg-warning/15 text-warning border-warning/40' },
  completed: { label: 'Concluída', cls: 'bg-info/15 text-info border-info/40' },
  exited:    { label: 'Encerrada', cls: 'bg-surface-3 text-fg-muted border-border' },
}

export function LeadCadencesTab({ leadId }: { leadId: number }) {
  const enrollmentsQuery = useLeadCadenceEnrollments(leadId)
  const cadencesQuery = useSalesCadences()
  const enroll = useEnrollLeadInCadence()
  const [showEnroll, setShowEnroll] = useState(false)
  const [selectedCadenceId, setSelectedCadenceId] = useState<string>('')

  const enrollments = enrollmentsQuery.data?.items ?? []
  const activeCadences = (cadencesQuery.data?.items ?? []).filter((c) => c.status === 'active')

  // Mapa cadenceId → status do enrollment atual. Cadências em estado terminal
  // (completed/exited) podem ser reinscritas — o backend remove o antigo e
  // cria um novo. Cadências em estado vivo (active/paused) bloqueiam novo
  // enrollment até serem encerradas explicitamente.
  const enrollmentStatus = new Map<number, string>()
  for (const e of enrollments) enrollmentStatus.set(e.cadenceId, e.status)

  type AvailableEntry = { id: number; name: string; reenroll: boolean }
  const available: AvailableEntry[] = activeCadences
    .map((c) => {
      const st = enrollmentStatus.get(c.id)
      if (!st) return { id: c.id, name: c.name, reenroll: false }
      if (st === 'completed' || st === 'exited') return { id: c.id, name: c.name, reenroll: true }
      return null // active/paused — bloqueado
    })
    .filter((x): x is AvailableEntry => x !== null)

  const blockedActive = activeCadences.filter((c) => {
    const st = enrollmentStatus.get(c.id)
    return st === 'active' || st === 'paused'
  })

  function handleEnroll() {
    const cadenceId = Number(selectedCadenceId)
    if (!Number.isFinite(cadenceId)) return
    const entry = available.find((a) => a.id === cadenceId)
    enroll.mutate(
      { cadenceId, leadId },
      {
        onSuccess: () => {
          toast(entry?.reenroll ? 'Lead reinscrito na cadência' : 'Lead inscrito na cadência', 'success')
          setShowEnroll(false)
          setSelectedCadenceId('')
        },
        onError: (e) => toast((e as Error).message, 'danger'),
      },
    )
  }

  return (
    <div class="flex flex-col gap-3">
      <div class="flex items-start justify-between gap-3">
        <p class="text-xs text-fg-muted max-w-xl">
          Aqui aparecem as cadências em que este lead está agora ou esteve no passado. Você pode inscrever em uma cadência ativa para iniciar contatos automáticos.
          Se já está em uma, acompanhe abaixo o passo atual e a próxima ação agendada.
        </p>
        <Button
          variant="primary"
          size="sm"
          onClick={() => setShowEnroll(true)}
        >
          <Plus size={12} /> Inscrever em cadência
        </Button>
      </div>

      {enrollmentsQuery.isLoading && <Skeleton class="h-20 w-full" />}

      {!enrollmentsQuery.isLoading && enrollments.length === 0 && (
        <div class="border border-dashed border-border rounded-md p-6 text-center">
          <Megaphone size={24} class="mx-auto text-fg-muted mb-2" />
          <p class="text-sm text-fg mb-1">Lead não está em nenhuma cadência</p>
          <p class="text-xs text-fg-muted">Inscreva manualmente em uma cadência ativa para iniciar contatos automáticos.</p>
        </div>
      )}

      {!enrollmentsQuery.isLoading && enrollments.length > 0 && (
        <div class="overflow-x-auto border border-border rounded-md">
          <table class="w-full text-sm">
            <thead>
              <tr class="text-2xs uppercase tracking-wider text-fg-muted border-b border-border">
                <th class="text-left px-3 py-2 font-medium">Cadência</th>
                <th class="text-center px-3 py-2 font-medium">Passo</th>
                <th class="text-center px-3 py-2 font-medium">Status</th>
                <th class="text-left px-3 py-2 font-medium">Última ação</th>
                <th class="text-left px-3 py-2 font-medium">Próxima ação</th>
                <th class="text-left px-3 py-2 font-medium">Motivo</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-border">
              {enrollments.map((e) => (
                <EnrollmentRow key={e.id} enrollment={e} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        open={showEnroll}
        onOpenChange={setShowEnroll}
        title="Inscrever lead em cadência"
        description="Escolha uma cadência ativa. O primeiro contato vai disparar automaticamente conforme o tempo configurado no primeiro passo (geralmente imediato)."
        size="md"
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setShowEnroll(false)} disabled={enroll.isPending}>
              Cancelar
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={handleEnroll}
              disabled={enroll.isPending || !selectedCadenceId || available.length === 0}
            >
              {enroll.isPending
                ? 'Inscrevendo…'
                : available.find((a) => a.id === Number(selectedCadenceId))?.reenroll
                  ? 'Reinscrever'
                  : 'Inscrever'}
            </Button>
          </>
        }
      >
        <div class="flex flex-col gap-2">
          {activeCadences.length === 0 && (
            <div class="rounded-md border border-dashed border-border p-3 text-xs text-fg-muted">
              Nenhuma cadência ativa cadastrada. Crie uma em <strong class="text-fg">Vendas &amp; Automação → Cadências</strong> antes de inscrever leads.
            </div>
          )}

          {activeCadences.length > 0 && available.length === 0 && blockedActive.length > 0 && (
            <div class="rounded-md border border-warning/40 bg-warning/10 p-3 text-xs text-fg">
              O lead já está inscrito (status ativo ou pausado) em todas as cadências disponíveis. Encerre o enrollment atual antes de reinscrever.
            </div>
          )}

          {activeCadences.length > 0 && available.length > 0 && (
            <>
              <label class="text-xs text-fg-muted">Cadência</label>
              <Select
                value={selectedCadenceId}
                onChange={(e: any) => setSelectedCadenceId(e.currentTarget.value)}
              >
                <option value="">— Selecione —</option>
                {available.map((c) => (
                  <option key={c.id} value={String(c.id)}>
                    {c.name}{c.reenroll ? ' (reinscrever — substitui enrollment anterior)' : ''}
                  </option>
                ))}
              </Select>
              {available.some((a) => a.reenroll) && (
                <p class="text-2xs text-fg-muted mt-1">
                  Cadências marcadas como "reinscrever" substituem o enrollment anterior (que estava concluído ou encerrado). O histórico do enrollment antigo é apagado.
                </p>
              )}
            </>
          )}
        </div>
      </Modal>
    </div>
  )
}

function EnrollmentRow({ enrollment: e }: { enrollment: LeadCadenceEnrollment }) {
  const status = STATUS_BADGE[e.status] ?? STATUS_BADGE.active!
  return (
    <tr>
      <td class="px-3 py-2 font-medium text-fg">{e.cadence.name}</td>
      <td class="px-3 py-2 text-center tabular-nums">{e.currentStep + 1}</td>
      <td class="px-3 py-2 text-center">
        <span class={cn('inline-flex items-center px-2 h-6 rounded-md border text-2xs font-medium', status.cls)}>
          {status.label}
        </span>
      </td>
      <td class="px-3 py-2 text-xs text-fg-muted">{formatDate(e.lastActionAt)}</td>
      <td class="px-3 py-2 text-xs text-fg-muted">{formatDate(e.nextActionAt)}</td>
      <td class="px-3 py-2 text-xs">
        {e.exitReason && <span class="text-fg-muted">Saída: {cadenceExitReasonLabel(e.exitReason)}</span>}
        {e.pauseReason && !e.exitReason && <span class="text-warning">Pausa: {cadencePauseReasonLabel(e.pauseReason)}</span>}
        {e.lastReplyClass && (
          <span class="ml-2 text-fg-muted">Resposta: {cadenceReplyClassLabel(e.lastReplyClass)}</span>
        )}
      </td>
    </tr>
  )
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
}
