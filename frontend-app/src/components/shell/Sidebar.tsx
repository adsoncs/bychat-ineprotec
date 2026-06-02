import * as Dialog from '@radix-ui/react-dialog'
import * as VisuallyHidden from '@radix-ui/react-visually-hidden'
import { useShellLayout } from '@/hooks/useBreakpoint'
import { useSidebarStore } from '@/stores/sidebar'
import { useT } from '@/i18n'
import { SidebarBody } from './SidebarBody'
import { SidebarHeader } from './SidebarHeader'

/**
 * Sidebar — 3 modos resolvidos automaticamente pelo breakpoint:
 *   - mobile (<lg/1024)         → drawer (Radix Dialog)
 *   - laptop (lg/1024–xl/1279)  → rail icon-only fixo
 *   - desktop (≥xl/1280)        → expanded fixo com labels
 *
 * Usuário pode forçar rail/expanded mesmo em desktop via store
 * (preferência persistida em localStorage).
 */
export function Sidebar() {
  const layout = useShellLayout()
  const mode = useSidebarStore((s) => s.mode)
  const drawerOpen = useSidebarStore((s) => s.drawerOpen)
  const closeDrawer = useSidebarStore((s) => s.closeDrawer)

  // Modo efetivo: drawer em mobile, ou preferência do usuário, ou auto pelo breakpoint
  const effectiveMode: 'drawer' | 'rail' | 'expanded' =
    layout === 'mobile' ? 'drawer' : mode === 'auto' ? (layout === 'laptop' ? 'rail' : 'expanded') : mode

  if (effectiveMode === 'drawer') {
    return (
      <Dialog.Root open={drawerOpen} onOpenChange={(o) => (o ? null : closeDrawer())}>
        <Dialog.Portal>
          <Dialog.Overlay class="app-drawer-overlay" />
          <Dialog.Content class="app-sidebar" data-mode="drawer" data-state={drawerOpen ? 'open' : 'closed'}>
            <VisuallyHidden.Root>
              <Dialog.Title>Menu de navegação</Dialog.Title>
              <Dialog.Description>Lista de seções e atalhos</Dialog.Description>
            </VisuallyHidden.Root>
            <SidebarHeader iconOnly={false} showCloseButton onClose={closeDrawer} />
            <SidebarBody iconOnly={false} onNavigate={closeDrawer} />
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    )
  }

  const iconOnly = effectiveMode === 'rail'
  return (
    <aside class="app-sidebar" data-mode={effectiveMode}>
      <SidebarHeader iconOnly={iconOnly} />
      <SidebarNav iconOnly={iconOnly} />
    </aside>
  )
}

function SidebarNav({ iconOnly }: { iconOnly: boolean }) {
  const t = useT()
  return (
    <nav aria-label={t('shell.nav.aria')} class="contents">
      <SidebarBody iconOnly={iconOnly} />
    </nav>
  )
}
