import { useState } from 'preact/hooks'
import { Link } from 'wouter-preact'
import {
  Bot, Activity, Trophy, AlertTriangle, Clock, ChevronRight,
  MessageSquare, Sparkles, HelpCircle,
} from 'lucide-preact'
import { Button } from '@/components/ui/Button'
import { HowItWorksModal } from '@/components/ui/HowItWorksModal'
import {
  useConversationAudits,
  useAuditOverview,
  useOperatorAuditRanking,
  type ConversationAudit,
} from '@/hooks/useConversationAudits'
import { Page } from '@/components/ui/Page'
import { Card } from '@/components/ui/Card'
import { KpiCard } from '@/components/ui/KpiCard'
import { Badge } from '@/components/ui/Badge'
import { Skeleton } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { Input } from '@/components/ui/Input'

const intf = new Intl.NumberFormat('pt-BR')
function today(): string { return new Date().toISOString().slice(0, 10) }
function daysAgo(n: number): string {
  const d = new Date(); d.setDate(d.getDate() - n)
  return d.toISOString().slice(0, 10)
}
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
const TONE_TONES: Record<string, 'success' | 'neutral' | 'warning' | 'danger'> = {
  cordial: 'success', neutro: 'neutral', frio: 'warning', agressivo: 'danger', inconsistente: 'warning',
}

export function ConversationAuditPage() {
  const [filters, setFilters] = useState({ dateFrom: daysAgo(30), dateTo: today() })
  const [showHowItWorks, setShowHowItWorks] = useState(false)
  const overview = useAuditOverview(filters)
  const ranking = useOperatorAuditRanking(filters)
  const recent = useConversationAudits({ ...filters, limit: 50, status: 'done' })

  return (
    <Page
      title="Auditoria de Conversas"
      description="IA analisa cada conversa atendida e devolve um score 0-100, identifica oportunidades perdidas e ranqueia os operadores. Use pra coaching e feedback estruturado."
      actions={
        <Button variant="ghost" size="sm" onClick={() => setShowHowItWorks(true)}>
          <HelpCircle size={14} /> Como funciona?
        </Button>
      }
    >
      <Card class="p-3">
        <div class="flex flex-wrap items-end gap-2">
          <Input
            label="De"
            type="date"
            value={filters.dateFrom}
            onInput={(e) => setFilters(f => ({ ...f, dateFrom: (e.target as HTMLInputElement).value }))}
          />
          <Input
            label="Até"
            type="date"
            value={filters.dateTo}
            onInput={(e) => setFilters(f => ({ ...f, dateTo: (e.target as HTMLInputElement).value }))}
          />
          <div class="flex items-center gap-1.5 ml-auto text-xs text-fg-muted">
            <Sparkles size={12} /> Auditorias rodam em background via fila BullMQ — atualize a página em alguns segundos pra ver novas
          </div>
        </div>
      </Card>

      <section class="grid gap-3 grid-cols-2 lg:grid-cols-4 mt-3">
        {overview.isLoading || !overview.data ? Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} class="h-20 w-full" />) : (
          <>
            <KpiCard
              label="Total no período"
              value={intf.format(overview.data.totals.total)}
              icon={<Activity size={16} />}
              hint={`${overview.data.totals.done} concluídas · ${overview.data.totals.failed} falharam`}
            />
            <KpiCard
              label="Score médio"
              value={overview.data.averages.score !== null ? `${overview.data.averages.score}` : '—'}
              icon={<Trophy size={16} />}
              hint={overview.data.averages.score !== null ? (overview.data.averages.score >= 75 ? 'Acima da média' : overview.data.averages.score >= 60 ? 'Atenção' : 'Crítico') : ''}
            />
            <KpiCard
              label="Conversas com score baixo"
              value={intf.format(overview.data.totals.lowScore)}
              icon={<AlertTriangle size={16} />}
              hint="Score < 60 (precisam de coaching)"
            />
            <KpiCard
              label="Tempo médio de resposta"
              value={formatSec(overview.data.averages.responseTimeSec)}
              icon={<Clock size={16} />}
              hint="Cliente → primeira resposta nossa"
            />
          </>
        )}
      </section>

      {/* Tom predominante */}
      {overview.data && overview.data.toneBreakdown.length > 0 && (
        <Card class="p-3 mt-3">
          <div class="text-xs uppercase tracking-wider text-fg-subtle font-semibold mb-2 flex items-center gap-1">
            <MessageSquare size={11} /> Tom predominante das auditorias
          </div>
          <div class="flex flex-wrap gap-2">
            {overview.data.toneBreakdown
              .sort((a, b) => b.count - a.count)
              .map(t => (
                <div key={t.tone} class="text-xs flex items-center gap-1.5">
                  <Badge tone={TONE_TONES[t.tone] ?? 'neutral'} solid>{TONE_LABELS[t.tone] ?? t.tone}</Badge>
                  <span class="text-fg tabular-nums">{intf.format(t.count)}</span>
                </div>
              ))}
          </div>
        </Card>
      )}

      {/* Ranking por operador */}
      <Card class="p-3 mt-3">
        <div class="text-xs uppercase tracking-wider text-fg-subtle font-semibold mb-2 flex items-center gap-1">
          <Trophy size={11} /> Ranking de operadores no período
        </div>
        {ranking.isLoading && <Skeleton class="h-32 w-full" />}
        {!ranking.isLoading && (!ranking.data || ranking.data.data.length === 0) && (
          <div class="text-xs text-fg-muted py-4">Nenhuma auditoria com operador identificado no período. Rode auditorias em leads com atendimento atribuído.</div>
        )}
        {!ranking.isLoading && ranking.data && ranking.data.data.length > 0 && (
          <div class="overflow-x-auto">
            <table class="w-full text-xs">
              <thead class="text-fg-muted">
                <tr>
                  <th class="text-left py-1.5">#</th>
                  <th class="text-left py-1.5">Operador</th>
                  <th class="text-right py-1.5">Auditorias</th>
                  <th class="text-right py-1.5">Score médio</th>
                  <th class="text-right py-1.5">Mín</th>
                  <th class="text-right py-1.5">Máx</th>
                  <th class="text-right py-1.5">Tempo médio</th>
                  <th class="text-left py-1.5 pl-2">Tom dominante</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-border">
                {ranking.data.data.map((r, i) => (
                  <tr key={r.operatorId}>
                    <td class="py-1.5 text-fg-subtle tabular-nums">{i + 1}</td>
                    <td class="py-1.5 text-fg">{r.operatorName || `#${r.operatorId}`}</td>
                    <td class="py-1.5 text-right tabular-nums text-fg-muted">{intf.format(r.audits)}</td>
                    <td class="py-1.5 text-right tabular-nums">
                      <Badge tone={scoreTone(r.avgScore)} solid>{r.avgScore ?? '—'}</Badge>
                    </td>
                    <td class="py-1.5 text-right tabular-nums text-fg-muted">{r.minScore ?? '—'}</td>
                    <td class="py-1.5 text-right tabular-nums text-fg-muted">{r.maxScore ?? '—'}</td>
                    <td class="py-1.5 text-right tabular-nums text-fg-muted">{formatSec(r.avgResponseTimeSec)}</td>
                    <td class="py-1.5 pl-2">
                      {r.dominantTone ? <Badge tone={TONE_TONES[r.dominantTone] ?? 'neutral'}>{TONE_LABELS[r.dominantTone] ?? r.dominantTone}</Badge> : <span class="text-fg-subtle">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Lista de auditorias recentes */}
      <Card class="p-3 mt-3">
        <div class="text-xs uppercase tracking-wider text-fg-subtle font-semibold mb-2 flex items-center gap-1">
          <Activity size={11} /> Auditorias recentes ({recent.data?.total ?? 0})
        </div>
        {recent.isLoading && Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} class="h-16 w-full mb-2" />)}
        {!recent.isLoading && (!recent.data || recent.data.data.length === 0) && (
          <EmptyState
            icon={<Bot size={20} />}
            title="Nenhuma auditoria no período"
            description="Para gerar a primeira auditoria, abra o detalhe de um lead com conversa e clique em 'Auditar conversa' na aba Auditoria IA."
          />
        )}
        {!recent.isLoading && recent.data && recent.data.data.length > 0 && (
          <ul class="divide-y divide-border">
            {recent.data.data.map(a => <AuditRow key={a.id} audit={a} />)}
          </ul>
        )}
      </Card>

      <HowItWorksModal
        open={showHowItWorks}
        onClose={() => setShowHowItWorks(false)}
        title="Como funciona a Auditoria de Conversas?"
        problem={<>
          Gestor não escuta todas as conversas que sua equipe tem com clientes. Sem isso, treinamento
          vira chute. A IA <strong>lê cada conversa</strong> automaticamente e devolve nota, identifica
          o que faltou (resposta lenta, falta de pergunta-chave, tom ruim, oportunidade ignorada) e
          ranqueia os vendedores.
        </>}
        steps={[
          {
            title: '🤖 A IA audita sozinha',
            body: <>Conversas finalizadas (atendimento encerrado, lead ganhou/perdeu, ou ficou inativo por X dias) entram na fila de auditoria. A IA lê o histórico inteiro e gera um relatório.</>,
          },
          {
            title: '🎯 Score 0-100 por conversa',
            body: <>A nota considera: tempo de resposta, completude (perguntou tudo que precisava?), tom, oportunidade aproveitada, fechamento. Score <strong>verde (≥80)</strong> = ótimo, <strong>amarelo (60-79)</strong> = ok, <strong>vermelho</strong> = problema.</>,
          },
          {
            title: '🧠 Identifica oportunidades perdidas',
            body: <>"Cliente perguntou desconto e operador não negociou", "Cliente mencionou prazo e ninguém anotou", "Operador não fez fechamento". Vira lista acionável pra coaching individual.</>,
          },
          {
            title: '🏆 Ranking por operador',
            body: <>Tabela ordenada por score médio do operador no período. Identifica os top performers (pra reconhecer e replicar) e os que precisam de ajuda.</>,
          },
          {
            title: '🔍 Drill em uma conversa',
            body: <>Clica numa auditoria pra ver: trecho da conversa, análise da IA passo a passo, tom detectado, recomendações. Material pronto pra usar no one-on-one.</>,
          },
        ]}
        tip={{
          tone: 'info',
          title: '💡 Use como ferramenta de coaching',
          body: <>Não vire ferramenta de punição — vire ferramenta de melhoria. Apresente o score como <em>"olha o que a IA viu"</em> e use os pontos identificados pra treinar, não pra demitir. Score baixo geralmente é falta de treinamento, não preguiça.</>,
        }}
      />
    </Page>
  )
}

function AuditRow({ audit }: { audit: ConversationAudit }) {
  return (
    <li class="py-2 flex items-start gap-3">
      <div class="shrink-0 w-12">
        {audit.score !== null ? (
          <Badge tone={scoreTone(audit.score)} solid>{audit.score}</Badge>
        ) : audit.status === 'failed' ? (
          <Badge tone="danger" solid>—</Badge>
        ) : (
          <Badge tone="neutral">…</Badge>
        )}
      </div>
      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-2 flex-wrap">
          <Link
            href={`/leads/${audit.leadId}/audit`}
            class="text-sm font-medium text-fg hover:text-accent truncate"
          >
            {audit.lead?.nome || `Lead #${audit.leadId}`}
          </Link>
          {audit.operatorName && <span class="text-xs text-fg-muted">· {audit.operatorName}</span>}
          {audit.tone && <Badge tone={TONE_TONES[audit.tone] ?? 'neutral'}>{TONE_LABELS[audit.tone] ?? audit.tone}</Badge>}
          {audit.status === 'failed' && <Badge tone="danger">falhou</Badge>}
        </div>
        {audit.summary && <p class="text-xs text-fg-muted mt-0.5 line-clamp-2">{audit.summary}</p>}
        {audit.status === 'failed' && audit.errorMessage && (
          <p class="text-xs text-danger mt-0.5 line-clamp-2">{audit.errorMessage}</p>
        )}
        <div class="text-[0.6875rem] text-fg-subtle mt-1 flex gap-3">
          <span>{new Date(audit.createdAt).toLocaleString('pt-BR')}</span>
          <span>{audit.messageCount} mensagens</span>
          {audit.responseTimeAvgSec !== null && <span>resposta média {formatSec(audit.responseTimeAvgSec)}</span>}
          {audit.modelUsed && <span>{audit.modelUsed}</span>}
        </div>
      </div>
      <ChevronRight size={14} class="text-fg-subtle mt-2" />
    </li>
  )
}
