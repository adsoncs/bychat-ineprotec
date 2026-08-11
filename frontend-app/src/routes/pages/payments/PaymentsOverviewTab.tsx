import { TrendingUp, TrendingDown, DollarSign, Activity, CheckCircle } from 'lucide-preact'
import { Card } from '@/components/ui/Card'
import { Skeleton } from '@/components/ui/Skeleton'
import { PeriodPicker, PeriodIncompleteHint, usePeriod } from '@/components/ui/PeriodPicker'
import {
  usePaymentsOverview, usePaymentsTimeseries, usePaymentsBreakdown,
} from '@/hooks/usePaymentsDashboard'

const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const intf = new Intl.NumberFormat('pt-BR')

export function PaymentsOverviewTab() {
  const { range, preset, customFrom, customTo, setPreset, setCustom } = usePeriod('payments')
  const overview = usePaymentsOverview(range)
  const ts = usePaymentsTimeseries(range)
  const bd = usePaymentsBreakdown(range)

  const o = overview.data

  return (
    <div class="space-y-4">
      <div class="flex min-w-0 flex-wrap items-center gap-2">
        <span class="text-xs text-fg-muted">Período:</span>
        <PeriodPicker preset={preset} customFrom={customFrom} customTo={customTo} onPreset={setPreset} onCustom={setCustom} />
      </div>
      <PeriodIncompleteHint show={range.incomplete} />

      {/* KPIs */}
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi
          icon={<DollarSign size={16} />}
          label="Receita recebida"
          value={o ? fmt(o.revenue.total) : '—'}
          hint={o?.revenue.growthPct != null ? `${o.revenue.growthPct > 0 ? '+' : ''}${o.revenue.growthPct.toFixed(1)}% vs período anterior` : null}
          trend={o?.revenue.growthPct != null && o.revenue.growthPct >= 0 ? 'up' : 'down'}
          loading={overview.isLoading}
        />
        <Kpi
          icon={<Activity size={16} />}
          label="A receber (pendente)"
          value={o ? fmt(o.revenue.pending) : '—'}
          hint={o ? `${intf.format(o.totals.pending)} cobrança(s)` : null}
          loading={overview.isLoading}
        />
        <Kpi
          icon={<CheckCircle size={16} />}
          label="Taxa de conversão"
          value={o ? `${(o.conversionRate * 100).toFixed(1)}%` : '—'}
          hint={o ? `${intf.format(o.totals.paid)} pagos / ${intf.format(o.totals.all)} totais` : null}
          loading={overview.isLoading}
        />
        <Kpi
          icon={<DollarSign size={16} />}
          label="Ticket médio"
          value={o ? fmt(o.ticketMedio) : '—'}
          hint={o ? `Em ${intf.format(o.totals.paid)} cobranças pagas` : null}
          loading={overview.isLoading}
        />
      </div>

      {/* Breakdown numérico simples */}
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <div class="text-xs uppercase tracking-wider text-fg-subtle mb-3">Status</div>
          {overview.isLoading ? <Skeleton class="h-24 w-full" /> : (
            <div class="space-y-2">
              <StatusRow color="bg-success" label="Pagos" count={o?.totals.paid ?? 0} total={o?.totals.all ?? 0} />
              <StatusRow color="bg-warning" label="Pendentes" count={o?.totals.pending ?? 0} total={o?.totals.all ?? 0} />
              <StatusRow color="bg-danger" label="Falharam/expiraram" count={o?.totals.failed ?? 0} total={o?.totals.all ?? 0} />
              {(o?.totals.refunded ?? 0) > 0 && (
                <StatusRow color="bg-info" label="Reembolsados" count={o?.totals.refunded ?? 0} total={o?.totals.all ?? 0} />
              )}
            </div>
          )}
        </Card>

        <Card>
          <div class="text-xs uppercase tracking-wider text-fg-subtle mb-3">Por método</div>
          {bd.isLoading ? <Skeleton class="h-24 w-full" /> : (
            <div class="space-y-2">
              {(bd.data?.byMethod ?? []).map((m) => (
                <MethodRow key={m.name} method={m} />
              ))}
              {(bd.data?.byMethod ?? []).length === 0 && (
                <div class="text-xs text-fg-subtle">Nenhuma cobrança no período.</div>
              )}
            </div>
          )}
        </Card>
      </div>

      {/* Timeseries — linhas paid/pending/failed por dia */}
      <Card>
        <div class="text-xs uppercase tracking-wider text-fg-subtle mb-3">Cobranças por dia</div>
        {ts.isLoading ? <Skeleton class="h-40 w-full" /> : (
          <TimeseriesChart series={ts.data?.series ?? []} />
        )}
      </Card>

      {/* Top portais */}
      <Card>
        <div class="text-xs uppercase tracking-wider text-fg-subtle mb-3">Top portais</div>
        {bd.isLoading ? <Skeleton class="h-24 w-full" /> : (
          <div class="overflow-x-auto">
            <table class="w-full text-sm">
              <thead>
                <tr class="text-left text-xs text-fg-subtle border-b border-border">
                  <th class="py-2 pr-3">Portal</th>
                  <th class="py-2 pr-3 text-right">Pagos</th>
                  <th class="py-2 pr-3 text-right">Total cobranças</th>
                  <th class="py-2 pr-3 text-right">Receita</th>
                </tr>
              </thead>
              <tbody>
                {(bd.data?.byPortal ?? []).map((p) => (
                  <tr key={p.id} class="border-b border-border/40">
                    <td class="py-2 pr-3 text-fg">{p.name}</td>
                    <td class="py-2 pr-3 text-right text-success tabular-nums">{intf.format(p.paidCount)}</td>
                    <td class="py-2 pr-3 text-right text-fg-muted tabular-nums">{intf.format(p.count)}</td>
                    <td class="py-2 pr-3 text-right text-fg font-medium tabular-nums">{fmt(p.paidTotal)}</td>
                  </tr>
                ))}
                {(bd.data?.byPortal ?? []).length === 0 && (
                  <tr><td colspan={4} class="py-4 text-center text-fg-subtle text-xs">Sem dados</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card>
        <div class="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <div class="text-xs uppercase tracking-wider text-fg-subtle">Webhooks recebidos</div>
            <div class="text-2xl font-semibold text-fg mt-1 tabular-nums">{o ? intf.format(o.webhookCount) : '—'}</div>
            <div class="text-xs text-fg-subtle mt-1">eventos do provedor no período</div>
          </div>
          <a href="#" class="text-xs text-accent hover:underline">Ver detalhes na aba Webhooks →</a>
        </div>
      </Card>
    </div>
  )
}

function Kpi({ icon, label, value, hint, trend, loading }: {
  icon: any
  label: string
  value: string
  hint?: string | null
  trend?: 'up' | 'down'
  loading?: boolean
}) {
  return (
    <Card>
      <div class="flex items-start justify-between gap-2">
        <div class="text-fg-subtle">{icon}</div>
        {trend === 'up' && <TrendingUp size={12} class="text-success" />}
        {trend === 'down' && <TrendingDown size={12} class="text-danger" />}
      </div>
      <div class="text-xs text-fg-muted mt-2">{label}</div>
      {loading ? (
        <Skeleton class="h-7 w-24 mt-1" />
      ) : (
        <div class="text-xl font-semibold text-fg tabular-nums mt-0.5">{value}</div>
      )}
      {hint && <div class="text-[0.6875rem] text-fg-subtle mt-1">{hint}</div>}
    </Card>
  )
}

function StatusRow({ color, label, count, total }: { color: string; label: string; count: number; total: number }) {
  const pct = total > 0 ? (count / total) * 100 : 0
  return (
    <div>
      <div class="flex items-center justify-between text-xs mb-1">
        <span class="text-fg-muted">{label}</span>
        <span class="tabular-nums text-fg">{intf.format(count)} ({pct.toFixed(1)}%)</span>
      </div>
      <div class="h-1.5 bg-surface-3 rounded-full overflow-hidden">
        <div class={`h-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

function MethodRow({ method }: { method: { name: string; paid: number; pending: number; failed: number; total: number } }) {
  const label = method.name === 'pix' ? '📱 PIX' : method.name === 'boleto' ? '📄 Boleto' : '💳 Cartão'
  return (
    <div class="flex items-center justify-between text-sm">
      <span class="text-fg-muted">{label}</span>
      <div class="flex items-center gap-3 text-xs tabular-nums">
        <span class="text-success">{method.paid} ok</span>
        <span class="text-warning">{method.pending} pend</span>
        <span class="text-danger">{method.failed} falha</span>
      </div>
    </div>
  )
}

function TimeseriesChart({ series }: { series: { day: string; paid: number; pending: number; failed: number; revenue: number }[] }) {
  if (series.length === 0) {
    return <div class="text-xs text-fg-subtle py-6 text-center">Sem dados no período.</div>
  }
  const maxCount = Math.max(1, ...series.map(s => s.paid + s.pending + s.failed))
  return (
    <div class="flex items-end gap-1 h-32 overflow-x-auto">
      {series.map((s) => {
        const total = s.paid + s.pending + s.failed
        const paidH = (s.paid / maxCount) * 100
        const pendingH = (s.pending / maxCount) * 100
        const failedH = (s.failed / maxCount) * 100
        const showLabel = series.length <= 14 || series.indexOf(s) % Math.ceil(series.length / 14) === 0
        const dayPart = s.day.slice(8)
        const monthPart = s.day.slice(5, 7)
        return (
          <div key={s.day} class="flex-1 min-w-[18px] flex flex-col items-center gap-1 group">
            <div class="text-[0.5625rem] text-fg-subtle opacity-0 group-hover:opacity-100 tabular-nums">{total}</div>
            <div class="w-full flex flex-col-reverse" style={{ height: '100px' }}>
              <div class="bg-success/80" style={{ height: `${paidH}%` }} title={`Pagos: ${s.paid}`} />
              <div class="bg-warning/80" style={{ height: `${pendingH}%` }} title={`Pendentes: ${s.pending}`} />
              <div class="bg-danger/80" style={{ height: `${failedH}%` }} title={`Falhas: ${s.failed}`} />
            </div>
            {showLabel && <div class="text-[0.5625rem] text-fg-subtle tabular-nums">{dayPart}/{monthPart}</div>}
          </div>
        )
      })}
    </div>
  )
}
