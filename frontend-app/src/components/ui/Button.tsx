import type { ComponentChildren, JSX } from 'preact'
import { cn } from '@/lib/cn'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success'
type Size = 'sm' | 'md' | 'lg'

type NativeButtonAttrs = Omit<JSX.IntrinsicElements['button'], 'size' | 'children'>

export interface ButtonProps extends NativeButtonAttrs {
  variant?: Variant
  size?: Size
  /** quando true, renderiza só ícone (square) */
  iconOnly?: boolean
  children?: ComponentChildren
}

const variantClasses: Record<Variant, string> = {
  primary: 'bg-accent text-fg-on-brand hover:bg-accent-hover active:bg-accent-active',
  secondary: 'bg-surface-2 text-fg border border-border hover:bg-surface-3',
  ghost: 'bg-transparent text-fg hover:bg-surface-2',
  danger: 'bg-danger text-fg-on-brand hover:opacity-90',
  success: 'bg-success text-fg-on-brand hover:opacity-90',
}

const sizeClasses: Record<Size, string> = {
  sm: 'h-8 px-3 text-xs gap-1.5',
  md: 'h-9 px-4 text-sm gap-2',
  lg: 'h-11 px-5 text-base gap-2',
}

const iconOnlyOverrides: Record<Size, string> = {
  sm: 'w-8 px-0',
  md: 'w-9 px-0',
  lg: 'w-11 px-0',
}

export function Button({
  variant = 'primary',
  size = 'md',
  iconOnly = false,
  class: className,
  className: classNameAlt,
  type = 'button',
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      class={cn(
        'inline-flex items-center justify-center rounded-md font-medium select-none',
        'transition-colors duration-150',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface',
        'disabled:opacity-50 disabled:pointer-events-none',
        variantClasses[variant],
        sizeClasses[size],
        iconOnly && iconOnlyOverrides[size],
        className,
        classNameAlt,
      )}
      {...rest}
    >
      {children}
    </button>
  )
}
