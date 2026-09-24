/**
 * Formatação do WhatsApp no campo de mensagem — igual ao WhatsApp Web: ao
 * selecionar um trecho aparece uma barrinha sobre a seleção com Negrito,
 * Itálico, Tachado, Código, listas e Citar.
 *
 * Não há editor rico: o WhatsApp formata por marcadores no próprio texto
 * (*negrito*, _itálico_, ~tachado~, `código`, "- ", "1. ", "> "), então os
 * botões só escrevem/tiram esses marcadores. A troca passa por
 * execCommand('insertText') para o Ctrl+Z desfazer a formatação como qualquer
 * digitação (e o evento `input` atualiza o rascunho do jeito de sempre).
 */
import { createPortal } from 'preact/compat'
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks'
import type { RefObject } from 'preact'
import { Bold, Code, Italic, List, ListOrdered, Quote, Strikethrough } from '@/components/ui/icon-set'

export type Formato = 'negrito' | 'italico' | 'tachado' | 'codigo' | 'lista' | 'numerada' | 'citacao'

const MARCADOR: Partial<Record<Formato, string>> = { negrito: '*', italico: '_', tachado: '~', codigo: '`' }
const PREFIXO: Partial<Record<Formato, RegExp>> = { lista: /^[-*] /, numerada: /^\d+\. /, citacao: /^> / }
const QUALQUER_LISTA = /^([-*] |\d+\. )/
/** Prefixo de linha que fica FORA dos marcadores (senão "*- item*" não vira negrito). */
const PREFIXO_DE_LINHA = /^(> )?([-*] |\d+\. )?/

type Troca = { ini: number; fim: number; texto: string; selIni: number; selFim: number }

/** *negrito*, _itálico_… — cada linha da seleção separada: o WhatsApp não
 *  formata através de quebra de linha. Se tudo já está marcado, desmarca. */
function alternarMarcador(v: string, s: number, e: number, m: string): Troca {
  const L = m.length
  if (s === e) return { ini: s, fim: e, texto: m + m, selIni: s + L, selFim: s + L }
  const sel = v.slice(s, e)
  // Seleção exatamente entre os marcadores (ex.: selecionou a palavra de "*oi*").
  if (!sel.includes('\n') && v.slice(s - L, s) === m && v.slice(e, e + L) === m) {
    return { ini: s - L, fim: e + L, texto: sel, selIni: s - L, selFim: e - L }
  }
  const noInicioDaLinha = s === 0 || v[s - 1] === '\n'
  const partes = sel.split('\n').map((linha, i) => {
    const pre = i > 0 || noInicioDaLinha ? (linha.match(PREFIXO_DE_LINHA)?.[0] ?? '') : ''
    const resto = linha.slice(pre.length)
    const ini = resto.length - resto.trimStart().length
    const miolo = resto.trim()
    return { pre: pre + resto.slice(0, ini), miolo, pos: resto.slice(ini + miolo.length) }
  })
  const marcada = (t: string) => t.length > 2 * L && t.startsWith(m) && t.endsWith(m)
  const comTexto = partes.filter((p) => p.miolo)
  const desmarcar = comTexto.length > 0 && comTexto.every((p) => marcada(p.miolo))
  const texto = partes.map((p) => {
    if (!p.miolo) return p.pre + p.pos
    const miolo = desmarcar ? p.miolo.slice(L, -L) : marcada(p.miolo) ? p.miolo : m + p.miolo + m
    return p.pre + miolo + p.pos
  }).join('\n')
  return { ini: s, fim: e, texto, selIni: s, selFim: s + texto.length }
}

/** Lista e citação valem para a linha inteira de cada linha tocada pela seleção. */
function alternarPrefixo(v: string, s: number, e: number, f: Formato): Troca {
  const re = PREFIXO[f]!
  const ls = v.lastIndexOf('\n', s - 1) + 1
  const ate = e > s && v[e - 1] === '\n' ? e - 1 : e
  let le = v.indexOf('\n', ate)
  if (le < 0) le = v.length
  const linhas = v.slice(ls, le).split('\n')
  const alvo = linhas.some((l) => l.trim()) ? (l: string) => !!l.trim() : () => true
  const tirar = linhas.filter(alvo).every((l) => re.test(l))
  let n = 1
  const texto = linhas.map((l) => {
    if (!alvo(l)) return l
    if (tirar) return l.replace(re, '')
    if (f === 'citacao') return re.test(l) ? l : '> ' + l
    // Trocar de marcador para numerada (e vice-versa) em vez de empilhar os dois.
    const limpa = l.replace(QUALQUER_LISTA, '')
    return (f === 'numerada' ? `${n++}. ` : '- ') + limpa
  }).join('\n')
  const cursor = s === e
  return { ini: ls, fim: le, texto, selIni: cursor ? ls + texto.length : ls, selFim: ls + texto.length }
}

export function aplicarFormato(ta: HTMLTextAreaElement, f: Formato) {
  const v = ta.value
  const s = ta.selectionStart ?? 0
  const e = ta.selectionEnd ?? s
  const t = MARCADOR[f] ? alternarMarcador(v, s, e, MARCADOR[f]!) : alternarPrefixo(v, s, e, f)
  ta.focus()
  ta.setSelectionRange(t.ini, t.fim)
  let ok = false
  try { ok = document.execCommand('insertText', false, t.texto) } catch { ok = false }
  if (!ok || ta.value.slice(t.ini, t.ini + t.texto.length) !== t.texto) {
    ta.setRangeText(t.texto, t.ini, t.fim, 'end')
    ta.dispatchEvent(new Event('input', { bubbles: true }))
  }
  ta.setSelectionRange(t.selIni, t.selFim)
}

/** Ctrl+B, Ctrl+I, Ctrl+Shift+X/M/8/7/9 — devolve true se tratou a tecla. */
export function atalhoFormatacao(e: KeyboardEvent, ta: HTMLTextAreaElement | null): boolean {
  if (!ta || !(e.ctrlKey || e.metaKey) || e.altKey) return false
  const k = e.key.toLowerCase()
  let f: Formato | null = null
  if (!e.shiftKey && k === 'b') f = 'negrito'
  else if (!e.shiftKey && k === 'i') f = 'italico'
  else if (e.shiftKey && k === 'x') f = 'tachado'
  else if (e.shiftKey && k === 'm') f = 'codigo'
  else if (e.shiftKey && e.code === 'Digit8') f = 'lista'
  else if (e.shiftKey && e.code === 'Digit7') f = 'numerada'
  else if (e.shiftKey && e.code === 'Digit9') f = 'citacao'
  if (!f) return false
  e.preventDefault()
  aplicarFormato(ta, f)
  return true
}

const ESTILOS_ESPELHO = [
  'boxSizing', 'width', 'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
  'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'fontStyle', 'fontVariant', 'fontWeight',
  'fontStretch', 'fontSize', 'lineHeight', 'fontFamily', 'textAlign', 'textTransform', 'textIndent',
  'letterSpacing', 'wordSpacing', 'tabSize',
] as const

/** Posição (relativa à caixa, já descontada a rolagem) de um índice do texto:
 *  copia a caixa num div invisível e mede onde o caractere cai. */
function posicaoNoTexto(ta: HTMLTextAreaElement, i: number) {
  const div = document.createElement('div')
  const cs = getComputedStyle(ta)
  for (const p of ESTILOS_ESPELHO) (div.style as any)[p] = cs[p as any]
  Object.assign(div.style, { position: 'absolute', visibility: 'hidden', top: '0', left: '-9999px', whiteSpace: 'pre-wrap', overflowWrap: 'break-word', overflow: 'hidden' })
  div.textContent = ta.value.slice(0, i)
  const marca = document.createElement('span')
  marca.textContent = ta.value.slice(i) || '.'
  div.appendChild(marca)
  document.body.appendChild(div)
  const r = { top: marca.offsetTop - ta.scrollTop, left: marca.offsetLeft - ta.scrollLeft, altura: parseFloat(cs.lineHeight) || 20 }
  div.remove()
  return r
}

const BOTOES: Array<{ f: Formato; rotulo: string; atalho: string; Icone: typeof Bold } | null> = [
  { f: 'negrito', rotulo: 'Negrito', atalho: 'Ctrl+B', Icone: Bold },
  { f: 'italico', rotulo: 'Itálico', atalho: 'Ctrl+I', Icone: Italic },
  { f: 'tachado', rotulo: 'Tachado', atalho: 'Ctrl+Shift+X', Icone: Strikethrough },
  { f: 'codigo', rotulo: 'Código inline', atalho: 'Ctrl+Shift+M', Icone: Code },
  null,
  { f: 'lista', rotulo: 'Lista com marcadores', atalho: 'Ctrl+Shift+8', Icone: List },
  { f: 'numerada', rotulo: 'Lista numerada', atalho: 'Ctrl+Shift+7', Icone: ListOrdered },
  { f: 'citacao', rotulo: 'Citar', atalho: 'Ctrl+Shift+9', Icone: Quote },
]

/** Barra flutuante sobre o trecho selecionado no campo de mensagem. */
export function BarraFormatacao({ textareaRef }: { textareaRef: RefObject<HTMLTextAreaElement | null> }) {
  const [pos, setPos] = useState<{ x: number; y: number; abaixo: boolean } | null>(null)
  const barra = useRef<HTMLDivElement>(null)
  const [ajusteX, setAjusteX] = useState(0)

  useEffect(() => {
    const ta = textareaRef.current
    if (!ta) return
    let arrastando = false
    let raf = 0
    const atualizar = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        const s = ta.selectionStart ?? 0, e = ta.selectionEnd ?? 0
        if (arrastando || document.activeElement !== ta || s === e || !ta.value.slice(s, e).trim()) { setPos(null); return }
        const r = ta.getBoundingClientRect()
        const a = posicaoNoTexto(ta, s), b = posicaoNoTexto(ta, e)
        const mesmaLinha = a.top === b.top
        const x = r.left + (mesmaLinha ? (a.left + b.left) / 2 : ta.clientWidth / 2)
        const topo = Math.min(Math.max(a.top, 0), r.height)
        let y = r.top + topo - 6
        let abaixo = false
        if (y < 56) { y = r.top + Math.min(Math.max(b.top + b.altura, 0), r.height) + 6; abaixo = true }
        setPos({ x, y, abaixo })
      })
    }
    const baixar = () => { arrastando = true; setPos(null) }
    const soltar = () => { if (arrastando) { arrastando = false; atualizar() } }
    const sumir = () => setPos(null)
    document.addEventListener('selectionchange', atualizar)
    ta.addEventListener('select', atualizar)
    ta.addEventListener('scroll', atualizar)
    ta.addEventListener('pointerdown', baixar)
    window.addEventListener('pointerup', soltar)
    ta.addEventListener('blur', sumir)
    window.addEventListener('resize', atualizar)
    return () => {
      cancelAnimationFrame(raf)
      document.removeEventListener('selectionchange', atualizar)
      ta.removeEventListener('select', atualizar)
      ta.removeEventListener('scroll', atualizar)
      ta.removeEventListener('pointerdown', baixar)
      window.removeEventListener('pointerup', soltar)
      ta.removeEventListener('blur', sumir)
      window.removeEventListener('resize', atualizar)
    }
  }, [textareaRef])

  // Não deixa a barra sair pela lateral da tela.
  useLayoutEffect(() => {
    const el = barra.current
    if (!el || !pos) { setAjusteX(0); return }
    const w = el.offsetWidth, m = 8
    const esq = pos.x - w / 2
    setAjusteX(esq < m ? m - esq : esq + w > window.innerWidth - m ? window.innerWidth - m - (esq + w) : 0)
  }, [pos?.x, pos?.y])

  if (!pos) return null
  return createPortal(
    <div
      ref={barra}
      role="toolbar"
      aria-label="Formatar texto selecionado"
      // Clicar na barra não pode tirar o foco (nem a seleção) da caixa.
      onPointerDown={(e) => e.preventDefault()}
      onMouseDown={(e) => e.preventDefault()}
      class="fixed flex items-center gap-0.5 rounded-lg border border-border bg-surface p-1 text-fg shadow-xl"
      style={{
        left: pos.x + ajusteX,
        top: pos.y,
        transform: `translate(-50%, ${pos.abaixo ? '0' : '-100%'})`,
        zIndex: 'var(--z-popover)',
      }}
    >
      {BOTOES.map((b, i) => b === null
        ? <span key={`sep${i}`} class="mx-0.5 h-5 w-px bg-border" aria-hidden="true" />
        : (
          <button
            key={b.f}
            type="button"
            tabIndex={-1}
            class="grid size-8 place-items-center rounded-md text-fg-muted hover:bg-surface-3 hover:text-fg"
            aria-label={b.rotulo}
            title={`${b.rotulo} (${b.atalho})`}
            onClick={() => { const ta = textareaRef.current; if (ta) aplicarFormato(ta, b.f) }}
          >
            <b.Icone size={16} />
          </button>
        ))}
    </div>,
    document.body,
  )
}
