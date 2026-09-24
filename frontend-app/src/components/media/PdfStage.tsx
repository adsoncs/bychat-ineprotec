/**
 * PDF renderizado DENTRO do app, com PDF.js (o motor do Firefox).
 *
 * Por que não um <iframe> com o visualizador do navegador: no Android o Chrome
 * não desenha PDF dentro da página, o Safari mostra só a primeira página, e a
 * CSP do app bloqueia <object>/<embed>. O PDF.js desenha cada página num
 * canvas — igual em qualquer navegador, sem extensão e sem nada que um
 * bloqueador trate como popup.
 *
 * Carregado sob demanda (import dinâmico): quem nunca abre um PDF não paga os
 * ~1 MB do motor.
 */
import { useEffect, useRef, useState } from 'preact/hooks'
import * as pdfjsLib from 'pdfjs-dist'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { Loader2, Minus, Plus, AlertTriangle } from '@/components/ui/icon-set'
import { ICON_SIZE } from '@/components/ui/Icon'

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl

const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3]

export default function PdfStage({ url }: { url: string }) {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [zoomIdx, setZoomIdx] = useState(2) // 100% = largura da área
  const [pagina, setPagina] = useState(1)
  const [largura, setLargura] = useState(0)
  const areaRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let vivo = true
    setDoc(null); setErro(null); setPagina(1)
    // isEvalSupported:false — a CSP do app não libera 'unsafe-eval'.
    const task = pdfjsLib.getDocument({ url, isEvalSupported: false, withCredentials: true })
    task.promise
      .then((d) => { if (vivo) setDoc(d) })
      .catch((e: Error) => { if (vivo) setErro(e?.message || 'Não foi possível abrir o PDF.') })
    return () => { vivo = false; void task.destroy() }
  }, [url])

  // Largura útil da área: é a base do "100%" (página ajustada à largura).
  useEffect(() => {
    const el = areaRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setLargura(el.clientWidth))
    ro.observe(el)
    setLargura(el.clientWidth)
    return () => ro.disconnect()
  }, [])

  // Página atual = a que ocupa o meio da área ao rolar.
  function aoRolar() {
    const el = areaRef.current
    if (!el) return
    const meio = el.scrollTop + el.clientHeight / 2
    const paginas = el.querySelectorAll<HTMLElement>('[data-pdf-page]')
    for (const p of paginas) {
      if (p.offsetTop + p.offsetHeight >= meio) { setPagina(Number(p.dataset.pdfPage)); break }
    }
  }

  const zoom = ZOOMS[zoomIdx]!
  const alvo = Math.max(240, Math.min(largura - 32, 1100)) * zoom

  return (
    <div class="flex h-full w-full flex-col">
      <div class="flex shrink-0 items-center justify-center gap-2 py-2 text-xs text-white/85">
        <button type="button" class="rounded p-1.5 hover:bg-white/10 disabled:opacity-40" onClick={() => setZoomIdx((i) => Math.max(0, i - 1))} disabled={zoomIdx === 0} aria-label="Diminuir zoom">
          <Minus size={ICON_SIZE.sm} />
        </button>
        <button type="button" class="min-w-[3.5rem] rounded px-2 py-1 tabular-nums hover:bg-white/10" onClick={() => setZoomIdx(2)} title="Ajustar à largura">
          {Math.round(zoom * 100)}%
        </button>
        <button type="button" class="rounded p-1.5 hover:bg-white/10 disabled:opacity-40" onClick={() => setZoomIdx((i) => Math.min(ZOOMS.length - 1, i + 1))} disabled={zoomIdx === ZOOMS.length - 1} aria-label="Aumentar zoom">
          <Plus size={ICON_SIZE.sm} />
        </button>
        {doc && <span class="ml-3 tabular-nums text-white/70">Página {pagina} de {doc.numPages}</span>}
      </div>
      <div ref={areaRef} onScroll={aoRolar} class="min-h-0 flex-1 overflow-auto px-4 pb-6">
        {erro ? (
          <div class="mx-auto mt-16 flex max-w-sm flex-col items-center gap-2 text-center text-sm text-white/80">
            <AlertTriangle size={ICON_SIZE.lg} />
            <p>Não foi possível exibir este PDF aqui.</p>
            <p class="text-xs text-white/60">Use “Baixar” no topo para abrir no seu computador.</p>
          </div>
        ) : !doc || !largura ? (
          <div class="flex h-full items-center justify-center text-white/70"><Loader2 size={ICON_SIZE.lg} class="animate-spin" /></div>
        ) : (
          <div class="mx-auto flex w-fit flex-col items-center gap-4">
            {Array.from({ length: doc.numPages }, (_, i) => (
              <PaginaPdf key={`${url}-${i}`} doc={doc} numero={i + 1} largura={alvo} raiz={areaRef.current} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

/** Uma página: só desenha quando chega perto da área visível. */
function PaginaPdf({ doc, numero, largura, raiz }: { doc: PDFDocumentProxy; numero: number; largura: number; raiz: HTMLElement | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const caixaRef = useRef<HTMLDivElement>(null)
  const [visivel, setVisivel] = useState(numero <= 2)
  const [proporcao, setProporcao] = useState(1.414) // A4 até saber a real

  useEffect(() => {
    const el = caixaRef.current
    if (!el || visivel) return
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) setVisivel(true) }, { root: raiz, rootMargin: '600px 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [visivel, raiz])

  useEffect(() => {
    if (!visivel) return
    let vivo = true
    let tarefa: { cancel: () => void } | null = null
    void doc.getPage(numero).then((page) => {
      if (!vivo) return
      const base = page.getViewport({ scale: 1 })
      setProporcao(base.height / base.width)
      const escala = largura / base.width
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const vp = page.getViewport({ scale: escala * dpr })
      const canvas = canvasRef.current
      if (!canvas) return
      canvas.width = Math.floor(vp.width)
      canvas.height = Math.floor(vp.height)
      canvas.style.width = `${Math.floor(vp.width / dpr)}px`
      canvas.style.height = `${Math.floor(vp.height / dpr)}px`
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      const t = page.render({ canvasContext: ctx, viewport: vp })
      tarefa = t
      t.promise.catch(() => {})
    })
    return () => { vivo = false; tarefa?.cancel() }
  }, [visivel, doc, numero, largura])

  return (
    <div ref={caixaRef} data-pdf-page={numero} class="bg-white shadow-lg" style={{ width: `${largura}px`, minHeight: `${largura * proporcao}px` }}>
      {visivel && <canvas ref={canvasRef} class="block" aria-label={`Página ${numero}`} />}
    </div>
  )
}
