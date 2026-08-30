import { useMemo, useState } from 'preact/hooks'
import { Palette, Type, Square, RotateCcw, Eye, Settings as SettingsIcon } from '@/components/ui/icon-set'
import { ColorPicker } from '@/components/ui/ColorPicker'
import { Input, Select } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import {
  DEFAULT_FORM_STYLING,
  resolveFormStyling,
  type FormStyling,
  type FormField,
  type FormSettings,
} from '@/hooks/useForms'
import { cn } from '@/lib/cn'

/**
 * Painel de aparência do formulário em duas colunas:
 *   • esquerda: tabs (Cores · Tipografia · Espaçamento · Botão · Sucesso) com controles
 *   • direita:  preview ao vivo do formulário renderizado com os tokens atuais
 *
 * Os tokens do `styling` espelham exatamente os do `getDefaultFormStyling`
 * no backend (`backend/src/routes/forms.ts`) — o preview aqui usa o mesmo
 * conjunto de valores que o `<beyond-form>` Web Component aplica em produção,
 * então o que se vê é o que sai.
 */

const FONT_OPTIONS: { value: string; label: string }[] = [
  { value: "'Inter', system-ui, sans-serif",                     label: 'Inter (padrão)' },
  { value: "'Roboto', system-ui, sans-serif",                    label: 'Roboto' },
  { value: "'Open Sans', system-ui, sans-serif",                 label: 'Open Sans' },
  { value: "'Lato', system-ui, sans-serif",                      label: 'Lato' },
  { value: "'Montserrat', system-ui, sans-serif",                label: 'Montserrat' },
  { value: "'Poppins', system-ui, sans-serif",                   label: 'Poppins' },
  { value: "'Nunito', system-ui, sans-serif",                    label: 'Nunito' },
  { value: "'Source Sans Pro', system-ui, sans-serif",           label: 'Source Sans Pro' },
  { value: "'Raleway', system-ui, sans-serif",                   label: 'Raleway' },
  { value: "Georgia, 'Times New Roman', serif",                  label: 'Georgia (serifa)' },
  { value: "system-ui, -apple-system, BlinkMacSystemFont, sans-serif", label: 'Sistema (nativa)' },
]

const PRESETS: { id: string; label: string; styling: FormStyling }[] = [
  {
    id: 'default',
    label: 'Padrão azul',
    styling: { ...DEFAULT_FORM_STYLING },
  },
  {
    id: 'dark',
    label: 'Dark',
    styling: {
      ...DEFAULT_FORM_STYLING,
      backgroundColor: '#0f172a',
      labelColor: '#f1f5f9',
      fieldBgColor: '#1e293b',
      fieldBorderColor: '#334155',
      fieldTextColor: '#f1f5f9',
      fieldPlaceholderColor: '#64748b',
      primaryColor: '#22d3ee',
      primaryHoverColor: '#0891b2',
      buttonTextColor: '#0f172a',
      successTitleColor: '#4ade80',
      successTextColor: '#94a3b8',
    },
  },
  {
    id: 'soft-purple',
    label: 'Suave roxo',
    styling: {
      ...DEFAULT_FORM_STYLING,
      backgroundColor: '#faf5ff',
      primaryColor: '#9333ea',
      primaryHoverColor: '#7e22ce',
      labelColor: '#581c87',
      fieldBorderColor: '#e9d5ff',
      fieldBgColor: '#ffffff',
      borderRadius: '12px',
      buttonRadius: '12px',
      successTitleColor: '#9333ea',
    },
  },
  {
    id: 'vibrant-orange',
    label: 'Vibrante laranja',
    styling: {
      ...DEFAULT_FORM_STYLING,
      backgroundColor: '#fff7ed',
      primaryColor: '#ea580c',
      primaryHoverColor: '#c2410c',
      labelColor: '#7c2d12',
      fieldBorderColor: '#fed7aa',
      borderRadius: '6px',
      buttonRadius: '6px',
      buttonFontWeight: '700',
    },
  },
  {
    id: 'minimal',
    label: 'Minimalista',
    styling: {
      ...DEFAULT_FORM_STYLING,
      primaryColor: '#000000',
      primaryHoverColor: '#374151',
      buttonTextColor: '#ffffff',
      fieldBorderColor: '#e5e7eb',
      labelColor: '#111827',
      fieldBgColor: '#fafafa',
      borderRadius: '0px',
      buttonRadius: '0px',
      labelWeight: '500',
      buttonFontWeight: '500',
    },
  },
  {
    id: 'rounded',
    label: 'Pílula',
    styling: {
      ...DEFAULT_FORM_STYLING,
      borderRadius: '999px',
      buttonRadius: '999px',
      fieldPadding: '14px 18px',
      buttonPadding: '14px 18px',
    },
  },
]

type Tab = 'colors' | 'typography' | 'spacing' | 'button' | 'success'

const TABS: { id: Tab; label: string; icon: typeof Palette }[] = [
  { id: 'colors',     label: 'Cores',       icon: Palette },
  { id: 'typography', label: 'Tipografia',  icon: Type },
  { id: 'spacing',    label: 'Espaçamento', icon: Square },
  { id: 'button',     label: 'Botão',       icon: SettingsIcon },
  { id: 'success',    label: 'Sucesso',     icon: Eye },
]

interface Props {
  value: FormStyling | null | undefined
  onChange: (next: FormStyling) => void
  // O preview precisa renderizar os campos reais do form pra ser fiel —
  // se ainda não há campos, usamos um fallback genérico (Nome/Email/Mensagem).
  fields?: FormField[] | null
  settings?: FormSettings | null
}

export function FormAppearancePanel({ value, onChange, fields, settings }: Props) {
  const [tab, setTab] = useState<Tab>('colors')
  const styling = useMemo(() => resolveFormStyling(value), [value])

  function set<K extends keyof FormStyling>(key: K, v: FormStyling[K]) {
    onChange({ ...styling, [key]: v })
  }
  function applyPreset(preset: FormStyling) {
    onChange({ ...preset })
  }
  function resetAll() {
    onChange({ ...DEFAULT_FORM_STYLING })
  }

  return (
    <div class="grid gap-4 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      {/* ────── coluna esquerda: controles ────── */}
      <div class="flex flex-col gap-3 min-w-0">
        <div class="flex items-center justify-between gap-2">
          <div class="flex items-center gap-1 border-b border-border flex-1 overflow-x-auto">
            {TABS.map((t) => {
              const Icon = t.icon
              const active = tab === t.id
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTab(t.id)}
                  class={cn(
                    'inline-flex items-center gap-1.5 h-9 px-3 -mb-px text-xs font-medium border-b-2 transition-colors whitespace-nowrap',
                    active ? 'border-accent text-fg' : 'border-transparent text-fg-muted hover:text-fg',
                  )}
                >
                  <Icon size={12} /> {t.label}
                </button>
              )
            })}
          </div>
          <Button variant="ghost" size="sm" onClick={resetAll} title="Voltar pro padrão">
            <RotateCcw size={12} /> Resetar
          </Button>
        </div>

        {/* Presets */}
        <div>
          <div class="text-2xs uppercase tracking-wider text-fg-muted font-medium mb-1.5">Presets</div>
          <div class="flex flex-wrap gap-1.5">
            {PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => applyPreset(p.styling)}
                class="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full border border-border bg-surface text-xs text-fg-muted hover:text-fg hover:bg-surface-3 transition-colors"
              >
                <span
                  class="size-3 rounded-full border border-border/60 shrink-0"
                  style={{ background: p.styling.primaryColor }}
                />
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {tab === 'colors' && (
          <div class="grid gap-3 grid-cols-1 sm:grid-cols-2">
            <ColorPicker label="Cor primária (botão / focus)" value={styling.primaryColor!} onChange={(v) => set('primaryColor', v)} />
            <ColorPicker label="Hover do botão" value={styling.primaryHoverColor!} onChange={(v) => set('primaryHoverColor', v)} />
            <ColorPicker label="Texto do botão" value={styling.buttonTextColor!} onChange={(v) => set('buttonTextColor', v)} />
            <ColorPicker label="Fundo do formulário" value={styling.backgroundColor === 'transparent' ? '#ffffff' : styling.backgroundColor!} onChange={(v) => set('backgroundColor', v)} hint="Use transparente pra integrar com a página." />
            <ColorPicker label="Cor da label" value={styling.labelColor!} onChange={(v) => set('labelColor', v)} />
            <ColorPicker label="Fundo dos campos" value={styling.fieldBgColor!} onChange={(v) => set('fieldBgColor', v)} />
            <ColorPicker label="Borda dos campos" value={styling.fieldBorderColor!} onChange={(v) => set('fieldBorderColor', v)} />
            <ColorPicker label="Texto digitado" value={styling.fieldTextColor!} onChange={(v) => set('fieldTextColor', v)} />
            <ColorPicker label="Placeholder" value={styling.fieldPlaceholderColor!} onChange={(v) => set('fieldPlaceholderColor', v)} />
            <ColorPicker label="Borda de erro" value={styling.errorBorderColor!} onChange={(v) => set('errorBorderColor', v)} />
            <div class="sm:col-span-2 flex items-center gap-2 pt-1">
              <input
                id="form-bg-transparent"
                type="checkbox"
                class="size-4 cursor-pointer accent-accent"
                checked={styling.backgroundColor === 'transparent'}
                onChange={(e) => set('backgroundColor', (e.target as HTMLInputElement).checked ? 'transparent' : '#ffffff')}
              />
              <label for="form-bg-transparent" class="text-xs text-fg-muted cursor-pointer">
                Fundo transparente (usa a cor da página)
              </label>
            </div>
          </div>
        )}

        {tab === 'typography' && (
          <div class="grid gap-3 grid-cols-1 sm:grid-cols-2">
            <Select label="Fonte" value={styling.fontFamily!} onChange={(e) => set('fontFamily', (e.target as HTMLSelectElement).value)}>
              {FONT_OPTIONS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
            </Select>
            <Input label="Tamanho base (px)" value={styling.fontSize!} onInput={(e) => set('fontSize', (e.target as HTMLInputElement).value)} hint="Ex.: 14px, 0.875rem" />
            <Input label="Tamanho da label" value={styling.labelSize!} onInput={(e) => set('labelSize', (e.target as HTMLInputElement).value)} />
            <Select label="Peso da label" value={styling.labelWeight!} onChange={(e) => set('labelWeight', (e.target as HTMLSelectElement).value)}>
              {['400', '500', '600', '700', '800'].map((w) => <option key={w} value={w}>{w}</option>)}
            </Select>
            <Input label="Tamanho do campo" value={styling.fieldFontSize!} onInput={(e) => set('fieldFontSize', (e.target as HTMLInputElement).value)} />
          </div>
        )}

        {tab === 'spacing' && (
          <div class="grid gap-3 grid-cols-1 sm:grid-cols-2">
            <Input label="Largura máxima" value={styling.maxWidth!} onInput={(e) => set('maxWidth', (e.target as HTMLInputElement).value)} hint="Ex.: 480px, 100%, 32rem" />
            <Input label="Espaço entre campos" value={styling.fieldSpacing!} onInput={(e) => set('fieldSpacing', (e.target as HTMLInputElement).value)} hint="Ex.: 16px" />
            <Input label="Padding dos campos" value={styling.fieldPadding!} onInput={(e) => set('fieldPadding', (e.target as HTMLInputElement).value)} hint="Ex.: 11px 14px" />
            <Input label="Cantos arredondados (campos)" value={styling.borderRadius!} onInput={(e) => set('borderRadius', (e.target as HTMLInputElement).value)} hint="Ex.: 8px, 999px" />
          </div>
        )}

        {tab === 'button' && (
          <div class="grid gap-3 grid-cols-1 sm:grid-cols-2">
            <Input label="Padding" value={styling.buttonPadding!} onInput={(e) => set('buttonPadding', (e.target as HTMLInputElement).value)} />
            <Input label="Cantos arredondados" value={styling.buttonRadius!} onInput={(e) => set('buttonRadius', (e.target as HTMLInputElement).value)} />
            <Input label="Tamanho do texto" value={styling.buttonFontSize!} onInput={(e) => set('buttonFontSize', (e.target as HTMLInputElement).value)} />
            <Select label="Peso do texto" value={styling.buttonFontWeight!} onChange={(e) => set('buttonFontWeight', (e.target as HTMLSelectElement).value)}>
              {['400', '500', '600', '700', '800'].map((w) => <option key={w} value={w}>{w}</option>)}
            </Select>
          </div>
        )}

        {tab === 'success' && (
          <div class="grid gap-3 grid-cols-1 sm:grid-cols-2">
            <ColorPicker label="Cor do título" value={styling.successTitleColor!} onChange={(v) => set('successTitleColor', v)} />
            <Input label="Tamanho do título" value={styling.successTitleSize!} onInput={(e) => set('successTitleSize', (e.target as HTMLInputElement).value)} />
            <ColorPicker label="Cor do texto" value={styling.successTextColor!} onChange={(v) => set('successTextColor', v)} />
            <div class="sm:col-span-2 text-xs text-fg-muted">
              Os textos do título e da mensagem de sucesso vêm da aba <strong>Mensagens</strong> (settings).
            </div>
          </div>
        )}
      </div>

      {/* ────── coluna direita: preview ────── */}
      <div class="min-w-0">
        <div class="flex items-center justify-between mb-2">
          <span class="text-2xs uppercase tracking-wider text-fg-muted font-medium inline-flex items-center gap-1">
            <Eye size={12} /> Preview ao vivo
          </span>
        </div>
        <div class="rounded-md border border-border bg-[repeating-linear-gradient(45deg,_var(--color-surface-3)_0_8px,_transparent_8px_16px)] p-4">
          <FormPreview styling={styling} fields={fields ?? []} settings={settings ?? null} />
        </div>
      </div>
    </div>
  )
}

// ─── Preview puro (mesmo CSS aplicado pelo embed real) ───────────

interface PreviewProps {
  styling: Required<FormStyling>
  fields: FormField[]
  settings: FormSettings | null
}

const FALLBACK_FIELDS: FormField[] = [
  { id: 'p1', type: 'text',     key: 'nome',     label: 'Nome',          placeholder: 'Como você se chama?', required: true },
  { id: 'p2', type: 'email',    key: 'email',    label: 'E-mail',        placeholder: 'voce@exemplo.com',    required: true },
  { id: 'p3', type: 'phone',    key: 'whatsapp', label: 'WhatsApp',      placeholder: '(11) 99999-9999',     required: false },
  { id: 'p4', type: 'textarea', key: 'mensagem', label: 'Mensagem',      placeholder: 'Conte um pouco sobre seu interesse…', required: false },
]

function FormPreview({ styling, fields, settings }: PreviewProps) {
  const renderFields = fields.length > 0 ? fields.filter((f) => f.type !== 'hidden') : FALLBACK_FIELDS
  const submitText = settings?.submitText ?? 'Enviar'

  // Mesmas regras de focus ring do generateEmbedScript.
  const focusRing = /^#([0-9a-f]{6})$/i.test(styling.primaryColor)
    ? `${styling.primaryColor}22`
    : styling.primaryColor

  // Como o preview é um <div> "normal" (sem Shadow DOM), escopamos as
  // regras dentro de uma classe única `bf-preview-root` pra não vazar.
  const css = `
    .bf-preview-root, .bf-preview-root *, .bf-preview-root *::before, .bf-preview-root *::after { box-sizing: border-box; margin: 0; padding: 0; }
    .bf-preview-root { font-family: ${styling.fontFamily}; font-size: ${styling.fontSize}; color: ${styling.labelColor}; line-height: 1.5; }
    .bf-preview-wrap { max-width: ${styling.maxWidth}; margin: 0 auto; background: ${styling.backgroundColor}; padding: 16px; border-radius: ${styling.borderRadius}; }
    .bf-preview-field { margin-bottom: ${styling.fieldSpacing}; }
    .bf-preview-field label { display: block; font-size: ${styling.labelSize}; font-weight: ${styling.labelWeight}; margin-bottom: 6px; color: ${styling.labelColor}; }
    .bf-preview-field input, .bf-preview-field select, .bf-preview-field textarea {
      width: 100%; padding: ${styling.fieldPadding}; border: 1px solid ${styling.fieldBorderColor};
      border-radius: ${styling.borderRadius}; font-size: ${styling.fieldFontSize}; font-family: inherit;
      color: ${styling.fieldTextColor}; background: ${styling.fieldBgColor};
      transition: border-color .2s, box-shadow .2s; outline: none;
    }
    .bf-preview-field input::placeholder, .bf-preview-field textarea::placeholder { color: ${styling.fieldPlaceholderColor}; }
    .bf-preview-field input:focus, .bf-preview-field select:focus, .bf-preview-field textarea:focus {
      border-color: ${styling.primaryColor}; box-shadow: 0 0 0 3px ${focusRing};
    }
    .bf-preview-field textarea { min-height: 80px; resize: vertical; }
    .bf-preview-btn {
      display: block; width: 100%; padding: ${styling.buttonPadding}; background: ${styling.primaryColor};
      color: ${styling.buttonTextColor}; border: none; border-radius: ${styling.buttonRadius};
      font-size: ${styling.buttonFontSize}; font-weight: ${styling.buttonFontWeight}; cursor: pointer;
      font-family: inherit; transition: background .15s;
    }
    .bf-preview-btn:hover { background: ${styling.primaryHoverColor}; }
  `

  return (
    <div>
      <style>{css}</style>
      <div class="bf-preview-root">
        <div class="bf-preview-wrap">
          {renderFields.map((f) => {
            const id = `prev-${f.key}`
            if (f.type === 'select') {
              return (
                <div key={f.id} class="bf-preview-field">
                  <label for={id}>{f.label}{f.required ? ' *' : ''}</label>
                  <select id={id}>
                    <option>{f.placeholder ?? 'Selecione...'}</option>
                    {(f.options ?? []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
              )
            }
            if (f.type === 'textarea') {
              return (
                <div key={f.id} class="bf-preview-field">
                  <label for={id}>{f.label}{f.required ? ' *' : ''}</label>
                  <textarea id={id} placeholder={f.placeholder ?? ''} />
                </div>
              )
            }
            const inputType = f.type === 'phone' ? 'tel' : f.type === 'email' ? 'email' : f.type === 'number' ? 'number' : f.type === 'url' ? 'url' : 'text'
            return (
              <div key={f.id} class="bf-preview-field">
                <label for={id}>{f.label}{f.required ? ' *' : ''}</label>
                <input id={id} type={inputType} placeholder={f.placeholder ?? ''} />
              </div>
            )
          })}
          <button type="button" class="bf-preview-btn" onClick={(e) => e.preventDefault()}>{submitText}</button>
        </div>
      </div>
    </div>
  )
}
