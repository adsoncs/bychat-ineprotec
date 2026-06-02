import { X } from 'lucide-preact'
import { cn } from '@/lib/cn'
import { BrandLogo } from '@/components/BrandLogo'

interface SidebarHeaderProps {
  iconOnly: boolean
  showCloseButton?: boolean
  onClose?: () => void
}

export function SidebarHeader({ iconOnly, showCloseButton = false, onClose }: SidebarHeaderProps) {
  return (
    <div
      class={cn(
        'flex items-center gap-2 px-3 border-b border-[color:var(--color-border)]',
        'h-[var(--topbar-h)] flex-none',
        iconOnly && 'justify-center px-0',
      )}
    >
      <BrandLogo variant="admin" iconOnly={iconOnly} />
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
