// Seletor de Resumo no detalhe do lead.
//
// É o controle central do módulo: em vez de arrastar o card e depois lembrar de
// criar a tarefa, o operador escolhe a situação e confirma. O modal mostra ANTES
// de aplicar o que vai acontecer (etapa, atividades, ganho/perdido), pra não ser
// um botão que "faz coisas" sem avisar.

import { useMemo, useState } from 'preact/hooks'
import { Tag, ArrowRight, ListChecks, Trophy, XCircle, CheckCircle2 } from 'lucide-preact'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'
import { Input } from '@/components/ui/Input'
import { toast } from '@/lib/toast'
import { useModuleAccess } from '@/hooks/usePermissions'
import { useLossReasons } from '@/hooks/useLeadOutcome'
import {
  useStatusSummaries,
  useApplyStatusSummary,
  type StatusSummary,
} from '@/hooks/useStatusSummaries'

const SELECT_CLASS =
  'w-full h-9 px-3 rounded-md bg-surface border border-border text-sm text-fg focus:outline-none focus:border-accent'

interface Props {
  leadId: number
  funnelId: number | null
  currentStage: string | null
  currentSummary: { code: string; name: string; color: string | null } | null
}

/**
 * Badge compacto do resumo — card do kanban, linha da lista de leads.
 * Não checa o módulo: quem renderiza já recebe `summary` null quando o módulo
 * está desligado (o backend não devolve a relação nesse caso).
 */
export function StatusSummaryBadge({
  summary, class: className,
}: {
  summary: { code: string; name: string; color: string | null } | null | undefined
  class?: string
}) {
  if (!summary) return null
  const color = summary.color || '#94a3b8'
  return (
    <span
      class={`inline-flex items-center gap-1 text-[0.625rem] font-medium px-1.5 py-0.5 rounded shrink-0 ${className ?? ''}`}
      style={{ background: `${color}22`, color }}
      title={`${summary.code} — ${summary.name}`}
    >
      <span class="size-1.5 rounded-full" style={{ background: color }} />
      <code class="font-mono">{summary.code}</code>
    </span>
  )
}

export function LeadStatusSummaryControl({ leadId, funnelId, currentStage, currentSummary }: Props) {
  const access = useModuleAccess('status_summary')
  const [open, setOpen] = useState(false)

  // Módulo desligado (o padrão) → o controle simplesmente não existe na tela.
  if (access.status !== 'allowed') return null

  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)} title="Classificar a situação do atendimento">
        <Tag size={14} />
        {currentSummary ? (
          <span class="inline-flex items-center gap-1.5">
            <span
              class="size-2 rounded-full"
              style={{ background: currentSummary.color || '#94a3b8' }}
            />
            <code class="text-xs font-mono">{currentSummary.code}</code>
          </span>
        ) : (
          'Resumo'
        )}
      </Button>

      {open && (
        <SummaryModal
          leadId={leadId}
          funnelId={funnelId}
          currentStage={currentStage}
          currentCode={currentSummary?.code ?? null}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}

function SummaryModal({
  leadId, funnelId, currentStage, currentCode, onClose,
}: {
  leadId: number
  funnelId: number | null
  currentStage: string | null
  currentCode: string | null
  onClose: () => void
}) {
  const { data, isLoading } = useStatusSummaries({ funnelId })
  const { data: reasons } = useLossReasons()
  const apply = useApplyStatusSummary()

  const [code, setCode] = useState(currentCode ?? '')
  const [note, setNote] = useState('')
  const [lossReasonId, setLossReasonId] = useState<number | ''>('')
  const [dueAt, setDueAt] = useState('')

  const summaries = data?.data ?? []
  const selected: StatusSummary | undefined = useMemo(
    () => summaries.find((s) => s.code === code),
    [summaries, code],
  )

  // Resumo que não pode partir da etapa atual fica visível mas desabilitado —
  // esconder faria o operador achar que o catálogo está incompleto.
  function isBlocked(s: StatusSummary): boolean {
    const allowed = s.allowedFromStages
    if (!Array.isArray(allowed) || allowed.length === 0) return false
    return !currentStage || !allowed.includes(currentStage)
  }

  const needsLossReason = selected?.requireLossReason && !selected?.defaultLossReasonId
  const needsDueDate = (selected?.activities ?? []).some(
    (a) => (a.dueOverrideMode ?? a.activityTemplate.dueMode) === 'lead_defined',
  )

  const canSubmit =
    !!selected &&
    !isBlocked(selected) &&
    (!needsLossReason || lossReasonId !== '') &&
    !apply.isPending

  async function submit(e: Event) {
    e.preventDefault()
    if (!selected) return
    try {
      const res = await apply.mutateAsync({
        leadId,
        code: selected.code,
        note: note.trim() || undefined,
        lossReasonId: lossReasonId === '' ? null : lossReasonId,
        dueAt: dueAt ? new Date(dueAt).toISOString() : null,
      })
      const r = res.data
      const parts: string[] = []
      if (r.movedStage?.to) parts.push(`etapa → ${r.movedStage.to}`)
      if (r.createdActivityIds.length) parts.push(`${r.createdActivityIds.length} atividade(s)`)
      if (r.outcomeApplied === 'won') parts.push('marcado como Ganho')
      if (r.outcomeApplied === 'lost') parts.push('marcado como Perdido')
      toast(parts.length ? `${selected.code} aplicado — ${parts.join(', ')}` : `${selected.code} aplicado`, 'success')
      onClose()
    } catch (err) {
      toast((err as Error).message, 'danger')
    }
  }

  return (
    <Modal open onOpenChange={(o) => { if (!o) onClose() }} title="Registrar situação do atendimento">
      <form onSubmit={submit} class="space-y-3">
        <div>
          <label class="text-xs font-medium text-fg-muted block mb-1">Resumo</label>
          {isLoading ? (
            <div class="text-sm text-fg-muted">Carregando catálogo…</div>
          ) : summaries.length === 0 ? (
            <div class="text-sm text-fg-muted">
              Nenhum resumo cadastrado para este funil. Configure em Cadastros → Resumos.
            </div>
          ) : (
            <select value={code} onChange={(e) => setCode((e.target as HTMLSelectElement).value)} class={SELECT_CLASS}>
              <option value="">Selecione…</option>
              {summaries.map((s) => (
                <option key={s.id} value={s.code} disabled={isBlocked(s)}>
                  {s.code} — {s.name}{isBlocked(s) ? ' (não disponível nesta etapa)' : ''}
                </option>
              ))}
            </select>
          )}
        </div>

        {selected && (
          <div class="rounded-md border border-border bg-surface-2 p-3 space-y-1.5">
            {selected.helpText && <p class="text-xs text-fg-muted">{selected.helpText}</p>}
            <div class="text-xs font-semibold text-fg">O que vai acontecer</div>
            <ul class="text-xs text-fg-muted space-y-1">
              {selected.targetStageKey ? (
                <li class="flex items-center gap-1.5">
                  <ArrowRight size={12} /> Move para a etapa <strong class="text-fg">{selected.targetStageKey}</strong>
                </li>
              ) : (
                <li class="flex items-center gap-1.5"><CheckCircle2 size={12} /> Mantém a etapa atual</li>
              )}
              {selected.closeOpenActivities && (
                <li class="flex items-center gap-1.5">
                  <CheckCircle2 size={12} /> Conclui as atividades pendentes
                </li>
              )}
              {selected.activities.map((a) => (
                <li key={a.activityTemplateId} class="flex items-center gap-1.5">
                  <ListChecks size={12} /> Cria <code class="font-mono">{a.activityTemplate.code}</code>{' '}
                  {a.titleOverride ?? a.activityTemplate.name}
                </li>
              ))}
              {selected.setOutcome === 'won' && (
                <li class="flex items-center gap-1.5 text-success"><Trophy size={12} /> Marca o lead como Ganho</li>
              )}
              {selected.setOutcome === 'lost' && (
                <li class="flex items-center gap-1.5 text-danger"><XCircle size={12} /> Marca o lead como Perdido</li>
              )}
              {selected.nextSummaryCode && selected.autoAdvanceOnDue && (
                <li class="flex items-center gap-1.5">
                  <ArrowRight size={12} /> Sem resposta até o vencimento, avança sozinho para{' '}
                  <code class="font-mono">{selected.nextSummaryCode}</code>
                </li>
              )}
            </ul>
            {selected.temperature && (
              <Badge tone="neutral">Temperatura: {selected.temperature}</Badge>
            )}
          </div>
        )}

        {needsLossReason && (
          <div>
            <label class="text-xs font-medium text-fg-muted block mb-1">
              Objeção <span class="text-danger">*</span>
            </label>
            <select
              value={lossReasonId === '' ? '' : String(lossReasonId)}
              onChange={(e) => {
                const v = (e.target as HTMLSelectElement).value
                setLossReasonId(v === '' ? '' : Number(v))
              }}
              class={SELECT_CLASS}
            >
              <option value="">Selecione a objeção…</option>
              {(reasons?.data ?? []).map((r) => (
                <option key={r.id} value={String(r.id)}>{r.name}</option>
              ))}
            </select>
          </div>
        )}

        {needsDueDate && (
          <div>
            <label class="text-xs font-medium text-fg-muted block mb-1">
              Data combinada com o lead
            </label>
            <Input
              type="datetime-local"
              value={dueAt}
              onInput={(e) => setDueAt((e.target as HTMLInputElement).value)}
            />
          </div>
        )}

        <div>
          <label class="text-xs font-medium text-fg-muted block mb-1">
            Observação <span class="font-normal text-fg-subtle">(opcional)</span>
          </label>
          <textarea
            value={note}
            onInput={(e) => setNote((e.target as HTMLTextAreaElement).value)}
            rows={2}
            class="w-full px-3 py-2 rounded-md bg-surface border border-border text-sm text-fg focus:outline-none focus:border-accent"
          />
        </div>

        <div class="flex justify-end gap-2 pt-1">
          <Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button type="submit" variant="primary" disabled={!canSubmit}>
            {apply.isPending ? 'Aplicando…' : 'Aplicar resumo'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
