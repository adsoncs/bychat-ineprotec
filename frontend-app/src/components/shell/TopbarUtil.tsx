// components/shell/TopbarUtil.tsx
//
// O botão da fileira de utilidades da barra superior.
//
// Existe como componente próprio porque é EXATAMENTE a regra que faz vários
// ícones no topo lerem como um bloco só, em vez de uma prateleira: mesmo
// diâmetro, mesmo cinza, mesmo hover circular e o contador sempre no mesmo
// ponto. Quando cada botão trazia as próprias classes, dois contadores vizinhos
// apareciam em alturas diferentes — e é esse tipo de desalinho que faz uma barra
// parecer montada aos pedaços.

import type { ComponentChildren } from 'preact'
import { forwardRef } from 'preact/compat'
import { cn } from '@/lib/cn'

export interface TopbarUtilProps {
  titulo: string
  onClick?: (() => void) | undefined
  children: ComponentChildren
  badge?: number | undefined
  /** `warning` é para pendência que atrasa alguém; o padrão é a cor de marca. */
  tom?: 'accent' | 'warning' | undefined
}

export const TopbarUtil = forwardRef<HTMLButtonElement, TopbarUtilProps>(
  function TopbarUtil({ titulo, onClick, children, badge, tom, ...rest }, ref) {
    const n = badge ?? 0
    return (
      <button
        {...rest}
        ref={ref}
        type="button"
        class="relative size-9 grid place-items-center rounded-full text-fg-muted hover:bg-surface-3 hover:text-fg transition-colors shrink-0"
        aria-label={n > 0 ? `${titulo} — ${n}` : titulo}
        title={titulo}
        onClick={onClick}
      >
        {children}
        {n > 0 && (
          <span
            class={cn(
              'absolute top-0 right-0 min-w-[15px] h-[15px] px-1 rounded-full',
              'text-3xs font-bold leading-none flex items-center justify-center',
              'ring-2 ring-surface',
              tom === 'warning' ? 'bg-warning text-fg-on-brand' : 'bg-accent text-fg-on-brand',
            )}
          >
            {n > 99 ? '99+' : n}
          </span>
        )}
      </button>
    )
  },
)
