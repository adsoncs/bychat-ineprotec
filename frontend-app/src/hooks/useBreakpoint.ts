import { useEffect, useState } from 'preact/hooks'

/**
 * Breakpoints do app shell — alinhados com tokens.
 * Mantém em JS o que está em CSS para a sidebar derivar o modo correto.
 */
export const BREAKPOINTS = {
  sm: 640,
  md: 768,
  lg: 1024,
  xl: 1280,
  '2xl': 1536,
} as const

export type Breakpoint = keyof typeof BREAKPOINTS

/**
 * Modo de layout do shell baseado no breakpoint atual:
 *   - mobile  (<lg/1024)         → drawer
 *   - laptop  (lg/1024–xl/1279)  → rail (icon-only)
 *   - desktop (≥xl/1280)         → expanded (com labels)
 */
export type ShellLayout = 'mobile' | 'laptop' | 'desktop'

export function getShellLayout(width: number): ShellLayout {
  if (width < BREAKPOINTS.lg) return 'mobile'
  if (width < BREAKPOINTS.xl) return 'laptop'
  return 'desktop'
}

/** Hook reativo a `resize` para o layout do shell. SSR-safe. */
export function useShellLayout(): ShellLayout {
  const [layout, setLayout] = useState<ShellLayout>(() =>
    typeof window === 'undefined' ? 'desktop' : getShellLayout(window.innerWidth),
  )

  useEffect(() => {
    let raf = 0
    function update() {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => setLayout(getShellLayout(window.innerWidth)))
    }
    window.addEventListener('resize', update)
    update()
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', update)
    }
  }, [])

  return layout
}

/** Hook genérico para comparar com um breakpoint específico. */
export function useMinWidth(bp: Breakpoint): boolean {
  const [match, setMatch] = useState(() =>
    typeof window === 'undefined' ? false : window.innerWidth >= BREAKPOINTS[bp],
  )

  useEffect(() => {
    const mq = window.matchMedia(`(min-width: ${BREAKPOINTS[bp]}px)`)
    const onChange = () => setMatch(mq.matches)
    mq.addEventListener('change', onChange)
    onChange()
    return () => mq.removeEventListener('change', onChange)
  }, [bp])

  return match
}
