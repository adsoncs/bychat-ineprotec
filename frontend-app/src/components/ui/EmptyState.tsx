import type { JSX, ComponentChildren } from 'preact'
import { Inbox } from 'lucide-preact'

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
    <div class="flex flex-col items-center justify-center gap-2 py-8 text-center">
      <span class="text-fg-subtle">{icon ?? <Inbox size={24} />}</span>
      <span class="text-sm font-medium text-fg">{title}</span>
      {description && <span class="text-xs text-fg-muted max-w-sm">{description}</span>}
      {action && <div class="mt-2">{action}</div>}
    </div>
  )
}
