// Aba "Jornada IA" do detalhe do lead — sugestões de ETAPA do funil feitas pela
// IA a partir das conversas deste lead. Aplicar = move o lead de etapa; Rejeitar
// = descarta. (Diferente de "Auditoria de Conversas", que avalia a QUALIDADE do
// atendimento.) Reusa os mesmos endpoints da página Jornada IA.
import { Bot, CheckCircle2, XCircle, ChevronRight } from 'lucide-preact'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Skeleton } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import {
  useLeadStageSuggestions, useApplySuggestion, useRejectSuggestion, type StageSuggestion,
} from '@/hooks/useAiJourney'
import { toast } from '@/lib/toast'

function toneFor(c: number): 'success' | 'warning' | 'danger' {
  return c >= 80 ? 'success' : c >= 60 ? 'warning' : 'danger'
}

export function LeadJourneyTab({ leadId }: { leadId: number }) {
  const q = useLeadStageSuggestions(leadId)
  const apply = useApplySuggestion()
  const reject = useRejectSuggestion()
  const suggestions = q.data?.data ?? []

  if (q.isLoading) return <Skeleton class="h-40 w-full" />

  return (
    <div class="space-y-3">
      <Card class="p-4">
        <div class="flex items-center gap-2 text-sm font-semibold text-fg">
          <Bot size={15} class="text-accent" /> Jornada Automática por IA
        </div>
        <p class="mt-1 text-xs text-fg-muted">
          A IA leu as conversas deste lead e sugere mover de etapa no funil. <strong>Aplicar</strong> move o
          lead; <strong>Rejeitar</strong> descarta (não altera o lead).
        </p>
      </Card>

      {suggestions.length === 0 ? (
        <EmptyState
          icon={<Bot size={22} />}
          title="Sem sugestões da IA para este lead"
          description="Quando a IA analisar as conversas e sugerir uma etapa, ela aparece aqui (ou já é aplicada sozinha, se a confiança passar do limite do funil)."
        />
      ) : (
        suggestions.map((s) => <SuggestionRow key={s.id} s={s}
          onApply={() => apply.mutate({ id: s.id }, {
            onSuccess: () => toast('Sugestão aplicada — lead movido de etapa', 'success'),
            onError: (e: unknown) => toast((e as Error).message, 'danger'),
          })}
          onReject={() => reject.mutate({ id: s.id }, {
            onSuccess: () => toast('Sugestão rejeitada', 'success'),
            onError: (e: unknown) => toast((e as Error).message, 'danger'),
          })}
        />)
      )}
    </div>
  )
}

function SuggestionRow({ s, onApply, onReject }: { s: StageSuggestion; onApply: () => void; onReject: () => void }) {
  const fromName = s.funnel?.stages?.find((x) => x.key === s.fromStageKey)?.name ?? s.fromStageKey ?? '—'
  const toName = s.funnel?.stages?.find((x) => x.key === s.suggestedStageKey)?.name ?? s.suggestedStageKey

  return (
    <Card class="p-3">
      <div class="flex items-start justify-between gap-3">
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2 flex-wrap mb-1">
            <Badge tone={toneFor(s.confidence)} solid>{s.confidence}% confiança</Badge>
            {s.status === 'applied' && <Badge tone="success">aplicada</Badge>}
            {s.status === 'rejected' && <Badge tone="danger">rejeitada</Badge>}
            {s.status === 'superseded' && <Badge tone="neutral">substituída</Badge>}
            {s.kind === 'not_in_funnel' && <Badge tone="warning">fora do funil</Badge>}
          </div>
          <div class="text-xs text-fg-muted mb-1">
            {s.kind === 'not_in_funnel' ? (
              <>Não pertence a <strong class="text-fg">{s.funnel?.name ?? 'este funil'}</strong> — está em <code class="font-mono">{fromName}</code></>
            ) : (
              <>
                <code class="font-mono">{fromName}</code> <ChevronRight size={11} class="inline" /> <strong class="text-fg">{toName}</strong>
                {s.funnel?.name ? <span class="text-fg-subtle">{' · '}{s.funnel.name}</span> : null}
              </>
            )}
          </div>
          {s.reasoning && <p class="text-xs text-fg leading-relaxed">{s.reasoning}</p>}
          <div class="text-[0.6875rem] text-fg-subtle mt-1">
            {new Date(s.createdAt).toLocaleString('pt-BR')}
            {s.modelUsed ? ` · ${s.modelUsed}` : ''}
            {s.decisionNote ? ` · "${s.decisionNote}"` : ''}
          </div>
        </div>
        {s.status === 'pending' && (
          <div class="flex flex-col gap-1 shrink-0">
            {s.kind !== 'not_in_funnel' && (
              <Button variant="primary" size="sm" onClick={onApply}>
                <CheckCircle2 size={12} /> Aplicar
              </Button>
            )}
            <Button variant="secondary" size="sm" onClick={onReject}>
              <XCircle size={12} /> {s.kind === 'not_in_funnel' ? 'Descartar' : 'Rejeitar'}
            </Button>
          </div>
        )}
      </div>
    </Card>
  )
}
