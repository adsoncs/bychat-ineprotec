import { leadSourceLabel, leadSourceColor } from '@/lib/leadSourceLabels'
import { cn } from '@/lib/cn'

interface SourceDotProps {
  /** Valor bruto do campo `source` do Lead (ex.: `whatsapp`, `db_connector:3`). */
  source: string | null | undefined
  /** Só o ponto, sem o rótulo — para colunas estreitas. */
  compact?: boolean | undefined
  class?: string | undefined
}

/**
 * Origem do lead como ponto colorido + rótulo.
 *
 * O ponto carrega a cor da plataforma (ver `leadSourceColor`) e o halo em volta
 * é a mesma cor a 18% — sem ele, um ponto de 7px sobre superfície escura
 * praticamente some. O rótulo continua vindo de `leadSourceLabel`, então uma
 * origem nova aparece escrita mesmo antes de alguém lhe dar cor.
 */
export function SourceDot({ source, compact = false, class: className }: SourceDotProps) {
  const color = leadSourceColor(source)
  const label = leadSourceLabel(source)
  return (
    <span class={cn('inline-flex items-center gap-1.5 text-xs text-fg-muted', className)} title={compact ? label : undefined}>
      <span
        class="size-1.5 shrink-0 rounded-full"
        style={{ background: color, boxShadow: `0 0 0 2px color-mix(in oklab, ${color} 18%, transparent)` }}
      />
      {!compact && label}
    </span>
  )
}
