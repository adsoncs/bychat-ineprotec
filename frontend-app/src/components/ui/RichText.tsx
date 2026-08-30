// Editor de rich text leve (sem dependência) baseado em contenteditable +
// document.execCommand. Toolbar completa: títulos (H1/H2/H3), tamanho de fonte,
// negrito/itálico/sublinhado/tachado, listas, alinhamento, cor, emoji, link e
// limpar. Emite HTML. Usado em headlines/copy de blocos e mensagens.
//
// IMPORTANTE: o container externo é um <div>, NÃO um <label>. Um <label> que
// contém <button> (a toolbar) redireciona o clique para o primeiro botão, o que
// roubava o foco da área de texto (não dava pra clicar e digitar).
import { useEffect, useRef, useState } from 'preact/hooks'
import {
  Bold, Italic, Underline, Strikethrough, List, ListOrdered, Link2, Eraser,
  Smile, AlignLeft, AlignCenter, AlignRight, Pilcrow, Heading1, Heading2, Heading3, Baseline, Palette,
} from '@/components/ui/icon-set'

interface RichTextProps {
  value: string
  onChange: (html: string) => void
  label?: string
  placeholder?: string
  minHeight?: string
}

/** Remove tags HTML — útil para exibir um rótulo "achatado" (ex.: lista de campos). */
export function stripHtml(html: string | undefined | null): string {
  if (!html) return ''
  return decodeIfEscaped(String(html)).replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').trim()
}

/** Conteúdo "escapado" (&lt;span&gt;) que deveria ser HTML → decodifica para renderizar.
 *  Só decodifica quando parece escapado E não há tags cruas, pra não destruir HTML real. */
export function decodeIfEscaped(html: string | undefined | null): string {
  const s = String(html ?? '')
  if (!s) return ''
  if (/&lt;|&gt;/.test(s) && !/<[a-z!/]/i.test(s)) {
    const t = document.createElement('textarea')
    t.innerHTML = s
    return t.value
  }
  return s
}

const EMOJIS = [
  '😀', '😁', '😂', '🤣', '😊', '😍', '😎', '🤩', '🥳', '😉',
  '🤔', '👀', '👍', '👏', '🙌', '🙏', '💪', '🔥', '⭐', '✨',
  '🎉', '🎯', '🚀', '💡', '✅', '❌', '⚠️', '📌', '📈', '💰',
  '🛒', '📞', '✉️', '💬', '❤️', '🧡', '💚', '💙', '💜', '🏆',
]

const SIZES: { label: string; value: string }[] = [
  { label: 'Pequeno', value: '2' },
  { label: 'Normal', value: '3' },
  { label: 'Médio', value: '4' },
  { label: 'Grande', value: '5' },
  { label: 'Enorme', value: '6' },
]

export function RichText({ value, onChange, label, placeholder, minHeight = '2.5rem' }: RichTextProps) {
  const ref = useRef<HTMLDivElement>(null)
  const focused = useRef(false)
  const [emojiOpen, setEmojiOpen] = useState(false)
  const [sizeOpen, setSizeOpen] = useState(false)

  // Sincroniza o HTML externo sem resetar o cursor durante a digitação:
  // NÃO reescreve enquanto o campo está focado (senão o cursor pula/perde foco).
  // decodeIfEscaped corrige dados antigos que vieram entity-encoded (&lt;span&gt;).
  useEffect(() => {
    const el = ref.current
    if (!el || focused.current) return
    const v = decodeIfEscaped(value)
    if (el.innerHTML !== v) el.innerHTML = v
  }, [value])

  const emit = () => onChange(ref.current?.innerHTML || '')
  const exec = (cmd: string, arg?: string) => {
    ref.current?.focus()
    document.execCommand(cmd, false, arg)
    emit()
  }
  // mousedown nos controles: preventDefault preserva a seleção/foco no editor.
  const keep = (fn: () => void) => (e: Event) => { e.preventDefault(); fn() }

  return (
    <div class="flex flex-col gap-1">
      {label && <span class="text-xs font-medium text-fg-muted">{label}</span>}
      <div class="rounded-md border border-border bg-surface-inset surface-inset overflow-visible focus-within:border-accent">
        <div class="relative flex flex-wrap items-center gap-0.5 border-b border-border bg-surface-2 px-1 py-1">
          {/* Estilos de bloco */}
          <ToolBtn title="Parágrafo" icon={Pilcrow} onClick={keep(() => exec('formatBlock', '<p>'))} />
          <ToolBtn title="Título 1" icon={Heading1} onClick={keep(() => exec('formatBlock', '<h1>'))} />
          <ToolBtn title="Título 2" icon={Heading2} onClick={keep(() => exec('formatBlock', '<h2>'))} />
          <ToolBtn title="Título 3" icon={Heading3} onClick={keep(() => exec('formatBlock', '<h3>'))} />
          <Sep />
          {/* Inline */}
          <ToolBtn title="Negrito" icon={Bold} onClick={keep(() => exec('bold'))} />
          <ToolBtn title="Itálico" icon={Italic} onClick={keep(() => exec('italic'))} />
          <ToolBtn title="Sublinhado" icon={Underline} onClick={keep(() => exec('underline'))} />
          <ToolBtn title="Tachado" icon={Strikethrough} onClick={keep(() => exec('strikeThrough'))} />
          <Sep />
          {/* Tamanho de fonte (popover) */}
          <div class="relative">
            <ToolBtn title="Tamanho da fonte" icon={Baseline} onMouseDown={keep(() => setSizeOpen((v) => !v))} />
            {sizeOpen && (
              <div class="absolute left-0 top-full z-20 mt-1 w-32 rounded-md border border-border bg-surface-2 shadow-lg surface-raised p-1">
                {SIZES.map((s) => (
                  <button key={s.value} type="button" class="block w-full rounded px-2 py-1 text-left text-sm hover:bg-surface-3"
                    onMouseDown={keep(() => { exec('fontSize', s.value); setSizeOpen(false) })}>{s.label}</button>
                ))}
              </div>
            )}
          </div>
          {/* Cor do texto */}
          <label class="size-7 grid place-items-center rounded text-fg-muted hover:bg-surface-3 hover:text-fg cursor-pointer" title="Cor do texto">
            <Palette size={14} />
            <input type="color" class="sr-only" onMouseDown={(e) => e.stopPropagation()}
              onInput={(e) => exec('foreColor', (e.target as HTMLInputElement).value)} />
          </label>
          <Sep />
          {/* Alinhamento */}
          <ToolBtn title="Alinhar à esquerda" icon={AlignLeft} onClick={keep(() => exec('justifyLeft'))} />
          <ToolBtn title="Centralizar" icon={AlignCenter} onClick={keep(() => exec('justifyCenter'))} />
          <ToolBtn title="Alinhar à direita" icon={AlignRight} onClick={keep(() => exec('justifyRight'))} />
          <Sep />
          {/* Listas */}
          <ToolBtn title="Lista com marcadores" icon={List} onClick={keep(() => exec('insertUnorderedList'))} />
          <ToolBtn title="Lista numerada" icon={ListOrdered} onClick={keep(() => exec('insertOrderedList'))} />
          <Sep />
          {/* Emoji (popover) */}
          <div class="relative">
            <ToolBtn title="Emoji" icon={Smile} onMouseDown={keep(() => setEmojiOpen((v) => !v))} />
            {emojiOpen && (
              <div class="absolute left-0 top-full z-20 mt-1 w-[15rem] rounded-md border border-border bg-surface-2 shadow-lg surface-raised p-2 grid grid-cols-10 gap-0.5">
                {EMOJIS.map((em) => (
                  <button key={em} type="button" class="size-5 grid place-items-center rounded text-base leading-none hover:bg-surface-3"
                    onMouseDown={keep(() => { exec('insertText', em); setEmojiOpen(false) })}>{em}</button>
                ))}
              </div>
            )}
          </div>
          {/* Link / limpar */}
          <ToolBtn title="Inserir link" icon={Link2} onClick={keep(() => { const url = window.prompt('URL do link:'); if (url) exec('createLink', url) })} />
          <ToolBtn title="Limpar formatação" icon={Eraser} onClick={keep(() => { exec('removeFormat'); exec('unlink') })} />
        </div>
        <div
          ref={ref}
          contentEditable
          onInput={emit}
          onFocus={() => { focused.current = true }}
          onBlur={() => { focused.current = false; emit() }}
          data-placeholder={placeholder ?? ''}
          class="rt-editor px-3 py-2 text-sm text-fg outline-none [&_a]:text-accent [&_a]:underline [&_h1]:text-2xl [&_h1]:font-bold [&_h1]:my-1 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:my-1 [&_h3]:text-lg [&_h3]:font-semibold [&_h3]:my-0.5 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&:empty]:before:content-[attr(data-placeholder)] [&:empty]:before:text-fg-muted"
          style={{ minHeight }}
        />
      </div>
    </div>
  )
}

function ToolBtn({ title, icon: Icon, onClick, onMouseDown }: { title: string; icon: any; onClick?: (e: Event) => void; onMouseDown?: (e: Event) => void }) {
  return (
    <button type="button" title={title}
      onMouseDown={onMouseDown ?? onClick}
      class="size-7 grid place-items-center rounded text-fg-muted hover:bg-surface-3 hover:text-fg">
      <Icon size={14} />
    </button>
  )
}

function Sep() {
  return <span class="mx-0.5 h-5 w-px bg-border" aria-hidden="true" />
}
