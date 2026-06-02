import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type FontSize = 'comfortable' | 'large' | 'larger'

const FONT_PX: Record<FontSize, string> = {
  comfortable: '16px',
  large: '17px',
  larger: '19px',
}

function applyFontSize(size: FontSize) {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  root.setAttribute('data-font-size', size)
  root.style.setProperty('--app-base-font-size', FONT_PX[size])
}

interface FontSizeState {
  size: FontSize
  setSize: (size: FontSize) => void
  cycle: () => void
}

const ORDER: FontSize[] = ['comfortable', 'large', 'larger']

export const useFontSizeStore = create<FontSizeState>()(
  persist(
    (set, get) => ({
      size: 'comfortable',
      setSize: (size) => {
        set({ size })
        applyFontSize(size)
      },
      cycle: () => {
        const cur = get().size
        const next = ORDER[(ORDER.indexOf(cur) + 1) % ORDER.length] ?? 'comfortable'
        set({ size: next })
        applyFontSize(next)
      },
    }),
    {
      name: 'bh:font-size',
      onRehydrateStorage: () => (state) => {
        if (state) applyFontSize(state.size)
      },
    },
  ),
)

export const FONT_SIZE_LABELS: Record<FontSize, string> = {
  comfortable: 'Confortável',
  large: 'Grande',
  larger: 'Maior',
}
