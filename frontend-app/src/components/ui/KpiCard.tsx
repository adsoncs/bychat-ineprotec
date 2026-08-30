import type { JSX } from 'preact'
import { IconTile, type IconTileTone } from '@/components/ui/IconTile'

interface KpiCardProps {
  label: string
  value: string | number
  hint?: string | undefined
  icon?: JSX.Element | undefined
  trend?: { value: number; label?: string } | undefined
  loading?: boolean | undefined
  /** Série pra sparkline embutida. Sem `sparklineColor`, segue a cor do `tone`. */
  sparkline?: number[] | undefined
  /** Sobrescreve a cor da sparkline (CSS color). */
  sparklineColor?: string | undefined
  /**
   * Cor do card: pinta a pastilha do ícone e a sparkline.
   *
   * Não é decoração — é o que separa séries. Quatro KPIs lado a lado medindo
   * coisas diferentes, todos no mesmo cinza, viram uma faixa só; com tons
   * distintos o olho encontra o que procura sem ler os rótulos.
   *
   * `accent`, `violet` e `orange` são cores de DADO (categoria).
   * `success`/`warning`/`danger`/`info` são de ESTADO — use só quando o número
   * realmente for bom, ruim ou de alerta, senão o painel passa a gritar sem
   * motivo e o alarme perde o efeito.
   */
  tone?: IconTileTone | undefined
}

/** Cor CSS de cada tom, para a sparkline. */
const toneVar: Record<IconTileTone, string> = {
  neutral: 'var(--color-fg-muted)',
  accent: 'var(--color-accent)',
  violet: 'var(--color-violet)',
  orange: 'var(--color-orange)',
  success: 'var(--color-success)',
  warning: 'var(--color-warning)',
  danger: 'var(--color-danger)',
  info: 'var(--color-info)',
}

/** Ids únicos para os gradientes das sparklines — dois <defs> com o mesmo id
 *  fazem o segundo gráfico herdar a cor do primeiro. */
let gradSeq = 0

/**
 * Card de KPI: rótulo curto, valor grande, dica opcional.
 * Loading mostra skeleton no valor (não no card inteiro — evita layout shift).
 *
 * O valor é o HERÓI do card: 28px em peso 800 com tracking apertado, contra os
 * 10px do rótulo. Essa distância é o que cria hierarquia — não o tamanho do
 * número sozinho. A variação saiu do cinza e virou chip colorido, porque era o
 * dado que responde "melhorou ou piorou?" e estava sendo o menos visível.
 */
export function KpiCard({
  label,
  value,
  hint,
  icon,
  trend,
  loading = false,
  sparkline,
  sparklineColor,
  tone = 'neutral',
}: KpiCardProps) {
  const dir = !trend || trend.value === 0 ? 'flat' : trend.value > 0 ? 'up' : 'down'
  const color = sparklineColor ?? toneVar[tone]

  return (
    <div class="rounded-lg bg-surface-2 p-4 flex flex-col gap-2.5 surface-raised">
      <div class="flex items-center gap-2">
        {icon && <IconTile tone={tone} size="md">{icon}</IconTile>}
        <span class="text-3xs uppercase tracking-[0.12em] text-fg-muted font-semibold">{label}</span>
      </div>
      <div class="flex items-baseline gap-2">
        {loading ? (
          <span class="h-7 w-20 rounded-md bg-surface-3 animate-pulse" />
        ) : (
          <span class="tabular text-[1.75rem] font-extrabold tracking-[-0.035em] leading-none text-fg">
            {value}
          </span>
        )}
        {trend && !loading && (
          <span class="delta-chip" data-dir={dir}>
            {trend.value > 0 ? '+' : ''}
            {trend.value}
            {trend.label ? ` ${trend.label}` : '%'}
          </span>
        )}
      </div>
      {sparkline && sparkline.length > 1 && !loading && (
        <Sparkline values={sparkline} color={color} />
      )}
      {hint && <span class="text-xs text-fg-muted">{hint}</span>}
    </div>
  )
}

function Sparkline({ values, color }: { values: number[]; color: string }) {
  const W = 100, H = 26
  const min = Math.min(0, ...values)
  const max = Math.max(0, ...values)
  const range = max - min || 1
  const step = values.length > 1 ? W / (values.length - 1) : 0
  const yOf = (v: number) => H - ((v - min) / range) * H
  const path = values.map((v, i) => `${i === 0 ? 'M' : 'L'} ${i * step} ${yOf(v)}`).join(' ')
  const area = `${path} L ${(values.length - 1) * step} ${H} L 0 ${H} Z`
  const lastY = yOf(values[values.length - 1] as number)
  const id = `spk${(gradSeq = (gradSeq + 1) % 1e6)}`

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" class="w-full h-6" aria-hidden="true">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color={color} stop-opacity="0.4" />
          <stop offset="1" stop-color={color} stop-opacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${id})`} />
      <path
        d={path}
        fill="none"
        stroke={color}
        stroke-width="1.5"
        stroke-linejoin="round"
        stroke-linecap="round"
        vector-effect="non-scaling-stroke"
      />
      {/* O ponto final marca "onde estamos agora" — sem ele a linha termina no
          nada e o olho não sabe qual ponta é o presente. `r` em unidades do
          viewBox esticadas por `preserveAspectRatio="none"` viraria elipse, por
          isso ele é desenhado como um traço redondo de comprimento zero. */}
      <path
        d={`M ${W} ${lastY} L ${W} ${lastY}`}
        stroke={color}
        stroke-width="4.5"
        stroke-linecap="round"
        vector-effect="non-scaling-stroke"
      />
    </svg>
  )
}
