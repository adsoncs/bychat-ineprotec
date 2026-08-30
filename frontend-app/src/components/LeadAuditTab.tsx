import { Bot, RefreshCw, AlertTriangle, CheckCircle2, Clock, Trash2 } from '@/components/ui/icon-set'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Skeleton } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { useState } from 'preact/hooks'
import { useLeadAudits, useRunAudit, useDeleteAudit, type ConversationAudit } from '@/hooks/useConversationAudits'
import { toast } from '@/lib/toast'

function formatSec(s: number | null): string {
  if (s === null) return '—'
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.round(s / 60)}min`
  return `${(s / 3600).toFixed(1)}h`
}
function scoreTone(score: number | null): 'success' | 'warning' | 'danger' | 'neutral' {
  if (score === null) return 'neutral'
  if (score >= 80) return 'success'
  if (score >= 60) return 'warning'
  return 'danger'
}
const TONE_LABELS: Record<string, string> = {
  cordial: 'Cordial', neutro: 'Neutro', frio: 'Frio', agressivo: 'Agressivo', inconsistente: 'Inconsistente',
}

export function LeadAuditTab({ leadId }: { leadId: number }) {
  const auditsQ = useLeadAudits(leadId)
  const runAudit = useRunAudit()
  const delAudit = useDeleteAudit()
  const [deleting, setDeleting] = useState<ConversationAudit | null>(null)

  function handleRun() {
    runAudit.mutate(leadId, {
      onSuccess: () => toast('Auditoria enfileirada — atualiza a página em 10-30s pra ver resultado', 'success'),
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  return (
    <div class="space-y-3">
      <Card class="p-3 bg-info/5 border-info/30">
        <div class="flex items-start justify-between gap-2 flex-wrap">
          <div class="flex-1 min-w-0">
            <div class="text-sm font-semibold text-fg flex items-center gap-1.5">
              <Bot size={14} class="text-accent" /> Auditoria de Conversa por IA
            </div>
            <p class="text-xs text-fg-muted mt-1">
              A IA analisa as últimas mensagens trocadas com este lead e devolve <strong>score 0-100</strong>, tom predominante,
              tempos de resposta, pontos fortes/fracos e oportunidades perdidas pelo atendente. Roda em background — atualize após alguns segundos.
            </p>
          </div>
          <Button variant="primary" size="sm" onClick={handleRun} disabled={runAudit.isPending}>
            <RefreshCw size={12} class={runAudit.isPending ? 'animate-spin' : ''} />
            {runAudit.isPending ? 'Enfileirando…' : 'Rodar auditoria'}
          </Button>
        </div>
      </Card>

      {auditsQ.isLoading && <Skeleton class="h-32 w-full" />}
      {!auditsQ.isLoading && (!auditsQ.data || auditsQ.data.data.length === 0) && (
        <EmptyState
          icon={<Bot size={20} />}
          title="Nenhuma auditoria ainda"
          description="Clique em 'Rodar auditoria' para gerar a primeira análise. Mínimo 4 mensagens trocadas com o lead."
        />
      )}
      {!auditsQ.isLoading && auditsQ.data && auditsQ.data.data.length > 0 && (
        <div class="space-y-3">
          {auditsQ.data.data.map(a => (
            <AuditCard key={a.id} audit={a} onDelete={() => setDeleting(a)} />
          ))}
        </div>
      )}

      {deleting && (
        <ConfirmDialog
          open
          onOpenChange={(o) => { if (!o) setDeleting(null) }}
          title="Excluir esta auditoria"
          description="O histórico é apagado permanentemente. Você pode rodar nova auditoria a qualquer momento."
          destructive
          confirmLabel="Excluir"
          loading={delAudit.isPending}
          onConfirm={() => delAudit.mutate(deleting.id, {
            onSuccess: () => { toast('Auditoria excluída', 'success'); setDeleting(null) },
            onError: (e: unknown) => toast((e as Error).message, 'danger'),
          })}
        />
      )}
    </div>
  )
}

function AuditCard({ audit, onDelete }: { audit: ConversationAudit; onDelete: () => void }) {
  if (audit.status === 'pending' || audit.status === 'running') {
    return (
      <Card class="p-3">
        <div class="flex items-center gap-2 text-xs text-fg-muted">
          <RefreshCw size={12} class="animate-spin text-accent" />
          Auditoria em execução… ({audit.status}) — atualize em alguns segundos.
        </div>
      </Card>
    )
  }
  if (audit.status === 'failed') {
    return (
      <Card class="p-3 border-danger/40 bg-danger/10">
        <div class="flex items-start gap-2">
          <AlertTriangle size={14} class="text-danger shrink-0 mt-0.5" />
          <div class="flex-1 min-w-0">
            <div class="text-sm text-fg">Falha na auditoria</div>
            <code class="text-2xs font-mono text-fg-muted break-all">{audit.errorMessage}</code>
            <div class="text-2xs text-fg-muted mt-1">{new Date(audit.createdAt).toLocaleString('pt-BR')}</div>
          </div>
          <button
            type="button"
            class="size-7 rounded-md grid place-items-center text-fg-muted hover:text-danger hover:bg-surface-3"
            onClick={onDelete} title="Excluir"
          >
            <Trash2 size={13} />
          </button>
        </div>
      </Card>
    )
  }

  return (
    <Card class="p-3">
      <div class="flex items-start justify-between gap-3">
        <div class="flex items-center gap-3">
          <div>
            <div class="text-2xs uppercase tracking-wider text-fg-muted">Score</div>
            <Badge tone={scoreTone(audit.score)} solid>
              <span class="text-base font-semibold">{audit.score ?? '—'}</span>
            </Badge>
          </div>
          {audit.tone && (
            <div>
              <div class="text-2xs uppercase tracking-wider text-fg-muted">Tom</div>
              <Badge tone={audit.tone === 'cordial' ? 'success' : audit.tone === 'agressivo' ? 'danger' : audit.tone === 'frio' ? 'warning' : 'neutral'}>
                {TONE_LABELS[audit.tone] ?? audit.tone}
              </Badge>
            </div>
          )}
          {audit.scriptAdherence !== null && (
            <div>
              <div class="text-2xs uppercase tracking-wider text-fg-muted">Roteiro</div>
              <div class="text-sm tabular-nums text-fg">{audit.scriptAdherence}%</div>
            </div>
          )}
          {audit.responseTimeAvgSec !== null && (
            <div>
              <div class="text-2xs uppercase tracking-wider text-fg-muted">Tempo médio</div>
              <div class="text-sm tabular-nums text-fg flex items-center gap-1"><Clock size={11} /> {formatSec(audit.responseTimeAvgSec)}</div>
            </div>
          )}
        </div>
        <div class="text-2xs text-fg-muted text-right shrink-0">
          {new Date(audit.createdAt).toLocaleString('pt-BR')}
          <div class="mt-0.5">{audit.messageCount} msgs · {audit.modelUsed}</div>
          <button
            type="button"
            class="mt-1 text-fg-muted hover:text-danger"
            onClick={onDelete} title="Excluir"
          >
            <Trash2 size={11} />
          </button>
        </div>
      </div>

      {audit.summary && (
        <p class="text-sm text-fg mt-3 leading-relaxed">{audit.summary}</p>
      )}

      <div class="grid gap-2 sm:grid-cols-3 mt-3 text-xs">
        {audit.strengths && audit.strengths.length > 0 && (
          <div>
            <div class="text-2xs uppercase tracking-wider text-success font-semibold mb-1 flex items-center gap-1">
              <CheckCircle2 size={10} /> Pontos fortes
            </div>
            <ul class="space-y-0.5 text-fg-muted">
              {audit.strengths.map((s, i) => <li key={i}>• {s}</li>)}
            </ul>
          </div>
        )}
        {audit.weaknesses && audit.weaknesses.length > 0 && (
          <div>
            <div class="text-2xs uppercase tracking-wider text-warning font-semibold mb-1 flex items-center gap-1">
              <AlertTriangle size={10} /> Pontos fracos
            </div>
            <ul class="space-y-0.5 text-fg-muted">
              {audit.weaknesses.map((s, i) => <li key={i}>• {s}</li>)}
            </ul>
          </div>
        )}
        {audit.missedOpportunities && audit.missedOpportunities.length > 0 && (
          <div>
            <div class="text-2xs uppercase tracking-wider text-danger font-semibold mb-1 flex items-center gap-1">
              <AlertTriangle size={10} /> Oportunidades perdidas
            </div>
            <ul class="space-y-0.5 text-fg-muted">
              {audit.missedOpportunities.map((s, i) => <li key={i}>• {s}</li>)}
            </ul>
          </div>
        )}
      </div>
    </Card>
  )
}
