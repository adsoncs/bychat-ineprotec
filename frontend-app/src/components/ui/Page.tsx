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
        {actions && <div class="flex items-center gap-2">{actions}</div>}
      </header>
      {children}
    </div>
  )
}
