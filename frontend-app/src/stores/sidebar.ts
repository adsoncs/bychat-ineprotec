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

/** Modo que a sidebar realmente assume: mobile é sempre drawer. */
export type EffectiveSidebarMode = 'drawer' | 'rail' | 'expanded'

/**
 * Resolve o modo efetivo a partir do breakpoint + preferência do usuário.
 *
 * Vive aqui, e não dentro do componente, porque o SHELL também precisa dele: o
 * recuo do conteúdo à direita saía do breakpoint da janela, então recolher o
 * menu num monitor grande encolhia a barra e deixava uma faixa vazia do tamanho
 * da diferença. Barra e conteúdo têm que ler o mesmo estado.
 *
 * A preferência só vale em tela grande: no mobile a navegação é o drawer, e
 * respeitar um "rail" salvo ali deixaria o usuário com uma tira de ícones sem
 * como voltar.
 */
export function resolveSidebarMode(layout: 'mobile' | 'laptop' | 'desktop', mode: SidebarMode): EffectiveSidebarMode {
  if (layout === 'mobile') return 'drawer'
  if (mode === 'auto') return layout === 'laptop' ? 'rail' : 'expanded'
  return mode
}
