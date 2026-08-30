import { useMemo, useState } from 'preact/hooks'

export interface LineChartPoint {
  label: string
  value: number
}

interface LineChartProps {
  data: LineChartPoint[]
  height?: number
  /** Cor da linha. Default: var(--color-accent) */
  color?: string
}

/**
 * Line chart minimalista em SVG. Sem libs externas — área de plot escala
 * automaticamente, eixo Y com 4 ticks, eixo X mostra primeiro/último/meio.
 */
export function LineChart({ data, height = 180, color = 'var(--color-accent)' }: LineChartProps) {
  const [hover, setHover] = useState<number | null>(null)
  const W = 600 // viewBox width — escala automaticamente
  const H = height
  const padL = 32
  const padR = 12
  const padT = 12
  const padB = 24

  const { points, max, ticks } = useMemo(() => {
    if (data.length === 0) return { points: [], max: 0, ticks: [] as number[] }
    const values = data.map((d) => d.value)
    const max = Math.max(...values, 1)
    const w = W - padL - padR
    const h = H - padT - padB
    const stepX = data.length === 1 ? 0 : w / (data.length - 1)
    const points = data.map((d, i) => ({
      x: padL + i * stepX,
      y: padT + h - (d.value / (max || 1)) * h,
      data: d,
      i,
    }))
    const tickStep = Math.ceil(max / 4)
    const ticks = [0, tickStep, tickStep * 2, tickStep * 3, tickStep * 4].filter((t) => t <= max + tickStep)
    return { points, max, ticks }
  }, [data, H])

  if (data.length === 0) {
    return (
      <div class="flex items-center justify-center text-xs text-fg-muted" style={{ height: `${H}px` }}>
        Sem dados no período
      </div>
    )
  }

  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ')
  const areaPath = `${linePath} L${points[points.length - 1]!.x},${H - padB} L${points[0]!.x},${H - padB} Z`

  const labelIndices = data.length <= 1 ? [0] : data.length <= 5 ? data.map((_, i) => i) : [0, Math.floor(data.length / 2), data.length - 1]

  return (
    <div class="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        class="w-full"
        style={{ height: `${H}px` }}
        onMouseLeave={() => setHover(null)}
      >
        {/* Y ticks */}
        {ticks.map((t) => {
          const y = padT + (H - padT - padB) * (1 - t / (max || 1))
          return (
            <g key={t}>
              <line x1={padL} y1={y} x2={W - padR} y2={y} stroke="var(--color-border)" stroke-dasharray="2 4" />
              <text x={padL - 6} y={y + 3} text-anchor="end" font-size="9" fill="var(--color-fg-muted)">{t}</text>
            </g>
          )
        })}
        {/* Area */}
        <path d={areaPath} fill={color} fill-opacity="0.12" />
        {/* Line */}
        <path d={linePath} fill="none" stroke={color} stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
        {/* Points */}
        {points.map((p) => (
          <circle
            key={p.i}
            cx={p.x}
            cy={p.y}
            r={hover === p.i ? 4 : 2.5}
            fill={color}
            stroke="var(--color-surface-2)"
            stroke-width="1.5"
            onMouseEnter={() => setHover(p.i)}
            style={{ cursor: 'pointer' }}
          />
        ))}
        {/* X labels */}
        {labelIndices.map((i) => {
          const p = points[i]!
          return (
            <text key={i} x={p.x} y={H - 8} text-anchor="middle" font-size="9" fill="var(--color-fg-muted)">
              {p.data.label}
            </text>
          )
        })}
        {/* Hover line */}
        {hover !== null && (
          <line
            x1={points[hover]!.x}
            y1={padT}
            x2={points[hover]!.x}
            y2={H - padB}
            stroke={color}
            stroke-opacity="0.4"
            stroke-dasharray="2 2"
          />
        )}
      </svg>
      {hover !== null && points[hover] && (
        <div
          class="absolute pointer-events-none rounded-md bg-surface-3 border border-border px-2 py-1 text-xs whitespace-nowrap shadow-md"
          style={{
            left: `${(points[hover].x / W) * 100}%`,
            top: `${(points[hover].y / H) * 100}%`,
            transform: 'translate(-50%, -110%)',
          }}
        >
          <div class="text-fg font-medium tabular-nums">{points[hover].data.value}</div>
          <div class="text-fg-muted">{points[hover].data.label}</div>
        </div>
      )}
    </div>
  )
}
