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

const solidClasses: Record<Tone, string> = {
  neutral: 'bg-fg-muted text-white',
  accent: 'bg-accent text-fg-on-brand',
  success: 'bg-success text-white',
  warning: 'bg-warning text-white',
  danger: 'bg-danger text-white',
  info: 'bg-info text-white',
}

export function Badge({ tone = 'neutral', solid = false, children, class: className, style, title }: BadgeProps) {
  return (
    <span
      class={cn(
        'inline-flex items-center h-5 px-2 rounded-full text-[0.6875rem] font-medium tabular-nums',
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
