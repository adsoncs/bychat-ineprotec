import { useState } from 'preact/hooks'
import { Eye, Send, Trophy, Banknote } from 'lucide-preact'
import {
  usePortalAnalytics,
  type EnrollmentPortal,
  type PortalAnalytics,
} from '@/hooks/useEnrollmentPortals'
import { Card } from '@/components/ui/Card'
import { Skeleton } from '@/components/ui/Skeleton'
import { Select } from '@/components/ui/Input'
import { LineChart } from '@/components/charts/LineChart'
import { formatDateShort } from '@/lib/format'
import { presetRange, presetLabel, type RangePreset } from '@/components/ui/PeriodPicker'

// Meses fechados, como no resto do sistema (ver PeriodPicker).
const PERIODS: { value: RangePreset; label: string }[] =
  (['m0', 'm1', 'm2', 'm3', 'm4'] as RangePreset[]).map((p) => ({ value: p, label: presetLabel(p) }))

export function PortalAnalyticsTab({ portal }: { portal: EnrollmentPortal }) {
  const [mes, setMes] = useState<RangePreset>('m0')
  const periodo = presetRange(mes)
  const { data, isLoading, error } = usePortalAnalytics(portal.id, { from: periodo.dateFrom, to: periodo.dateTo })

  return (
    <div class="space-y-3">
      <Card>
        <div class="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <div class="text-sm font-medium text-fg">Analytics do portal</div>
            <div class="text-xs text-fg-subtle mt-0.5">
              KPIs e atividade do portal em {presetLabel(mes)}.
            </div>
          </div>
          <Select
            value={mes}
            onChange={(e) => setDays(Number((e.target as HTMLSelectElement).value))}
            aria-label="Período"
          >
            {PERIODS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </Select>
        </div>
      </Card>

      {isLoading && <Skeleton class="h-64 w-full" />}
      {error && (
        <Card>
          <div class="text-sm text-danger">Erro: {(error).message}</div>
        </Card>
      )}

      {data && (
        <>
          <KpiRow data={data} />
          <ByDayChart data={data} />
          <div class="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <ByStatus data={data} />
            <BySource data={data} />
          </div>
        </>
      )}
    </div>
  )
}

function KpiRow({ data }: { data: PortalAnalytics }) {
  const tiles = [
    { icon: <Eye size={16} />,    label: 'Visualizações', value: data.views, sub: 'Total acumulado' },
    { icon: <Send size={16} />,   label: 'Submissões',    value: data.submissions, sub: 'Total acumulado' },
    { icon: <Trophy size={16} />, label: 'Conversões',    value: data.conversions, sub: `${data.conversionRate.toFixed(1)}% taxa` },
    { icon: <Banknote size={16} />, label: 'Receita',     value: `R$ ${Number(data.revenue).toFixed(2)}`, sub: 'no período' },
  ]
  return (
    <div class="grid grid-cols-2 sm:grid-cols-4 gap-2">
      {tiles.map((t) => (
        <Card key={t.label}>
          <div class="flex items-center gap-2 text-fg-muted">
            <span class="size-7 rounded-md bg-surface-3 grid place-items-center">{t.icon}</span>
            <span class="text-xs uppercase tracking-wider text-fg-subtle">{t.label}</span>
          </div>
          <div class="text-2xl font-semibold text-fg tabular-nums mt-2">{t.value}</div>
          <div class="text-[0.6875rem] text-fg-subtle">{t.sub}</div>
        </Card>
      ))}
    </div>
  )
}

function ByDayChart({ data }: { data: PortalAnalytics }) {
  if (data.byDay.length === 0) {
    return (
      <Card>
        <div class="text-sm text-fg-muted text-center py-8">
          Sem inscrições no período selecionado.
        </div>
      </Card>
    )
  }
  // Backend devolve em ordem desc — invertemos para o chart cronológico.
  const points = [...data.byDay].reverse().map((d) => ({
    label: formatDateShort(d.day),
    value: d.total,
  }))
  return (
    <Card>
      <div class="text-xs uppercase tracking-wider text-fg-subtle mb-2">Inscrições por dia</div>
      <LineChart data={points} height={200} />
      <div class="flex items-center gap-3 text-[0.6875rem] text-fg-subtle mt-2">
        <span class="inline-flex items-center gap-1">
          <span class="size-2 rounded-full bg-accent" />
          Total
        </span>
        <span class="text-fg-subtle">
          Pagas:{' '}
          <span class="text-fg tabular-nums">
            {data.byDay.reduce((acc, d) => acc + d.paid, 0)}
          </span>
        </span>
      </div>
    </Card>
  )
}

const STATUS_COLORS: Record<string, string> = {
  draft: 'var(--color-fg-subtle)',
  submitted: 'var(--color-info)',
  reviewing: 'var(--color-warning)',
  approved: 'var(--color-success)',
  enrolled: 'var(--color-success)',
  rejected: 'var(--color-danger)',
  cancelled: 'var(--color-fg-subtle)',
  expired: 'var(--color-fg-subtle)',
  pending: 'var(--color-warning)',
}

const STATUS_LABELS: Record<string, string> = {
  draft: 'Rascunho',
  submitted: 'Enviada',
  reviewing: 'Em análise',
  approved: 'Aprovada',
  enrolled: 'Matriculada',
  rejected: 'Rejeitada',
  cancelled: 'Cancelada',
  expired: 'Expirada',
  pending: 'Pendente',
}

function ByStatus({ data }: { data: PortalAnalytics }) {
  if (data.byStatus.length === 0) {
    return (
      <Card>
        <div class="text-xs uppercase tracking-wider text-fg-subtle mb-2">Por status</div>
        <div class="text-sm text-fg-muted text-center py-4">Sem dados</div>
      </Card>
    )
  }
  const total = data.byStatus.reduce((acc, s) => acc + s.count, 0)
  return (
    <Card>
      <div class="text-xs uppercase tracking-wider text-fg-subtle mb-3">Por status</div>
      <ul class="space-y-2">
        {[...data.byStatus].sort((a, b) => b.count - a.count).map((s) => {
          const pct = total > 0 ? Math.max(2, Math.round((s.count / total) * 100)) : 0
          return (
            <li key={s.status} class="flex items-center gap-3">
              <span class="text-xs text-fg-muted w-28 truncate" title={s.status}>
                {STATUS_LABELS[s.status] ?? s.status}
              </span>
              <span class="flex-1 h-2 rounded-full bg-surface-3 overflow-hidden">
                <span
                  class="block h-full"
                  style={{ width: `${pct}%`, background: STATUS_COLORS[s.status] ?? 'var(--color-accent)' }}
                />
              </span>
              <span class="text-xs text-fg w-10 text-right tabular-nums">{s.count}</span>
            </li>
          )
        })}
      </ul>
    </Card>
  )
}

function BySource({ data }: { data: PortalAnalytics }) {
  if (data.bySource.length === 0) {
    return (
      <Card>
        <div class="text-xs uppercase tracking-wider text-fg-subtle mb-2">Origens (UTM)</div>
        <div class="text-sm text-fg-muted text-center py-4">Sem dados</div>
      </Card>
    )
  }
  const total = data.bySource.reduce((acc, s) => acc + s.count, 0)
  return (
    <Card>
      <div class="text-xs uppercase tracking-wider text-fg-subtle mb-3">Origens (UTM)</div>
      <ul class="space-y-2">
        {data.bySource.map((s) => {
          const pct = total > 0 ? Math.max(2, Math.round((s.count / total) * 100)) : 0
          return (
            <li key={s.source} class="flex items-center gap-3">
              <span class="text-xs text-fg-muted w-28 truncate" title={s.source}>{s.source}</span>
              <span class="flex-1 h-2 rounded-full bg-surface-3 overflow-hidden">
                <span class="block h-full bg-accent" style={{ width: `${pct}%` }} />
              </span>
              <span class="text-xs text-fg w-10 text-right tabular-nums">{s.count}</span>
            </li>
          )
        })}
      </ul>
    </Card>
  )
}
