// components/ui/icons.custom.tsx
//
// Ícones que a biblioteca não cobre (logos de marca, sobretudo). Desenhados no
// mesmo grid do set principal (viewBox 24) e com o mesmo `data-icon`, para que
// a regra de traço não-escalável valha para eles também.

import type { JSX } from 'preact'

interface CustomIconProps {
  size?: number
  strokeWidth?: number
  absoluteStrokeWidth?: boolean
  class?: string
}

/** Instagram — logo de marca, não existe no lucide. */
export function Instagram(props: CustomIconProps): JSX.Element {
  const { size = 24, class: className } = props
  return (
    <svg
      data-icon=""
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width={props.strokeWidth ?? 1.5}
      stroke-linecap="round"
      stroke-linejoin="round"
      class={className}
      aria-hidden="true"
    >
      <rect width="20" height="20" x="2" y="2" rx="5" />
      <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
      <line x1="17.5" x2="17.51" y1="6.5" y2="6.5" />
    </svg>
  )
}
