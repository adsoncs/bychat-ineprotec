// components/ui/Icon.tsx
//
// Camada única de ícone do painel. Existe por três motivos:
//
//  1. ESCALA. Antes disso o app usava 19 tamanhos diferentes (`size={8}` a
//     `size={48}`, com dois `size={1}` que eram bug) espalhados por 228
//     arquivos. Aqui há 5 degraus nomeados e é isso.
//  2. PESO DO TRAÇO. O lucide desenha em viewBox 24 com traço de 2 unidades —
//     o que na tela vira 0,66px num ícone de 8px e 2px num de 24px. Ícones
//     lado a lado ficavam com espessuras diferentes. `absoluteStrokeWidth`
//     fixa o traço em px de tela (ver ICON_STROKE), então 12px e 24px têm o
//     mesmo peso óptico.
//  3. TROCA DE BIBLIOTECA. Enquanto os call sites usarem <Icon name="..."/>,
//     migrar de lucide para outro set (Streamline, Phosphor…) é reescrever
//     `icons.ts` — não 2.014 chamadas.
//
// O traço não é calibrado aqui: quem faz isso é a regra `svg[data-icon] *` em
// styles/global.css. Vale para qualquer ícone do set, inclusive os que as telas
// dimensionam por classe CSS.

import type { ComponentChildren } from 'preact'
import { cn } from '@/lib/cn'
import { ICONS, type IconName } from './icons'

/** Degraus de tamanho. Fora daqui, só com justificativa (hero/ilustração). */
export const ICON_SIZE = {
  // 10px existe por causa dos micro-chips: rótulos com fonte de 10-11px (as
  // etiquetas "Grupo"/"Lead" da lista de conversas, o "x" de remover tag). Um
  // ícone de 12px ao lado de um texto de 10px fica maior que a própria letra.
  xxs: 10,
  xs: 12, // metadado denso: timestamps, badges, chips
  sm: 14, // padrão de texto corrido e botões pequenos
  md: 16, // padrão de UI: botões, campos, navegação
  lg: 20, // títulos de seção, ações em destaque
  xl: 24, // estados vazios, cabeçalhos de modal
} as const

export type IconSize = keyof typeof ICON_SIZE

/** Espessura do traço em PX DE TELA, constante em qualquer tamanho. */
export const ICON_STROKE = 1.5

export type IconComponent = (props: {
  size?: number
  class?: string
}) => ComponentChildren

interface IconProps {
  /** Nome no registry (`icons.ts`) — preferido: é o que permite trocar de set. */
  name?: IconName
  /** Componente lucide direto — ponte para telas ainda não migradas. */
  icon?: IconComponent
  size?: IconSize
  class?: string
  /** Rótulo acessível. Sem ele o ícone é decorativo (aria-hidden pelo lucide). */
  label?: string
}

export function Icon({ name, icon, size = 'md', class: className, label }: IconProps) {
  const Cmp = (icon ?? (name ? ICONS[name] : undefined)) as IconComponent | undefined
  const px = ICON_SIZE[size]

  if (!Cmp) {
    // Nome desconhecido: círculo neutro, mesma caixa. Nunca quebra o layout.
    return (
      <svg
        data-icon=""
        width={px}
        height={px}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width={ICON_STROKE}
        stroke-linecap="round"
        stroke-linejoin="round"
        class={cn('shrink-0', className)}
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="9" />
      </svg>
    )
  }

  return (
    <Cmp
      size={px}
      class={cn('shrink-0', className)}
      {...(label ? { 'aria-label': label, role: 'img' } : {})}
    />
  )
}
