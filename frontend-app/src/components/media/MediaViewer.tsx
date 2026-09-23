/**
 * Visualizador de mídia da conversa.
 *
 * Antes cada mídia abria numa ABA nova (`target="_blank"`): o agente saía da
 * conversa, o navegador às vezes barrava como popup e o PDF, no celular, nem
 * abria. Aqui tudo abre por cima da própria tela — imagem com zoom e arrasto,
 * vídeo com velocidade, PDF renderizado no app (PdfStage) — e fecha com Esc,
 * devolvendo o agente exatamente onde estava.
 *
 * Navega entre TODAS as mídias da conversa (← →), como a galeria do WhatsApp.
 */
import { createContext } from 'preact'
import { createPortal, lazy, Suspense } from 'preact/compat'
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'preact/hooks'
import type { ComponentChildren } from 'preact'
import {
  X, ChevronLeft, ChevronRight, Download, RotateCcw, Plus, Minus, Loader2, FileText, FileSpreadsheet, File, Play,
} from '@/components/ui/icon-set'
import { ICON_SIZE } from '@/components/ui/Icon'
import { cn } from '@/lib/cn'
import { type MediaItem, type MediaKind, abreNoVisualizador, baixarArquivo, extensaoDe, rotuloDoTipo } from './mediaKind'

const PdfStage = lazy(() => import('./PdfStage'))

// ── Contexto: a bolha pede "abra a mídia da mensagem X" ──────────────────
interface Galeria { abrir: (msgId: number) => boolean }
const GaleriaCtx = createContext<Galeria | null>(null)

export function useGaleriaDeMidia(): Galeria | null {
  return useContext(GaleriaCtx)
}

/** Envolve a conversa: guarda a lista de mídias e desenha o visualizador. */
export function GaleriaDeMidiaProvider({ items, children }: { items: MediaItem[]; children: ComponentChildren }) {
  const [aberto, setAberto] = useState<number | null>(null) // id da mensagem
  const visiveis = useMemo(() => items.filter((i) => abreNoVisualizador(i.kind)), [items])
  const abrir = useCallback((msgId: number) => {
    if (!visiveis.some((i) => i.id === msgId)) return false
    setAberto(msgId)
    return true
  }, [visiveis])
  const valor = useMemo(() => ({ abrir }), [abrir])
  const idx = aberto == null ? -1 : visiveis.findIndex((i) => i.id === aberto)
  return (
    <GaleriaCtx.Provider value={valor}>
      {children}
      {idx >= 0 && (
        <MediaViewer
          items={visiveis}
          index={idx}
          onIndex={(i) => setAberto(visiveis[i]?.id ?? null)}
          onClose={() => setAberto(null)}
        />
      )}
    </GaleriaCtx.Provider>
  )
}

// ── Visualizador ──────────────────────────────────────────────────────────
const BTN = 'inline-flex h-9 w-9 items-center justify-center rounded-full text-white/85 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-35 disabled:hover:bg-transparent focus-visible:outline focus-visible:outline-2 focus-visible:outline-white/70'

export function MediaViewer({ items, index, onIndex, onClose }: {
  items: MediaItem[]
  index: number
  onIndex: (i: number) => void
  onClose: () => void
}) {
  const item = items[index]!
  const raizRef = useRef<HTMLDivElement>(null)
  const temAnterior = index > 0
  const temProximo = index < items.length - 1
  // Estado da imagem sobe para cá: os atalhos de teclado (+ − 0 R) mexem nele.
  const [zoom, setZoom] = useState(1)
  const [giro, setGiro] = useState(0)
  useEffect(() => { setZoom(1); setGiro(0) }, [item.id])

  // Foco no visualizador (teclado funciona já) e de volta ao sair.
  useEffect(() => {
    const antes = document.activeElement as HTMLElement | null
    raizRef.current?.focus()
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = overflow; antes?.focus?.() }
  }, [])

  function onKey(e: KeyboardEvent) {
    const alvo = e.target as HTMLElement
    // Dentro do player de vídeo, setas e espaço são dele.
    if (alvo.tagName === 'VIDEO' && (e.key === ' ' || e.key.startsWith('Arrow'))) return
    if (e.key === 'Escape') { e.preventDefault(); onClose() }
    else if (e.key === 'ArrowLeft' && temAnterior) { e.preventDefault(); onIndex(index - 1) }
    else if (e.key === 'ArrowRight' && temProximo) { e.preventDefault(); onIndex(index + 1) }
    else if (item.kind === 'image' || item.kind === 'sticker') {
      if (e.key === '+' || e.key === '=') setZoom((z) => Math.min(8, z * 1.25))
      else if (e.key === '-') setZoom((z) => Math.max(1, z / 1.25))
      else if (e.key === '0') setZoom(1)
      else if (e.key.toLowerCase() === 'r') setGiro((g) => (g + 270) % 360)
    }
  }

  const quando = formatarQuando(item.at)
  const ehImagem = item.kind === 'image' || item.kind === 'sticker'

  return createPortal(
    <div
      ref={raizRef}
      role="dialog"
      aria-modal="true"
      aria-label={`Visualizar ${item.name || 'mídia'}`}
      tabIndex={-1}
      onKeyDown={onKey}
      class="fixed inset-0 flex flex-col text-white outline-none backdrop-blur-sm"
      style={{ zIndex: 'var(--z-modal)', backgroundColor: 'rgba(8, 10, 14, 0.94)' }}
    >
      {/* Topo: o que é, de quem, quando — e as ações */}
      <header class="flex shrink-0 items-center gap-3 px-3 py-2 sm:px-4">
        <div class="min-w-0 flex-1">
          <div class="truncate text-sm font-medium">{item.name || rotuloDoTipo(item.kind, extensaoDe(item.url, item.name))}</div>
          <div class="truncate text-xs text-white/60">
            {[item.sender, quando].filter(Boolean).join(' · ')}
            {items.length > 1 && <span class="ml-2 tabular-nums">{index + 1} de {items.length}</span>}
          </div>
        </div>
        {ehImagem && (
          <div class="hidden items-center gap-0.5 sm:flex">
            <button type="button" class={BTN} onClick={() => setZoom((z) => Math.max(1, z / 1.25))} disabled={zoom <= 1} aria-label="Diminuir zoom" title="Diminuir zoom (−)">
              <Minus size={ICON_SIZE.md} />
            </button>
            <button type="button" class="min-w-[3.25rem] rounded px-1.5 py-1 text-xs tabular-nums text-white/85 hover:bg-white/10" onClick={() => setZoom(1)} title="Ajustar à tela (0)">
              {Math.round(zoom * 100)}%
            </button>
            <button type="button" class={BTN} onClick={() => setZoom((z) => Math.min(8, z * 1.25))} disabled={zoom >= 8} aria-label="Aumentar zoom" title="Aumentar zoom (+)">
              <Plus size={ICON_SIZE.md} />
            </button>
            <button type="button" class={BTN} onClick={() => setGiro((g) => (g + 270) % 360)} aria-label="Girar" title="Girar (R)">
              <RotateCcw size={ICON_SIZE.md} />
            </button>
          </div>
        )}
        <button type="button" class={BTN} onClick={() => void baixarArquivo(item.url, item.name)} aria-label="Baixar" title="Baixar">
          <Download size={ICON_SIZE.md} />
        </button>
        <button type="button" class={BTN} onClick={onClose} aria-label="Fechar" title="Fechar (Esc)">
          <X size={ICON_SIZE.lg} />
        </button>
      </header>

      {/* Palco */}
      <div class="relative min-h-0 flex-1">
        <Palco key={item.id} item={item} zoom={zoom} setZoom={setZoom} giro={giro} onSwipe={(dir) => {
          if (dir < 0 && temProximo) onIndex(index + 1)
          if (dir > 0 && temAnterior) onIndex(index - 1)
        }} />
        {temAnterior && (
          <button type="button" onClick={() => onIndex(index - 1)} aria-label="Anterior" title="Anterior (←)"
            class={cn(BTN, 'absolute left-2 top-1/2 h-11 w-11 -translate-y-1/2 bg-black/40 sm:left-4')}>
            <ChevronLeft size={ICON_SIZE.xl} />
          </button>
        )}
        {temProximo && (
          <button type="button" onClick={() => onIndex(index + 1)} aria-label="Próxima" title="Próxima (→)"
            class={cn(BTN, 'absolute right-2 top-1/2 h-11 w-11 -translate-y-1/2 bg-black/40 sm:right-4')}>
            <ChevronRight size={ICON_SIZE.xl} />
          </button>
        )}
      </div>

      {/* Tira de miniaturas: orienta onde se está na conversa */}
      {items.length > 1 && (
        <Miniaturas items={items} index={index} onIndex={onIndex} />
      )}
    </div>,
    document.body,
  )
}

function Palco({ item, zoom, setZoom, giro, onSwipe }: {
  item: MediaItem
  zoom: number
  setZoom: (fn: (z: number) => number) => void
  giro: number
  onSwipe: (dir: number) => void
}) {
  if (item.kind === 'image' || item.kind === 'sticker') {
    return <ImagemZoom url={item.url} alt={item.name ?? 'Imagem'} zoom={zoom} setZoom={setZoom} giro={giro} onSwipe={onSwipe} />
  }
  if (item.kind === 'video' || item.kind === 'gif') return <Video url={item.url} gif={item.kind === 'gif'} />
  if (item.kind === 'pdf') {
    return (
      <Suspense fallback={<div class="flex h-full items-center justify-center text-white/70"><Loader2 size={ICON_SIZE.lg} class="animate-spin" /></div>}>
        <PdfStage url={item.url} />
      </Suspense>
    )
  }
  if (item.kind === 'text') return <Texto url={item.url} name={item.name} />
  return <Arquivo item={item} />
}

// ── Imagem: roda do mouse = zoom no ponto, arrastar = mover, duplo clique ──
function ImagemZoom({ url, alt, zoom, setZoom, giro, onSwipe }: {
  url: string; alt: string; zoom: number; setZoom: (fn: (z: number) => number) => void; giro: number; onSwipe: (dir: number) => void
}) {
  const [pos, setPos] = useState({ x: 0, y: 0 })
  const arrasto = useRef<{ x: number; y: number; px: number; py: number } | null>(null)
  const toque = useRef<number | null>(null)
  useEffect(() => { if (zoom === 1) setPos({ x: 0, y: 0 }) }, [zoom])

  return (
    <div
      class={cn('flex h-full w-full select-none items-center justify-center overflow-hidden', zoom > 1 ? 'cursor-grab active:cursor-grabbing' : 'cursor-zoom-in')}
      onWheel={(e) => { e.preventDefault(); setZoom((z) => Math.min(8, Math.max(1, e.deltaY < 0 ? z * 1.15 : z / 1.15))) }}
      onDblClick={() => setZoom((z) => (z > 1 ? 1 : 2.5))}
      onPointerDown={(e) => {
        if (zoom <= 1) return
        arrasto.current = { x: e.clientX, y: e.clientY, px: pos.x, py: pos.y }
        ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
      }}
      onPointerMove={(e) => {
        const a = arrasto.current
        if (!a) return
        setPos({ x: a.px + (e.clientX - a.x), y: a.py + (e.clientY - a.y) })
      }}
      onPointerUp={() => { arrasto.current = null }}
      onTouchStart={(e) => { toque.current = e.touches.length === 1 ? e.touches[0]!.clientX : null }}
      onTouchEnd={(e) => {
        const ini = toque.current
        toque.current = null
        if (ini == null || zoom > 1) return
        const dx = (e.changedTouches[0]?.clientX ?? ini) - ini
        if (Math.abs(dx) > 60) onSwipe(dx)
      }}
    >
      <img
        src={url}
        alt={alt}
        draggable={false}
        class="max-h-full max-w-full object-contain transition-transform duration-100 ease-out"
        style={{ transform: `translate(${pos.x}px, ${pos.y}px) scale(${zoom}) rotate(${giro}deg)` }}
      />
    </div>
  )
}

// ── Vídeo: player grande, com velocidade ──────────────────────────────────
const VELOCIDADES = [0.5, 1, 1.25, 1.5, 2]
function Video({ url, gif }: { url: string; gif: boolean }) {
  const ref = useRef<HTMLVideoElement>(null)
  const [vel, setVel] = useState(1)
  useEffect(() => { if (ref.current) ref.current.playbackRate = vel }, [vel])
  if (gif) {
    return (
      <div class="flex h-full items-center justify-center p-4">
        <video src={url} autoPlay loop muted playsInline class="max-h-full max-w-full rounded" />
      </div>
    )
  }
  return (
    <div class="flex h-full flex-col items-center justify-center gap-3 p-4">
      <video
        ref={ref}
        src={url}
        controls
        autoPlay
        playsInline
        preload="metadata"
        class="max-h-[calc(100%-3rem)] max-w-full rounded bg-black shadow-2xl"
      />
      <div class="flex items-center gap-1 text-xs">
        <span class="mr-1 text-white/60">Velocidade</span>
        {VELOCIDADES.map((v) => (
          <button key={v} type="button" onClick={() => setVel(v)}
            class={cn('rounded-full px-2.5 py-1 tabular-nums transition-colors', v === vel ? 'bg-white text-black' : 'text-white/80 hover:bg-white/10')}>
            {v}×
          </button>
        ))}
      </div>
    </div>
  )
}

// ── Texto/CSV: prévia legível, sem baixar ─────────────────────────────────
function Texto({ url, name }: { url: string; name: string | null }) {
  const [conteudo, setConteudo] = useState<string | null>(null)
  const [erro, setErro] = useState(false)
  useEffect(() => {
    let vivo = true
    fetch(url, { credentials: 'include' })
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))))
      .then((t) => { if (vivo) setConteudo(t.length > 300_000 ? `${t.slice(0, 300_000)}\n\n… (prévia cortada — baixe o arquivo para ver tudo)` : t) })
      .catch(() => { if (vivo) setErro(true) })
    return () => { vivo = false }
  }, [url])
  if (erro) return <Arquivo item={{ id: 0, kind: 'text', url, name, sender: null, at: '' }} />
  if (conteudo == null) return <div class="flex h-full items-center justify-center text-white/70"><Loader2 size={ICON_SIZE.lg} class="animate-spin" /></div>
  const ext = extensaoDe(url, name)
  if (ext === 'csv' || ext === 'tsv') {
    const linhas = tabelaDeCsv(conteudo, ext === 'tsv' ? '\t' : null)
    if (linhas.length > 1) {
      const [cab, ...corpo] = linhas
      return (
        <div class="h-full overflow-auto px-4 pb-6">
          <div class="mx-auto w-fit max-w-full overflow-auto rounded-md bg-white shadow-lg">
            <table class="text-left text-xs text-neutral-900">
              <thead class="sticky top-0 bg-neutral-100">
                <tr>{cab!.map((c, i) => <th key={i} class="whitespace-nowrap border-b border-neutral-300 px-3 py-2 font-semibold">{c}</th>)}</tr>
              </thead>
              <tbody>
                {corpo.map((l, r) => (
                  <tr key={r} class="odd:bg-white even:bg-neutral-50">
                    {cab!.map((_, i) => <td key={i} class="whitespace-nowrap border-b border-neutral-200 px-3 py-1.5">{l[i] ?? ''}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
            {corpo.length >= 1000 && <div class="px-3 py-2 text-xs text-neutral-500">Mostrando as primeiras 1.000 linhas — baixe para ver todas.</div>}
          </div>
        </div>
      )
    }
  }
  return (
    <div class="h-full overflow-auto px-4 pb-6">
      <pre class="mx-auto max-w-4xl whitespace-pre-wrap break-words rounded-md bg-white p-4 font-mono text-xs leading-relaxed text-neutral-900 shadow-lg">{conteudo}</pre>
    </div>
  )
}

// ── Demais arquivos: cartão com o que é e o botão de baixar ───────────────
function Arquivo({ item }: { item: MediaItem }) {
  const ext = extensaoDe(item.url, item.name)
  const Icone = ['xls', 'xlsx', 'ods', 'csv'].includes(ext) ? FileSpreadsheet : ['doc', 'docx', 'odt', 'rtf'].includes(ext) ? FileText : File
  return (
    <div class="flex h-full items-center justify-center p-4">
      <div class="flex w-full max-w-sm flex-col items-center gap-3 rounded-xl bg-white/5 p-6 text-center ring-1 ring-white/10">
        <Icone size={48} class="text-white/80" />
        <div class="min-w-0 max-w-full">
          <div class="truncate text-sm font-medium">{item.name || 'Arquivo'}</div>
          <div class="mt-0.5 text-xs text-white/60">{rotuloDoTipo(item.kind, ext)} · pré-visualização indisponível para este formato</div>
        </div>
        <button type="button" onClick={() => void baixarArquivo(item.url, item.name)}
          class="mt-1 inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-medium text-black hover:bg-white/90">
          <Download size={ICON_SIZE.md} /> Baixar
        </button>
      </div>
    </div>
  )
}

// ── Miniaturas ────────────────────────────────────────────────────────────
function Miniaturas({ items, index, onIndex }: { items: MediaItem[]; index: number; onIndex: (i: number) => void }) {
  const ativaRef = useRef<HTMLButtonElement>(null)
  useEffect(() => { ativaRef.current?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' }) }, [index])
  return (
    <div class="flex shrink-0 justify-center overflow-x-auto px-3 pb-3 pt-1">
      <div class="flex gap-1.5">
        {items.map((it, i) => (
          <button
            key={it.id}
            {...(i === index ? { ref: ativaRef } : {})}
            type="button"
            onClick={() => onIndex(i)}
            aria-label={`Mídia ${i + 1}`}
            class={cn('relative h-12 w-12 shrink-0 overflow-hidden rounded-md ring-2 transition-opacity', i === index ? 'ring-white opacity-100' : 'ring-transparent opacity-55 hover:opacity-90')}
          >
            <MiniaturaConteudo item={it} />
          </button>
        ))}
      </div>
    </div>
  )
}

function MiniaturaConteudo({ item }: { item: MediaItem }) {
  if (item.kind === 'image' || item.kind === 'sticker') return <img src={item.url} alt="" loading="lazy" class="h-full w-full object-cover" />
  if (item.kind === 'video' || item.kind === 'gif') {
    return (
      <>
        <video src={`${item.url}#t=0.1`} preload="metadata" muted playsInline class="h-full w-full object-cover" />
        <span class="absolute inset-0 flex items-center justify-center bg-black/30"><Play size={ICON_SIZE.sm} /></span>
      </>
    )
  }
  return <span class="flex h-full w-full items-center justify-center bg-white/10 text-[9px] font-semibold uppercase">{rotuloDoTipo(item.kind, extensaoDe(item.url, item.name))}</span>
}

/** CSV → linhas (até 1.000). Separador: `;` (padrão BR do Excel) ou `,`, o que aparecer mais no cabeçalho. Respeita aspas. */
function tabelaDeCsv(texto: string, sep: string | null): string[][] {
  const primeira = texto.split(/\r?\n/, 1)[0] ?? ''
  const s = sep ?? ((primeira.split(';').length >= primeira.split(',').length) ? ';' : ',')
  const linhas: string[][] = []
  let campo = '', linha: string[] = [], aspas = false
  for (let i = 0; i < texto.length && linhas.length <= 1000; i++) {
    const c = texto[i]!
    if (aspas) {
      if (c === '"' && texto[i + 1] === '"') { campo += '"'; i++ }
      else if (c === '"') aspas = false
      else campo += c
    } else if (c === '"') aspas = true
    else if (c === s) { linha.push(campo); campo = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && texto[i + 1] === '\n') i++
      linha.push(campo); campo = ''
      if (linha.some((x) => x !== '')) linhas.push(linha)
      linha = []
    } else campo += c
  }
  if (campo !== '' || linha.length) { linha.push(campo); if (linha.some((x) => x !== '')) linhas.push(linha) }
  return linhas
}

function formatarQuando(iso: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })
}

export type { MediaItem, MediaKind }
