import type { ComponentChildren, JSX } from 'preact'
import { cn } from '@/lib/cn'

type CardProps = JSX.IntrinsicElements['div'] & {
  children?: ComponentChildren
}

/**
 * Container base de superfície elevada.
 * Usado por KpiCard, listagens, painéis de detalhe.
 */
export function Card({ children, class: className, className: classNameAlt, ...rest }: CardProps) {
  return (
    <div
      class={cn(
        'rounded-lg border border-border bg-surface-2 p-4',
        className,
        classNameAlt,
      )}
      {...rest}
    >
      {children}
    </div>
  )
}

export function CardHeader({ children, class: className, ...rest }: CardProps) {
  return (
    <div class={cn('mb-3 flex items-center justify-between gap-2', className)} {...rest}>
      {children}
    </div>
  )
}

export function CardTitle({ children, class: className, ...rest }: CardProps) {
  return (
    <h3 class={cn('text-sm font-semibold text-fg', className)} {...rest}>
      {children}
    </h3>
  )
}
