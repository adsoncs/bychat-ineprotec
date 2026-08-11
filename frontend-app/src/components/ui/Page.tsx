import type { ComponentChildren } from 'preact'

interface PageProps {
  title: string
  description?: string
  actions?: ComponentChildren
  children: ComponentChildren
}

/**
 * Layout padrão de páginas migradas: cabeçalho com título, subtítulo opcional
 * e área de ações; corpo com espaçamento vertical entre seções.
 */
export function Page({ title, description, actions, children }: PageProps) {
  return (
    <div class="space-y-6">
      <header class="flex items-end justify-between gap-4 flex-wrap">
        <div class="min-w-0">
          <h1 class="text-2xl font-semibold tracking-tight text-fg truncate">{title}</h1>
          {description && <p class="text-sm text-fg-muted mt-1">{description}</p>}
        </div>
        {/* flex-wrap + min-w-0: a área de ações cresceu (o seletor de período tem
            6 botões) e sem isso ela empurrava o título e estourava a largura. */}
        {actions && <div class="flex min-w-0 max-w-full flex-wrap items-center justify-end gap-2">{actions}</div>}
      </header>
      {children}
    </div>
  )
}
