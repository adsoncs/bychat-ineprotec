import { X, PanelLeftClose, PanelLeftOpen } from 'lucide-preact'
import { useLocation } from 'wouter-preact'
import { cn } from '@/lib/cn'
import { BrandLogo } from '@/components/BrandLogo'
import { useSidebarStore } from '@/stores/sidebar'
import { useT } from '@/i18n'

interface SidebarHeaderProps {
  iconOnly: boolean
  showCloseButton?: boolean
  onClose?: () => void
  /** Mostra o botão de recolher/expandir. Falso no drawer, que fecha pelo X. */
  showCollapseButton?: boolean
}

const HOME_HREF = '/app/dashboard'

/**
 * Botão que recolhe/expande a barra. Fica no cabeçalho quando há espaço para o
 * rótulo e no rodapé quando a barra está no modo faixa — o mesmo controle, sempre
 * visível, para o usuário nunca ficar preso no modo estreito.
 */
export function SidebarCollapseButton({ iconOnly, class: className }: { iconOnly: boolean; class?: string }) {
  const setMode = useSidebarStore((s) => s.setMode)
  const t = useT()
  const label = iconOnly ? t('shell.sidebar.expand') : t('shell.sidebar.collapse')

  return (
    <button
      type="button"
      class={cn(
        'size-8 rounded-md text-fg-muted hover:bg-surface-3 hover:text-fg flex items-center justify-center',
        'transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)]',
        className,
      )}
      onClick={() => setMode(iconOnly ? 'expanded' : 'rail')}
      aria-label={label}
      aria-expanded={!iconOnly}
      aria-controls="app-sidebar-nav"
      title={`${label} (Ctrl+B)`}
    >
      {iconOnly ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
    </button>
  )
}

export function SidebarHeader({ iconOnly, showCloseButton = false, onClose, showCollapseButton = false }: SidebarHeaderProps) {
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
      {/* Expandido, o botão de recolher cabe ao lado do logo; recolhido, ele vai
        * para o rodapé da barra (SidebarFooter) — 4rem não comportam os dois. */}
      {showCollapseButton && !iconOnly && (
        <SidebarCollapseButton iconOnly={false} class="ml-auto" />
      )}
    </div>
  )
}
