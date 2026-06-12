import { X } from 'lucide-preact'
import { useLocation } from 'wouter-preact'
import { cn } from '@/lib/cn'
import { BrandLogo } from '@/components/BrandLogo'

interface SidebarHeaderProps {
  iconOnly: boolean
  showCloseButton?: boolean
  onClose?: () => void
}

const HOME_HREF = '/app/dashboard'

export function SidebarHeader({ iconOnly, showCloseButton = false, onClose }: SidebarHeaderProps) {
  const [, navigate] = useLocation()

  function goHome(e: MouseEvent) {
    e.preventDefault()
    navigate(HOME_HREF)
    onClose?.()
  }

  return (
    <div
      class={cn(
        'flex items-center gap-2 px-3 border-b border-[color:var(--color-border)]',
        'h-[var(--topbar-h)] flex-none',
        iconOnly && 'justify-center px-0',
      )}
    >
      <a
        href={HOME_HREF}
        onClick={goHome}
        aria-label="Ir para a página inicial"
        class={cn(
          'inline-flex items-center rounded-md cursor-pointer transition-opacity hover:opacity-80',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)]',
        )}
      >
        <BrandLogo variant="admin" iconOnly={iconOnly} />
      </a>
      {showCloseButton && (
        <button
          type="button"
          class="ml-auto size-8 rounded-md text-fg-muted hover:bg-surface-3 hover:text-fg flex items-center justify-center"
          onClick={onClose}
          aria-label="Fechar menu"
        >
          <X size={18} />
        </button>
      )}
    </div>
  )
}
