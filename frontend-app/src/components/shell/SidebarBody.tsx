import { useState } from 'preact/hooks'
import { sidebarSchema, type SidebarItem as SidebarItemType } from '@/modules/sidebar.config'
import { SidebarItem } from './SidebarItem'
import { SidebarGroup } from './SidebarGroup'
import { useMyPermissions } from '@/hooks/usePermissions'
import { useUserStore } from '@/stores/user'

interface SidebarBodyProps {
  iconOnly: boolean
  onNavigate?: (() => void) | undefined
}

/**
 * Conteúdo navegável da sidebar (header + footer ficam no orquestrador).
 * Mesmo conteúdo é usado nos 3 modos — a diferença visual está em CSS via
 * data-mode no <aside> e em iconOnly via prop.
 */
export function SidebarBody({ iconOnly, onNavigate }: SidebarBodyProps) {
  const role = useUserStore((s) => s.user?.role ?? null)
  const { data, isLoading } = useMyPermissions()
  const [openGroupId, setOpenGroupId] = useState<string | null>(null)

  function visible(item: SidebarItemType): boolean {
    // Reforma F1.10: fail-closed — item sem permission declarada só SUPERADMIN vê.
    if (!item.permission) return role === 'SUPERADMIN'
    // Aguardando carregar — fail-closed temporário.
    if (isLoading || !data) return false
    // Reforma F6: módulo desativado some de TODOS (inclusive SUPERADMIN).
    // resolvePermissions já filtra módulos com active=false antes de retornar,
    // então módulo desligado não aparece em data.permissions.
    const perm = data.permissions[item.permission]
    if (!perm) return false
    // SUPERADMIN com módulo ativo vê sempre. Outros respeitam canView.
    if (role === 'SUPERADMIN') return true
    return !!perm.canView
  }

  const pinned = sidebarSchema.pinned.filter(visible)
  const footer = sidebarSchema.footer.filter(visible)

  return (
    // id referenciado pelo aria-controls do botão de recolher (SidebarHeader)
    <nav id="app-sidebar-nav" class="app-sidebar-nav" aria-label="Navegação principal">
      {pinned.length > 0 && (
        <div class="app-sidebar-section" data-section="pinned">
          {!iconOnly && <div class="app-sidebar-section-label">Início</div>}
          {pinned.map((item) => (
            <SidebarItem key={item.id} item={item} iconOnly={iconOnly} onNavigate={onNavigate} />
          ))}
        </div>
      )}

      {sidebarSchema.groups.map((group) => {
        const items = group.items.filter(visible)
        if (items.length === 0) return null
        return (
          <SidebarGroup
            key={group.id}
            group={{ ...group, items }}
            iconOnly={iconOnly}
            isOpen={openGroupId === group.id}
            onToggle={() => setOpenGroupId((current) => (current === group.id ? null : group.id))}
            onNavigate={onNavigate}
          />
        )
      })}

      {footer.length > 0 && (
        <div class="app-sidebar-section mt-auto pt-2 border-t border-[color:var(--color-border)]" data-section="footer">
          {footer.map((item) => (
            <SidebarItem key={item.id} item={item} iconOnly={iconOnly} onNavigate={onNavigate} />
          ))}
        </div>
      )}
    </nav>
  )
}
