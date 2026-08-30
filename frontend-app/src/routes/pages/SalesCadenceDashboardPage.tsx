import { useLocation } from 'wouter-preact'
import { ArrowLeft, AlertTriangle, TrendingUp, Users, Megaphone } from '@/components/ui/icon-set'
import { useCadenceMetrics, useSalesCadence, type OperatorBreakdown } from '@/hooks/useSalesCadences'
import { Page } from '@/components/ui/Page'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Skeleton } from '@/components/ui/Skeleton'
import { cn } from '@/lib/cn'
import {
  CADENCE_STATUS_LABEL,
  CADENCE_EXIT_REASON_LABEL,
  CADENCE_REPLY_CLASS_LABEL,
  CADENCE_CHANNEL_LABEL,
} from '@/lib/cadenceLabels'

interface Props {
  params: { id: string }
}

// Os labels usam o map compartilhado em `@/lib/cadenceLabels`. Aqui só
// adicionamos a chave 'unknown' que o componente Distribution exibe quando
// o backend retorna count agrupado sem motivo conhecido.
const STATUS_LABEL: Record<string, string> = { ...CADENCE_STATUS_LABEL, unknown: '—' }
const EXIT_REASON_LABEL: Record<string, string> = { ...CADENCE_EXIT_REASON_LABEL, unknown: '—' }
const REPLY_CLASS_LABEL: Record<string, string> = { ...CADENCE_REPLY_CLASS_LABEL, unknown: '—' }
const CHANNEL_LABEL: Record<string, string> = { ...CADENCE_CHANNEL_LABEL, unknown: '—' }

/** E3: detecta "step morto" — drop > 50% no alcance de leads entre dois steps
 * sequenciais. Retorna o set de steps que devem ser destacados. */
function detectDeadSteps(reach: { step: number; count: number }[]): Set<number> {
  const dead = new Set<number>()
  if (reach.length < 2) return dead
  // stepReach.count = enrollments que estão NAQUELE currentStep agora.
  // Pra detectar drop, preciso converter pra "alcançou o step N+ ao menos uma vez".
  // Aproximação: enrollments que estão em currentStep >= N.
  const totalAt: { step: number; alcance: number }[] = []
  for (const r of reach) {
    const alcance = reach
      .filter((x) => x.step >= r.step)
      .reduce((acc, x) => acc + x.count, 0)
    totalAt.push({ step: r.step, alcance })
  }
  for (let i = 1; i < totalAt.length; i++) {
    const prev = totalAt[i - 1]!
    const cur = totalAt[i]!
    if (prev.alcance > 0 && cur.alcance / prev.alcance < 0.5) {
      dead.add(cur.step)
    }
  }
  return dead
}

export function SalesCadenceDashboardPage({ params }: Props) {
  const [, navigate] = useLocation()
  const id = Number(params.id)
  const detail = useSalesCadence(Number.isFinite(id) ? id : null)
  const metrics = useCadenceMetrics(Number.isFinite(id) ? id : null)

  const cadence = detail.data
  const m = metrics.data
  const deadSteps = m ? detectDeadSteps(m.stepReach) : new Set<number>()
  const totalReachMax = m ? Math.max(...m.stepReach.map((r) => r.count), 1) : 1

  return (
    <Page
      title={cadence?.name ?? 'Cadência'}
      description="Como esta cadência está performando: quantos leads passaram, onde estão parando, o que dizem quando respondem e quantos viraram venda."
      actions={
        <Button variant="secondary" size="sm" onClick={() => navigate('/sales-cadences')}>
          <ArrowLeft size={12} /> Voltar
        </Button>
      }
    >
      {(detail.isLoading || metrics.isLoading) && (
        <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} class="h-24 w-full" />)}
        </div>
      )}

      {m && (
        <>
          {/* KPIs */}
          <div class="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
            <KpiCard icon={Users} label="Inscritos (total)" value={m.enrolled.toLocaleString('pt-BR')} />
            <KpiCard
              icon={Megaphone}
              label="Ativos agora"
              value={(m.byStatus.active ?? 0).toLocaleString('pt-BR')}
            />
            <KpiCard
              icon={TrendingUp}
              label="Conversão"
              value={`${(m.conversionRate * 100).toFixed(1)}%`}
              hint={`${m.conversionCount} venda(s) detectada(s)`}
            />
          </div>

          {/* Step reach + dead step detection (E3) */}
          <Card class="mb-4">
            <h3 class="text-sm font-semibold text-fg">Quantos leads chegaram em cada passo</h3>
            <p class="text-xs text-fg-muted mb-3">
              Passos destacados em laranja perderam mais de 50% dos leads em relação ao passo anterior. Sinal de que aquele template ou o tempo de espera não está funcionando — vale revisar.
            </p>
            {m.stepReach.length === 0 && <p class="text-xs text-fg-muted">Sem dados ainda.</p>}
            {m.stepReach.length > 0 && (
              <div class="flex flex-col gap-2">
                {m.stepReach.map((r) => {
                  const isDead = deadSteps.has(r.step)
                  const widthPct = (r.count / totalReachMax) * 100
                  return (
                    <div key={r.step} class="flex items-center gap-3">
                      <span class="text-xs text-fg-muted w-16">Passo #{r.step + 1}</span>
                      <div class="flex-1 h-5 bg-surface-3 rounded overflow-hidden relative">
                        <div
                          class={cn(
                            'h-full transition-all',
                            isDead ? 'bg-warning/40' : 'bg-info/40',
                          )}
                          style={{ width: `${widthPct}%` }}
                        />
                        <span class="absolute inset-0 flex items-center px-2 text-xs font-medium text-fg">
                          {r.count} {isDead && <AlertTriangle size={12} class="ml-2 text-warning" />}
                        </span>
                      </div>
                      {isDead && (
                        <span class="text-2xs text-warning font-medium">queda &gt; 50%</span>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </Card>

          {/* Breakdown grids — E4 drill-down completo */}
          <div class="mb-2 mt-1">
            <p class="text-xs text-fg-muted">
              Onde estão os leads agora, por que saíram, como a IA classifica as respostas, qual canal está sendo mais usado e quem do time está completando as tarefas.
            </p>
          </div>
          <div class="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
            <BreakdownCard
              title="Onde estão"
              hint="Quantos estão recebendo, pausados, encerrados ou concluíram."
              data={m.byStatus}
              labelMap={STATUS_LABEL}
            />
            <BreakdownCard
              title="Por que saíram"
              hint="Motivo dos leads que não estão mais na cadência."
              data={m.byExitReason}
              labelMap={EXIT_REASON_LABEL}
            />
            <BreakdownCard
              title="Como respondem"
              hint="O tom da última mensagem que cada lead enviou (classificado por IA)."
              data={m.byReplyClass}
              labelMap={REPLY_CLASS_LABEL}
            />
          </div>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
            <BreakdownCard
              title="Por canal"
              hint="Distribuição de envios automáticos e tarefas criadas, por canal."
              data={m.byChannel}
              labelMap={CHANNEL_LABEL}
            />
            <OperatorBreakdownCard data={m.byOperator} />
          </div>
        </>
      )}
    </Page>
  )
}

function KpiCard({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: any
  label: string
  value: string
  hint?: string
}) {
  return (
    <Card>
      <div class="flex items-start gap-3">
        <Icon size={20} class="text-fg-muted mt-0.5" />
        <div class="flex-1">
          <div class="text-xs text-fg-muted">{label}</div>
          <div class="text-xl font-semibold text-fg tabular-nums">{value}</div>
          {hint && <div class="text-2xs text-fg-muted mt-0.5">{hint}</div>}
        </div>
      </div>
    </Card>
  )
}

function BreakdownCard({
  title,
  hint,
  data,
  labelMap,
}: {
  title: string
  hint?: string
  data: Record<string, number>
  labelMap: Record<string, string>
}) {
  const entries = Object.entries(data).sort((a, b) => b[1] - a[1])
  const total = entries.reduce((acc, [, v]) => acc + v, 0)
  return (
    <Card>
      <h3 class="text-sm font-semibold text-fg">{title}</h3>
      {hint && <p class="text-2xs text-fg-muted mb-3">{hint}</p>}
      {!hint && <div class="mb-3" />}
      {entries.length === 0 && <p class="text-xs text-fg-muted">Sem dados.</p>}
      {entries.length > 0 && (
        <ul class="flex flex-col gap-1.5">
          {entries.map(([key, count]) => {
            const pct = total > 0 ? (count / total) * 100 : 0
            return (
              <li key={key} class="flex items-center justify-between text-xs">
                <span class="text-fg">{labelMap[key] ?? key}</span>
                <span class="text-fg-muted tabular-nums">
                  {count} <span class="text-fg-muted">({pct.toFixed(0)}%)</span>
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}

function OperatorBreakdownCard({ data }: { data: OperatorBreakdown[] }) {
  const total = data.reduce((acc, o) => acc + o.count, 0)
  return (
    <Card>
      <h3 class="text-sm font-semibold text-fg">Por operador</h3>
      <p class="text-2xs text-fg-muted mb-3">
        Quantas tarefas de cadência cada pessoa do time já completou.
      </p>
      {data.length === 0 && (
        <p class="text-xs text-fg-muted">
          Nenhuma tarefa de cadência foi completada por operadores ainda.
        </p>
      )}
      {data.length > 0 && (
        <ul class="flex flex-col gap-1.5">
          {data.map((op) => {
            const pct = total > 0 ? (op.count / total) * 100 : 0
            const label = op.name || op.email || `Usuário #${op.userId}`
            return (
              <li key={op.userId} class="flex items-center justify-between text-xs">
                <span class="text-fg truncate" title={op.email ?? undefined}>{label}</span>
                <span class="text-fg-muted tabular-nums whitespace-nowrap">
                  {op.count} <span class="text-fg-muted">({pct.toFixed(0)}%)</span>
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}
