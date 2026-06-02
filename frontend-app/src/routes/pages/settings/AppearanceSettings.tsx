import { useState, useEffect, useMemo } from 'preact/hooks'
import {
  Save,
  AlertTriangle,
  Code,
  Palette,
  Globe,
  Sun,
  Moon,
  Monitor,
  Accessibility,
  Search,
  LayoutDashboard,
  Layers,
  Image as ImageIcon,
  Type,
  PanelLeft,
  Eye,
  LogIn,
} from 'lucide-preact'
import {
  useAppearance,
  useUpdateAppearance,
} from '@/hooks/useSettings'
import { useThemeStore, type Theme } from '@/stores/theme'
import { useFontSizeStore, FONT_SIZE_LABELS, type FontSize } from '@/stores/fontSize'
import { Card, CardHeader, CardTitle } from '@/components/ui/Card'
import { Skeleton } from '@/components/ui/Skeleton'
import { Button } from '@/components/ui/Button'
import { Input, Textarea, Select } from '@/components/ui/Input'
import { ColorPicker } from '@/components/ui/ColorPicker'
import { LogoUploader } from '@/components/LogoUploader'
import { LandingInstitucionalSettings } from './LandingInstitucionalSettings'
import { cn } from '@/lib/cn'
import { toast } from '@/lib/toast'

type Draft = Record<string, string>

interface OptionalColorPickerProps {
  label: string
  hint?: string
  value: string
  onChange: (v: string) => void
  fallbackHex: string
}

function OptionalColorPicker({ label, hint, value, onChange, fallbackHex }: OptionalColorPickerProps) {
  const enabled = !!value
  return (
    <div class="space-y-2 rounded-md border border-border bg-surface-2 p-3">
      <label class="flex items-center gap-2 text-xs font-medium text-fg">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) =>
            onChange((e.target as HTMLInputElement).checked ? fallbackHex : '')
          }
        />
        <span>{label}</span>
        {!enabled && <span class="text-fg-subtle">(usando cor do tema)</span>}
      </label>
      {enabled && <ColorPicker value={value} onChange={onChange} label="" {...(hint ? { hint } : {})} />}
    </div>
  )
}

const FONT_OPTIONS_ADMIN: { value: string; label: string }[] = [
  { value: 'Inter, sans-serif', label: 'Inter (padrão)' },
  { value: 'Google Sans, Poppins, sans-serif', label: 'Google Sans / Poppins' },
  { value: 'Roboto, sans-serif', label: 'Roboto' },
  { value: 'Open Sans, sans-serif', label: 'Open Sans' },
  { value: 'Nunito, sans-serif', label: 'Nunito' },
  { value: 'Lato, sans-serif', label: 'Lato' },
  { value: 'Montserrat, sans-serif', label: 'Montserrat' },
  { value: 'Poppins, sans-serif', label: 'Poppins' },
  { value: 'Source Sans Pro, sans-serif', label: 'Source Sans Pro' },
  { value: 'Raleway, sans-serif', label: 'Raleway' },
  { value: 'Work Sans, sans-serif', label: 'Work Sans' },
  { value: 'IBM Plex Sans, sans-serif', label: 'IBM Plex Sans' },
  { value: 'DM Sans, sans-serif', label: 'DM Sans' },
  { value: 'Manrope, sans-serif', label: 'Manrope' },
  { value: 'system-ui, -apple-system, sans-serif', label: 'Sistema (nativa)' },
]

type AppearanceTab = 'admin' | 'lp'

export function AppearanceSettings() {
  const { data, isLoading } = useAppearance()
  const update = useUpdateAppearance()
  const [draft, setDraft] = useState<Draft>({})
  const [dirty, setDirty] = useState(false)
  const [tab, setTab] = useState<AppearanceTab>('admin')
  // Controles da landing/home só existem na instalação principal (domínio
  // principal). Instalações filhas (subdomínio) só veem "Sistema Admin".
  const isLandingAdmin = data?.landingAdmin === true

  useEffect(() => {
    if (data) {
      setDraft(data.appearance)
      setDirty(false)
    }
  }, [data])

  const isEqualToServer = useMemo(() => {
    if (!data) return true
    const keys = new Set([...Object.keys(draft), ...Object.keys(data.appearance)])
    for (const k of keys) {
      if ((draft[k] ?? '') !== (data.appearance[k] ?? '')) return false
    }
    return true
  }, [draft, data])

  function patch(key: string, value: string) {
    setDraft((d) => ({ ...d, [key]: value }))
    setDirty(true)
  }

  function handleSave() {
    update.mutate(draft, {
      onSuccess: () => {
        toast('Aparência atualizada', 'success')
        setDirty(false)
      },
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  function handleDiscard() {
    if (!data) return
    setDraft(data.appearance)
    setDirty(false)
  }

  if (isLoading) return <Skeleton class="h-64 w-full" />

  const canSave = dirty && !isEqualToServer && !update.isPending

  return (
    <div class="space-y-4">
      {/* Barra de ação flutuante quando há alterações */}
      {dirty && (
        <div class="sticky top-2 z-20 flex items-center justify-between gap-3 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 backdrop-blur">
          <span class="flex items-center gap-2 text-xs text-fg">
            <AlertTriangle size={14} class="text-warning" />
            Alterações não salvas
          </span>
          <div class="flex gap-2">
            <Button variant="ghost" size="sm" onClick={handleDiscard} disabled={update.isPending}>
              Descartar
            </Button>
            <Button variant="primary" size="sm" onClick={handleSave} disabled={!canSave}>
              <Save size={14} /> {update.isPending ? 'Salvando…' : 'Salvar alterações'}
            </Button>
          </div>
        </div>
      )}

      {/* Tabs — só aparecem na instalação principal (tem landing/home).
          Filhas (subdomínio) só têm "Sistema Admin", sem troca de aba. */}
      {isLandingAdmin && (
        <div class="flex flex-wrap gap-1 rounded-md border border-border bg-surface p-1">
          <button
            type="button"
            onClick={() => setTab('admin')}
            class={cn(
              'flex flex-1 items-center justify-center gap-2 rounded px-3 py-1.5 text-sm transition-colors',
              tab === 'admin' ? 'bg-accent text-white' : 'text-fg-muted hover:bg-surface-3',
            )}
            aria-pressed={tab === 'admin'}
          >
            <LayoutDashboard size={14} /> Sistema Admin
          </button>
          <button
            type="button"
            onClick={() => setTab('lp')}
            class={cn(
              'flex flex-1 items-center justify-center gap-2 rounded px-3 py-1.5 text-sm transition-colors',
              tab === 'lp' ? 'bg-accent text-white' : 'text-fg-muted hover:bg-surface-3',
            )}
            aria-pressed={tab === 'lp'}
          >
            <Globe size={14} /> Landing Institucional
          </button>
        </div>
      )}

      <div class="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div class="space-y-4 min-w-0">
          {(!isLandingAdmin || tab === 'admin') ? (
            <>
              <AdminTab draft={draft} patch={patch} />

              <div class="flex flex-wrap items-center justify-end gap-2 pt-2">
                <Button variant="ghost" size="sm" onClick={handleDiscard} disabled={!dirty || update.isPending}>
                  Descartar
                </Button>
                <Button variant="primary" size="sm" onClick={handleSave} disabled={!canSave}>
                  <Save size={14} /> {update.isPending ? 'Salvando…' : 'Salvar alterações'}
                </Button>
              </div>
            </>
          ) : (
            /* Landing institucional (bychat.ia.br): contatos editáveis sem
               rebuild. Tem load/save próprios (endpoint à parte). */
            <LandingInstitucionalSettings />
          )}
        </div>

        {(!isLandingAdmin || tab === 'admin') && (
          <aside class="lg:sticky lg:top-2 lg:self-start">
            <Card>
              <CardHeader>
                <CardTitle>
                  <span class="flex items-center gap-2">
                    <Eye size={14} /> Preview ao vivo
                  </span>
                </CardTitle>
              </CardHeader>
              <AdminPreview draft={draft} />
            </Card>
          </aside>
        )}
      </div>
    </div>
  )
}

// ───────────────────── ABA ADMIN ─────────────────────

interface TabProps {
  draft: Draft
  patch: (key: string, value: string) => void
}

function AdminTab({ draft, patch }: TabProps) {
  const adminLogoMode = draft['appearance.admin_logo_mode'] ?? 'text'
  const adminLogoUrl = draft['appearance.admin_logo_url'] ?? ''
  const faviconUrl = draft['appearance.favicon_url'] ?? ''

  return (
    <>
      <ThemeCard />
      <AccessibilityCard />

      {/* Logotipo Admin */}
      <Card>
        <CardHeader>
          <CardTitle>
            <span class="flex items-center gap-2">
              <ImageIcon size={14} /> Logotipo do Admin
            </span>
          </CardTitle>
        </CardHeader>
        <div class="grid gap-4 grid-cols-1 md:grid-cols-2">
          <div class="space-y-3">
            <ModeToggle
              value={adminLogoMode}
              onChange={(v) => patch('appearance.admin_logo_mode', v)}
            />
            {adminLogoMode === 'text' ? (
              <div class="grid gap-3 grid-cols-1 sm:grid-cols-2">
                <Input
                  label="Nome da marca"
                  placeholder="Ex: BeyondHub"
                  hint="Nome completo exibido no logotipo"
                  value={draft['appearance.admin_brand_name'] ?? ''}
                  onInput={(e) => patch('appearance.admin_brand_name', (e.target as HTMLInputElement).value)}
                />
                <Input
                  label="Parte em destaque"
                  placeholder="Ex: Hub"
                  hint='Em "Beyond<b>Hub</b>", o destaque é "Hub"'
                  value={draft['appearance.admin_brand_accent'] ?? ''}
                  onInput={(e) => patch('appearance.admin_brand_accent', (e.target as HTMLInputElement).value)}
                />
              </div>
            ) : null}
            <RangeField
              label="Tamanho do logotipo"
              min={12}
              max={32}
              unit="px"
              value={draft['appearance.admin_logo_size'] ?? '16'}
              onChange={(v) => patch('appearance.admin_logo_size', v)}
              hint="Tamanho do logotipo no painel admin (texto e imagem)"
            />
          </div>
          <div class="space-y-3">
            <LogoUploader
              slot="admin_logo"
              label="Imagem do logotipo (admin)"
              hint="PNG, JPG, SVG, WebP, GIF. Máx 2 MB."
              currentUrl={adminLogoUrl}
              allowVector
            />
          </div>
        </div>
      </Card>

      {/* Favicon */}
      <Card>
        <CardHeader>
          <CardTitle>
            <span class="flex items-center gap-2">
              <ImageIcon size={14} /> Favicon
            </span>
          </CardTitle>
        </CardHeader>
        <p class="mb-3 text-xs text-fg-muted">Ícone de 32×32 que aparece na aba do navegador.</p>
        <LogoUploader
          slot="favicon"
          label="Favicon"
          hint="ICO, PNG, SVG (32×32 recomendado). Máx 2 MB."
          currentUrl={faviconUrl}
          allowVector
        />
      </Card>

      {/* Tela de login */}
      <Card>
        <CardHeader>
          <CardTitle>
            <span class="flex items-center gap-2">
              <LogIn size={14} /> Tela de login
            </span>
          </CardTitle>
        </CardHeader>
        <p class="mb-3 text-xs text-fg-muted">
          Personalize a imagem, textos e posição do painel ilustrado da tela <code>/login</code>.
        </p>
        <div class="mb-4 rounded-md border border-border bg-surface-2 p-3 text-xs text-fg-muted">
          <p class="mb-1 font-semibold text-fg">Recomendações para a imagem</p>
          <ul class="list-disc space-y-0.5 pl-4">
            <li>Tamanho ideal: <strong>1600×2000 px</strong> (proporção 4:5, vertical) ou maior.</li>
            <li>Mínimo: <strong>1200×1500 px</strong>. Abaixo disso pode haver perda de nitidez em telas grandes.</li>
            <li>Formato: <strong>JPG</strong> (preferido para fotos), <strong>WebP</strong> ou <strong>PNG</strong>. Máximo 2 MB.</li>
            <li>A imagem é responsiva e cobre todo o painel; em telas menores aparece no <strong>topo</strong> com altura reduzida (~30% da viewport). Use o foco para escolher qual parte da imagem é mantida nesses crops.</li>
          </ul>
        </div>
        <div class="grid gap-4 grid-cols-1 md:grid-cols-2">
          <div class="space-y-3">
            <LogoUploader
              slot="login_image"
              label="Imagem da tela de login"
              hint="Recomendado 1600×2000 (vertical, 4:5). PNG, JPG, WebP. Máx 2 MB."
              currentUrl={draft['appearance.login_image_url'] ?? ''}
            />
            <Select
              label="Posição da imagem"
              hint="Lado em que a imagem aparece em telas grandes"
              value={draft['appearance.login_image_position'] ?? 'left'}
              onChange={(e) => patch('appearance.login_image_position', (e.target as HTMLSelectElement).value)}
            >
              <option value="left">Esquerda</option>
              <option value="right">Direita</option>
            </Select>
            <Select
              label="Foco da imagem"
              hint="Parte da imagem que permanece visível quando há corte (ex.: mobile)"
              value={draft['appearance.login_image_focus'] ?? 'center'}
              onChange={(e) => patch('appearance.login_image_focus', (e.target as HTMLSelectElement).value)}
            >
              <option value="center">Centro</option>
              <option value="top">Topo</option>
              <option value="bottom">Base</option>
              <option value="left">Esquerda</option>
              <option value="right">Direita</option>
              <option value="top left">Topo esquerda</option>
              <option value="top right">Topo direita</option>
              <option value="bottom left">Base esquerda</option>
              <option value="bottom right">Base direita</option>
            </Select>
            <Input
              type="number"
              min={0}
              max={80}
              step={5}
              label="Escurecimento sobre a imagem (%)"
              hint="Aplicado atrás dos textos para manter contraste. Padrão: 40."
              value={draft['appearance.login_overlay_dim'] ?? '40'}
              onInput={(e) => patch('appearance.login_overlay_dim', (e.target as HTMLInputElement).value)}
            />
          </div>
          <div class="space-y-3">
            <Input
              label="Título"
              placeholder="Ex: Bem-vindo de volta"
              hint="Texto principal exibido acima do formulário"
              value={draft['appearance.login_title'] ?? ''}
              onInput={(e) => patch('appearance.login_title', (e.target as HTMLInputElement).value)}
            />
            <Input
              label="Subtítulo"
              placeholder="Ex: Acesse sua conta para continuar"
              value={draft['appearance.login_subtitle'] ?? ''}
              onInput={(e) => patch('appearance.login_subtitle', (e.target as HTMLInputElement).value)}
            />
            <Input
              label="Slogan sobre a imagem"
              placeholder="Ex: Gestão completa do seu negócio"
              hint="Aparece sobre a imagem em telas grandes"
              value={draft['appearance.login_overlay_title'] ?? ''}
              onInput={(e) => patch('appearance.login_overlay_title', (e.target as HTMLInputElement).value)}
            />
            <Textarea
              label="Subtexto sobre a imagem"
              rows={2}
              placeholder="Ex: Atendimento, CRM e automações em uma única plataforma."
              value={draft['appearance.login_overlay_subtitle'] ?? ''}
              onInput={(e) => patch('appearance.login_overlay_subtitle', (e.target as HTMLTextAreaElement).value)}
            />
            <Input
              label="Rodapé do formulário (opcional)"
              placeholder="Ex: © 2026 Sua Empresa — Todos os direitos reservados"
              hint="Deixe vazio para ocultar"
              value={draft['appearance.login_footer_text'] ?? ''}
              onInput={(e) => patch('appearance.login_footer_text', (e.target as HTMLInputElement).value)}
            />
          </div>
        </div>

        <div class="mt-4 border-t border-border pt-4">
          <h4 class="mb-1 flex items-center gap-2 text-sm font-semibold text-fg">
            <Palette size={14} /> Cores da tela de login
          </h4>
          <p class="mb-3 text-xs text-fg-muted">
            Cada cor é opcional — quando desativada, herda do tema global definido em &quot;Cores principais&quot;.
          </p>
          <div class="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
            <OptionalColorPicker
              label="Fundo do formulário"
              hint="Lado onde fica o formulário de login"
              value={draft['appearance.login_form_bg'] ?? ''}
              onChange={(v) => patch('appearance.login_form_bg', v)}
              fallbackHex="#ffffff"
            />
            <OptionalColorPicker
              label="Cor do botão Entrar"
              value={draft['appearance.login_button_bg'] ?? ''}
              onChange={(v) => patch('appearance.login_button_bg', v)}
              fallbackHex={draft['appearance.primary_color'] ?? '#1a73e8'}
            />
            <OptionalColorPicker
              label="Texto do botão"
              value={draft['appearance.login_button_text'] ?? ''}
              onChange={(v) => patch('appearance.login_button_text', v)}
              fallbackHex="#ffffff"
            />
            <OptionalColorPicker
              label="Cor do título"
              hint="&quot;Bem-vindo de volta&quot; e similares"
              value={draft['appearance.login_title_color'] ?? ''}
              onChange={(v) => patch('appearance.login_title_color', v)}
              fallbackHex="#202124"
            />
            <OptionalColorPicker
              label="Cor do subtítulo"
              value={draft['appearance.login_subtitle_color'] ?? ''}
              onChange={(v) => patch('appearance.login_subtitle_color', v)}
              fallbackHex="#5f6368"
            />
            <OptionalColorPicker
              label="Texto sobre a imagem"
              hint="Slogan e subtexto exibidos sobre a imagem"
              value={draft['appearance.login_overlay_text_color'] ?? ''}
              onChange={(v) => patch('appearance.login_overlay_text_color', v)}
              fallbackHex="#ffffff"
            />
            <OptionalColorPicker
              label="Gradiente do hero — início"
              hint="Usado quando não há imagem"
              value={draft['appearance.login_hero_from'] ?? ''}
              onChange={(v) => patch('appearance.login_hero_from', v)}
              fallbackHex={draft['appearance.primary_color'] ?? '#1a73e8'}
            />
            <OptionalColorPicker
              label="Gradiente do hero — fim"
              hint="Usado quando não há imagem"
              value={draft['appearance.login_hero_to'] ?? ''}
              onChange={(v) => patch('appearance.login_hero_to', v)}
              fallbackHex="#1557b0"
            />
          </div>
        </div>
      </Card>

      {/* Cores principais */}
      <Card>
        <CardHeader>
          <CardTitle>
            <span class="flex items-center gap-2">
              <Palette size={14} /> Cores principais
            </span>
          </CardTitle>
        </CardHeader>
        <div class="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          <ColorPicker
            label="Cor primária"
            hint="Botões, links e destaques"
            value={draft['appearance.primary_color'] ?? '#1a73e8'}
            onChange={(v) => patch('appearance.primary_color', v)}
          />
          <ColorPicker
            label="Primária (hover)"
            hint="Hover dos botões"
            value={draft['appearance.primary_hover'] ?? '#1557b0'}
            onChange={(v) => patch('appearance.primary_hover', v)}
          />
          <ColorPicker
            label="Sucesso"
            hint="Indicadores positivos"
            value={draft['appearance.success_color'] ?? '#34a853'}
            onChange={(v) => patch('appearance.success_color', v)}
          />
          <ColorPicker
            label="Erro"
            hint="Mensagens de erro"
            value={draft['appearance.error_color'] ?? '#ea4335'}
            onChange={(v) => patch('appearance.error_color', v)}
          />
          <ColorPicker
            label="Aviso"
            hint="Alertas"
            value={draft['appearance.warning_color'] ?? '#fbbc04'}
            onChange={(v) => patch('appearance.warning_color', v)}
          />
          <ColorPicker
            label="Secundária"
            hint="Textos menos importantes"
            value={draft['appearance.secondary_color'] ?? '#5f6368'}
            onChange={(v) => patch('appearance.secondary_color', v)}
          />
        </div>
      </Card>

      {/* Sidebar & Topbar */}
      <Card>
        <CardHeader>
          <CardTitle>
            <span class="flex items-center gap-2">
              <PanelLeft size={14} /> Sidebar &amp; Topbar
            </span>
          </CardTitle>
        </CardHeader>
        <div class="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          <ColorPicker
            label="Fundo da sidebar"
            value={draft['appearance.sidebar_bg'] ?? '#ffffff'}
            onChange={(v) => patch('appearance.sidebar_bg', v)}
          />
          <ColorPicker
            label="Texto da sidebar"
            value={draft['appearance.sidebar_text'] ?? '#5f6368'}
            onChange={(v) => patch('appearance.sidebar_text', v)}
          />
          <ColorPicker
            label="Item ativo (fundo)"
            value={draft['appearance.sidebar_active_bg'] ?? '#e8f0fe'}
            onChange={(v) => patch('appearance.sidebar_active_bg', v)}
          />
          <ColorPicker
            label="Item ativo (texto)"
            value={draft['appearance.sidebar_active_text'] ?? '#1a73e8'}
            onChange={(v) => patch('appearance.sidebar_active_text', v)}
          />
          <ColorPicker
            label="Fundo do topbar"
            value={draft['appearance.topbar_bg'] ?? '#ffffff'}
            onChange={(v) => patch('appearance.topbar_bg', v)}
          />
          <ColorPicker
            label="Texto do topbar"
            value={draft['appearance.topbar_text'] ?? '#202124'}
            onChange={(v) => patch('appearance.topbar_text', v)}
          />
        </div>
      </Card>

      {/* Corpo & Cards */}
      <Card>
        <CardHeader>
          <CardTitle>
            <span class="flex items-center gap-2">
              <Layers size={14} /> Corpo &amp; Cards
            </span>
          </CardTitle>
        </CardHeader>
        <div class="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          <ColorPicker
            label="Fundo geral"
            hint="Background do painel"
            value={draft['appearance.body_bg'] ?? '#f8f9fa'}
            onChange={(v) => patch('appearance.body_bg', v)}
          />
          <ColorPicker
            label="Fundo dos cards"
            value={draft['appearance.card_bg'] ?? '#ffffff'}
            onChange={(v) => patch('appearance.card_bg', v)}
          />
          <ColorPicker
            label="Borda dos cards"
            value={draft['appearance.card_border'] ?? '#e0e0e0'}
            onChange={(v) => patch('appearance.card_border', v)}
          />
          <ColorPicker
            label="Texto principal"
            value={draft['appearance.text_primary'] ?? '#202124'}
            onChange={(v) => patch('appearance.text_primary', v)}
          />
          <ColorPicker
            label="Texto secundário"
            value={draft['appearance.text_secondary'] ?? '#5f6368'}
            onChange={(v) => patch('appearance.text_secondary', v)}
          />
        </div>
      </Card>

      {/* Tipografia & Bordas */}
      <Card>
        <CardHeader>
          <CardTitle>
            <span class="flex items-center gap-2">
              <Type size={14} /> Tipografia &amp; Bordas
            </span>
          </CardTitle>
        </CardHeader>
        <div class="grid gap-4 grid-cols-1 sm:grid-cols-2">
          <Select
            label="Fonte do sistema"
            hint="Aplica em todo o painel admin e na tela de login"
            value={draft['appearance.font_family'] ?? 'Inter, sans-serif'}
            onChange={(e) => patch('appearance.font_family', (e.target as HTMLSelectElement).value)}
          >
            {FONT_OPTIONS_ADMIN.map((o) => (
              <option
                key={o.value}
                value={o.value}
                style={{ fontFamily: o.value }}
              >
                {o.label}
              </option>
            ))}
          </Select>
          <RangeField
            label="Arredondamento de bordas"
            min={0}
            max={24}
            unit="px"
            value={draft['appearance.border_radius'] ?? '8'}
            onChange={(v) => patch('appearance.border_radius', v)}
            hint="Raio dos cantos dos cards e botões"
          />
        </div>
      </Card>

      {/* SEO & Meta Tags Admin */}
      <Card>
        <CardHeader>
          <CardTitle>
            <span class="flex items-center gap-2">
              <Search size={14} /> SEO &amp; metadados — Admin
            </span>
          </CardTitle>
        </CardHeader>
        <div class="grid gap-3 grid-cols-1 sm:grid-cols-2">
          <Input
            label="Título da página (tag title)"
            placeholder="Ex: BeyondHub — Painel Admin"
            hint="Título que aparece na aba do navegador"
            value={draft['appearance.admin_page_title'] ?? ''}
            onInput={(e) => patch('appearance.admin_page_title', (e.target as HTMLInputElement).value)}
          />
          <BooleanToggle
            label="Indexação (Google)"
            valueOn="index"
            valueOff="noindex"
            labelOn="index, follow — permitido"
            labelOff="noindex, nofollow — bloqueado"
            current={draft['appearance.admin_robots_index'] ?? 'noindex'}
            onChange={(v) => patch('appearance.admin_robots_index', v)}
            hint="Quando desativado, adiciona noindex,nofollow — impede que buscadores indexem o painel"
          />
          <div class="sm:col-span-2">
            <Textarea
              label="Meta description"
              rows={2}
              placeholder="Ex: Painel administrativo do sistema"
              hint="Descrição para motores de busca"
              value={draft['appearance.admin_page_description'] ?? ''}
              onInput={(e) => patch('appearance.admin_page_description', (e.target as HTMLTextAreaElement).value)}
            />
          </div>
        </div>
      </Card>

      <CustomCodeCard
        title="Códigos externos — Painel Admin"
        description="Snippets injetados no <head> e antes do </body> do app admin (Google Analytics, Hotjar, GTM, etc)."
        headKey="appearance.custom_head_code"
        bodyKey="appearance.custom_body_code"
        draft={draft}
        onPatch={patch}
      />
    </>
  )
}

// ───────────────────── PREVIEWS ─────────────────────

function AdminPreview({ draft }: { draft: Draft }) {
  const sidebarBg = draft['appearance.sidebar_bg'] ?? '#ffffff'
  const sidebarText = draft['appearance.sidebar_text'] ?? '#5f6368'
  const sidebarActiveBg = draft['appearance.sidebar_active_bg'] ?? '#e8f0fe'
  const sidebarActiveText = draft['appearance.sidebar_active_text'] ?? '#1a73e8'
  const topbarBg = draft['appearance.topbar_bg'] ?? '#ffffff'
  const topbarText = draft['appearance.topbar_text'] ?? '#202124'
  const bodyBg = draft['appearance.body_bg'] ?? '#f8f9fa'
  const cardBg = draft['appearance.card_bg'] ?? '#ffffff'
  const cardBorder = draft['appearance.card_border'] ?? '#e0e0e0'
  const textPrimary = draft['appearance.text_primary'] ?? '#202124'
  const textSecondary = draft['appearance.text_secondary'] ?? '#5f6368'
  const primary = draft['appearance.primary_color'] ?? '#1a73e8'
  const success = draft['appearance.success_color'] ?? '#34a853'
  const warning = draft['appearance.warning_color'] ?? '#fbbc04'
  const radius = `${draft['appearance.border_radius'] ?? '8'}px`
  const fontFamily = draft['appearance.font_family'] ?? 'Google Sans, Poppins, sans-serif'

  const logoMode = draft['appearance.admin_logo_mode'] ?? 'text'
  const logoUrl = draft['appearance.admin_logo_url'] ?? ''
  const brandName = draft['appearance.admin_brand_name'] ?? 'Beyond'
  const brandAccent = draft['appearance.admin_brand_accent'] ?? 'Hub'
  const brandText = brandName.replace(brandAccent, '')
  const logoSizePx = Number.parseInt(draft['appearance.admin_logo_size'] ?? '16', 10) || 16
  const previewLogoTextPx = Math.round(logoSizePx * 0.7)
  const previewLogoImagePx = Math.round(logoSizePx * 1.15)

  const btnTextColor = isLightColor(primary) ? '#000' : '#fff'

  return (
    <div
      class="flex h-72 overflow-hidden rounded-md border"
      style={{ borderColor: cardBorder, fontFamily }}
    >
      {/* sidebar */}
      <div
        class="flex w-[42%] flex-col gap-1 border-r px-2 py-3"
        style={{ background: sidebarBg, color: sidebarText, borderColor: cardBorder }}
      >
        <div class="mb-2 flex items-center px-1.5 py-1 font-semibold">
          {logoMode === 'image' && logoUrl ? (
            <img src={logoUrl} alt="" style={{ height: `${previewLogoImagePx}px` }} />
          ) : (
            <span style={{ fontSize: `${previewLogoTextPx}px`, lineHeight: 1 }}>
              {brandText}
              <b style={{ color: primary }}>{brandAccent}</b>
            </span>
          )}
        </div>
        <div
          class="rounded px-2 py-1 text-[0.625rem] font-medium"
          style={{ background: sidebarActiveBg, color: sidebarActiveText, borderRadius: radius }}
        >
          Dashboard
        </div>
        <div class="px-2 py-1 text-[0.625rem]">Leads</div>
        <div class="px-2 py-1 text-[0.625rem]">Kanban</div>
        <div class="px-2 py-1 text-[0.625rem]">WhatsApp</div>
      </div>
      {/* main */}
      <div class="flex flex-1 flex-col" style={{ background: bodyBg }}>
        <div
          class="flex items-center justify-between border-b px-2 py-1.5 text-[0.625rem]"
          style={{ background: topbarBg, color: topbarText, borderColor: cardBorder }}
        >
          <span>Dashboard</span>
          <div class="flex items-center gap-1">
            <span class="h-2 w-2 rounded-full" style={{ background: success }} />
            <span class="h-2 w-2 rounded-full" style={{ background: warning }} />
          </div>
        </div>
        <div class="flex flex-1 flex-col gap-1.5 p-2">
          <div
            class="border p-1.5"
            style={{ background: cardBg, borderColor: cardBorder, borderRadius: radius }}
          >
            <div class="text-[0.5625rem]" style={{ color: textSecondary }}>
              Leads este mês
            </div>
            <div class="text-base font-semibold" style={{ color: textPrimary }}>
              142
            </div>
          </div>
          <div
            class="border p-1.5"
            style={{ background: cardBg, borderColor: cardBorder, borderRadius: radius }}
          >
            <div class="text-[0.5625rem]" style={{ color: textSecondary }}>
              Conversão
            </div>
            <div class="text-sm font-semibold" style={{ color: textPrimary }}>
              28.5%
            </div>
          </div>
          <button
            type="button"
            class="px-2 py-1 text-[0.625rem] font-medium"
            style={{
              background: primary,
              color: btnTextColor,
              borderRadius: radius,
              border: 'none',
            }}
          >
            Novo Lead
          </button>
        </div>
      </div>
    </div>
  )
}

// ───────────────────── HELPERS ─────────────────────

function isLightColor(hex: string): boolean {
  if (!hex || hex.length < 7) return false
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return (r * 299 + g * 587 + b * 114) / 1000 > 160
}

interface RangeFieldProps {
  label: string
  min: number
  max: number
  step?: number
  unit?: string
  value: string
  onChange: (v: string) => void
  hint?: string
}

function RangeField({ label, min, max, step = 1, unit = '', value, onChange, hint }: RangeFieldProps) {
  return (
    <label class="flex flex-col gap-1">
      <span class="flex items-center justify-between text-xs font-medium text-fg-muted">
        <span>{label}</span>
        <strong class="text-fg">
          {value}
          {unit}
        </strong>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onInput={(e) => onChange((e.target as HTMLInputElement).value)}
        class="h-5 w-full accent-accent"
      />
      {hint && <span class="text-[0.6875rem] text-fg-subtle">{hint}</span>}
    </label>
  )
}

interface ModeToggleProps {
  value: string
  onChange: (v: string) => void
}

function ModeToggle({ value, onChange }: ModeToggleProps) {
  const isText = value === 'text'
  return (
    <div class="flex flex-col gap-1">
      <span class="text-xs font-medium text-fg-muted">Modo do logotipo</span>
      <div class="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => onChange('text')}
          class={cn(
            'flex items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors',
            isText ? 'border-accent bg-accent/10 text-accent' : 'border-border bg-surface text-fg-muted hover:bg-surface-3',
          )}
          aria-pressed={isText}
        >
          <Type size={14} /> Apenas texto
        </button>
        <button
          type="button"
          onClick={() => onChange('image')}
          class={cn(
            'flex items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors',
            !isText ? 'border-accent bg-accent/10 text-accent' : 'border-border bg-surface text-fg-muted hover:bg-surface-3',
          )}
          aria-pressed={!isText}
        >
          <ImageIcon size={14} /> Imagem PNG/SVG
        </button>
      </div>
    </div>
  )
}

interface BooleanToggleProps {
  label: string
  current: string
  valueOn: string
  valueOff: string
  labelOn: string
  labelOff: string
  hint?: string
  onChange: (v: string) => void
}

function BooleanToggle({
  label,
  current,
  valueOn,
  valueOff,
  labelOn,
  labelOff,
  hint,
  onChange,
}: BooleanToggleProps) {
  const isOn = current === valueOn
  return (
    <div class="flex flex-col gap-1">
      <span class="text-xs font-medium text-fg-muted">{label}</span>
      <button
        type="button"
        onClick={() => onChange(isOn ? valueOff : valueOn)}
        class={cn(
          'flex items-center gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors',
          isOn
            ? 'border-accent bg-accent/10 text-accent'
            : 'border-border bg-surface text-fg-muted hover:bg-surface-3',
        )}
        aria-pressed={isOn}
      >
        <span
          class={cn(
            'inline-flex h-4 w-7 items-center rounded-full transition-colors',
            isOn ? 'bg-accent' : 'bg-surface-3',
          )}
        >
          <span
            class={cn(
              'h-3 w-3 rounded-full bg-white transition-transform',
              isOn ? 'translate-x-3' : 'translate-x-0.5',
            )}
          />
        </span>
        <span>{isOn ? labelOn : labelOff}</span>
      </button>
      {hint && <span class="text-[0.6875rem] text-fg-subtle">{hint}</span>}
    </div>
  )
}

function ThemeCard() {
  const theme = useThemeStore((s) => s.theme)
  const setTheme = useThemeStore((s) => s.setTheme)
  const items: { value: Theme; label: string; icon: typeof Sun; description: string }[] = [
    { value: 'light', label: 'Claro', icon: Sun, description: 'Fundo branco, alto contraste para ambientes iluminados.' },
    { value: 'dark', label: 'Escuro', icon: Moon, description: 'Fundo escuro, reduz fadiga visual à noite.' },
    { value: 'system', label: 'Automático', icon: Monitor, description: 'Acompanha a preferência do sistema operacional.' },
  ]
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <span class="flex items-center gap-2">
            <Sun size={14} /> Tema da interface
          </span>
        </CardTitle>
      </CardHeader>
      <p class="mb-3 text-xs text-fg-muted">
        Escolha entre claro, escuro ou automático (segue o sistema). A preferência fica salva neste navegador.
      </p>
      <div class="grid gap-2 sm:grid-cols-3">
        {items.map((it) => {
          const Icon = it.icon
          const active = it.value === theme
          return (
            <button
              key={it.value}
              type="button"
              onClick={() => setTheme(it.value)}
              class={cn(
                'flex flex-col gap-1 rounded-md border bg-surface px-3 py-2.5 text-left transition-colors',
                active ? 'border-accent ring-2 ring-accent/30' : 'border-border hover:bg-surface-3',
              )}
            >
              <div class="flex items-center gap-2">
                <Icon size={14} class={active ? 'text-accent' : 'text-fg-muted'} />
                <span class={cn('text-sm', active ? 'font-semibold text-fg' : 'text-fg')}>{it.label}</span>
                {active && <span class="ml-auto text-[0.6875rem] text-accent">Ativo</span>}
              </div>
              <span class="text-[0.6875rem] text-fg-subtle">{it.description}</span>
            </button>
          )
        })}
      </div>
    </Card>
  )
}

function AccessibilityCard() {
  const size = useFontSizeStore((s) => s.size)
  const setSize = useFontSizeStore((s) => s.setSize)
  const items: { value: FontSize; label: string; preview: string; description: string }[] = [
    {
      value: 'comfortable',
      label: FONT_SIZE_LABELS.comfortable,
      preview: 'Aa',
      description: 'Tamanho padrão (16px). Equilíbrio entre densidade e legibilidade.',
    },
    {
      value: 'large',
      label: FONT_SIZE_LABELS.large,
      preview: 'Aa',
      description: 'Aumenta um pouco (17px). Mais conforto em jornadas longas.',
    },
    {
      value: 'larger',
      label: FONT_SIZE_LABELS.larger,
      preview: 'Aa',
      description: 'Tamanho ampliado (19px). Indicado para baixa visão ou uso em telas pequenas.',
    },
  ]
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <span class="flex items-center gap-2">
            <Accessibility size={14} /> Acessibilidade — tamanho da fonte
          </span>
        </CardTitle>
      </CardHeader>
      <p class="mb-3 text-xs text-fg-muted">
        Ajuste o tamanho da fonte global. A preferência fica salva neste navegador e também
        pode ser alternada pelo botão <strong>Aa</strong> no topo.
      </p>
      <div class="grid gap-2 sm:grid-cols-3">
        {items.map((it) => {
          const active = it.value === size
          const previewSize = it.value === 'comfortable' ? '1rem' : it.value === 'large' ? '1.0625rem' : '1.1875rem'
          return (
            <button
              key={it.value}
              type="button"
              onClick={() => setSize(it.value)}
              class={cn(
                'flex flex-col gap-1 rounded-md border bg-surface px-3 py-2.5 text-left transition-colors',
                active ? 'border-accent ring-2 ring-accent/30' : 'border-border hover:bg-surface-3',
              )}
              aria-pressed={active}
            >
              <div class="flex items-baseline gap-2">
                <span
                  class={cn('font-semibold', active ? 'text-accent' : 'text-fg-muted')}
                  style={{ fontSize: previewSize }}
                >
                  {it.preview}
                </span>
                <span class={cn('text-sm', active ? 'font-semibold text-fg' : 'text-fg')}>{it.label}</span>
                {active && <span class="ml-auto text-[0.6875rem] text-accent">Ativo</span>}
              </div>
              <span class="text-[0.6875rem] text-fg-subtle">{it.description}</span>
            </button>
          )
        })}
      </div>
      <p class="mt-2 text-[0.6875rem] text-fg-subtle">
        Atalho rápido: o botão <strong>Aa</strong> no topo direito também troca o tamanho. WCAG AA
        garantido (contraste ≥ 4.5:1, focus visível, áreas clicáveis ≥ 44px no modo Maior).
      </p>
    </Card>
  )
}

interface CustomCodeCardProps {
  title: string
  description: string
  headKey: string
  bodyKey: string
  draft: Draft
  onPatch: (key: string, value: string) => void
}

function CustomCodeCard({ title, description, headKey, bodyKey, draft, onPatch }: CustomCodeCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <span class="flex items-center gap-2">
            <Code size={14} /> {title}
          </span>
        </CardTitle>
      </CardHeader>
      <p class="mb-3 text-xs text-fg-muted">{description}</p>
      <div class="mb-3 flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-[0.6875rem] text-fg-muted">
        <AlertTriangle size={14} class="mt-0.5 shrink-0 text-warning" />
        <span>
          O conteúdo é injetado <strong>sem sanitização</strong> no DOM. Cole apenas códigos de fontes
          confiáveis — qualquer script aqui executa com permissões totais da página.
        </span>
      </div>
      <div class="grid gap-3">
        <Textarea
          label="<head> — antes do fechamento"
          rows={6}
          spellcheck={false}
          class="font-mono text-[0.75rem]"
          placeholder={'<!-- Google Analytics -->\n<script>...</script>'}
          value={draft[headKey] ?? ''}
          onInput={(e) => onPatch(headKey, (e.target as HTMLTextAreaElement).value)}
        />
        <Textarea
          label="<body> — antes do fechamento"
          rows={6}
          spellcheck={false}
          class="font-mono text-[0.75rem]"
          placeholder={'<!-- Hotjar / Pixel / etc -->\n<script>...</script>'}
          value={draft[bodyKey] ?? ''}
          onInput={(e) => onPatch(bodyKey, (e.target as HTMLTextAreaElement).value)}
        />
      </div>
    </Card>
  )
}
