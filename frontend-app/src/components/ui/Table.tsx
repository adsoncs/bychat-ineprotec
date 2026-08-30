import type { ComponentChildren, JSX } from 'preact'
import { cn } from '@/lib/cn'

type Align = 'left' | 'right' | 'center'

interface TableProps {
  children: ComponentChildren
  /** Largura mínima antes de a tabela rolar na horizontal (ex.: `'40rem'`). */
  minWidth?: string | undefined
  class?: string | undefined
}

/**
 * Tabela de dados do painel.
 *
 * Existe porque não existia: 56 arquivos montavam `<table>` na mão, cada um com
 * o seu padding, o seu cabeçalho e a sua altura de linha. O resultado era que a
 * densidade mudava de tela para tela sem ninguém ter decidido isso, e qualquer
 * ajuste de pele parava na porta de cada arquivo.
 *
 * O `<Table>` já vem com o contêiner de rolagem horizontal próprio: conteúdo
 * largo rola dentro dele, e o corpo da página nunca rola de lado.
 *
 * A aparência mora em `.data-table` (styles/global.css); estes componentes só
 * carregam a estrutura, para que a próxima mudança de densidade seja uma linha
 * de CSS e não 56 arquivos.
 */
export function Table({ children, minWidth, class: className }: TableProps) {
  return (
    <div class="-mx-4 overflow-x-auto px-4">
      <table class={cn('data-table', className)} style={minWidth ? { minWidth } : undefined}>
        {children}
      </table>
    </div>
  )
}

export function THead({ children }: { children: ComponentChildren }) {
  return <thead>{children}</thead>
}

export function TBody({ children }: { children: ComponentChildren }) {
  return <tbody>{children}</tbody>
}

type RowProps = JSX.IntrinsicElements['tr'] & { children?: ComponentChildren }

export function TR({ children, class: className, ...rest }: RowProps) {
  return (
    <tr class={className} {...rest}>
      {children}
    </tr>
  )
}

type CellProps = {
  children?: ComponentChildren
  align?: Align | undefined
  colSpan?: number | undefined
  class?: string | undefined
  title?: string | undefined
}

export function TH({ children, align, colSpan, class: className }: CellProps) {
  return (
    <th scope="col" data-align={align} colSpan={colSpan} class={className}>
      {children}
    </th>
  )
}

export function TD({ children, align, colSpan, class: className, title }: CellProps) {
  return (
    <td data-align={align} colSpan={colSpan} class={className} title={title}>
      {children}
    </td>
  )
}

/**
 * Linha de "nada aqui".
 *
 * Uma tabela vazia com só o cabeçalho lê como carregamento travado. Esta linha
 * ocupa a largura toda e hospeda o <EmptyState>, que diz o que houve e o que
 * fazer — e o `data-empty` tira o padding da célula para o estado vazio ficar
 * centrado no espaço inteiro, não deslocado pelo recuo da coluna.
 */
export function TEmpty({ colSpan, children }: { colSpan: number; children: ComponentChildren }) {
  return (
    <tr data-empty>
      <td colSpan={colSpan}>{children}</td>
    </tr>
  )
}
