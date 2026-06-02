import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import {
  Palette, Type, Square, Settings as SettingsIcon, ImageIcon, Code,
  Eye, RotateCcw, Save, Smartphone, Monitor, Tablet,
} from 'lucide-preact'
import { ColorPicker } from '@/components/ui/ColorPicker'
import { Input, Textarea, Select } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { Skeleton } from '@/components/ui/Skeleton'
import { PageImageUploader } from '@/components/PageImageUploader'
import {
  DEFAULT_LANDING_STYLES,
  resolveLandingStyles,
  useLandingPagePreview,
  useUpdatePage,
  type LandingPageDetail,
  type LandingPageStyles,
} from '@/hooks/usePages'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/cn'

/**
 * Painel de aparência da Landing Page com controle TOTAL:
 *   • esquerda: 6 tabs (Marca · Cores · Tipografia · Botão · Espaçamento · CSS)
 *   • direita:  iframe srcdoc com preview ao vivo (debounce 600ms)
 *
 * Os tokens espelham `getDefaultStyles()` do backend e `generateCSS()` do
 * `pageRenderer.ts`. O preview chama `/api/pages/:id/preview-html` que
 * renderiza com os overrides em memória — ou seja, **o que se vê é
 * exatamente o que será publicado**.
 */

const FONT_OPTIONS: { value: string; label: string }[] = [
  { value: "'Inter', 'Segoe UI', system-ui, sans-serif",                  label: 'Inter (padrão)' },
  { value: "'Roboto', 'Segoe UI', system-ui, sans-serif",                 label: 'Roboto' },
  { value: "'Open Sans', system-ui, sans-serif",                          label: 'Open Sans' },
  { value: "'Lato', system-ui, sans-serif",                               label: 'Lato' },
  { value: "'Montserrat', system-ui, sans-serif",                         label: 'Montserrat' },
  { value: "'Poppins', system-ui, sans-serif",                            label: 'Poppins' },
  { value: "'Nunito', system-ui, sans-serif",                             label: 'Nunito' },
  { value: "'Raleway', system-ui, sans-serif",                            label: 'Raleway' },
  { value: "'Playfair Display', Georgia, serif",                          label: 'Playfair Display (serif)' },
  { value: "'Merriweather', Georgia, serif",                              label: 'Merriweather (serif)' },
  { value: "'Manrope', system-ui, sans-serif",                            label: 'Manrope' },
  { value: "'DM Sans', system-ui, sans-serif",                            label: 'DM Sans' },
  { value: "system-ui, -apple-system, BlinkMacSystemFont, sans-serif",    label: 'Sistema (nativa)' },
]

const PRESETS: { id: string; label: string; styles: LandingPageStyles }[] = [
  {
    id: 'default', label: 'Padrão azul',
    styles: { ...DEFAULT_LANDING_STYLES },
  },
  {
    id: 'corporate', label: 'Corporativo',
    styles: {
      ...DEFAULT_LANDING_STYLES,
      primaryColor: '#0d47a1', secondaryColor: '#1a237e', accentColor: '#1976d2',
      fontFamily: "'Manrope', system-ui, sans-serif",
      headingFontFamily: "'Manrope', system-ui, sans-serif",
      borderRadius: '6px', buttonRadius: '6px',
    },
  },
  {
    id: 'startup', label: 'Startup vibrante',
    styles: {
      ...DEFAULT_LANDING_STYLES,
      primaryColor: '#7c3aed', secondaryColor: '#0f172a', accentColor: '#22d3ee',
      fontFamily: "'Poppins', system-ui, sans-serif",
      headingFontFamily: "'Poppins', system-ui, sans-serif",
      fontWeightHeading: '800',
      borderRadius: '14px', buttonRadius: '14px',
    },
  },
  {
    id: 'editorial', label: 'Editorial / serif',
    styles: {
      ...DEFAULT_LANDING_STYLES,
      primaryColor: '#0b1220', secondaryColor: '#374151', accentColor: '#dc2626',
      headingFontFamily: "'Playfair Display', Georgia, serif",
      fontFamily: "'Inter', system-ui, sans-serif",
      fontWeightHeading: '700',
      backgroundColor: '#fafaf9',
    },
  },
  {
    id: 'dark', label: 'Dark elegante',
    styles: {
      ...DEFAULT_LANDING_STYLES,
      primaryColor: '#22d3ee', secondaryColor: '#0f172a', accentColor: '#f472b6',
      backgroundColor: '#0f172a',
      textColor: '#e2e8f0', textMuted: '#94a3b8',
      headingColor: '#f8fafc',
      borderColor: '#334155', cardBgColor: '#1e293b', cardBorderColor: '#334155',
      buttonTextColor: '#0f172a',
      linkColor: '#22d3ee', linkHoverColor: '#06b6d4',
    },
  },
  {
    id: 'sunset', label: 'Sunset',
    styles: {
      ...DEFAULT_LANDING_STYLES,
      primaryColor: '#ea580c', secondaryColor: '#7c2d12', accentColor: '#facc15',
      fontFamily: "'Nunito', system-ui, sans-serif",
      headingFontFamily: "'Nunito', system-ui, sans-serif",
      backgroundColor: '#fff7ed',
      borderRadius: '999px', buttonRadius: '999px', buttonPadding: '14px 36px',
    },
  },
  {
    id: 'minimal', label: 'Minimalista',
    styles: {
      ...DEFAULT_LANDING_STYLES,
      primaryColor: '#000000', secondaryColor: '#374151', accentColor: '#000000',
      backgroundColor: '#ffffff',
      borderRadius: '0px', buttonRadius: '0px',
      fontWeightHeading: '500', buttonFontWeight: '500',
      buttonTextColor: '#ffffff',
    },
  },
]

type Tab = 'brand' | 'colors' | 'typography' | 'button' | 'spacing' | 'code'
type Device = 'desktop' | 'tablet' | 'mobile'

const TABS: { id: Tab; label: string; icon: typeof Palette }[] = [
  { id: 'brand',      label: 'Marca',       icon: ImageIcon },
  { id: 'colors',     label: 'Cores',       icon: Palette },
  { id: 'typography', label: 'Tipografia',  icon: Type },
  { id: 'button',     label: 'Botão',       icon: SettingsIcon },
  { id: 'spacing',    label: 'Espaçamento', icon: Square },
  { id: 'code',       label: 'CSS / HEAD',  icon: Code },
]

interface Props {
  page: LandingPageDetail
  onClose: () => void
}

export function LandingAppearancePanel({ page, onClose }: Props) {
  const [tab, setTab] = useState<Tab>('brand')
  const [device, setDevice] = useState<Device>('desktop')
  const [styles, setStyles] = useState<Required<LandingPageStyles>>(() => resolveLandingStyles(page.globalStyles))
  const [customCss, setCustomCss] = useState(page.customCss ?? '')
  const [customHead, setCustomHead] = useState(page.customHead ?? '')
  const [previewHtml, setPreviewHtml] = useState<string>('')
  const [previewError, setPreviewError] = useState<string | null>(null)
  const initialSerialized = useRef<string>(JSON.stringify({ s: page.globalStyles, css: page.customCss, head: page.customHead }))

  const preview = useLandingPagePreview()
  const update = useUpdatePage()

  // Debounce 600ms — evita disparar uma chamada de preview a cada keystroke.
  // O endpoint é leve (renderização em memória + 1 SELECT), mas vale o cuidado.
  const debouncedKey = useDebounce(JSON.stringify({ styles, customCss, customHead }), 600)
  useEffect(() => {
    setPreviewError(null)
    preview.mutate(
      { id: page.id, globalStyles: styles, customCss, customHead },
      {
        onSuccess: (html) => setPreviewHtml(html),
        onError: (e: unknown) => setPreviewError((e as Error).message),
      },
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedKey, page.id])

  const isDirty = useMemo(() => {
    return JSON.stringify({ s: styles, css: customCss || null, head: customHead || null })
        !== JSON.stringify({ s: page.globalStyles ?? null, css: page.customCss, head: page.customHead })
  }, [styles, customCss, customHead, page])

  function set<K extends keyof LandingPageStyles>(key: K, v: LandingPageStyles[K]) {
    setStyles((prev) => ({ ...prev, [key]: v as Required<LandingPageStyles>[K] }))
  }
  function applyPreset(p: LandingPageStyles) {
    setStyles({ ...DEFAULT_LANDING_STYLES, ...p })
  }
  function resetAll() {
    setStyles({ ...DEFAULT_LANDING_STYLES })
  }
  function discardChanges() {
    setStyles(resolveLandingStyles(page.globalStyles))
    setCustomCss(page.customCss ?? '')
    setCustomHead(page.customHead ?? '')
  }
  function save() {
    update.mutate(
      { id: page.id, globalStyles: styles, customCss: customCss || null, customHead: customHead || null },
      {
        onSuccess: () => {
          initialSerialized.current = JSON.stringify({ s: styles, css: customCss, head: customHead })
          toast('Aparência salva e publicada', 'success')
          onClose()
        },
        onError: (e: unknown) => toast((e as Error).message, 'danger'),
      },
    )
  }

  const previewWidth = device === 'desktop' ? '100%' : device === 'tablet' ? '768px' : '375px'

  return (
    <div class="flex flex-col gap-3 h-full min-h-0">
      {/* Toolbar topo */}
      <div class="flex items-center gap-2 flex-wrap pb-2 border-b border-border">
        <span class="text-sm font-semibold text-fg">Aparência</span>
        <span class="text-xs text-fg-subtle">·</span>
        <span class="text-xs text-fg-muted truncate">{page.title}</span>
        <span class="flex-1" />

        {/* Device toggle */}
        <div class="inline-flex items-center rounded-md border border-border overflow-hidden text-xs">
          {([
            { id: 'desktop' as const, icon: Monitor, label: 'Desktop' },
            { id: 'tablet'  as const, icon: Tablet,  label: 'Tablet' },
            { id: 'mobile'  as const, icon: Smartphone, label: 'Mobile' },
          ]).map((d) => {
            const Icon = d.icon
            const active = device === d.id
            return (
              <button
                key={d.id}
                type="button"
                onClick={() => setDevice(d.id)}
                class={cn(
                  'inline-flex items-center gap-1 h-7 px-2 transition-colors',
                  active ? 'bg-accent text-fg-on-brand' : 'bg-surface text-fg-muted hover:text-fg',
                )}
                aria-pressed={active}
                title={d.label}
              >
                <Icon size={12} /> <span class="hidden sm:inline">{d.label}</span>
              </button>
            )
          })}
        </div>

        <Button variant="ghost" size="sm" onClick={resetAll} title="Voltar pro padrão da plataforma">
          <RotateCcw size={12} /> Resetar
        </Button>
        {isDirty && (
          <Button variant="ghost" size="sm" onClick={discardChanges}>Descartar mudanças</Button>
        )}
        <Button variant="primary" size="sm" onClick={save} disabled={update.isPending || !isDirty}>
          <Save size={12} /> {update.isPending ? 'Salvando…' : 'Salvar'}
        </Button>
      </div>

      <div class="grid gap-4 grid-cols-1 lg:grid-cols-[420px_minmax(0,1fr)] flex-1 min-h-0">
        {/* ────── coluna esquerda: controles ────── */}
        <div class="flex flex-col gap-3 min-w-0 overflow-y-auto pr-1">
          {/* Presets */}
          <div>
            <div class="text-[0.6875rem] uppercase tracking-wider text-fg-subtle font-medium mb-1.5">Presets prontos</div>
            <div class="flex flex-wrap gap-1.5">
              {PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => applyPreset(p.styles)}
                  class="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full border border-border bg-surface text-xs text-fg-muted hover:text-fg hover:bg-surface-3 transition-colors"
                >
                  <span class="size-3 rounded-full border border-border/60 shrink-0" style={{ background: p.styles.primaryColor }} />
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {/* Tabs */}
          <div class="flex items-center gap-0.5 border-b border-border overflow-x-auto">
            {TABS.map((t) => {
              const Icon = t.icon
              const active = tab === t.id
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTab(t.id)}
                  class={cn(
                    'inline-flex items-center gap-1.5 h-9 px-3 -mb-px text-xs font-medium border-b-2 whitespace-nowrap',
                    active ? 'border-accent text-fg' : 'border-transparent text-fg-muted hover:text-fg',
                  )}
                >
                  <Icon size={12} /> {t.label}
                </button>
              )
            })}
          </div>

          {tab === 'brand' && (
            <div class="space-y-3">
              <PageImageUploader
                pageId={page.id}
                slot="logo"
                label="Logotipo"
                value={styles.logoUrl}
                onChange={(url) => set('logoUrl', url)}
                hint="PNG, JPG, SVG, WebP, GIF ou AVIF até 10 MB. Pode também colar uma URL externa."
                previewHeight="md"
              />
              <Input
                label="Altura máxima do logo"
                value={styles.logoMaxHeight}
                onInput={(e) => set('logoMaxHeight', (e.target as HTMLInputElement).value)}
                placeholder="40px"
              />
              <Input
                label="Google Fonts (extras)"
                value={styles.googleFonts}
                onInput={(e) => set('googleFonts', (e.target as HTMLInputElement).value)}
                placeholder="Inter:400,600,800|Poppins:400,700"
                hint="Sintaxe: Família:pesos,separado,com,vírgula | outra-família:pesos. Ou cole a URL completa do Google Fonts."
              />
            </div>
          )}

          {tab === 'colors' && (
            <div class="space-y-3">
              <Section title="Cores principais">
                <div class="grid gap-3 grid-cols-2">
                  <ColorPicker label="Primária" value={styles.primaryColor}     onChange={(v) => set('primaryColor', v)} />
                  <ColorPicker label="Secundária" value={styles.secondaryColor} onChange={(v) => set('secondaryColor', v)} />
                  <ColorPicker label="Accent"    value={styles.accentColor}    onChange={(v) => set('accentColor', v)} />
                  <ColorPicker label="Fundo da página" value={styles.backgroundColor} onChange={(v) => set('backgroundColor', v)} />
                </div>
              </Section>
              <Section title="Texto e títulos">
                <div class="grid gap-3 grid-cols-2">
                  <ColorPicker label="Texto"           value={styles.textColor}     onChange={(v) => set('textColor', v)} />
                  <ColorPicker label="Texto suave"     value={styles.textMuted}     onChange={(v) => set('textMuted', v)} />
                  <ColorPicker label="Títulos (h1-h6)" value={styles.headingColor}  onChange={(v) => set('headingColor', v)} />
                  <ColorPicker label="Link"            value={styles.linkColor}     onChange={(v) => set('linkColor', v)} />
                  <ColorPicker label="Link hover"      value={styles.linkHoverColor} onChange={(v) => set('linkHoverColor', v)} />
                </div>
              </Section>
              <Section title="Bordas e cards">
                <div class="grid gap-3 grid-cols-2">
                  <ColorPicker label="Borda"        value={styles.borderColor}     onChange={(v) => set('borderColor', v)} />
                  <ColorPicker label="Fundo do card" value={styles.cardBgColor}    onChange={(v) => set('cardBgColor', v)} />
                  <ColorPicker label="Borda do card" value={styles.cardBorderColor} onChange={(v) => set('cardBorderColor', v)} />
                </div>
              </Section>
            </div>
          )}

          {tab === 'typography' && (
            <div class="space-y-3">
              <Section title="Família">
                <Select label="Fonte do corpo" value={styles.fontFamily} onChange={(e) => set('fontFamily', (e.target as HTMLSelectElement).value)}>
                  {FONT_OPTIONS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
                </Select>
                <Select label="Fonte dos títulos (vazio = mesma do corpo)" value={styles.headingFontFamily} onChange={(e) => set('headingFontFamily', (e.target as HTMLSelectElement).value)}>
                  <option value="">— Mesma do corpo —</option>
                  {FONT_OPTIONS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
                </Select>
                <p class="text-[0.6875rem] text-fg-subtle">
                  Para usar fontes diferentes das listadas, cadastre-as em Marca → Google Fonts e referencie pelo nome aqui.
                </p>
              </Section>
              <Section title="Tamanhos">
                <div class="grid gap-3 grid-cols-2">
                  <Input label="Tamanho base" value={styles.fontSizeBase} onInput={(e) => set('fontSizeBase', (e.target as HTMLInputElement).value)} hint="Ex.: 16px" />
                  <Input label="H1" value={styles.fontSizeH1} onInput={(e) => set('fontSizeH1', (e.target as HTMLInputElement).value)} hint="Aceita clamp()" />
                  <Input label="H2" value={styles.fontSizeH2} onInput={(e) => set('fontSizeH2', (e.target as HTMLInputElement).value)} />
                  <Input label="H3" value={styles.fontSizeH3} onInput={(e) => set('fontSizeH3', (e.target as HTMLInputElement).value)} />
                </div>
              </Section>
              <Section title="Pesos e altura de linha">
                <div class="grid gap-3 grid-cols-2">
                  <Select label="Peso dos títulos" value={styles.fontWeightHeading} onChange={(e) => set('fontWeightHeading', (e.target as HTMLSelectElement).value)}>
                    {['400', '500', '600', '700', '800', '900'].map((w) => <option key={w} value={w}>{w}</option>)}
                  </Select>
                  <Input label="Altura de linha (corpo)" value={styles.lineHeightBody} onInput={(e) => set('lineHeightBody', (e.target as HTMLInputElement).value)} hint="Ex.: 1.6" />
                  <Input label="Altura de linha (títulos)" value={styles.lineHeightHeading} onInput={(e) => set('lineHeightHeading', (e.target as HTMLInputElement).value)} hint="Ex.: 1.15" />
                </div>
              </Section>
            </div>
          )}

          {tab === 'button' && (
            <div class="space-y-3">
              <Section title="Cores">
                <div class="grid gap-3 grid-cols-2">
                  <ColorPicker label="Fundo"    value={styles.buttonBgColor || styles.primaryColor} onChange={(v) => set('buttonBgColor', v)} hint="Vazio = usa primária." />
                  <ColorPicker label="Texto"    value={styles.buttonTextColor}    onChange={(v) => set('buttonTextColor', v)} />
                  <ColorPicker label="Hover"    value={styles.buttonHoverBgColor || styles.buttonBgColor || styles.primaryColor} onChange={(v) => set('buttonHoverBgColor', v)} />
                </div>
              </Section>
              <Section title="Forma e tipografia">
                <div class="grid gap-3 grid-cols-2">
                  <Input label="Padding"  value={styles.buttonPadding} onInput={(e) => set('buttonPadding', (e.target as HTMLInputElement).value)} hint="14px 32px" />
                  <Input label="Cantos arredondados" value={styles.buttonRadius || styles.borderRadius} onInput={(e) => set('buttonRadius', (e.target as HTMLInputElement).value)} hint="Vazio = usa o radius geral." />
                  <Input label="Tamanho da fonte" value={styles.buttonFontSize}  onInput={(e) => set('buttonFontSize', (e.target as HTMLInputElement).value)} />
                  <Select label="Peso da fonte" value={styles.buttonFontWeight} onChange={(e) => set('buttonFontWeight', (e.target as HTMLSelectElement).value)}>
                    {['400', '500', '600', '700', '800'].map((w) => <option key={w} value={w}>{w}</option>)}
                  </Select>
                </div>
              </Section>
            </div>
          )}

          {tab === 'spacing' && (
            <div class="space-y-3">
              <Section title="Layout">
                <div class="grid gap-3 grid-cols-2">
                  <Input label="Largura máxima" value={styles.maxWidth}  onInput={(e) => set('maxWidth', (e.target as HTMLInputElement).value)} hint="Ex.: 1140px, 100%" />
                  <Input label="Padding lateral" value={styles.containerPaddingX} onInput={(e) => set('containerPaddingX', (e.target as HTMLInputElement).value)} hint="Ex.: 24px" />
                </div>
              </Section>
              <Section title="Seções">
                <div class="grid gap-3 grid-cols-2">
                  <Input label="Padding vertical" value={styles.sectionPaddingY} onInput={(e) => set('sectionPaddingY', (e.target as HTMLInputElement).value)} hint="Desktop. Ex.: 64px" />
                  <Input label="Padding mobile" value={styles.sectionPaddingMobile} onInput={(e) => set('sectionPaddingMobile', (e.target as HTMLInputElement).value)} hint="Ex.: 40px" />
                </div>
              </Section>
              <Section title="Cantos arredondados (geral)">
                <Input label="Border radius" value={styles.borderRadius} onInput={(e) => set('borderRadius', (e.target as HTMLInputElement).value)} hint="Ex.: 8px, 0px (quadrado), 999px (pílula)" />
              </Section>
              <Section title="Movimento">
                <label class="flex items-center gap-2 text-sm text-fg-muted">
                  <input
                    type="checkbox"
                    checked={styles.smoothScroll}
                    onChange={(e) => set('smoothScroll', (e.target as HTMLInputElement).checked)}
                  />
                  Rolagem suave (smooth scroll)
                </label>
                <p class="text-[0.625rem] text-fg-muted">Dá o "deslizar" premium dos sites de ponta (Lenis). Desativado automaticamente para quem prefere reduzir movimento.</p>
              </Section>
            </div>
          )}

          {tab === 'code' && (
            <div class="space-y-3">
              <Section title="CSS livre" hint="Aplicado depois das regras do tema. Útil pra ajustes finos.">
                <Textarea
                  label=""
                  value={customCss}
                  onInput={(e) => setCustomCss((e.target as HTMLTextAreaElement).value)}
                  rows={8}
                  placeholder=".lp-section { padding: 80px 0; } .btn--primary:hover { transform: scale(1.05); }"
                />
              </Section>
              <Section title="HTML extra no <head>" hint="Inserido dentro do <head> da página. Útil pra pixels, scripts de tracking ou meta tags adicionais. Sem cuidado pode quebrar a página.">
                <Textarea
                  label=""
                  value={customHead}
                  onInput={(e) => setCustomHead((e.target as HTMLTextAreaElement).value)}
                  rows={6}
                  placeholder="<!-- Meta Pixel --><script>...</script>"
                />
              </Section>
            </div>
          )}
        </div>

        {/* ────── coluna direita: preview iframe ────── */}
        <div class="min-w-0 flex flex-col">
          <div class="flex items-center justify-between mb-2">
            <span class="text-[0.6875rem] uppercase tracking-wider text-fg-subtle font-medium inline-flex items-center gap-1">
              <Eye size={12} /> Preview ao vivo
            </span>
            {preview.isPending && <span class="text-[0.6875rem] text-fg-subtle">atualizando…</span>}
          </div>

          <div class="rounded-md border border-border bg-[repeating-linear-gradient(45deg,_var(--color-surface-3)_0_8px,_transparent_8px_16px)] p-2 flex-1 min-h-[400px] overflow-auto">
            <div class="mx-auto h-full" style={{ width: previewWidth, transition: 'width 0.2s' }}>
              {previewError ? (
                <div class="rounded-md border border-danger/40 bg-danger/10 p-3 text-xs text-danger">
                  Erro no preview: {previewError}
                </div>
              ) : !previewHtml ? (
                <Skeleton class="h-full w-full" />
              ) : (
                <iframe
                  title="Pré-visualização da página"
                  srcDoc={previewHtml}
                  class="w-full h-full bg-white border border-border rounded-md"
                  style={{ minHeight: '600px' }}
                  // sandbox sem allow-same-origin pra evitar que scripts da LP
                  // (tracking, etc.) acessem nosso storage. allow-scripts pra
                  // que o JS dela funcione (form submit usa fetch).
                  sandbox="allow-scripts allow-forms"
                />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Helpers ─────────────────────────────────────────────────────

function Section({ title, hint, children }: { title: string; hint?: string; children: preact.ComponentChildren }) {
  return (
    <div>
      <div class="text-[0.6875rem] uppercase tracking-wider text-fg-subtle font-medium mb-1.5">{title}</div>
      {hint && <p class="text-[0.6875rem] text-fg-subtle mb-2">{hint}</p>}
      <div class="space-y-2">{children}</div>
    </div>
  )
}

function useDebounce<T>(value: T, delayMs: number): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), delayMs)
    return () => window.clearTimeout(t)
  }, [value, delayMs])
  return v
}
