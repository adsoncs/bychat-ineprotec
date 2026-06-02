import type { JSX } from 'preact'
import { cn } from '@/lib/cn'

interface KpiCardProps {
  label: string
  value: string | number
  hint?: string | undefined
  icon?: JSX.Element | undefined
  trend?: { value: number; label?: string } | undefined
  loading?: boolean | undefined
  /** Série pra sparkline embutida (uma barra por valor). currentColor / cor do ícone */
  sparkline?: number[] | undefined
  /** Cor da sparkline (CSS color). Default: currentColor herdado */
  sparklineColor?: string | undefined
}

/**
 * Card de KPI: rótulo curto, valor grande, dica opcional.
 * Loading mostra skeleton no valor (não no card inteiro — evita layout shift).
 */
export function KpiCard({ label, value, hint, icon, trend, loading = false, sparkline, sparklineColor }: KpiCardProps) {
  const trendPositive = trend && trend.value > 0
  const trendNegative = trend && trend.value < 0

  return (
    <div class="rounded-lg border border-border bg-surface-2 p-4 flex flex-col gap-2">
      <div class="flex items-center justify-between gap-2">
        <span class="text-xs uppercase tracking-wider text-fg-subtle font-medium">{label}</span>
        {icon && <span class="text-fg-subtle">{icon}</span>}
      </div>
      <div class="flex items-baseline gap-2">
        {loading ? (
          <span class="h-7 w-20 rounded bg-surface-3 animate-pulse" />
        ) : (
          <span class="text-2xl font-semibold text-fg">{value}</span>
        )}
        {trend && !loading && (
          <span
            class={cn(
              'text-xs font-medium',
              trendPositive && 'text-success',
              trendNegative && 'text-danger',
              !trendPositive && !trendNegative && 'text-fg-subtle',
            )}
          >
            {trendPositive ? '+' : ''}
            {trend.value}
            {trend.label ? ` ${trend.label}` : '%'}
          </span>
        )}
      </div>
      {sparkline && sparkline.length > 1 && !loading && (
        <Sparkline values={sparkline} color={sparklineColor} />
      )}
      {hint && <span class="text-xs text-fg-muted">{hint}</span>}
    </div>
  )
}

function Sparkline({ values, color = 'currentColor' }: { values: number[]; color?: string | undefined }) {
  const W = 100, H = 22
  const min = Math.min(0, ...values)
  const max = Math.max(0, ...values)
  const range = max - min || 1
  const step = values.length > 1 ? W / (values.length - 1) : 0
  const yOf = (v: number) => H - ((v - min) / range) * H
  const path = values.map((v, i) => `${i === 0 ? 'M' : 'L'} ${i * step} ${yOf(v)}`).join(' ')
  const area = `${path} L ${(values.length - 1) * step} ${H} L 0 ${H} Z`
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" class="w-full h-5" style={{ color }}>
      <path d={area} fill={color} fill-opacity="0.15" />
      <path d={path} fill="none" stroke={color} stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round" />
    </svg>
  )
}
