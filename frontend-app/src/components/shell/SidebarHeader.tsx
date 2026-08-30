import { X, PanelLeftClose, PanelLeftOpen } from '@/components/ui/icon-set'
import { useLocation } from 'wouter-preact'
import { cn } from '@/lib/cn'
import { BrandLogo } from '@/components/BrandLogo'
import { useSidebarStore } from '@/stores/sidebar'
import { useAccountPrefs } from '@/hooks/useAccountPrefs'
import { useT } from '@/i18n'
import { ICON_SIZE } from '@/components/ui/Icon'

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
  const { setPref } = useAccountPrefs()
  const t = useT()
  const label = iconOnly ? t('shell.sidebar.expand') : t('shell.sidebar.collapse')

  function alternar() {
    const next = iconOnly ? 'expanded' : 'rail'
    setMode(next)          // efeito imediato na tela
    setPref({ sidebarMode: next }) // e a escolha segue a conta
  }

  return (
    <button
      type="button"
      class={cn(
        'size-8 rounded-md text-fg-muted hover:bg-surface-3 hover:text-fg flex items-center justify-center',
        'transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)]',
        className,
      )}
      onClick={alternar}
      aria-label={label}
      aria-expanded={!iconOnly}
      aria-controls="app-sidebar-nav"
      title={`${label} (Ctrl+B)`}
    >
      {iconOnly ? <PanelLeftOpen size={ICON_SIZE.md} /> : <PanelLeftClose size={ICON_SIZE.md} />}
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
          <X size={ICON_SIZE.md} />
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
