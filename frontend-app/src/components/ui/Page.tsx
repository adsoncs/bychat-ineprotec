import type { ComponentChildren } from 'preact'
import { useEffect } from 'preact/hooks'
import { usePageHeaderStore } from '@/stores/pageHeader'

interface PageProps {
  title: string
  description?: string
  actions?: ComponentChildren
  children: ComponentChildren
}

/**
 * Layout padrão de páginas migradas: subtítulo opcional, área de ações e corpo
 * com espaçamento vertical entre seções.
 *
 * O TÍTULO não é desenhado aqui — ele sobe para a faixa de página da barra
 * superior, que é onde ele fica agora em toda tela (o mesmo lugar, sempre, é o
 * que faz telas diferentes parecerem o mesmo produto). Desenhar nos dois lugares
 * poria dois títulos iguais um sob o outro em 99 telas.
 */
export function Page({ title, description, actions, children }: PageProps) {
  const setTitle = usePageHeaderStore((s) => s.setTitle)
  useEffect(() => {
    setTitle(title)
    // Ao sair, devolve a faixa ao nome que vem do menu: sem isto, o título de um
    // lead ficaria no topo da tela seguinte até ela registrar o dela.
    return () => setTitle(null)
  }, [title, setTitle])

  return (
    // `stagger`: os blocos da página entram em sequência de 40ms (ver
    // styles/global.css). Como o <Page> remonta a cada rota, a sequência roda
    // na navegação — é ela que confirma "a tela mudou" sem um spinner.
    <div class="space-y-6 stagger">
      {(description || actions) && (
        <header class="flex items-end justify-between gap-4 flex-wrap">
          <div class="min-w-0">
            {description && <p class="text-sm text-fg-muted">{description}</p>}
          </div>
          {/* flex-wrap + min-w-0: a área de ações cresceu (o seletor de período tem
              6 botões) e sem isso ela empurrava o título e estourava a largura. */}
          {actions && <div class="flex min-w-0 max-w-full flex-wrap items-center justify-end gap-2">{actions}</div>}
        </header>
      )}
      {children}
    </div>
  )
}
