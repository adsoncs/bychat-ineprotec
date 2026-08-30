import * as Tooltip from '@radix-ui/react-tooltip'
import { useLocation } from 'wouter-preact'
import { isItemActive, type SidebarItem as SidebarItemType } from '@/modules/sidebar.config'
import { SidebarIcon } from './SidebarIcon'
import { cn } from '@/lib/cn'

interface SidebarItemProps {
  item: SidebarItemType
  /** Em modo rail só aparece o ícone; o label vai num Tooltip flutuante. */
  iconOnly: boolean
  onNavigate?: (() => void) | undefined
}

export function SidebarItem({ item, iconOnly, onNavigate }: SidebarItemProps) {
  const [location, navigate] = useLocation()
  // Match do item mais específico: `/app/leads/duplicates` acende só Duplicados,
  // não Leads junto (ver `isItemActive` em sidebar.config).
  const isActive = isItemActive(location, item.href)

  function handleClick(e: MouseEvent) {
    e.preventDefault()
    navigate(item.href)
    onNavigate?.()
  }

  const link = (
    <a
      href={item.href}
      class="app-sidebar-item"
      data-active={isActive}
      data-id={item.id}
      onClick={handleClick}
      aria-label={iconOnly ? item.label : undefined}
      aria-current={isActive ? 'page' : undefined}
    >
      <SidebarIcon name={item.icon} size={18} />
      {/* No rail o rótulo desaparece por opacidade (ver shell.css) em vez de
        * `sr-only`: com `sr-only` ele saía do fluxo no mesmo instante e o texto
        * piscava fora durante a animação. Quem lê tela usa o aria-label do link
        * acima, então aqui o texto é escondido da árvore de acessibilidade. */}
      <span class="app-sidebar-item-label" aria-hidden={iconOnly}>{item.label}</span>
      {/* No rail o CSS transforma este mesmo elemento num ponto sobre o ícone —
        * por isso ele é renderizado nos dois modos. O número segue no tooltip. */}
      {item.badge !== undefined && (
        <span class="app-sidebar-item-badge" aria-hidden={iconOnly}>{item.badge}</span>
      )}
    </a>
  )

  if (!iconOnly) return link

  return (
    <Tooltip.Provider delayDuration={300}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>{link}</Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content
            side="right"
            sideOffset={8}
            class="z-tooltip rounded-md bg-surface-3 text-fg px-2 py-1 text-xs shadow-md border border-border"
            style={{ zIndex: 'var(--z-tooltip)' }}
          >
            {item.label}
            {item.badge !== undefined && <span class="ml-1.5 opacity-70">({item.badge})</span>}
            <Tooltip.Arrow class="fill-[color:var(--color-surface-3)]" />
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  )
}
