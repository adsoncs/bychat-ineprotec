import type { SidebarGroup as SidebarGroupType } from '@/modules/sidebar.config'
import { SidebarItem } from './SidebarItem'

interface SidebarGroupProps {
  group: SidebarGroupType
  /** Em rail, todos os itens viram lista achatada (sem header de grupo) */
  iconOnly: boolean
  /** Acordeão: apenas um grupo aberto por vez (controlado pelo pai) */
  isOpen: boolean
  onToggle: () => void
  onNavigate?: (() => void) | undefined
}

/**
 * Em modo rail/drawer-mobile: render lista plana sem header (ícones falam por si).
 * Em modo expanded: render com header clicável; abertura é controlada pelo pai
 * (`SidebarBody`) para comportamento acordeão — abrir um fecha os outros.
 */
export function SidebarGroup({ group, iconOnly, isOpen, onToggle, onNavigate }: SidebarGroupProps) {
  if (iconOnly) {
    return (
      <div class="app-sidebar-section" data-group={group.id}>
        {group.items.map((item) => (
          <SidebarItem key={item.id} item={item} iconOnly onNavigate={onNavigate} />
        ))}
      </div>
    )
  }

  const collapsed = !isOpen

  return (
    <div class="app-sidebar-group" data-group={group.id} data-collapsed={collapsed}>
      <button
        type="button"
        class="app-sidebar-group-header"
        onClick={onToggle}
        aria-expanded={isOpen}
        aria-controls={`group-${group.id}-items`}
      >
        <span>{group.label}</span>
        <svg
          class="app-sidebar-group-toggle"
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2.5"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      <div class="app-sidebar-group-items" id={`group-${group.id}-items`}>
        {group.items.map((item) => (
          <SidebarItem key={item.id} item={item} iconOnly={false} onNavigate={onNavigate} />
        ))}
      </div>
    </div>
  )
}
