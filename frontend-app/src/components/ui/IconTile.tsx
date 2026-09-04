import type { ComponentChildren } from 'preact'
import { cn } from '@/lib/cn'

export type IconTileTone =
  | 'neutral'
  | 'accent'
  | 'violet'
  | 'orange'
  | 'success'
  | 'warning'
  | 'danger'
  | 'info'

interface IconTileProps {
  children: ComponentChildren
  /** Cor da pastilha. `neutral` fica cinza — use para ícone sem significado próprio. */
  tone?: IconTileTone | undefined
  size?: 'sm' | 'md' | 'lg' | 'xl' | undefined
  class?: string | undefined
}

/**
 * Moldura colorida para um ícone.
 *
 * Existe porque ícone de traço cinza solto no vazio é o que faz um painel
 * parecer genérico: sem moldura ele não tem como carregar estado (ativo,
 * categoria, severidade) nem cor. A pastilha resolve os dois sem trocar o
 * desenho de nenhum ícone.
 *
 * Só a MOLDURA vem daqui. O ícone continua sendo o `<Icon>`/`icon-set` de
 * sempre, e o tamanho dele é escolha de quem chama. A regra é deixar ~3px de
 * respiro de cada lado: 14px na pastilha `sm`, 16px na `md`/`lg`, 24px na `xl`.
 *
 * O visual do estado ativo da barra lateral NÃO está aqui: quem pinta é o
 * `shell.css`, a partir do `data-active` do item, para que a pastilha não
 * precise saber em que contexto está.
 */
export function IconTile({ children, tone = 'neutral', size = 'sm', class: className }: IconTileProps) {
  return (
    <span class={cn('icon-tile', className)} data-tone={tone} data-size={size} aria-hidden="true">
      {children}
    </span>
  )
}
