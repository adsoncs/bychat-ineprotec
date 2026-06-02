import { useEffect, useMemo, useRef } from 'preact/hooks'
import { Check, CheckCheck } from 'lucide-preact'

type Channel = 'whatsapp' | 'sms' | 'email'

interface PhonePreviewProps {
  channel: Channel
  text: string
  subject?: string | undefined
  sampleValues?: Record<string, string> | undefined
}

const DEFAULT_SAMPLES: Record<string, string> = {
  nome: 'Maria',
  empresa: 'Beyond',
  operador: 'Carlos',
  data_hoje: new Date().toLocaleDateString('pt-BR'),
  score: '82',
  maturidade: 'alta',
  solucao: 'plano Pro',
}

function fillVariables(text: string, sample: Record<string, string>): string {
  return text.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_m, key: string) => {
    const v = sample[key.toLowerCase()] ?? sample[key]
    return v ?? `{{${key}}}`
  })
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string))
}

function renderWhatsAppFormat(text: string): string {
  let html = escapeHtml(text)
  html = html.replace(/```([\s\S]+?)```/g, '<code class="wa-mono">$1</code>')
  html = html.replace(/(^|\s)\*([^\s*][^*]*[^\s*]|[^\s*])\*(?=\s|$|[.,!?;:])/g, '$1<b>$2</b>')
  html = html.replace(/(^|\s)_([^\s_][^_]*[^\s_]|[^\s_])_(?=\s|$|[.,!?;:])/g, '$1<i>$2</i>')
  html = html.replace(/(^|\s)~([^\s~][^~]*[^\s~]|[^\s~])~(?=\s|$|[.,!?;:])/g, '$1<s>$2</s>')
  html = html.replace(/\{\{([\w.-]+)\}\}/g, '<span class="wa-var">{{$1}}</span>')
  html = html.replace(/\n/g, '<br/>')
  return html
}

function renderPlainPreview(text: string): string {
  let html = escapeHtml(text)
  html = html.replace(/\{\{([\w.-]+)\}\}/g, '<span class="wa-var">{{$1}}</span>')
  html = html.replace(/\n/g, '<br/>')
  return html
}

export function PhonePreview({ channel, text, subject, sampleValues }: PhonePreviewProps) {
  const samples = { ...DEFAULT_SAMPLES, ...(sampleValues ?? {}) }
  const filled = useMemo(() => fillVariables(text, samples), [text, samples])
  const filledSubject = useMemo(() => (subject ? fillVariables(subject, samples) : ''), [subject, samples])

  const now = new Date()
  const timeLabel = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })

  if (channel === 'email') {
    return (
      <div class="rounded-lg border border-border bg-surface overflow-hidden">
        <div class="px-3 py-2 border-b border-border bg-surface-2 text-[0.6875rem] text-fg-muted">
          <div class="flex justify-between">
            <span class="font-medium text-fg">Para: maria@empresa.com</span>
            <span>{timeLabel}</span>
          </div>
          <div class="font-semibold text-fg mt-0.5 text-xs">
            {filledSubject || <span class="text-fg-subtle italic">(sem assunto)</span>}
          </div>
        </div>
        <EmailRenderedBody html={filled} />
      </div>
    )
  }

  if (channel === 'whatsapp') {
    return (
      <div class="phone-frame">
        <div class="phone-screen wa-screen">
          <div class="wa-header">
            <div class="wa-avatar">M</div>
            <div>
              <div class="wa-name">Maria</div>
              <div class="wa-status">online</div>
            </div>
          </div>
          <div class="wa-body">
            {filled ? (
              <div class="wa-bubble">
                <div class="wa-text" dangerouslySetInnerHTML={{ __html: renderWhatsAppFormat(text ? filled : '') }} />
                <div class="wa-meta">
                  <span>{timeLabel}</span>
                  <CheckCheck size={12} class="wa-tick" />
                </div>
              </div>
            ) : (
              <div class="wa-empty">A pré-visualização aparece aqui…</div>
            )}
          </div>
        </div>
        <PhoneStyles />
      </div>
    )
  }

  // SMS
  return (
    <div class="phone-frame">
      <div class="phone-screen sms-screen">
        <div class="sms-header">
          <div class="sms-name">Beyond</div>
          <div class="sms-sub">Mensagem de texto · SMS</div>
        </div>
        <div class="sms-body">
          {filled ? (
            <div class="sms-bubble">
              <div class="sms-text" dangerouslySetInnerHTML={{ __html: renderPlainPreview(filled) }} />
              <div class="sms-meta">
                <span>{timeLabel}</span>
                <Check size={11} />
              </div>
            </div>
          ) : (
            <div class="sms-empty">A pré-visualização aparece aqui…</div>
          )}
        </div>
      </div>
      <PhoneStyles />
    </div>
  )
}

function EmailRenderedBody({ html }: { html: string }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.innerHTML = html ? highlightEmailVars(html) : ''
  }, [html])
  return (
    <>
      <div
        ref={ref}
        class="email-rendered p-3 max-h-[420px] overflow-y-auto bg-white text-slate-900 text-sm leading-relaxed"
        style={{ minHeight: '160px' }}
      >
        {!html && <span class="text-slate-400 italic">A pré-visualização aparece aqui…</span>}
      </div>
      <style>{`
        .email-rendered h1, .email-rendered h2, .email-rendered h3 { font-weight: 600; margin: 0.5em 0 0.25em; }
        .email-rendered h2 { font-size: 1.05rem; }
        .email-rendered p { margin: 0.4em 0; }
        .email-rendered ul { list-style: disc; padding-left: 1.25rem; margin: 0.4em 0; }
        .email-rendered ol { list-style: decimal; padding-left: 1.25rem; margin: 0.4em 0; }
        .email-rendered a { color: #2563eb; text-decoration: underline; }
        .email-rendered blockquote { border-left: 3px solid #cbd5e1; padding-left: 0.5rem; color: #64748b; margin: 0.4em 0; }
        .email-rendered pre { background: #f1f5f9; padding: 0.5rem; border-radius: 4px; font-family: ui-monospace, monospace; font-size: 0.75rem; overflow-x: auto; }
        .email-rendered img { max-width: 100%; height: auto; }
        .email-rendered table { border-collapse: collapse; max-width: 100%; }
      `}</style>
    </>
  )
}

function highlightEmailVars(html: string): string {
  return html.replace(
    /\{\{([\w.-]+)\}\}/g,
    '<span style="background:#eef2ff;color:#4338ca;padding:0 4px;border-radius:4px;font-family:ui-monospace,monospace;font-size:0.85em">{{$1}}</span>',
  )
}

function PhoneStyles() {
  return (
    <style>{`
      .phone-frame {
        width: 100%;
        max-width: 280px;
        margin: 0 auto;
        border-radius: 28px;
        background: #0f172a;
        padding: 8px;
        box-shadow: 0 12px 30px -10px rgba(0,0,0,0.35);
      }
      .phone-screen {
        border-radius: 22px;
        overflow: hidden;
        min-height: 440px;
        max-height: 480px;
        display: flex;
        flex-direction: column;
      }
      .wa-screen { background: #e5ddd5; }
      .wa-header {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 10px;
        background: #075e54;
        color: #fff;
      }
      .wa-avatar {
        width: 28px; height: 28px;
        border-radius: 50%;
        background: #128c7e;
        display: flex; align-items: center; justify-content: center;
        font-size: 12px; font-weight: 600;
      }
      .wa-name { font-size: 12px; font-weight: 600; line-height: 1.1; }
      .wa-status { font-size: 10px; opacity: 0.8; }
      .wa-body { flex: 1; padding: 12px 8px; overflow-y: auto; }
      .wa-bubble {
        background: #dcf8c6;
        color: #111827;
        padding: 6px 8px 4px;
        border-radius: 8px 0 8px 8px;
        margin-left: auto;
        max-width: 88%;
        width: fit-content;
        font-size: 12px;
        line-height: 1.35;
        word-break: break-word;
        box-shadow: 0 1px 0 rgba(0,0,0,0.06);
      }
      .wa-text b { font-weight: 700; }
      .wa-text i { font-style: italic; }
      .wa-text s { text-decoration: line-through; }
      .wa-text .wa-mono { background: rgba(0,0,0,0.06); padding: 0 3px; border-radius: 3px; font-family: ui-monospace, monospace; font-size: 0.85em; }
      .wa-text .wa-var { background: #fef3c7; color: #92400e; padding: 0 4px; border-radius: 4px; font-family: ui-monospace, monospace; font-size: 0.85em; }
      .wa-meta { display: flex; justify-content: flex-end; align-items: center; gap: 2px; font-size: 9px; color: #6b7280; margin-top: 2px; }
      .wa-tick { color: #34b7f1; }
      .wa-empty { font-size: 11px; color: #6b7280; text-align: center; margin-top: 24px; font-style: italic; }

      .sms-screen { background: #fff; }
      .sms-header { padding: 10px; text-align: center; border-bottom: 1px solid #e5e7eb; }
      .sms-name { font-size: 12px; font-weight: 600; color: #111827; }
      .sms-sub { font-size: 9px; color: #6b7280; margin-top: 1px; }
      .sms-body { flex: 1; padding: 12px 8px; overflow-y: auto; }
      .sms-bubble {
        background: #e5e7eb;
        color: #111827;
        padding: 7px 10px 4px;
        border-radius: 14px 14px 14px 4px;
        max-width: 84%;
        width: fit-content;
        font-size: 12px;
        line-height: 1.35;
        word-break: break-word;
      }
      .sms-text .wa-var { background: #fef3c7; color: #92400e; padding: 0 4px; border-radius: 4px; font-family: ui-monospace, monospace; font-size: 0.85em; }
      .sms-meta { display: flex; justify-content: flex-end; align-items: center; gap: 3px; font-size: 9px; color: #6b7280; margin-top: 2px; }
      .sms-empty { font-size: 11px; color: #9ca3af; text-align: center; margin-top: 24px; font-style: italic; }
    `}</style>
  )
}
