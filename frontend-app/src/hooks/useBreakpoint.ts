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

/**
 * O aparelho aponta com o dedo, não com o mouse?
 *
 * Largura de tela NÃO responde isso: existe notebook estreito com mouse e
 * tablet largo sem nenhum. Quem sabe é `hover: none` — a mesma condição que o
 * CSS usa para deixar as ações da mensagem sempre visíveis. Aqui o valor serve
 * para decidir o que só o JS consegue: abrir folha inferior em vez de menu
 * flutuante e ligar o "pressionar e segurar".
 */
export function usePonteiroGrosso(): boolean {
  const [grosso, setGrosso] = useState(() =>
    typeof window === 'undefined' ? false : window.matchMedia('(hover: none)').matches,
  )

  useEffect(() => {
    const mq = window.matchMedia('(hover: none)')
    const update = () => setGrosso(mq.matches)
    update()
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [])

  return grosso
}

/**
 * Largura em pixels de um elemento, acompanhada por `ResizeObserver`.
 *
 * Existe porque a largura da JANELA mente sobre o espaço de um painel: na tela
 * de Conversas, 768px de tablet viram ~370px no painel da conversa (a lista
 * fica ao lado), e 1440px com o painel de informações aberto viram ~600px.
 * Decidir o que cabe pelo breakpoint da viewport põe botão demais num espaço
 * que não existe — foi o que fazia o cabeçalho quebrar em duas fileiras.
 */
export function useLarguraElemento(ref: { current: HTMLElement | null }): number {
  const [largura, setLargura] = useState(0)

  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver((entradas) => {
      const w = entradas[0]?.contentRect.width
      if (typeof w === 'number') setLargura(w)
    })
    ro.observe(el)
    setLargura(el.getBoundingClientRect().width)
    return () => ro.disconnect()
  }, [ref])

  return largura
}
