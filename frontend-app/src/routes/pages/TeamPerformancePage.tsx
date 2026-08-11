import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { useQueryClient } from '@tanstack/react-query'
import {
  Users, Trophy, Clock, Timer, Target, BarChart3, MessageSquare,
  CheckCircle2, AlertTriangle, ListChecks, DollarSign, Star, Activity, Zap,
  TrendingUp, ArrowRightLeft, HelpCircle, Pencil, Check, X as XIcon,
} from 'lucide-preact'
import { Button } from '@/components/ui/Button'
import { HowItWorksModal } from '@/components/ui/HowItWorksModal'
import { Page } from '@/components/ui/Page'
import { Card } from '@/components/ui/Card'
import { Skeleton } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { KpiCard } from '@/components/ui/KpiCard'
import { Modal } from '@/components/ui/Modal'
import { Select, Input } from '@/components/ui/Input'
import { Badge } from '@/components/ui/Badge'
import { useTeams } from '@/hooks/useTeams'
import { useFunnels } from '@/hooks/useFunnels'
import { useUsers, useUpdateUser } from '@/hooks/useUsers'
import {
  useTeamMetrics,
  useOperatorBreakdown,
  useTeamWorkload,
  type TeamMetricsOperator,
} from '@/hooks/useTeamMetrics'
import { useUserStore } from '@/stores/user'
import { toast } from '@/lib/toast'
import { presetRange, presetLabel, type RangePreset } from '@/components/ui/PeriodPicker'
import { useSlaMetrics, useSlaTarget, useSetSlaTarget } from '@/hooks/useRouting'
import { ApiError } from '@/lib/apiClient'

// Períodos: meses fechados, como no resto do sistema (ver PeriodPicker).
const PRESETS: { value: RangePreset; label: string }[] = [
  { value: 'm0', label: presetLabel('m0') },
  { value: 'm1', label: presetLabel('m1') },
  { value: 'm2', label: presetLabel('m2') },
  { value: 'm3', label: presetLabel('m3') },
  { value: 'm4', label: presetLabel('m4') },
  { value: 'custom', label: 'Período personalizado' },
]

const QUALIFICATION_SOURCES: { value: string; label: string }[] = [
  { value: 'form', label: 'Formulário' },
  { value: 'scheduling', label: 'Agendamento' },
  { value: 'enrollment_portal', label: 'Portal de Matrículas' },
  { value: 'meta_lead_ads', label: 'Meta Lead Ads' },
  { value: 'web_chat_completed', label: 'Chat Web (concluiu)' },
  { value: 'chatbot_completed', label: 'Chatbot (concluiu)' },
  { value: 'make', label: 'Make.com' },
  { value: 'api', label: 'API' },
  { value: 'manual', label: 'Manual' },
]

const STATUS_LABELS: Record<TeamMetricsOperator['workStatus'], string> = {
  available: 'Disponível',
  away: 'Ausente',
  busy: 'Em pausa',
  offline: 'Offline',
}
const STATUS_COLORS: Record<TeamMetricsOperator['workStatus'], string> = {
  available: '#22c55e',
  away: '#f59e0b',
  busy: '#dc2626',
  offline: '#9ca3af',
}

function formatMs(ms: number | null): string {
  if (ms === null) return '—'
  const totalSec = Math.round(ms / 1000)
  if (totalSec < 60) return `${totalSec}s`
  const min = Math.floor(totalSec / 60)
  const sec = totalSec % 60
  if (min < 60) return sec > 0 ? `${min}m ${sec}s` : `${min}m`
  const hr = Math.floor(min / 60)
  const remMin = min % 60
  return remMin > 0 ? `${hr}h ${remMin}m` : `${hr}h`
}

function formatBRL(value: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(value || 0)
}

export function TeamPerformancePage() {
  const [periodPreset, setPeriodPreset] = useState<string>('m0')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [teamId, setTeamId] = useState<string>('')
  const [userId, setUserId] = useState<string>('')
  const [funnelId, setFunnelId] = useState<string>('')
  const [qualSource, setQualSource] = useState<string>('')
  const [drillUserId, setDrillUserId] = useState<number | null>(null)
  const [showHowItWorks, setShowHowItWorks] = useState(false)

  const { data: teamsData } = useTeams()
  const teams = (teamsData?.teams ?? []).filter((t) => t.active)
  const { data: usersData } = useUsers()
  // Operadores = mesma regra do backend (Roteamento de Leads > Agentes):
  // role AGENT OU qualquer perfil com o toggle isAgent ligado.
  const users = (usersData?.users ?? []).filter((u) => u.active && (u.role === 'AGENT' || u.isAgent))
  const { data: funnelsData } = useFunnels()
  const funnels = funnelsData?.funnels ?? []

  const { from, to } = useMemo(() => {
    const r = presetRange(periodPreset as RangePreset, { from: customFrom, to: customTo })
    return {
      from: new Date(r.dateFrom + 'T00:00:00').toISOString(),
      to: new Date(r.dateTo + 'T23:59:59').toISOString(),
    }
  }, [periodPreset, customFrom, customTo])

  const { data, isLoading } = useTeamMetrics({
    from,
    to,
    teamId: teamId ? Number(teamId) : null,
    userId: userId ? Number(userId) : null,
    funnelId: funnelId ? Number(funnelId) : null,
    qualificationSource: qualSource || null,
  })

  const { data: workload } = useTeamWorkload(teamId ? Number(teamId) : null)

  const operators = data?.operators ?? []
  const totals = data?.totals

  const drillOperator = drillUserId !== null ? operators.find((o) => o.userId === drillUserId) ?? null : null

  return (
    <Page
      title="Performance da Equipe"
      description="Métricas individuais por operador no período: volume, conversão, receita, tempos de resposta e produtividade."
      actions={
        <Button variant="ghost" size="sm" onClick={() => setShowHowItWorks(true)}>
          <HelpCircle size={14} /> Como funciona?
        </Button>
      }
    >
      {/* Filtros */}
      <Card class="p-4 mb-4">
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-x-4 gap-y-3">
          <Select
            label="Período"
            value={periodPreset}
            onChange={(e) => setPeriodPreset((e.target as HTMLSelectElement).value)}
            class="w-full"
          >
            {PRESETS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </Select>
          <Select
            label="Equipe"
            value={teamId}
            onChange={(e) => setTeamId((e.target as HTMLSelectElement).value)}
            class="w-full"
          >
            <option value="">Todas</option>
            {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </Select>
          <Select
            label="Operador"
            value={userId}
            onChange={(e) => setUserId((e.target as HTMLSelectElement).value)}
            class="w-full"
          >
            <option value="">Todos</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>{u.name ?? u.email}</option>
            ))}
          </Select>
          <Select
            label="Funil"
            value={funnelId}
            onChange={(e) => setFunnelId((e.target as HTMLSelectElement).value)}
            class="w-full"
          >
            <option value="">Todos</option>
            {funnels.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </Select>
          <Select
            label="Origem"
            value={qualSource}
            onChange={(e) => setQualSource((e.target as HTMLSelectElement).value)}
            class="w-full"
          >
            <option value="">Todas</option>
            {QUALIFICATION_SOURCES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </Select>
        </div>
        {periodPreset === 'custom' && (
          <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-x-4 gap-y-3 mt-3 pt-3 border-t border-border">
            <Input
              label="De"
              type="date"
              value={customFrom}
              onInput={(e) => setCustomFrom((e.target as HTMLInputElement).value)}
              class="w-full"
            />
            <Input
              label="Até"
              type="date"
              value={customTo}
              onInput={(e) => setCustomTo((e.target as HTMLInputElement).value)}
              class="w-full"
            />
          </div>
        )}
      </Card>

      {/* KPIs principais — Volume + Conversão + Receita */}
      <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-3">
        <KpiCard
          label="Operadores"
          value={totals?.operators ?? 0}
          hint="Com pelo menos 1 lead atendido"
          icon={<Users size={16} />}
          loading={isLoading}
        />
        <KpiCard
          label="Leads atendidos"
          value={totals?.leadsAttended ?? 0}
          icon={<Target size={16} />}
          loading={isLoading}
        />
        <KpiCard
          label="Ganhos (won)"
          value={totals?.leadsWon ?? 0}
          hint={totals && totals.leadsAttended > 0 ? `${totals.winRate}% de conversão` : undefined}
          icon={<Trophy size={16} />}
          loading={isLoading}
        />
        <KpiCard
          label="Receita gerada"
          value={formatBRL(totals?.revenue ?? 0)}
          hint={totals && totals.salesCount > 0 ? `${totals.salesCount} vendas` : 'Sem vendas no período'}
          icon={<DollarSign size={16} />}
          loading={isLoading}
        />
        <KpiCard
          label="Ticket médio"
          value={formatBRL(totals?.avgTicket ?? 0)}
          hint="Receita ÷ vendas ganhas"
          icon={<TrendingUp size={16} />}
          loading={isLoading}
        />
        <KpiCard
          label="Resolução"
          value={`${totals && totals.leadsAttended > 0 ? Math.round((totals.leadsResolved / totals.leadsAttended) * 100) : 0}%`}
          hint={totals ? `${totals.leadsResolved} de ${totals.leadsAttended}` : undefined}
          icon={<CheckCircle2 size={16} />}
          loading={isLoading}
        />
      </div>

      {/* KPIs secundários — Tempos + Atividade */}
      <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-5">
        <KpiCard
          label="TME (espera médio)"
          value={formatMs(totals?.avgWaitTimeMs ?? null)}
          hint="Criação → atribuição"
          icon={<Clock size={16} />}
          loading={isLoading}
        />
        <KpiCard
          label="FRT (1ª resposta)"
          value={formatMs(totals?.avgFirstResponseMs ?? null)}
          hint="Atribuição → 1ª mensagem"
          icon={<Zap size={16} />}
          loading={isLoading}
        />
        <KpiCard
          label="TMA (atendimento)"
          value={formatMs(totals?.avgHandlingTimeMs ?? null)}
          hint="Abertura → fechamento"
          icon={<Timer size={16} />}
          loading={isLoading}
        />
        <KpiCard
          label="Mensagens enviadas"
          value={totals?.messagesSent ?? 0}
          hint="Operadores → leads"
          icon={<MessageSquare size={16} />}
          loading={isLoading}
        />
        <KpiCard
          label="Atividades"
          value={totals?.activitiesCompleted ?? 0}
          hint={totals ? `${totals.activitiesCreated} criadas · ${totals.activitiesOverdue} em atraso` : undefined}
          icon={<ListChecks size={16} />}
          loading={isLoading}
        />
        <KpiCard
          label="Stage moves"
          value={totals?.stageMoves ?? 0}
          hint="Mudanças manuais de etapa"
          icon={<ArrowRightLeft size={16} />}
          loading={isLoading}
        />
      </div>

      {/* Workload atual */}
      {workload && workload.items.length > 0 && (
        <Card class="mb-5">
          <div class="px-4 py-3 border-b border-border flex items-center gap-2">
            <Activity size={14} class="text-fg-muted" />
            <h2 class="text-sm font-semibold text-fg">Carga de trabalho agora</h2>
            <span
              class="text-[0.6875rem] text-fg-subtle ml-auto"
              title="Esta seção mostra o estado neste instante: leads em aberto que cada operador está carregando agora. Não responde ao filtro de período acima."
            >
              Snapshot agora · independe do filtro de período
            </span>
          </div>
          <div class="overflow-x-auto">
            <table class="w-full text-sm">
              <thead class="text-[0.6875rem] uppercase tracking-wider text-fg-subtle bg-surface-2/50">
                <tr>
                  <th class="text-left px-4 py-2 font-semibold">Operador</th>
                  <th class="text-left px-4 py-2 font-semibold">Status</th>
                  <th
                    class="text-right px-4 py-2 font-semibold"
                    title="Leads atualmente atribuídos ao operador e ainda sem resultado (não foram ganhos nem perdidos)."
                  >
                    Leads ativos
                  </th>
                  <th
                    class="text-right px-4 py-2 font-semibold"
                    title="Quantos leads em aberto o operador pode carregar ao mesmo tempo. É um teto de concorrência, não uma meta diária/mensal. Usado pelo roteamento automático (least_loaded) e pelo cálculo de utilização."
                  >
                    Limite simultâneo
                  </th>
                  <th
                    class="text-right px-4 py-2 font-semibold"
                    title="Leads ativos ÷ Limite simultâneo. 80%+ amarelo, 100%+ vermelho (operador saturado, roteamento automático pula)."
                  >
                    Utilização
                  </th>
                  <th class="text-right px-4 py-2 font-semibold">Tarefas pendentes</th>
                  <th class="text-right px-4 py-2 font-semibold">Em atraso</th>
                </tr>
              </thead>
              <tbody>
                {workload.items.map((w) => (
                  <tr key={w.userId} class="border-t border-border hover:bg-surface-2/30">
                    <td class="px-4 py-2 font-medium text-fg">{w.name ?? w.email ?? `#${w.userId}`}</td>
                    <td class="px-4 py-2">
                      <span class="inline-flex items-center gap-1.5 text-[0.6875rem] text-fg-muted">
                        <span class="size-2 rounded-full" style={{ background: STATUS_COLORS[w.workStatus] }} />
                        {STATUS_LABELS[w.workStatus]}
                      </span>
                    </td>
                    <td class="px-4 py-2 text-right tabular-nums font-semibold">{w.activeLeads}</td>
                    <td class="px-4 py-2 text-right">
                      <EditableCapacity userId={w.userId} value={w.capacity} />
                    </td>
                    <td class="px-4 py-2">
                      <div
                        class="inline-flex items-center gap-2 justify-end w-full"
                        title={`${w.activeLeads} de ${w.capacity} leads em aberto (${w.utilization}%)`}
                      >
                        <div class="h-1.5 w-20 rounded-full bg-surface-2 overflow-hidden">
                          <div
                            class={
                              'h-full rounded-full transition-all ' + (
                                w.utilization >= 100 ? 'bg-danger'
                                : w.utilization >= 80 ? 'bg-warning'
                                : 'bg-accent'
                              )
                            }
                            style={{ width: `${Math.min(w.utilization, 100)}%` }}
                          />
                        </div>
                        <span
                          class={
                            'tabular-nums text-xs w-10 text-right ' + (
                              w.utilization >= 100 ? 'text-danger font-semibold'
                              : w.utilization >= 80 ? 'text-warning font-semibold'
                              : 'text-fg-muted'
                            )
                          }
                        >
                          {w.utilization}%
                        </span>
                      </div>
                    </td>
                    <td class="px-4 py-2 text-right tabular-nums">{w.activitiesPending}</td>
                    <td class="px-4 py-2 text-right tabular-nums">
                      {w.activitiesOverdue > 0 ? (
                        <span class="text-danger font-semibold">{w.activitiesOverdue}</span>
                      ) : (
                        <span class="text-fg-subtle">0</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Ranking */}
      <Card>
        <div class="px-4 py-3 border-b border-border flex items-center justify-between">
          <h2 class="text-sm font-semibold text-fg flex items-center gap-2">
            <BarChart3 size={14} class="text-fg-muted" /> Ranking por operador
          </h2>
          <span class="text-[0.6875rem] text-fg-subtle">
            Ordenado por leads atendidos · empate desempata por receita
          </span>
        </div>
        {isLoading && (
          <div class="p-4 space-y-2">
            <Skeleton class="h-10 w-full" />
            <Skeleton class="h-10 w-full" />
            <Skeleton class="h-10 w-full" />
          </div>
        )}
        {!isLoading && operators.length === 0 && (
          <EmptyState
            icon={<Users size={28} />}
            title="Sem dados no período"
            description="Nenhum operador teve atividade no intervalo selecionado. Ajuste filtros."
          />
        )}
        {!isLoading && operators.length > 0 && (
          <div class="overflow-x-auto">
            <table class="w-full text-sm">
              <thead class="text-[0.6875rem] uppercase tracking-wider text-fg-subtle bg-surface-2/50">
                <tr>
                  <th class="text-left px-3 py-2 font-semibold">#</th>
                  <th class="text-left px-3 py-2 font-semibold">Operador</th>
                  <th class="text-left px-3 py-2 font-semibold">Status</th>
                  <th class="text-right px-3 py-2 font-semibold" title="Leads atendidos no período">Atend.</th>
                  <th class="text-right px-3 py-2 font-semibold" title="Ganhos / Perdidos">Won/Lost</th>
                  <th class="text-right px-3 py-2 font-semibold" title="Taxa de conversão">Win%</th>
                  <th class="text-right px-3 py-2 font-semibold" title="Receita gerada (leads ganhos · lead.saleValue)">Receita</th>
                  <th class="text-right px-3 py-2 font-semibold" title="Ticket médio">Ticket</th>
                  <th class="text-right px-3 py-2 font-semibold" title="Mensagens enviadas">Msgs</th>
                  <th class="text-right px-3 py-2 font-semibold" title="Atividades concluídas / criadas / em atraso">Atividades</th>
                  <th class="text-right px-3 py-2 font-semibold" title="Tempo médio de espera (criação → atribuição)">TME</th>
                  <th class="text-right px-3 py-2 font-semibold" title="Tempo de 1ª resposta (atribuição → 1ª mensagem)">FRT</th>
                  <th class="text-right px-3 py-2 font-semibold" title="Tempo médio de atendimento (abertura → fechamento)">TMA</th>
                  <th class="text-right px-3 py-2 font-semibold" title="Movimentações de etapa feitas">Stage moves</th>
                  <th class="text-right px-3 py-2 font-semibold" title="Prioridade média dos leads atendidos (priorityScore)">Pri. média</th>
                  <th class="text-right px-3 py-2 font-semibold" title="Limite simultâneo configurado (máx. de leads em aberto carregados ao mesmo tempo).">Cap.</th>
                  <th class="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {operators.map((op, idx) => (
                  <tr key={op.userId} class="border-t border-border hover:bg-surface-2/30">
                    <td class="px-3 py-2 text-fg-subtle tabular-nums">{idx + 1}</td>
                    <td class="px-3 py-2">
                      <div class="font-medium text-fg">{op.name ?? op.email ?? `#${op.userId}`}</div>
                      {op.name && <div class="text-[0.6875rem] text-fg-subtle truncate">{op.email}</div>}
                    </td>
                    <td class="px-3 py-2">
                      <span class="inline-flex items-center gap-1.5 text-[0.6875rem] text-fg-muted">
                        <span class="size-2 rounded-full" style={{ background: STATUS_COLORS[op.workStatus] }} />
                        {STATUS_LABELS[op.workStatus]}
                      </span>
                    </td>
                    <td class="px-3 py-2 text-right tabular-nums font-semibold">{op.leadsAttended}</td>
                    <td class="px-3 py-2 text-right tabular-nums text-[0.75rem]">
                      <span class="text-success">{op.leadsWon}↑</span>
                      <span class="text-fg-subtle mx-1">/</span>
                      <span class="text-danger">{op.leadsLost}↓</span>
                    </td>
                    <td class="px-3 py-2 text-right tabular-nums">{op.winRate.toFixed(1)}%</td>
                    <td class="px-3 py-2 text-right tabular-nums font-semibold text-success">
                      {op.revenue > 0 ? formatBRL(op.revenue) : '—'}
                    </td>
                    <td class="px-3 py-2 text-right tabular-nums text-fg-muted">
                      {op.avgTicket > 0 ? formatBRL(op.avgTicket) : '—'}
                    </td>
                    <td class="px-3 py-2 text-right tabular-nums">{op.messagesSent}</td>
                    <td class="px-3 py-2 text-right tabular-nums text-[0.75rem]">
                      <span class="text-success">{op.activitiesCompleted}</span>
                      <span class="text-fg-subtle mx-1">/</span>
                      <span class="text-fg-muted">{op.activitiesCreated}</span>
                      {op.activitiesOverdue > 0 && (
                        <>
                          <span class="text-fg-subtle mx-1">·</span>
                          <span class="text-danger" title="Em atraso">{op.activitiesOverdue}</span>
                        </>
                      )}
                    </td>
                    <td class="px-3 py-2 text-right tabular-nums text-fg-muted">{formatMs(op.avgWaitTimeMs)}</td>
                    <td class="px-3 py-2 text-right tabular-nums text-fg-muted">{formatMs(op.avgFirstResponseMs)}</td>
                    <td class="px-3 py-2 text-right tabular-nums text-fg-muted">{formatMs(op.avgHandlingTimeMs)}</td>
                    <td class="px-3 py-2 text-right tabular-nums text-fg-muted">{op.stageMoves}</td>
                    <td class="px-3 py-2 text-right tabular-nums text-fg-muted">
                      {op.avgPriorityScore !== null ? (
                        <span class="inline-flex items-center gap-0.5">
                          <Star size={10} class="text-warning" />
                          {op.avgPriorityScore.toFixed(1)}
                        </span>
                      ) : '—'}
                    </td>
                    <td class="px-3 py-2 text-right tabular-nums text-fg-subtle">{op.capacity}</td>
                    <td class="px-3 py-2">
                      <button
                        type="button"
                        onClick={() => setDrillUserId(op.userId)}
                        class="text-[0.6875rem] text-info hover:underline"
                      >
                        Ver detalhes
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {drillOperator && (
        <OperatorDrillModal
          operator={drillOperator}
          from={from}
          to={to}
          onClose={() => setDrillUserId(null)}
        />
      )}

      {/* Herda o período do topo da tela: dois seletores independentes na mesma
          página faziam o SLA responder por 7 dias enquanto o resto mostrava 90. */}
      <SlaSection from={from} to={to} />

      <HowItWorksModal
        open={showHowItWorks}
        onClose={() => setShowHowItWorks(false)}
        title="Como funciona a Performance da Equipe?"
        problem={<>
          Quem está vendendo mais? Quem está demorando demais pra responder? Qual vendedor tem a melhor
          taxa de conversão? Esta tela responde tudo isso em uma única visão, comparando os operadores
          lado a lado, em qualquer período.
        </>}
        steps={[
          {
            title: '🗓️ Escolha o período',
            body: <>Hoje, ontem, 7/30/90 dias, mês atual, mês passado, ou intervalo customizado. Tudo recalcula em tempo real conforme você muda.</>,
          },
          {
            title: '👥 Filtre por equipe ou operador',
            body: <>Veja a equipe inteira ou foque em um time/operador. Combine com filtro por funil pra olhar performance numa unidade de negócio específica.</>,
          },
          {
            title: '📈 Leia os KPIs no topo',
            body: <>Total de leads atendidos, ganhos, perdidos, taxa de conversão (Win%), receita gerada, tempo médio de resposta, tempo até primeira resposta. <strong>Comparativo do período anterior</strong> em cada KPI.</>,
          },
          {
            title: '👤 Tabela por operador',
            body: <>Cada linha é um vendedor com volume de leads, won/lost, win%, receita, atividades, mensagens enviadas, tempo médio de resposta. Ordene clicando no cabeçalho da coluna.</>,
          },
          {
            title: '🔬 Drill-down individual',
            body: <>Clique em um operador pra abrir modal com gráficos de receita ao longo do tempo, principais motivos de perda, taxa de execução de cadência, etc. Útil pra one-on-one com vendedor.</>,
          },
        ]}
        tip={{
          tone: 'info',
          title: '💡 O que olhar primeiro',
          body: <>Se a equipe vende pouco, foque em <strong>volume</strong> (poucos leads atendidos?) e <strong>velocidade</strong> (tempo de resposta alto?). Se vende bem mas perde, olhe <strong>motivos de perda</strong> no drill-down — talvez seja preço, prazo, ou treinamento.</>,
        }}
      />
    </Page>
  )
}

// ─── Drill-down modal ─────────────────────────────────────────────────

function OperatorDrillModal({
  operator, from, to, onClose,
}: {
  operator: TeamMetricsOperator
  from: string
  to: string
  onClose: () => void
}) {
  const { data, isLoading } = useOperatorBreakdown(operator.userId, { from, to })

  const totalOutcome = (data?.outcomes.won ?? 0) + (data?.outcomes.lost ?? 0) + (data?.outcomes.open ?? 0)
  const wonPct = totalOutcome > 0 ? Math.round(((data?.outcomes.won ?? 0) / totalOutcome) * 100) : 0
  const lostPct = totalOutcome > 0 ? Math.round(((data?.outcomes.lost ?? 0) / totalOutcome) * 100) : 0
  const openPct = totalOutcome > 0 ? 100 - wonPct - lostPct : 0

  const maxRevenue = Math.max(1, ...(data?.revenueTimeline.map((d) => d.value) ?? [0]))

  return (
    <Modal
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      title={`Detalhes — ${operator.name ?? operator.email ?? `#${operator.userId}`}`}
      description={`Período: ${new Date(from).toLocaleDateString('pt-BR')} → ${new Date(to).toLocaleDateString('pt-BR')}`}
      size="xl"
    >
      <div class="space-y-5">
        {/* Resumo do operador */}
        <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KpiCard label="Atendidos" value={operator.leadsAttended} icon={<Target size={14} />} />
          <KpiCard label="Win rate" value={`${operator.winRate.toFixed(1)}%`} icon={<Trophy size={14} />} />
          <KpiCard label="Receita" value={formatBRL(operator.revenue)} icon={<DollarSign size={14} />} />
          <KpiCard label="Mensagens" value={operator.messagesSent} icon={<MessageSquare size={14} />} />
        </div>

        {/* Distribuição de outcomes — barra empilhada */}
        <div>
          <h3 class="text-xs font-semibold text-fg-muted uppercase tracking-wide mb-2">Distribuição de outcomes</h3>
          {totalOutcome === 0 ? (
            <p class="text-sm text-fg-subtle">Sem dados de outcome no período.</p>
          ) : (
            <>
              <div class="flex h-6 rounded-md overflow-hidden border border-border bg-surface-2">
                {wonPct > 0 && (
                  <div
                    class="flex items-center justify-center text-[0.6875rem] text-white font-semibold"
                    style={{ width: `${wonPct}%`, background: '#22c55e' }}
                    title={`Ganhos: ${data?.outcomes.won}`}
                  >
                    {wonPct >= 8 ? `${wonPct}%` : ''}
                  </div>
                )}
                {lostPct > 0 && (
                  <div
                    class="flex items-center justify-center text-[0.6875rem] text-white font-semibold"
                    style={{ width: `${lostPct}%`, background: '#dc2626' }}
                    title={`Perdidos: ${data?.outcomes.lost}`}
                  >
                    {lostPct >= 8 ? `${lostPct}%` : ''}
                  </div>
                )}
                {openPct > 0 && (
                  <div
                    class="flex items-center justify-center text-[0.6875rem] text-fg font-semibold"
                    style={{ width: `${openPct}%`, background: '#9ca3af' }}
                    title={`Em andamento: ${data?.outcomes.open}`}
                  >
                    {openPct >= 8 ? `${openPct}%` : ''}
                  </div>
                )}
              </div>
              <div class="flex gap-3 mt-2 text-[0.6875rem] text-fg-muted">
                <span class="inline-flex items-center gap-1"><span class="size-2 rounded-full bg-success" /> Ganhos: {data?.outcomes.won ?? 0}</span>
                <span class="inline-flex items-center gap-1"><span class="size-2 rounded-full bg-danger" /> Perdidos: {data?.outcomes.lost ?? 0}</span>
                <span class="inline-flex items-center gap-1"><span class="size-2 rounded-full" style={{ background: '#9ca3af' }} /> Em andamento: {data?.outcomes.open ?? 0}</span>
              </div>
            </>
          )}
        </div>

        {/* Top motivos de perda */}
        <div>
          <h3 class="text-xs font-semibold text-fg-muted uppercase tracking-wide mb-2 flex items-center gap-1">
            <AlertTriangle size={12} /> Top motivos de perda
          </h3>
          {isLoading ? (
            <Skeleton class="h-16 w-full" />
          ) : (data?.lossReasons ?? []).length === 0 ? (
            <p class="text-sm text-fg-subtle">Sem leads marcados como perdidos no período.</p>
          ) : (
            <div class="space-y-1.5">
              {data!.lossReasons.map((r) => {
                const max = Math.max(1, ...data!.lossReasons.map((x) => x.count))
                const pct = (r.count / max) * 100
                return (
                  <div key={r.reasonId} class="flex items-center gap-2">
                    <div class="text-xs text-fg w-48 truncate" title={r.name}>{r.name}</div>
                    <div class="flex-1 h-4 bg-surface-2 rounded overflow-hidden">
                      <div
                        class="h-full"
                        style={{ width: `${pct}%`, background: r.color ?? '#dc2626' }}
                      />
                    </div>
                    <div class="text-xs text-fg-muted tabular-nums w-10 text-right">{r.count}</div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Origens */}
        <div>
          <h3 class="text-xs font-semibold text-fg-muted uppercase tracking-wide mb-2">Origens dos leads atendidos</h3>
          {isLoading ? (
            <Skeleton class="h-12 w-full" />
          ) : (data?.qualificationSources ?? []).length === 0 ? (
            <p class="text-sm text-fg-subtle">Sem origem registrada.</p>
          ) : (
            <div class="flex flex-wrap gap-1.5">
              {data!.qualificationSources.slice(0, 8).map((s) => (
                <Badge key={s.source} tone="info">
                  {QUALIFICATION_SOURCES.find((x) => x.value === s.source)?.label ?? s.source}: {s.count}
                </Badge>
              ))}
            </div>
          )}
        </div>

        {/* Receita por dia (sparkline simples em barras) */}
        <div>
          <h3 class="text-xs font-semibold text-fg-muted uppercase tracking-wide mb-2 flex items-center gap-1">
            <DollarSign size={12} /> Receita ao longo do período
          </h3>
          {isLoading ? (
            <Skeleton class="h-20 w-full" />
          ) : (data?.revenueTimeline ?? []).length === 0 ? (
            <p class="text-sm text-fg-subtle">Sem vendas detectadas no período.</p>
          ) : (
            <div class="flex items-end gap-0.5 h-20">
              {data!.revenueTimeline.map((d) => {
                const heightPct = (d.value / maxRevenue) * 100
                return (
                  <div
                    key={d.date}
                    class="flex-1 bg-success/70 hover:bg-success transition-colors rounded-t-sm cursor-help"
                    style={{ height: `${Math.max(heightPct, 3)}%`, minWidth: '4px' }}
                    title={`${d.date}: ${formatBRL(d.value)}`}
                  />
                )
              })}
            </div>
          )}
        </div>
      </div>
    </Modal>
  )
}

function EditableCapacity({ userId, value }: { userId: number; value: number }) {
  const me = useUserStore((s) => s.user)
  const role = String(me?.role ?? '').toUpperCase()
  const canEdit = role === 'SUPERADMIN' || role === 'ADMIN' || role === 'MANAGER'
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(String(value))
  const inputRef = useRef<HTMLInputElement>(null)
  const update = useUpdateUser()
  const qc = useQueryClient()

  useEffect(() => {
    if (!editing) setDraft(String(value))
  }, [value, editing])

  useEffect(() => {
    if (editing) {
      requestAnimationFrame(() => {
        inputRef.current?.focus()
        inputRef.current?.select()
      })
    }
  }, [editing])

  if (!canEdit) {
    return <span class="text-fg-muted tabular-nums">{value}</span>
  }

  function commit() {
    const n = Math.floor(Number(draft))
    if (!Number.isFinite(n) || n < 0 || n > 1000) {
      toast('Limite simultâneo deve ser um número entre 0 e 1000.', 'danger')
      setDraft(String(value))
      setEditing(false)
      return
    }
    if (n === value) {
      setEditing(false)
      return
    }
    update.mutate(
      { id: userId, capacity: n },
      {
        onSuccess: () => {
          toast(`Limite simultâneo atualizado para ${n}.`, 'success')
          qc.invalidateQueries({ queryKey: ['team-metrics-workload'] })
          qc.invalidateQueries({ queryKey: ['team-metrics'] })
          setEditing(false)
        },
        onError: (e: unknown) => {
          toast((e as Error).message, 'danger')
          setDraft(String(value))
        },
      },
    )
  }

  function cancel() {
    setDraft(String(value))
    setEditing(false)
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        title="Clique para editar o limite simultâneo (máx. de leads em aberto ao mesmo tempo)"
        class="inline-flex items-center gap-1 tabular-nums text-fg-muted hover:text-fg group"
      >
        <span>{value}</span>
        <Pencil size={11} class="opacity-0 group-hover:opacity-100 transition-opacity" />
      </button>
    )
  }

  return (
    <div class="inline-flex items-center gap-1">
      <input
        ref={inputRef}
        type="number"
        min={0}
        max={1000}
        step={1}
        value={draft}
        onInput={(e) => setDraft((e.target as HTMLInputElement).value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
          if (e.key === 'Escape') cancel()
        }}
        disabled={update.isPending}
        class="w-14 h-7 px-1.5 rounded border border-border bg-surface text-fg text-sm text-right tabular-nums focus:outline-none focus:border-accent"
      />
      <button
        type="button"
        onClick={commit}
        disabled={update.isPending}
        title="Salvar"
        class="inline-flex items-center justify-center w-6 h-6 rounded text-success hover:bg-success/10 disabled:opacity-50"
      >
        <Check size={13} />
      </button>
      <button
        type="button"
        onClick={cancel}
        disabled={update.isPending}
        title="Cancelar"
        class="inline-flex items-center justify-center w-6 h-6 rounded text-fg-muted hover:bg-surface-3 disabled:opacity-50"
      >
        <XIcon size={13} />
      </button>
    </div>
  )
}

// ─── Lead Routing F10: SLA primeira resposta ─────────────────────────
function SlaSection({ from, to }: { from: string; to: string }) {
  const target = useSlaTarget()
  const setTarget = useSetSlaTarget()
  // `from`/`to` chegam em ISO; a rota espera YYYY-MM-DD.
  const metrics = useSlaMetrics({ from: from.slice(0, 10), to: to.slice(0, 10) })
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

  useEffect(() => {
    if (target.data) setDraft(String(target.data.minutes))
  }, [target.data])

  const handleSaveTarget = async () => {
    const n = parseInt(draft)
    if (!Number.isFinite(n) || n < 1 || n > 1440) {
      toast('Minutos deve estar entre 1 e 1440', 'danger')
      return
    }
    try {
      await setTarget.mutateAsync(n)
      toast('SLA atualizado', 'success')
      setEditing(false)
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : 'Falha ao salvar'
      toast(msg, 'danger')
    }
  }

  if (metrics.isLoading || !metrics.data) {
    return <Skeleton class="h-64 w-full mt-6" />
  }
  const m = metrics.data

  return (
    <div class="mt-6 space-y-3">
      <div class="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h3 class="text-base font-semibold flex items-center gap-2">
            <Timer class="w-4 h-4" /> SLA — primeira resposta
          </h3>
          <p class="text-xs text-fg-muted">
            % de leads atendidos cuja primeira ação do agente atribuído (Activity concluída)
            ocorreu dentro do tempo configurado — no período selecionado no topo da tela.
          </p>
        </div>
        <div class="flex items-center gap-2">
          {editing ? (
            <div class="flex items-center gap-1">
              <Input
                type="number"
                min={1}
                max={1440}
                value={draft}
                onInput={(e) => setDraft((e.currentTarget as HTMLInputElement).value)}
                class="w-20"
              />
              <Button variant="primary" size="sm" onClick={handleSaveTarget} disabled={setTarget.isPending}>
                <Check class="w-4 h-4" />
              </Button>
              <Button variant="ghost" size="sm" onClick={() => { setEditing(false); setDraft(String(target.data?.minutes ?? 30)) }}>
                <XIcon class="w-4 h-4" />
              </Button>
            </div>
          ) : (
            <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
              <Pencil class="w-3.5 h-3.5 mr-1" /> SLA: {m.slaMinutes} min
            </Button>
          )}
        </div>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-4 gap-3">
        <KpiCard label="Atendidos" value={m.totals.attended} hint="Leads atribuídos no período" />
        <KpiCard label="Responderam" value={m.totals.responded} hint="Activity concluída pelo dono" />
        <KpiCard
          label="Dentro do SLA"
          value={m.totals.slaMet}
          hint={`Resposta ≤ ${m.slaMinutes} min`}
        />
        <KpiCard
          label="% SLA"
          value={m.totals.slaPercent == null ? '—' : `${m.totals.slaPercent}%`}
          hint={m.totals.slaPercent != null && m.totals.slaPercent >= 80 ? 'Saudável' : 'Atenção'}
        />
      </div>

      <Card>
        {m.agents.length === 0 ? (
          <div class="p-6 text-sm text-fg-muted">Sem dados no período.</div>
        ) : (
          <div class="overflow-x-auto">
            <table class="w-full text-sm">
              <thead class="text-left text-xs uppercase tracking-wide text-fg-muted border-b border-border">
                <tr>
                  <th class="px-4 py-3">Agente</th>
                  <th class="px-4 py-3 text-right">Atendidos</th>
                  <th class="px-4 py-3 text-right">Responderam</th>
                  <th class="px-4 py-3 text-right">SLA met</th>
                  <th class="px-4 py-3 text-right">SLA missed</th>
                  <th class="px-4 py-3 text-right">% SLA</th>
                  <th class="px-4 py-3 text-right">Tempo médio (min)</th>
                </tr>
              </thead>
              <tbody>
                {m.agents.map((a) => (
                  <tr key={a.userId} class="border-b border-border last:border-0 hover:bg-surface-2">
                    <td class="px-4 py-3 font-medium">{a.name}</td>
                    <td class="px-4 py-3 text-right tabular-nums">{a.attended}</td>
                    <td class="px-4 py-3 text-right tabular-nums">{a.responded}</td>
                    <td class="px-4 py-3 text-right tabular-nums text-success">{a.slaMet}</td>
                    <td class="px-4 py-3 text-right tabular-nums text-danger">{a.slaMissed}</td>
                    <td class="px-4 py-3 text-right">
                      {a.slaPercent == null ? (
                        <span class="text-fg-subtle">—</span>
                      ) : (
                        <Badge tone={a.slaPercent >= 80 ? 'success' : a.slaPercent >= 50 ? 'warning' : 'danger'}>
                          {a.slaPercent}%
                        </Badge>
                      )}
                    </td>
                    <td class="px-4 py-3 text-right tabular-nums">
                      {a.avgFirstResponseMin ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}
