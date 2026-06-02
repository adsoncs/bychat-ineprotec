import { Link } from 'wouter-preact'
import { cn } from '@/lib/cn'

export interface TocItem {
  id: string
  label: string
  count?: number | string | null
}

interface Props {
  items: TocItem[]
  /** ID do lead — usado pra construir as URLs `/leads/:id/:section` */
  leadId: number
  /** Seção atualmente ativa (vem da URL) */
  active: string
}

/**
 * Menu lateral de seções do lead. Cada item é um wouter Link que navega
 * pra `/leads/:id/:section`. A seção ativa é destacada.
 */
export function LeadDetailToc({ items, leadId, active }: Props) {
  return (
    <nav
      aria-label="Navegação do lead"
      class="sticky self-start space-y-0.5"
      style={{ top: 'calc(var(--topbar-h) + 1rem)' }}
    >
      <p class="text-[0.6875rem] font-medium uppercase tracking-wider text-fg-subtle px-2 mb-1.5">
        Seções
      </p>
      {items.map((item) => {
        const isActive = active === item.id
        return (
          <Link
            key={item.id}
            href={`/leads/${leadId}/${item.id}`}
            class={cn(
              'flex items-center justify-between gap-2 px-2 h-8 rounded-md text-sm transition-colors',
              isActive
                ? 'bg-accent/10 text-fg font-medium'
                : 'text-fg-muted hover:bg-surface-3/50 hover:text-fg',
            )}
          >
            <span class="truncate flex items-center gap-2">
              <span
                class={cn(
                  'size-1 rounded-full transition-colors',
                  isActive ? 'bg-accent' : 'bg-transparent',
                )}
              />
              {item.label}
            </span>
            {item.count !== undefined && item.count !== null && (
              <span
                class={cn(
                  'min-w-[1.25rem] h-4 px-1 rounded text-[0.625rem] font-medium grid place-items-center',
                  isActive ? 'bg-accent/20 text-fg' : 'bg-surface-3 text-fg-subtle',
                )}
              >
                {item.count}
              </span>
            )}
          </Link>
        )
      })}
    </nav>
  )
}
