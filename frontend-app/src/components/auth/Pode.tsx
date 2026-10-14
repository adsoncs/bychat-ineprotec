import type { ComponentChildren } from 'preact'
import { useCan, type PermAction } from '@/hooks/usePermissions'

/**
 * Mostra o conteúdo só para quem tem a ação na tela/módulo. Botão que levaria
 * a um "sem permissão" não aparece — com `senao`, aparece outra coisa no lugar.
 */
export function Pode({ tela, acao, senao, children }: {
  tela: string
  acao: PermAction
  senao?: ComponentChildren
  children: ComponentChildren
}) {
  return <>{useCan(tela, acao) ? children : (senao ?? null)}</>
}
