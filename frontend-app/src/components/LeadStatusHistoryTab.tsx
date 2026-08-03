// Histórico de resumos do lead — a trilha de como o atendimento foi classificado
// ao longo do tempo, com o que cada mudança provocou.
//
// Existe separado da Timeline porque responde outra pergunta: a Timeline conta
// tudo que aconteceu; aqui só interessa a sequência de situações e seus efeitos
// (foi para qual etapa, quantas atividades nasceram, virou ganho/perdido).

import { Tag, ArrowRight, ListChecks, CheckCircle2, Trophy, XCircle, Bot, User } from 'lucide-preact'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Skeleton } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { useLeadStatusHistory, type LeadStatusHistoryEntry } from '@/hooks/useStatusSummaries'

const SOURCE_LABELS: Record<string, string> = {
  panel: 'Painel',
  workflow: 'Fluxo automático',
  chatbot: 'Chatbot',
  api: 'API',
  auto_advance: 'Avanço automático',
  import: 'Importação',
  seed: 'Carga inicial',
}

function fmt(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

export function LeadStatusHistoryTab({ leadId }: { leadId: number }) {
  const { data, isLoading } = useLeadStatusHistory(leadId)
  const rows = data?.data ?? []

  if (isLoading) return <Skeleton class="h-64 w-full" />

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<Tag size={20} />}
        title="Nenhum resumo registrado"
        description="Quando alguém classificar a situação deste atendimento, o histórico aparece aqui."
      />
    )
  }

  return (
    <Card>
      <ul class="divide-y divide-border">
        {rows.map((e) => <HistoryRow key={e.id} entry={e} />)}
      </ul>
    </Card>
  )
}

function HistoryRow({ entry }: { entry: LeadStatusHistoryEntry }) {
  const eff = entry.effects
  const color = entry.toSummary?.color || '#94a3b8'
  const auto = entry.source === 'auto_advance' || entry.source === 'workflow'

  return (
    <li class="py-3 flex gap-3">
      <span class="size-2.5 rounded-full mt-1.5 shrink-0" style={{ background: color }} />
      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-2 flex-wrap">
          {entry.fromCode && (
            <>
              <code class="text-xs font-mono text-fg-subtle">{entry.fromCode}</code>
              <ArrowRight size={11} class="text-fg-subtle" />
            </>
          )}
          <code class="text-xs font-mono px-1.5 py-0.5 rounded bg-surface-2 text-fg">{entry.toCode}</code>
          <span class="text-sm text-fg truncate">{entry.toSummary?.name ?? ''}</span>
          {entry.toSummary?.sector && <Badge tone="neutral">{entry.toSummary.sector}</Badge>}
        </div>

        {eff && (
          <ul class="mt-1.5 space-y-1 text-xs text-fg-muted">
            {eff.movedStage?.to && (
              <li class="flex items-center gap-1.5">
                <ArrowRight size={11} />
                Etapa: {eff.movedStage.from ?? '—'} → <strong class="text-fg">{eff.movedStage.to}</strong>
              </li>
            )}
            {eff.closedActivities > 0 && (
              <li class="flex items-center gap-1.5">
                <CheckCircle2 size={11} /> {eff.closedActivities} atividade(s) concluída(s)
              </li>
            )}
            {eff.createdActivityIds.length > 0 && (
              <li class="flex items-center gap-1.5">
                <ListChecks size={11} /> {eff.createdActivityIds.length} atividade(s) criada(s)
              </li>
            )}
            {eff.outcomeApplied === 'won' && (
              <li class="flex items-center gap-1.5 text-success"><Trophy size={11} /> Marcado como Ganho</li>
            )}
            {eff.outcomeApplied === 'lost' && (
              <li class="flex items-center gap-1.5 text-danger"><XCircle size={11} /> Marcado como Perdido</li>
            )}
          </ul>
        )}

        {entry.note && <p class="mt-1.5 text-xs text-fg-muted italic">"{entry.note}"</p>}

        <div class="mt-1.5 flex items-center gap-2 text-xs text-fg-subtle flex-wrap">
          <span>{fmt(entry.changedAt)}</span>
          <span>·</span>
          <span class="inline-flex items-center gap-1">
            {auto ? <Bot size={11} /> : <User size={11} />}
            {entry.changedByUser?.name || entry.changedByUser?.email || SOURCE_LABELS[entry.source ?? ''] || 'Sistema'}
          </span>
          {entry.changedByUser && entry.source && (
            <>
              <span>·</span>
              <span>{SOURCE_LABELS[entry.source] ?? entry.source}</span>
            </>
          )}
        </div>
      </div>
    </li>
  )
}
