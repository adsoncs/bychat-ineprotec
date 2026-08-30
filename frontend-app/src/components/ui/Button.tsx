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

/* Preenchido = `fill-raised` (fio de luz forte no topo + sombra curta): o botão
 * lê como uma tecla acima da superfície, não como um retângulo colorido.
 * `secondary` é uma superfície, então usa `surface-raised` como o <Card>.
 * `ghost` continua sem corpo — é o único que não é objeto. */
const variantClasses: Record<Variant, string> = {
  primary: 'bg-accent text-fg-on-brand hover:bg-accent-hover active:bg-accent-active fill-raised',
  secondary: 'bg-surface-2 text-fg border border-border hover:bg-surface-3 surface-raised',
  ghost: 'bg-transparent text-fg hover:bg-surface-2',
  danger: 'bg-danger text-fg-on-brand hover:opacity-90 fill-raised',
  success: 'bg-success text-fg-on-brand hover:opacity-90 fill-raised',
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
        'inline-flex items-center justify-center rounded-md font-semibold select-none',
        /* A transição saiu do utilitário `transition-colors` e foi para o CSS
           (`.btn-motion`): o utilitário só anima COR, e o botão preenchido
           precisa animar também a sombra e o deslocamento de 1px do hover.
           Como utilitários do Tailwind vencem a @layer base, deixá-lo aqui
           anularia silenciosamente as outras duas propriedades. */
        'btn-motion',
        /* O foco era `ring` com `ring-offset-surface`, e `surface` passou a ser o
           FUNDO da janela: dentro do painel isso desenhava um halo preto em volta
           do botão. `outline` compõe sobre o que estiver atrás, seja qual for. */
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
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
