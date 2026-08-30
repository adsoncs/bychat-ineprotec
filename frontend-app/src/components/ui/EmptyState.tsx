import type { JSX, ComponentChildren } from 'preact'
import { Inbox } from '@/components/ui/icon-set'

interface EmptyStateProps {
  title?: string | undefined
  description?: string | undefined
  icon?: JSX.Element | undefined
  action?: ComponentChildren | undefined
}

export function EmptyState({
  title = 'Sem dados ainda',
  description,
  icon,
  action,
}: EmptyStateProps) {
  return (
    /* Estado vazio desenhado, não só ausente: o ícone ganha um poço redondo, o
       título ganha peso e a descrição ganha largura de leitura. Uma tela vazia é
       a primeira que muita gente vê num módulo novo — deixá-la como duas linhas
       de cinza é onde o painel parecia inacabado. */
    <div class="flex flex-col items-center justify-center gap-3 py-12 text-center">
      <span class="grid size-12 place-items-center rounded-full bg-surface-inset surface-inset text-fg-muted">
        {icon ?? <Inbox size={22} />}
      </span>
      <div class="flex flex-col gap-1">
        <span class="text-sm font-semibold tracking-tight text-fg">{title}</span>
        {description && <span class="text-xs text-fg-muted max-w-[38ch]">{description}</span>}
      </div>
      {action && <div class="mt-1">{action}</div>}
    </div>
  )
}
