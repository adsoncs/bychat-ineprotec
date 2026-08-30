import type { ComponentChildren, JSX } from 'preact'
import { cn } from '@/lib/cn'

type Tone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info'

interface BadgeProps {
  tone?: Tone | undefined
  /** Fundo cheio (cor sólida + texto branco). Útil para evitar texto-em-fundo da mesma cor. */
  solid?: boolean | undefined
  children: ComponentChildren
  class?: string | undefined
  style?: JSX.CSSProperties | undefined
  /** Tooltip nativo (atributo title) */
  title?: string | undefined
}

const toneClasses: Record<Tone, string> = {
  neutral: 'bg-surface-3 text-fg-muted',
  accent: 'bg-accent text-fg-on-brand',
  success: 'bg-success/15 text-success',
  warning: 'bg-warning/15 text-warning',
  danger: 'bg-danger/15 text-danger',
  info: 'bg-info/15 text-info',
}

/* `text-white` era um bug de contraste, não uma escolha: no tema escuro os tons
 * de estado são CLAROS (success em L=0.78, warning em L=0.80), e branco por cima
 * deles dava 1,69:1 a 3,15:1 — muito abaixo do mínimo de 4,5:1. `fg-on-brand` é
 * exatamente o token para "texto sobre preenchimento sólido" e resolve nos dois
 * temas de uma vez: escuro no tema escuro (5,4:1 a 10,0:1), branco no claro
 * (5,4:1 a 6,2:1). */
const solidClasses: Record<Tone, string> = {
  neutral: 'bg-fg-muted text-fg-on-brand',
  accent: 'bg-accent text-fg-on-brand',
  success: 'bg-success text-fg-on-brand',
  warning: 'bg-warning text-fg-on-brand',
  danger: 'bg-danger text-fg-on-brand',
  info: 'bg-info text-fg-on-brand',
}

export function Badge({ tone = 'neutral', solid = false, children, class: className, style, title }: BadgeProps) {
  return (
    <span
      class={cn(
        'inline-flex items-center h-5 px-2 rounded-full text-2xs font-semibold tabular-nums',
        solid && 'fill-raised',
        (solid ? solidClasses : toneClasses)[tone],
        className,
      )}
      style={style}
      title={title}
    >
      {children}
    </span>
  )
}
