import { useCallback, useEffect, useRef, useState } from 'preact/hooks'
import {
  Bold,
  Italic,
  Underline as UnderlineIcon,
  Strikethrough,
  Heading2,
  List,
  ListOrdered,
  Link2,
  Eraser,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Quote,
  Code,
} from '@/components/ui/icon-set'
import { cn } from '@/lib/cn'

interface RichTextEditorProps {
  value: string
  onChange: (html: string) => void
  placeholder?: string
  varKeys?: string[]
  minHeight?: number
}

const COLOR_SWATCHES = ['#0f172a', '#475569', '#ef4444', '#f97316', '#eab308', '#22c55e', '#0ea5e9', '#6366f1', '#a855f7', '#ec4899']

function exec(cmd: string, value?: string) {
  document.execCommand(cmd, false, value)
}

export function RichTextEditor({ value, onChange, placeholder, varKeys = [], minHeight = 220 }: RichTextEditorProps) {
  const ref = useRef<HTMLDivElement>(null)
  const lastValueRef = useRef<string>(value)
  const [colorOpen, setColorOpen] = useState(false)
  const colorBtnRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!ref.current) return
    if (lastValueRef.current !== value && ref.current.innerHTML !== value) {
      ref.current.innerHTML = value
      lastValueRef.current = value
    }
  }, [value])

  useEffect(() => {
    if (!ref.current) return
    ref.current.innerHTML = value || ''
    lastValueRef.current = value || ''
  }, [])

  const handleInput = useCallback(() => {
    if (!ref.current) return
    const html = ref.current.innerHTML
    lastValueRef.current = html
    onChange(html)
  }, [onChange])

  function focusEditor() {
    ref.current?.focus()
  }

  function run(cmd: string, val?: string) {
    focusEditor()
    exec(cmd, val)
    handleInput()
  }

  function makeLink() {
    focusEditor()
    const sel = window.getSelection()
    const hasSelection = sel && !sel.isCollapsed
    const url = window.prompt('URL do link (inclua https://):', 'https://')
    if (!url) return
    if (hasSelection) {
      exec('createLink', url)
    } else {
      exec('insertHTML', `<a href="${escapeAttr(url)}" target="_blank" rel="noopener">${escapeHtml(url)}</a>`)
    }
    handleInput()
  }

  function insertVariable(k: string) {
    focusEditor()
    exec('insertHTML', `{{${k}}}`)
    handleInput()
  }

  function clearFormatting() {
    focusEditor()
    exec('removeFormat')
    exec('unlink')
    handleInput()
  }

  function applyColor(color: string) {
    focusEditor()
    exec('foreColor', color)
    setColorOpen(false)
    handleInput()
  }

  return (
    <div class="rounded-md border border-border bg-surface-inset surface-inset overflow-hidden">
      <div class="flex flex-wrap items-center gap-0.5 px-1.5 py-1 border-b border-border bg-surface-2">
        <ToolbarBtn title="Negrito (Ctrl+B)" onClick={() => run('bold')}><Bold size={14} /></ToolbarBtn>
        <ToolbarBtn title="Itálico (Ctrl+I)" onClick={() => run('italic')}><Italic size={14} /></ToolbarBtn>
        <ToolbarBtn title="Sublinhado (Ctrl+U)" onClick={() => run('underline')}><UnderlineIcon size={14} /></ToolbarBtn>
        <ToolbarBtn title="Tachado" onClick={() => run('strikeThrough')}><Strikethrough size={14} /></ToolbarBtn>
        <Divider />
        <ToolbarBtn title="Subtítulo" onClick={() => run('formatBlock', '<h2>')}><Heading2 size={14} /></ToolbarBtn>
        <ToolbarBtn title="Parágrafo" onClick={() => run('formatBlock', '<p>')}><span class="text-2xs font-semibold">P</span></ToolbarBtn>
        <ToolbarBtn title="Citação" onClick={() => run('formatBlock', '<blockquote>')}><Quote size={14} /></ToolbarBtn>
        <ToolbarBtn title="Código" onClick={() => run('formatBlock', '<pre>')}><Code size={14} /></ToolbarBtn>
        <Divider />
        <ToolbarBtn title="Lista" onClick={() => run('insertUnorderedList')}><List size={14} /></ToolbarBtn>
        <ToolbarBtn title="Lista numerada" onClick={() => run('insertOrderedList')}><ListOrdered size={14} /></ToolbarBtn>
        <Divider />
        <ToolbarBtn title="Alinhar à esquerda" onClick={() => run('justifyLeft')}><AlignLeft size={14} /></ToolbarBtn>
        <ToolbarBtn title="Centralizar" onClick={() => run('justifyCenter')}><AlignCenter size={14} /></ToolbarBtn>
        <ToolbarBtn title="Alinhar à direita" onClick={() => run('justifyRight')}><AlignRight size={14} /></ToolbarBtn>
        <Divider />
        <ToolbarBtn title="Link" onClick={makeLink}><Link2 size={14} /></ToolbarBtn>
        <div class="relative">
          <ToolbarBtn title="Cor do texto" onClick={() => setColorOpen((o) => !o)} btnRef={colorBtnRef}>
            <span class="inline-flex items-center gap-0.5 text-2xs font-semibold">A<span class="block w-2.5 h-1 rounded-sm bg-gradient-to-r from-danger via-warning to-info" /></span>
          </ToolbarBtn>
          {colorOpen && (
            <>
              <div class="fixed inset-0 z-10" onClick={() => setColorOpen(false)} />
              <div class="absolute z-20 mt-1 grid grid-cols-5 gap-1 p-1.5 rounded-md border border-border bg-surface-2 shadow-lg surface-raised">
                {COLOR_SWATCHES.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => applyColor(c)}
                    class="w-5 h-5 rounded-sm border border-border/70 hover:scale-110 transition-transform"
                    style={{ background: c }}
                    title={c}
                  />
                ))}
              </div>
            </>
          )}
        </div>
        <ToolbarBtn title="Limpar formatação" onClick={clearFormatting}><Eraser size={14} /></ToolbarBtn>
        {varKeys.length > 0 && (
          <>
            <Divider />
            <div class="flex flex-wrap gap-1 items-center">
              <span class="text-3xs text-fg-muted uppercase tracking-wide ml-1">Variáveis:</span>
              {varKeys.map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => insertVariable(k)}
                  class="inline-flex items-center h-5 px-2 rounded-full text-3xs font-mono border border-info/40 bg-info/10 text-info hover:bg-info/20 transition-colors"
                >
                  {`{{${k}}}`}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      <div
        ref={ref}
        contentEditable
        onInput={handleInput}
        onBlur={handleInput}
        data-placeholder={placeholder}
        class={cn(
          'rich-editor px-3 py-2 text-sm text-fg outline-none',
          'prose-headings:font-semibold prose-headings:my-1.5',
        )}
        style={{ minHeight }}
      />
      <style>{`
        .rich-editor:empty::before {
          content: attr(data-placeholder);
          color: var(--color-fg-muted, #94a3b8);
          pointer-events: none;
        }
        .rich-editor h2 { font-size: 1rem; font-weight: 600; margin: 0.5rem 0 0.25rem; }
        .rich-editor p { margin: 0.25rem 0; }
        .rich-editor ul { list-style: disc; padding-left: 1.25rem; margin: 0.25rem 0; }
        .rich-editor ol { list-style: decimal; padding-left: 1.25rem; margin: 0.25rem 0; }
        .rich-editor a { color: var(--color-accent, #2563eb); text-decoration: underline; }
        .rich-editor blockquote { border-left: 3px solid var(--color-border, #e2e8f0); padding-left: 0.5rem; color: var(--color-fg-muted, #475569); margin: 0.25rem 0; }
        .rich-editor pre { background: var(--color-surface-2, #f1f5f9); padding: 0.5rem; border-radius: 4px; font-family: ui-monospace, monospace; font-size: 0.75rem; overflow-x: auto; }
      `}</style>
    </div>
  )
}

function ToolbarBtn({
  children,
  onClick,
  title,
  btnRef,
}: {
  children: preact.ComponentChildren
  onClick: () => void
  title: string
  btnRef?: preact.RefObject<HTMLButtonElement> | undefined
}) {
  return (
    <button
      {...(btnRef ? { ref: btnRef } : {})}
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      title={title}
      class="inline-flex items-center justify-center h-7 min-w-7 px-1.5 rounded-md text-fg-muted hover:bg-surface-3 hover:text-fg transition-colors"
    >
      {children}
    </button>
  )
}

function Divider() {
  return <span class="w-px h-4 bg-border mx-0.5" />
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string))
}

function escapeAttr(s: string) {
  return s.replace(/"/g, '&quot;')
}

export function htmlToText(html: string): string {
  const div = document.createElement('div')
  div.innerHTML = html
  div.querySelectorAll('br').forEach((br) => br.replaceWith('\n'))
  div.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li, blockquote').forEach((el) => {
    el.append('\n')
  })
  return (div.textContent ?? '').replace(/\n{3,}/g, '\n\n').trim()
}
