/**
 * Menu de contexto (botão direito) — genérico.
 *
 * Abre na posição do mouse e nunca sai da tela: se não cabe embaixo/à direita,
 * vira para cima/para a esquerda. Submenu abre ao lado (mesma regra). Teclado:
 * ↑ ↓ navegam, → / Enter abrem submenu, ← volta, Esc fecha. Fecha também com
 * clique fora, rolagem e redimensionamento — o menu é sobre o que estava sob o
 * mouse, e depois que a tela mexe isso deixa de ser verdade.
 */
import { createPortal } from 'preact/compat'
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks'
import type { ComponentChildren } from 'preact'
import { ChevronRight } from '@/components/ui/icon-set'
import { cn } from '@/lib/cn'

export type ItemMenu =
  | { tipo?: 'item'; id: string; rotulo: string; icone?: ComponentChildren; atalho?: string; perigo?: boolean; desativado?: boolean; aoEscolher?: () => void; submenu?: ItemMenu[] }
  | { tipo: 'separador'; id: string }
  | { tipo: 'titulo'; id: string; rotulo: string }

function clicavel(i: ItemMenu): i is Extract<ItemMenu, { id: string; rotulo: string; aoEscolher?: () => void }> & { tipo?: 'item' } {
  return (i.tipo === undefined || i.tipo === 'item') && !(i as any).desativado
}

export function ContextMenu({ x, y, itens, onClose, rotulo }: {
  x: number
  y: number
  itens: ItemMenu[]
  onClose: () => void
  /** Para leitor de tela: "Ações da conversa com Fulano". */
  rotulo: string
}) {
  useEffect(() => {
    const fechar = () => onClose()
    // Esc fecha de qualquer lugar: depois do clique direito o foco pode ter
    // ficado na linha da lista, e aí o Esc não chegaria ao menu.
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose() } }
    window.addEventListener('keydown', esc, true)
    window.addEventListener('resize', fechar)
    window.addEventListener('blur', fechar)
    // Rolagem de QUALQUER contêiner (a lista de conversas rola por dentro).
    window.addEventListener('scroll', fechar, true)
    return () => {
      window.removeEventListener('keydown', esc, true)
      window.removeEventListener('resize', fechar)
      window.removeEventListener('blur', fechar)
      window.removeEventListener('scroll', fechar, true)
    }
  }, [onClose])

  return createPortal(
    <>
      {/* Camada transparente: clique fora fecha, e o botão direito fora também
          (sem abrir o menu do navegador por cima). */}
      <div
        class="fixed inset-0"
        style={{ zIndex: 'var(--z-popover)' }}
        onPointerDown={(e) => { e.preventDefault(); onClose() }}
        onContextMenu={(e) => { e.preventDefault(); onClose() }}
      />
      <Painel x={x} y={y} itens={itens} onClose={onClose} rotulo={rotulo} />
    </>,
    document.body,
  )
}

function Painel({ x, y, itens, onClose, rotulo, onVoltar, ancoraLargura = 0 }: {
  x: number; y: number; itens: ItemMenu[]; onClose: () => void; rotulo: string
  onVoltar?: () => void; ancoraLargura?: number
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: x, top: y, pronto: false })
  const [ativo, setAtivo] = useState(-1)
  const [sub, setSub] = useState<{ idx: number; x: number; y: number; largura: number } | null>(null)

  // Mede e encaixa na tela antes de pintar (sem "pulo").
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const { width: w, height: h } = el.getBoundingClientRect()
    const vw = window.innerWidth, vh = window.innerHeight, m = 8
    let left = x, top = y
    if (left + w > vw - m) left = ancoraLargura ? x - w - ancoraLargura : vw - w - m
    if (top + h > vh - m) top = Math.max(m, vh - h - m)
    setPos({ left: Math.max(m, left), top: Math.max(m, top), pronto: true })
    el.focus()
    // O botão que soltou o clique direito pode roubar o foco logo depois.
    requestAnimationFrame(() => el.focus())
  }, [x, y, ancoraLargura])

  const indices = itens.map((i, k) => (clicavel(i) ? k : -1)).filter((k) => k >= 0)

  function abrirSub(k: number) {
    const item = itens[k] as any
    const btn = ref.current?.querySelector<HTMLElement>(`[data-k="${k}"]`)
    if (!item?.submenu || !btn) return
    const r = btn.getBoundingClientRect()
    setSub({ idx: k, x: r.right - 2, y: r.top - 4, largura: r.width })
  }

  function escolher(k: number) {
    const item = itens[k] as any
    if (!item || item.desativado) return
    if (item.submenu) { abrirSub(k); return }
    onClose()
    item.aoEscolher?.()
  }

  function onKey(e: KeyboardEvent) {
    if (sub) return // o submenu trata o teclado enquanto está aberto
    const pos = indices.indexOf(ativo)
    if (e.key === 'ArrowDown') { e.preventDefault(); setAtivo(indices[(pos + 1) % indices.length] ?? -1) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setAtivo(indices[(pos - 1 + indices.length) % indices.length] ?? -1) }
    else if (e.key === 'Home') { e.preventDefault(); setAtivo(indices[0] ?? -1) }
    else if (e.key === 'End') { e.preventDefault(); setAtivo(indices[indices.length - 1] ?? -1) }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (ativo >= 0) escolher(ativo) }
    else if (e.key === 'ArrowRight') { e.preventDefault(); if (ativo >= 0) abrirSub(ativo) }
    else if (e.key === 'ArrowLeft' && onVoltar) { e.preventDefault(); onVoltar() }
    else if (e.key === 'Escape') { e.preventDefault(); onVoltar ? onVoltar() : onClose() }
    else if (e.key === 'Tab') { e.preventDefault(); onClose() }
  }

  return (
    <>
      <div
        ref={ref}
        role="menu"
        aria-label={rotulo}
        tabIndex={-1}
        onKeyDown={onKey}
        onContextMenu={(e) => e.preventDefault()}
        class="fixed min-w-[15rem] max-w-[20rem] rounded-lg border border-border bg-surface py-1 text-sm text-fg shadow-xl outline-none"
        style={{ left: pos.left, top: pos.top, zIndex: 'var(--z-popover)', visibility: pos.pronto ? 'visible' : 'hidden' }}
      >
        {itens.map((item, k) => {
          if (item.tipo === 'separador') return <div key={item.id} role="separator" class="my-1 border-t border-border" />
          if (item.tipo === 'titulo') return <div key={item.id} class="px-3 pb-0.5 pt-1.5 text-2xs font-medium uppercase tracking-wider text-fg-muted">{item.rotulo}</div>
          const it = item as Extract<ItemMenu, { rotulo: string }> & { perigo?: boolean; desativado?: boolean; submenu?: ItemMenu[]; icone?: ComponentChildren; atalho?: string }
          const aberto = sub?.idx === k
          return (
            <button
              key={it.id}
              data-k={k}
              type="button"
              role="menuitem"
              aria-haspopup={it.submenu ? 'menu' : undefined}
              aria-expanded={it.submenu ? aberto : undefined}
              aria-disabled={it.desativado || undefined}
              disabled={it.desativado}
              onMouseEnter={() => { setAtivo(k); if (it.submenu) abrirSub(k); else setSub(null) }}
              onClick={() => escolher(k)}
              class={cn(
                'flex w-full items-center gap-2.5 px-3 py-1.5 text-left outline-none transition-colors',
                it.perigo ? 'text-danger' : 'text-fg',
                (ativo === k || aberto) && (it.perigo ? 'bg-danger/10' : 'bg-surface-3'),
                it.desativado && 'cursor-not-allowed opacity-45',
              )}
            >
              <span class={cn('grid size-4 shrink-0 place-items-center', it.perigo ? 'text-danger' : 'text-fg-muted')}>{it.icone}</span>
              <span class="min-w-0 flex-1 truncate">{it.rotulo}</span>
              {it.atalho && <span class="shrink-0 text-2xs text-fg-muted">{it.atalho}</span>}
              {it.submenu && <ChevronRight size={12} class="shrink-0 text-fg-muted" />}
            </button>
          )
        })}
      </div>
      {sub && (itens[sub.idx] as any)?.submenu && (
        <Painel
          x={sub.x}
          y={sub.y}
          ancoraLargura={sub.largura}
          itens={(itens[sub.idx] as any).submenu}
          onClose={onClose}
          rotulo={(itens[sub.idx] as any).rotulo}
          onVoltar={() => { setSub(null); ref.current?.focus() }}
        />
      )}
    </>
  )
}
