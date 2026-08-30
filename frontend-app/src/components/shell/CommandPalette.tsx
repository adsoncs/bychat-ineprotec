import { useMemo } from 'preact/hooks'
import * as Dialog from '@radix-ui/react-dialog'
import * as VisuallyHidden from '@radix-ui/react-visually-hidden'
import { Command } from 'cmdk'
import { useLocation } from 'wouter-preact'
import { Star, Clock, ArrowRight } from '@/components/ui/icon-set'
import { flattenItems, findItem } from '@/modules/sidebar.config'
import { useFavoritesStore } from '@/stores/favorites'
import { useRecentsStore } from '@/stores/recents'
import { useMyPermissions } from '@/hooks/usePermissions'
import { useUserStore } from '@/stores/user'
import { Icon, ICON_SIZE } from '@/components/ui/Icon'
import type { IconName } from '@/components/ui/icons'

interface CommandPaletteProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const [, navigate] = useLocation()
  const favoriteIds = useFavoritesStore((s) => s.ids)
  const toggleFavorite = useFavoritesStore((s) => s.toggle)
  const recentIds = useRecentsStore((s) => s.ids)
  const role = useUserStore((s) => s.user?.role ?? null)
  const { data: permsData } = useMyPermissions()

  // Filtra itens que o user atual NÃO pode acessar.
  // Critério: SUPERADMIN vê tudo; demais só itens onde
  //   - item.permission é undefined (item sempre público), OU
  //   - permissions[item.permission].canView === true E o módulo está em modules[]
  // Backend já filtra modules[] pelos ativos, então basta verificar que está lá.
  function canAccessItem(item: { permission?: string }): boolean {
    if (role === 'SUPERADMIN') return true
    if (!item.permission) return true
    if (!permsData) return true  // fail-open enquanto carrega (evita esconder tudo)
    const isActive = permsData.modules.some((m) => m.id === item.permission)
    if (!isActive) return false
    const perm = permsData.permissions[item.permission]
    return !!perm?.canView
  }

  const allItems = useMemo(() => flattenItems().filter(canAccessItem), [permsData, role])
  const favoriteItems = useMemo(
    () => favoriteIds.map((id) => findItem(id)).filter((i): i is NonNullable<typeof i> => !!i).filter(canAccessItem),
    [favoriteIds, permsData, role],
  )
  const recentItems = useMemo(
    () => recentIds.map((id) => findItem(id)).filter((i): i is NonNullable<typeof i> => !!i).filter(canAccessItem).slice(0, 5),
    [recentIds, permsData, role],
  )

  function handleSelect(href: string) {
    navigate(href)
    onOpenChange(false)
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay
          class="fixed inset-0 bg-[oklch(0%_0_0/0.5)] backdrop-blur-sm"
          style={{ zIndex: 'var(--z-backdrop)' }}
        />
        <Dialog.Content
          class="fixed left-1/2 top-[15dvh] w-[min(34rem,90vw)] -translate-x-1/2 rounded-panel border border-border bg-surface-2 shadow-xl surface-raised overflow-hidden"
          style={{ zIndex: 'var(--z-modal)' }}
        >
          <VisuallyHidden.Root>
            <Dialog.Title>Paleta de comandos</Dialog.Title>
            <Dialog.Description>Busque páginas, ações e atalhos</Dialog.Description>
          </VisuallyHidden.Root>
          <Command label="Paleta de comandos" class="flex flex-col">
            <Command.Input
              autoFocus
              placeholder="Buscar páginas, ações…"
              class="h-12 px-4 bg-transparent text-sm text-fg placeholder:text-fg-muted border-b border-border outline-none"
            />
            <Command.List class="max-h-[60dvh] overflow-y-auto p-2">
              <Command.Empty class="py-8 text-center text-sm text-fg-muted">
                Nada encontrado.
              </Command.Empty>

              {favoriteItems.length > 0 && (
                <Command.Group heading="Favoritos" class="mb-2 [&>[cmdk-group-heading]]:px-2 [&>[cmdk-group-heading]]:py-1.5 [&>[cmdk-group-heading]]:text-2xs [&>[cmdk-group-heading]]:uppercase [&>[cmdk-group-heading]]:tracking-wider [&>[cmdk-group-heading]]:text-fg-muted">
                  {favoriteItems.map((item) =>
                    item ? (
                      <PaletteItem key={item.id} icon={item.icon} label={item.label} onSelect={() => handleSelect(item.href)} />
                    ) : null,
                  )}
                </Command.Group>
              )}

              {recentItems.length > 0 && (
                <Command.Group heading="Recentes" class="mb-2 [&>[cmdk-group-heading]]:px-2 [&>[cmdk-group-heading]]:py-1.5 [&>[cmdk-group-heading]]:text-2xs [&>[cmdk-group-heading]]:uppercase [&>[cmdk-group-heading]]:tracking-wider [&>[cmdk-group-heading]]:text-fg-muted">
                  {recentItems.map((item) =>
                    item ? (
                      <PaletteItem key={item.id} icon={item.icon} label={item.label} onSelect={() => handleSelect(item.href)}>
                        <Clock size={ICON_SIZE.xs} class="text-fg-muted" />
                      </PaletteItem>
                    ) : null,
                  )}
                </Command.Group>
              )}

              <Command.Group heading="Todas as páginas" class="[&>[cmdk-group-heading]]:px-2 [&>[cmdk-group-heading]]:py-1.5 [&>[cmdk-group-heading]]:text-2xs [&>[cmdk-group-heading]]:uppercase [&>[cmdk-group-heading]]:tracking-wider [&>[cmdk-group-heading]]:text-fg-muted">
                {allItems.map((item) => {
                  const isFav = favoriteIds.includes(item.id)
                  return (
                    <PaletteItem
                      key={item.id}
                      icon={item.icon}
                      label={item.label}
                      onSelect={() => handleSelect(item.href)}
                      action={
                        <button
                          type="button"
                          class="ml-2 size-6 rounded hover:bg-surface-3 grid place-items-center text-fg-muted hover:text-fg"
                          onClick={(e) => {
                            e.stopPropagation()
                            toggleFavorite(item.id)
                          }}
                          aria-label={isFav ? `Remover ${item.label} dos favoritos` : `Favoritar ${item.label}`}
                        >
                          <Star size={ICON_SIZE.xs} class={isFav ? 'fill-accent text-accent' : ''} />
                        </button>
                      }
                    />
                  )
                })}
              </Command.Group>
            </Command.List>
          </Command>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function PaletteItem({
  icon,
  label,
  onSelect,
  children,
  action,
}: {
  icon: IconName
  label: string
  onSelect: () => void
  children?: preact.ComponentChildren
  action?: preact.ComponentChildren
}) {
  return (
    <Command.Item
      onSelect={onSelect}
      class="flex items-center gap-2 h-9 px-2 rounded-md text-sm cursor-pointer text-fg-muted aria-selected:bg-surface-3 aria-selected:text-fg outline-none"
    >
      <Icon name={icon} size="md" />
      <span class="flex-1 truncate">{label}</span>
      {children}
      {action}
      <ArrowRight size={ICON_SIZE.xs} class="text-fg-muted opacity-0 aria-selected:opacity-100" />
    </Command.Item>
  )
}
