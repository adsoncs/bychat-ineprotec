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

/**
 * WhatsApp em CONTORNO — para ficar ao lado dos ícones de ação.
 *
 * O logo oficial é um glifo sólido numa grade de 32. Encolhido para 13px e
 * pintado de cinza, ele lê mais leve que os vizinhos: os ícones do painel são
 * contorno de 1,5px absoluto na grade 24, e o glifo não tem traço nenhum para
 * casar com isso. Este desenho é o `brand-whatsapp` do Tabler — a mesma fonte
 * do resto do set —, então o peso bate exatamente.
 *
 * O glifo sólido continua existindo em `WhatsappSend.WhatsappIcon`: no botão
 * verde ele é branco sobre cor cheia, e ali a silhueta é o que se reconhece.
 */
export function WhatsappOutline(props: CustomIconProps): JSX.Element {
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
      <path d="M3 21l1.65 -3.8a9 9 0 1 1 3.4 2.9l-5.05 .9" />
      <path d="M9 10a.5 .5 0 0 0 1 0v-1a.5 .5 0 0 0 -1 0v1a5 5 0 0 0 5 5h1a.5 .5 0 0 0 0 -1h-1a.5 .5 0 0 0 0 1" />
    </svg>
  )
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

/**
 * Tela cheia — entrar e sair.
 *
 * Não existe no set gerado, e o set não se edita à mão. São quatro cantos
 * apontando para fora (entrar) e para dentro (sair), na mesma grade 24 e com o
 * mesmo traço dos vizinhos, para o botão não destoar na fileira de utilidades.
 */
export function Maximize(props: CustomIconProps): JSX.Element {
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
      <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
    </svg>
  )
}

export function Minimize(props: CustomIconProps): JSX.Element {
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
      <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" />
    </svg>
  )
}
