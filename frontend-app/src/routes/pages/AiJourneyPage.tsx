import { useState } from 'preact/hooks'
import { Link } from 'wouter-preact'
import {
  Sparkles, ChevronRight, CheckCircle2, XCircle, HelpCircle,
} from 'lucide-preact'
import { HowItWorksModal } from '@/components/ui/HowItWorksModal'
import {
  useStageSuggestions,
  useApplySuggestion,
  useRejectSuggestion,
  type StageSuggestion,
} from '@/hooks/useAiJourney'
import { useFunnels } from '@/hooks/useFunnels'
import { Page } from '@/components/ui/Page'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Skeleton } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { Select } from '@/components/ui/Input'
import { toast } from '@/lib/toast'

export function AiJourneyPage() {
  const [funnelId, setFunnelId] = useState<number | undefined>(undefined)
  const [status, setStatus] = useState<'pending' | 'applied' | 'rejected'>('pending')
  const [showHowItWorks, setShowHowItWorks] = useState(false)
  const { data: funnels } = useFunnels()
  const suggestionsQ = useStageSuggestions({ status, funnelId, limit: 100 })
  const apply = useApplySuggestion()
  const reject = useRejectSuggestion()

  return (
    <Page
      title="Jornada Automática por IA"
      description="A IA analisa as conversas dos leads e sugere a etapa apropriada do funil. Sugestões com alta confiança podem ser aplicadas automaticamente; o restante fica pra sua revisão aqui."
      actions={
        <Button variant="ghost" size="sm" onClick={() => setShowHowItWorks(true)}>
          <HelpCircle size={14} /> Como funciona?
        </Button>
      }
    >
      <Card class="p-3 bg-info/5 border-info/30">
        <div class="flex items-start gap-2 text-xs">
          <Sparkles size={14} class="text-accent shrink-0 mt-0.5" />
          <div class="flex-1">
            Configure a Jornada IA por funil em <Link href="/funnels" class="underline text-accent">Funis</Link> (toggle, auto-aplicar, threshold de confiança, prompt customizado).
            A IA roda automaticamente após cada nova mensagem do lead (debounce 60s).
          </div>
        </div>
      </Card>

      <Card class="p-3 mt-3">
        <div class="flex flex-wrap items-end gap-2">
          <Select
            label="Funil"
            value={funnelId ?? ''}
            onChange={(e) => {
              const v = (e.target as HTMLSelectElement).value
              setFunnelId(v ? Number(v) : undefined)
            }}
          >
            <option value="">Todos</option>
            {funnels?.funnels?.map((f: any) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </Select>
          <div class="flex items-center gap-1">
            {(['pending', 'applied', 'rejected'] as const).map(s => (
              <button
                key={s}
                type="button"
                onClick={() => setStatus(s)}
                class={`h-8 px-3 rounded-md text-xs font-medium border ${status === s ? 'bg-accent text-white border-accent' : 'bg-surface text-fg-muted border-border hover:bg-surface-2'}`}
              >
                {s === 'pending' ? 'Pendentes' : s === 'applied' ? 'Aplicadas' : 'Rejeitadas'}
              </button>
            ))}
          </div>
        </div>
      </Card>

      <div class="mt-3 space-y-2">
        {suggestionsQ.isLoading && Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} class="h-24 w-full" />)}
        {!suggestionsQ.isLoading && (!suggestionsQ.data || suggestionsQ.data.data.length === 0) && (
          <EmptyState
            icon={<Sparkles size={20} />}
            title={status === 'pending' ? 'Sem sugestões pendentes' : `Sem sugestões ${status === 'applied' ? 'aplicadas' : 'rejeitadas'}`}
            description={status === 'pending'
              ? 'Quando a IA analisar um lead e a confidence ficar abaixo do threshold do funil (ou auto-apply estiver off), a sugestão aparecerá aqui pra você revisar.'
              : 'Histórico de decisões aparece aqui.'}
          />
        )}
        {!suggestionsQ.isLoading && suggestionsQ.data && suggestionsQ.data.data.map(s => (
          <SuggestionRow
            key={s.id}
            suggestion={s}
            canDecide={s.status === 'pending'}
            onApply={() => apply.mutate({ id: s.id }, {
              onSuccess: () => toast('Lead movido para a etapa sugerida', 'success'),
              onError: (e: unknown) => toast((e as Error).message, 'danger'),
            })}
            onReject={() => reject.mutate({ id: s.id }, {
              onSuccess: () => toast('Sugestão rejeitada', 'success'),
              onError: (e: unknown) => toast((e as Error).message, 'danger'),
            })}
          />
        ))}
      </div>

      <HowItWorksModal
        open={showHowItWorks}
        onClose={() => setShowHowItWorks(false)}
        title="Como funciona a Jornada Automática por IA?"
        problem={<>
          Etapa do funil deveria refletir <em>onde o lead realmente está</em>. Mas vendedor esquece de
          mover, conversa segue e o status fica desatualizado. A IA escuta a conversa, entende o
          momento ("já mandou proposta", "está negociando preço", "fechou") e <strong>sugere a etapa
          correta</strong> — você revisa ou deixa aplicar sozinho.
        </>}
        steps={[
          {
            title: '🎙️ A IA escuta cada nova mensagem',
            body: <>A cada mensagem nova do lead (debounce 60s pra não rodar a cada palavra), a IA lê a conversa inteira e tenta deduzir em qual etapa do funil o lead deveria estar. Há um intervalo mínimo entre duas análises do mesmo lead, pra ele não ser reclassificado a cada pausa da conversa.</>,
          },
          {
            title: '🔁 E revisita quem ficou parado',
            body: <>De tempos em tempos a Jornada reavalia leads com sugestão parada e recolhe as que o tempo venceu. Assim que alguém move o lead — bot, fluxo ou você no kanban — a sugestão pendente é descartada na hora: ela descrevia um estado que não existe mais.</>,
          },
          {
            title: '⚙️ Configure por funil',
            body: <>Em <strong>Funis</strong>, cada funil tem opção de ligar a Jornada IA, definir <strong>threshold de confiança</strong> (ex.: 85% pra auto-aplicar) e um <strong>prompt customizado</strong> (descreva como a IA deve interpretar cada etapa).</>,
          },
          {
            title: '🤖 Auto-aplica ou pede revisão',
            body: <>Sugestão acima do threshold: <strong>aplica sozinha</strong> e o lead muda de etapa. Abaixo: fica aqui como <strong>Pendente</strong> aguardando seu Aplicar/Rejeitar.</>,
          },
          {
            title: '✅ Você revisa as pendentes',
            body: <>Lista de sugestões com: nome do lead, etapa atual → etapa sugerida, confiança (%), trecho da conversa que motivou. "Aplicar" move o lead — e recusa a movimentação se ele já estiver numa etapa igual ou mais adiantada. "Rejeitar" descarta a sugestão. Quando a IA conclui que o contato não é deste funil, ela marca <strong>fora do funil</strong> em vez de escolher uma etapa qualquer.</>,
          },
          {
            title: '📚 Histórico applied/rejected',
            body: <>Filtre por Aplicadas ou Rejeitadas pra revisitar decisões anteriores. Útil pra calibrar o threshold (se está rejeitando muita coisa, baixe; se está aplicando errado, suba).</>,
          },
        ]}
        tip={{
          tone: 'warning',
          title: '⚠️ Comece em modo manual',
          body: <>Antes de ligar auto-apply, deixe rodando em modo só sugestão por algumas semanas. Veja como a IA decide. Quando estiver confortável (taxa de rejeição &lt;5%), suba pro automático.</>,
        }}
      />
    </Page>
  )
}

function SuggestionRow({ suggestion, canDecide, onApply, onReject }: {
  suggestion: StageSuggestion
  canDecide: boolean
  onApply: () => void
  onReject: () => void
}) {
  const fromName = suggestion.funnel?.stages?.find(s => s.key === suggestion.fromStageKey)?.name ?? suggestion.fromStageKey ?? '—'
  const toName = suggestion.funnel?.stages?.find(s => s.key === suggestion.suggestedStageKey)?.name ?? suggestion.suggestedStageKey
  const tone = suggestion.confidence >= 80 ? 'success' : suggestion.confidence >= 60 ? 'warning' : 'danger'
  // 'not_in_funnel': a IA concluiu que o contato não pertence a este funil. Não
  // há etapa a aplicar — quem decide o destino é o operador, no card do lead.
  const notInFunnel = suggestion.kind === 'not_in_funnel'

  return (
    <Card class="p-3">
      <div class="flex items-start justify-between gap-3">
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2 flex-wrap mb-1">
            <Link href={`/leads/${suggestion.leadId}/jornada`} class="text-sm font-medium text-fg hover:text-accent">
              {suggestion.lead?.nome || `Lead #${suggestion.leadId}`}
            </Link>
            <Badge tone={tone} solid>{suggestion.confidence}% confiança</Badge>
            {suggestion.status === 'applied' && <Badge tone="success">aplicada</Badge>}
            {suggestion.status === 'rejected' && <Badge tone="danger">rejeitada</Badge>}
            {suggestion.status === 'superseded' && <Badge tone="neutral">substituída</Badge>}
            {notInFunnel && <Badge tone="warning">fora do funil</Badge>}
          </div>
          <div class="text-xs text-fg-muted mb-1">
            {notInFunnel ? (
              <>Não pertence a <strong class="text-fg">{suggestion.funnel?.name}</strong> — está em <code class="font-mono">{fromName}</code></>
            ) : (
              <>
                <code class="font-mono">{fromName}</code> <ChevronRight size={11} class="inline" /> <strong class="text-fg">{toName}</strong>
                {' · '}<span class="text-fg-subtle">{suggestion.funnel?.name}</span>
              </>
            )}
          </div>
          {suggestion.reasoning && <p class="text-xs text-fg leading-relaxed">{suggestion.reasoning}</p>}
          <div class="text-[0.6875rem] text-fg-subtle mt-1">
            {new Date(suggestion.createdAt).toLocaleString('pt-BR')}
            {suggestion.modelUsed && ` · ${suggestion.modelUsed}`}
            {suggestion.decisionNote && ` · "${suggestion.decisionNote}"`}
          </div>
        </div>
        {canDecide && (
          <div class="flex flex-col gap-1 shrink-0">
            {!notInFunnel && (
              <Button variant="primary" size="sm" onClick={onApply}>
                <CheckCircle2 size={12} /> Aplicar
              </Button>
            )}
            {notInFunnel && (
              <Link href={`/leads/${suggestion.leadId}`} class="text-xs text-accent hover:underline whitespace-nowrap">
                Abrir lead
              </Link>
            )}
            <Button variant="secondary" size="sm" onClick={onReject}>
              <XCircle size={12} /> {notInFunnel ? 'Descartar' : 'Rejeitar'}
            </Button>
          </div>
        )}
      </div>
    </Card>
  )
}
