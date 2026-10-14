import type { ComponentChildren } from 'preact'
import { useCan } from '@/hooks/usePermissions'

/**
 * Para telas de configuração com muitos campos: quem tem só "Ver" enxerga
 * tudo, mas nada responde — o <fieldset disabled> desliga de uma vez todo
 * input, select e botão lá dentro (abas e links ficam FORA do bloco). Melhor
 * do que deixar a pessoa preencher um formulário inteiro para receber
 * "sem permissão" no Salvar.
 */
export function SomenteLeitura({ tela, acao = 'edit', aviso = true, children }: {
  tela: string
  acao?: 'edit' | 'create'
  /** Página com vários blocos: o aviso aparece uma vez só, no topo dela. */
  aviso?: boolean
  children: ComponentChildren
}) {
  const pode = useCan(tela, acao)
  if (pode) return <>{children}</>
  return (
    <>
      {aviso && <div class="mb-3 rounded-md border border-border bg-surface-2 px-3 py-2 text-xs text-fg-muted">
        Você tem acesso só de leitura nesta tela. Para alterar, peça a um administrador a permissão "Editar" em Configurações → Permissões.
      </div>}
      <fieldset disabled class="m-0 min-w-0 border-0 p-0">{children}</fieldset>
    </>
  )
}
