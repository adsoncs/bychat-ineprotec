import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type Theme = 'dark' | 'light' | 'system'

interface ThemeState {
  theme: Theme
  setTheme: (theme: Theme) => void
  toggle: () => void
}

/** Aplica o atributo no <html>. Quando system, lê prefers-color-scheme. */
function applyTheme(theme: Theme) {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  const resolved =
    theme === 'system'
      ? window.matchMedia('(prefers-color-scheme: light)').matches
        ? 'light'
        : 'dark'
      : theme
  if (resolved === 'light') {
    root.setAttribute('data-theme', 'light')
  } else {
    root.removeAttribute('data-theme')
  }
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      theme: 'dark',
      setTheme: (theme) => {
        set({ theme })
        applyTheme(theme)
      },
      toggle: () => {
        const next: Theme = get().theme === 'dark' ? 'light' : 'dark'
        set({ theme: next })
        applyTheme(next)
      },
    }),
    {
      name: 'bh:theme',
      onRehydrateStorage: () => (state) => {
        if (state) applyTheme(state.theme)
      },
    },
  ),
)

/** Liga o listener de prefers-color-scheme quando o tema atual é system. */
const noop = () => {
  /* sem listener disponível */
}

export function startThemeAutoSync(): () => void {
  if (typeof window === 'undefined') return noop
  const mq = window.matchMedia('(prefers-color-scheme: light)')
  const handler = () => {
    const { theme } = useThemeStore.getState()
    if (theme === 'system') applyTheme('system')
  }
  mq.addEventListener('change', handler)
  // Aplica imediatamente caso o estado já esteja em system.
  applyTheme(useThemeStore.getState().theme)
  return () => mq.removeEventListener('change', handler)
}
