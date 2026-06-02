import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/**
 * Modos do sidebar:
 *   - 'auto'     → segue breakpoint atual (padrão recomendado)
 *   - 'rail'     → força icon-only mesmo em desktop (preferência do usuário)
 *   - 'expanded' → força expanded mesmo em laptop pequeno
 *
 * O modo "drawer" (mobile) é sempre derivado do breakpoint, não armazenado.
 */
export type SidebarMode = 'auto' | 'rail' | 'expanded'

export interface SidebarState {
  mode: SidebarMode
  drawerOpen: boolean

  setMode: (mode: SidebarMode) => void
  toggleDrawer: () => void
  openDrawer: () => void
  closeDrawer: () => void
}

export const useSidebarStore = create<SidebarState>()(
  persist(
    (set) => ({
      mode: 'auto',
      drawerOpen: false,

      setMode: (mode) => set({ mode }),
      toggleDrawer: () => set((s) => ({ drawerOpen: !s.drawerOpen })),
      openDrawer: () => set({ drawerOpen: true }),
      closeDrawer: () => set({ drawerOpen: false }),
    }),
    {
      name: 'bh:sidebar',
      partialize: (s) => ({ mode: s.mode }),
    },
  ),
)
