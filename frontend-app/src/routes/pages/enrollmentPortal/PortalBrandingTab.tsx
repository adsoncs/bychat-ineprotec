import { useState, useEffect } from 'preact/hooks'
import { ImagePlus, Trash2, Save, AlertCircle } from '@/components/ui/icon-set'
import {
  useUpdatePortalBranding,
  useUploadPortalAsset,
  useDeletePortalAsset,
  type EnrollmentPortal,
  type FontFamily,
  type RadiusScale,
  type PortalAssetKind,
  type BrandingInput,
} from '@/hooks/useEnrollmentPortals'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input, Textarea, Select } from '@/components/ui/Input'
import { ColorPicker } from '@/components/ui/ColorPicker'
import { FormLimpoEditor, type FormLimpoEstilo } from './FormLimpoEditor'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { toast } from '@/lib/toast'

const FONT_OPTIONS: { value: FontFamily; label: string }[] = [
  { value: 'inter',   label: 'Inter (moderna)' },
  { value: 'roboto',  label: 'Roboto (neutra)' },
  { value: 'poppins', label: 'Poppins (geométrica)' },
  { value: 'system',  label: 'Sistema (default OS)' },
]

/** Arranjo da página. Só a estrutura — cor, fonte e arredondamento seguem abaixo. */
const TEMPLATE_OPTIONS: { value: string; label: string; hint: string }[] = [
  { value: 'classico', label: 'Clássico — uma coluna', hint: 'Formulário centralizado, com o resumo do curso abaixo. Mais direto no celular.' },
  { value: 'duas-colunas', label: 'Duas colunas — resumo ao lado', hint: 'Formulário à esquerda e resumo do curso fixo à direita, no computador. Bom quando o valor pesa na decisão.' },
]

const RADIUS_OPTIONS: { value: RadiusScale; label: string }[] = [
  { value: 'sharp',   label: 'Sharp (sem arredondamento)' },
  { value: 'medium',  label: 'Médio' },
  { value: 'rounded', label: 'Arredondado' },
]

/** Campos de acabamento — ainda não estão no tipo gerado do portal. */
interface Acabamento {
  brandHeaderStyle?: string | null
  brandStepStyle?: string | null
  brandButtonShape?: string | null
  brandButtonUppercase?: boolean | null
  brandSecurityNote?: string | null
  brandBackdropFrom?: string | null
  brandBackdropTo?: string | null
  brandSummaryAlways?: boolean | null
  brandSecondaryColor?: string | null
  brandTypeScale?: string | null
  brandContentWidth?: string | null
  brandLabels?: Record<string, string> | null
  brandFormStyle?: FormLimpoEstilo | null
}

const SCALE_OPTIONS: { value: string; label: string }[] = [
  { value: 'compacta', label: 'Compacta — cabe mais na tela' },
  { value: 'padrao', label: 'Padrão' },
  { value: 'ampla', label: 'Ampla — texto maior, mais fácil de ler' },
]

const WIDTH_OPTIONS: { value: string; label: string }[] = [
  { value: 'estreita', label: 'Estreita — foco no formulário' },
  { value: 'padrao', label: 'Padrão' },
  { value: 'ampla', label: 'Ampla — aproveita telas grandes' },
]

/**
 * Textos da tela pública. O campo em branco usa o padrão do sistema (mostrado
 * como placeholder), então ninguém precisa reescrever a tela inteira para
 * trocar uma palavra.
 */
const TEXTOS: { chave: string; label: string; padrao: string }[] = [
  { chave: 'continuar', label: 'Botão de avançar', padrao: 'Continuar' },
  { chave: 'voltar', label: 'Botão de voltar', padrao: 'Voltar' },
  { chave: 'enviar', label: 'Botão de enviar a inscrição', padrao: 'Confirmar inscrição' },
  { chave: 'revisao', label: 'Nome da última etapa', padrao: 'Revisão' },
  { chave: 'revisaoTitulo', label: 'Título da revisão', padrao: 'Confira antes de enviar' },
  { chave: 'revisaoSubtitulo', label: 'Linha de apoio da revisão', padrao: 'Depois de confirmar, esses dados vão para a secretaria.' },
  { chave: 'resumoTitulo', label: 'Título do resumo', padrao: 'Resumo da inscrição' },
  { chave: 'resumoVazio', label: 'Resumo sem curso escolhido', padrao: 'O curso escolhido e os valores aparecem aqui.' },
  { chave: 'resumoTaxa', label: 'Rótulo da taxa de inscrição', padrao: 'Taxa de inscrição' },
  { chave: 'resumoMatricula', label: 'Rótulo da taxa de matrícula', padrao: 'Taxa de matrícula' },
  { chave: 'resumoMensalidade', label: 'Rótulo da mensalidade', padrao: 'Mensalidade' },
  { chave: 'resumoObservacao', label: 'Observação do resumo', padrao: 'Os valores são confirmados no contrato, depois da análise dos documentos.' },
]

/** Acabamento: aparência, não identidade. A cor e a fonte seguem as de cima. */
const HEADER_OPTIONS: { value: string; label: string; hint: string }[] = [
  { value: 'simples', label: 'Logo acima da capa', hint: 'Logo solto no topo, capa logo abaixo. É o padrão.' },
  { value: 'barra', label: 'Faixa fixa com os passos', hint: 'Logo, passos da inscrição e selo numa faixa branca presa ao topo — como num checkout.' },
]

const STEP_OPTIONS: { value: string; label: string }[] = [
  { value: 'barras', label: 'Barras de progresso' },
  { value: 'numeros', label: 'Círculos numerados' },
]

const BUTTON_OPTIONS: { value: string; label: string }[] = [
  { value: 'reta', label: 'Cantos do arredondamento escolhido' },
  { value: 'pill', label: 'Cápsula (totalmente arredondado)' },
]

export function PortalBrandingTab({ portal }: { portal: EnrollmentPortal }) {
  // Estado local controlado pelos campos de texto/cor — uploads são imediatos.
  const [brandPrimaryColor, setBrandPrimaryColor] = useState(portal.brandPrimaryColor ?? '#1a73e8')
  const [brandFontFamily, setBrandFontFamily] = useState<FontFamily>(portal.brandFontFamily ?? 'inter')
  const [brandRadiusScale, setBrandRadiusScale] = useState<RadiusScale>(portal.brandRadiusScale ?? 'medium')
  const [brandTemplate, setBrandTemplate] = useState<string>((portal as { brandTemplate?: string | null }).brandTemplate ?? 'classico')
  const [brandLogoLink, setBrandLogoLink] = useState(portal.brandLogoLink ?? '')
  const [brandHeroEnabled, setBrandHeroEnabled] = useState(portal.brandHeroEnabled)
  const [brandHeroTitle, setBrandHeroTitle] = useState(portal.brandHeroTitle ?? '')
  const [brandHeroSubtitle, setBrandHeroSubtitle] = useState(portal.brandHeroSubtitle ?? '')
  const [brandHeroOverlayOpacity, setBrandHeroOverlayOpacity] = useState(
    String(portal.brandHeroOverlayOpacity ?? 40),
  )
  const [brandFooterText, setBrandFooterText] = useState(portal.brandFooterText ?? '')
  const acab = portal as unknown as Acabamento
  const [brandHeaderStyle, setBrandHeaderStyle] = useState(acab.brandHeaderStyle ?? 'simples')
  const [brandStepStyle, setBrandStepStyle] = useState(acab.brandStepStyle ?? 'barras')
  const [brandButtonShape, setBrandButtonShape] = useState(acab.brandButtonShape ?? 'reta')
  const [brandButtonUppercase, setBrandButtonUppercase] = useState(!!acab.brandButtonUppercase)
  const [brandSummaryAlways, setBrandSummaryAlways] = useState(!!acab.brandSummaryAlways)
  const [brandSecurityNote, setBrandSecurityNote] = useState(acab.brandSecurityNote ?? '')
  const [brandBackdropFrom, setBrandBackdropFrom] = useState(acab.brandBackdropFrom ?? '')
  const [brandBackdropTo, setBrandBackdropTo] = useState(acab.brandBackdropTo ?? '')
  const [brandSecondaryColor, setBrandSecondaryColor] = useState(acab.brandSecondaryColor ?? '')
  const [brandTypeScale, setBrandTypeScale] = useState(acab.brandTypeScale ?? 'padrao')
  const [brandContentWidth, setBrandContentWidth] = useState(acab.brandContentWidth ?? 'padrao')
  const [brandLabels, setBrandLabels] = useState<Record<string, string>>(acab.brandLabels ?? {})
  const [brandFormStyle, setBrandFormStyle] = useState<FormLimpoEstilo>(acab.brandFormStyle ?? {})
  const [dirty, setDirty] = useState(false)

  // Mantém o estado em sync se o portal for atualizado externamente (upload).
  // Usa portal completo nas deps; setters são estáveis e o efeito só roda quando portal muda.
  useEffect(() => {
    setBrandPrimaryColor(portal.brandPrimaryColor ?? '#1a73e8')
    setBrandFontFamily(portal.brandFontFamily ?? 'inter')
    setBrandRadiusScale(portal.brandRadiusScale ?? 'medium')
    setBrandTemplate((portal as { brandTemplate?: string | null }).brandTemplate ?? 'classico')
    setBrandLogoLink(portal.brandLogoLink ?? '')
    setBrandHeroEnabled(portal.brandHeroEnabled)
    setBrandHeroTitle(portal.brandHeroTitle ?? '')
    setBrandHeroSubtitle(portal.brandHeroSubtitle ?? '')
    setBrandHeroOverlayOpacity(String(portal.brandHeroOverlayOpacity ?? 40))
    setBrandFooterText(portal.brandFooterText ?? '')
    setBrandHeaderStyle(acab.brandHeaderStyle ?? 'simples')
    setBrandStepStyle(acab.brandStepStyle ?? 'barras')
    setBrandButtonShape(acab.brandButtonShape ?? 'reta')
    setBrandButtonUppercase(!!acab.brandButtonUppercase)
    setBrandSummaryAlways(!!acab.brandSummaryAlways)
    setBrandSecurityNote(acab.brandSecurityNote ?? '')
    setBrandBackdropFrom(acab.brandBackdropFrom ?? '')
    setBrandBackdropTo(acab.brandBackdropTo ?? '')
    setBrandSecondaryColor(acab.brandSecondaryColor ?? '')
    setBrandTypeScale(acab.brandTypeScale ?? 'padrao')
    setBrandContentWidth(acab.brandContentWidth ?? 'padrao')
    setBrandLabels(acab.brandLabels ?? {})
    setBrandFormStyle(acab.brandFormStyle ?? {})
    setDirty(false)
  }, [
    portal.brandPrimaryColor,
    portal.brandFontFamily,
    portal.brandRadiusScale,
    (portal as { brandTemplate?: string | null }).brandTemplate,
    portal.brandLogoLink,
    portal.brandHeroEnabled,
    portal.brandHeroTitle,
    portal.brandHeroSubtitle,
    portal.brandHeroOverlayOpacity,
    portal.brandFooterText,
    acab.brandHeaderStyle,
    acab.brandStepStyle,
    acab.brandButtonShape,
    acab.brandButtonUppercase,
    acab.brandSummaryAlways,
    acab.brandSecurityNote,
    acab.brandBackdropFrom,
    acab.brandBackdropTo,
    acab.brandSecondaryColor,
    acab.brandTypeScale,
    acab.brandContentWidth,
    acab.brandLabels,
    acab.brandFormStyle,
  ])

  function markDirty<T>(setter: (v: T) => void) {
    return (v: T) => { setter(v); setDirty(true) }
  }

  // beforeunload: avisa se houver alterações pendentes
  useEffect(() => {
    if (!dirty) return
    function onBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [dirty])

  const update = useUpdatePortalBranding(portal.id)

  function handleSave() {
    const overlay = parseInt(brandHeroOverlayOpacity)
    const payload: BrandingInput = {
      brandPrimaryColor: brandPrimaryColor.trim() || null,
      brandFontFamily,
      brandRadiusScale,
      brandTemplate,
      brandLogoLink: brandLogoLink.trim() || null,
      brandHeroEnabled,
      brandHeroTitle: brandHeroTitle.trim() || null,
      brandHeroSubtitle: brandHeroSubtitle.trim() || null,
      brandHeroOverlayOpacity: Number.isFinite(overlay) ? Math.max(0, Math.min(80, overlay)) : null,
      brandFooterText: brandFooterText.trim() || null,
      brandHeaderStyle,
      brandStepStyle,
      brandButtonShape,
      brandButtonUppercase,
      brandSummaryAlways,
      brandSecurityNote: brandSecurityNote.trim() || null,
      // As duas pontas do degradê andam juntas: com uma só, o portal mantém o
      // fundo liso — então enviar uma sem a outra não adianta.
      brandBackdropFrom: brandBackdropFrom.trim() || null,
      brandBackdropTo: brandBackdropTo.trim() || null,
      brandSecondaryColor: brandSecondaryColor.trim() || null,
      brandTypeScale,
      brandContentWidth,
      brandLabels,
      brandFormStyle: Object.keys(brandFormStyle).length ? (brandFormStyle as Record<string, unknown>) : null,
    }
    update.mutate(payload, {
      onSuccess: () => { toast('Branding salvo', 'success'); setDirty(false) },
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  return (
    <div class="space-y-3">
      {dirty && (
        <div class="sticky top-0 z-10 -mx-2 px-2 py-2 rounded-md border border-warning/40 bg-warning/10 backdrop-blur flex items-center justify-between gap-3 flex-wrap">
          <div class="flex items-center gap-2 text-xs text-warning">
            <AlertCircle size={14} /> Alterações de branding não salvas.
          </div>
          <Button size="sm" variant="primary" onClick={handleSave} disabled={update.isPending}>
            <Save size={12} /> {update.isPending ? 'Salvando…' : 'Salvar agora'}
          </Button>
        </div>
      )}
      <Card>
        <div class="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <div class="text-sm font-medium text-fg">Identidade visual</div>
            <div class="text-xs text-fg-muted mt-0.5">
              Logo, favicon e hero são salvos imediatamente ao enviar. Demais campos exigem clicar em Salvar.
            </div>
          </div>
          <Button size="sm" variant="primary" onClick={handleSave} disabled={!dirty || update.isPending}>
            <Save size={12} /> {update.isPending ? 'Salvando…' : 'Salvar'}
          </Button>
        </div>
      </Card>

      <div class="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <AssetUploader
          portalId={portal.id}
          kind="logo"
          label="Logo"
          hint="PNG/JPG/SVG/WebP/GIF · até 1MB"
          currentUrl={portal.brandLogoUrl}
        />
        <AssetUploader
          portalId={portal.id}
          kind="favicon"
          label="Favicon"
          hint="PNG/ICO/SVG · até 200KB"
          currentUrl={portal.brandFaviconUrl}
        />
        <AssetUploader
          portalId={portal.id}
          kind="hero"
          label="Imagem de capa"
          hint="PNG/JPG/WebP · até 4MB"
          currentUrl={portal.brandHeroUrl}
        />
      </div>

      <Card>
        <div class="text-xs uppercase tracking-wider text-fg-muted mb-3">Cores e tipografia</div>
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <ColorPicker
            label="Cor primária"
            value={brandPrimaryColor}
            onChange={markDirty(setBrandPrimaryColor)}
          />
          <ColorPicker
            label="Cor de apoio"
            value={brandSecondaryColor || brandPrimaryColor}
            onChange={markDirty(setBrandSecondaryColor)}
          />
          <Select
            label="Fonte"
            value={brandFontFamily}
            onChange={(e) => {
              markDirty(setBrandFontFamily)((e.target as HTMLSelectElement).value as FontFamily)
            }}
          >
            {FONT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </Select>
          <Select
            label="Layout da página"
            value={brandTemplate}
            onChange={(e) => {
              markDirty(setBrandTemplate)((e.target as HTMLSelectElement).value)
            }}
            hint={TEMPLATE_OPTIONS.find((o) => o.value === brandTemplate)?.hint ?? ''}
          >
            {TEMPLATE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </Select>

          <Select
            label="Arredondamento"
            value={brandRadiusScale}
            onChange={(e) => {
              markDirty(setBrandRadiusScale)((e.target as HTMLSelectElement).value as RadiusScale)
            }}
          >
            {RADIUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </Select>
        </div>
      </Card>

      <Card>
        <div class="text-xs uppercase tracking-wider text-fg-muted mb-1">Acabamento</div>
        <p class="text-xs text-fg-muted mb-3">
          Como a página se apresenta. A cor, a fonte e o arredondamento continuam sendo os de cima —
          aqui você escolhe a forma.
        </p>
        <div class="space-y-3">
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Select
              label="Topo da página"
              value={brandHeaderStyle}
              onChange={(e) => markDirty(setBrandHeaderStyle)((e.target as HTMLSelectElement).value)}
              hint={HEADER_OPTIONS.find((o) => o.value === brandHeaderStyle)?.hint ?? ''}
            >
              {HEADER_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </Select>
            <Select
              label="Passos da inscrição"
              value={brandStepStyle}
              onChange={(e) => markDirty(setBrandStepStyle)((e.target as HTMLSelectElement).value)}
            >
              {STEP_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </Select>
          </div>

          <Input
            label="Selo do topo"
            value={brandSecurityNote}
            onInput={(e) => markDirty(setBrandSecurityNote)((e.target as HTMLInputElement).value)}
            placeholder="Inscrição segura"
            hint="Aparece com um cadeado, à direita da faixa. Em branco, não aparece."
            disabled={brandHeaderStyle !== 'barra'}
          />

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Select
              label="Botão principal"
              value={brandButtonShape}
              onChange={(e) => markDirty(setBrandButtonShape)((e.target as HTMLSelectElement).value)}
            >
              {BUTTON_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </Select>
            <div class="flex flex-col justify-end gap-2 pb-1">
              <label class="flex items-center gap-2 text-sm text-fg-muted">
                <input
                  type="checkbox"
                  checked={brandButtonUppercase}
                  onChange={(e) => markDirty(setBrandButtonUppercase)((e.target as HTMLInputElement).checked)}
                />
                Texto do botão em caixa alta
              </label>
              <label class="flex items-center gap-2 text-sm text-fg-muted">
                <input
                  type="checkbox"
                  checked={brandSummaryAlways}
                  onChange={(e) => markDirty(setBrandSummaryAlways)((e.target as HTMLInputElement).checked)}
                />
                Resumo visível desde o começo
              </label>
            </div>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <ColorPicker
              label="Fundo — cor inicial"
              value={brandBackdropFrom || '#ffffff'}
              onChange={markDirty(setBrandBackdropFrom)}
            />
            <ColorPicker
              label="Fundo — cor final"
              value={brandBackdropTo || '#ffffff'}
              onChange={markDirty(setBrandBackdropTo)}
            />
          </div>
          <p class="text-xs text-fg-muted -mt-1">
            O degradê precisa das duas cores; sem as duas, o fundo fica liso.
          </p>

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Select
              label="Tamanho do texto"
              value={brandTypeScale}
              onChange={(e) => markDirty(setBrandTypeScale)((e.target as HTMLSelectElement).value)}
            >
              {SCALE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </Select>
            <Select
              label="Largura do conteúdo"
              value={brandContentWidth}
              onChange={(e) => markDirty(setBrandContentWidth)((e.target as HTMLSelectElement).value)}
            >
              {WIDTH_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </Select>
          </div>
          {(brandBackdropFrom || brandBackdropTo) && (
            <button
              type="button"
              class="text-xs text-fg-muted underline"
              onClick={() => {
                markDirty(setBrandBackdropFrom)('')
                setBrandBackdropTo('')
              }}
            >
              Voltar ao fundo liso
            </button>
          )}
        </div>
      </Card>

      <FormLimpoEditor valor={brandFormStyle} corMarca={brandPrimaryColor} onChange={markDirty(setBrandFormStyle)} />

      <Card>
        <div class="text-xs uppercase tracking-wider text-fg-muted mb-3">Hero (capa do portal)</div>
        <label class="flex items-center gap-2 text-sm text-fg-muted mb-3">
          <input
            type="checkbox"
            checked={brandHeroEnabled}
            onChange={(e) => markDirty(setBrandHeroEnabled)((e.target as HTMLInputElement).checked)}
          />
          Exibir hero
        </label>
        <div class="space-y-3">
          <div class="grid grid-cols-1 sm:grid-cols-[2fr_1fr] gap-3">
            <Input
              label="Título"
              value={brandHeroTitle ?? ''}
              onInput={(e) => markDirty(setBrandHeroTitle)((e.target as HTMLInputElement).value)}
              placeholder="Inscrições abertas"
              disabled={!brandHeroEnabled}
            />
            <Input
              label="Opacidade da sobreposição (0–80)"
              type="number"
              value={brandHeroOverlayOpacity}
              onInput={(e) => markDirty(setBrandHeroOverlayOpacity)((e.target as HTMLInputElement).value)}
              hint="Escurece a imagem para legibilidade"
              disabled={!brandHeroEnabled}
            />
          </div>
          <Textarea
            label="Subtítulo"
            value={brandHeroSubtitle ?? ''}
            onInput={(e) => markDirty(setBrandHeroSubtitle)((e.target as HTMLTextAreaElement).value)}
            placeholder="Vagas para 2027/1 — Vestibular ENEM e tradicional"
            disabled={!brandHeroEnabled}
            rows={2}
          />
        </div>
      </Card>

      <Card>
        <div class="text-xs uppercase tracking-wider text-fg-muted mb-1">Textos da tela</div>
        <p class="text-xs text-fg-muted mb-3">
          Cada campo em branco usa o texto padrão, que aparece em cinza. Troque só o que quiser.
        </p>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {TEXTOS.map((t) => (
            <Input
              key={t.chave}
              label={t.label}
              value={brandLabels[t.chave] ?? ''}
              placeholder={t.padrao}
              onInput={(e) => {
                const v = (e.target as HTMLInputElement).value
                markDirty(setBrandLabels)({ ...brandLabels, [t.chave]: v })
              }}
            />
          ))}
        </div>
        {Object.values(brandLabels).some((v) => v && v.trim()) && (
          <button
            type="button"
            class="text-xs text-fg-muted underline mt-3"
            onClick={() => markDirty(setBrandLabels)({})}
          >
            Voltar todos aos textos padrão
          </button>
        )}
      </Card>

      <Card>
        <div class="text-xs uppercase tracking-wider text-fg-muted mb-3">Logo + rodapé</div>
        <div class="space-y-3">
          <Input
            label="Link do logo"
            type="url"
            value={brandLogoLink ?? ''}
            onInput={(e) => markDirty(setBrandLogoLink)((e.target as HTMLInputElement).value)}
            placeholder="https://"
            hint="Ao clicar no logo, o candidato vai para esta URL"
          />
          <Textarea
            label="Texto do rodapé"
            value={brandFooterText ?? ''}
            onInput={(e) => markDirty(setBrandFooterText)((e.target as HTMLTextAreaElement).value)}
            rows={3}
            placeholder="© 2026 Sua Instituição. CNPJ ..."
          />
        </div>
      </Card>
    </div>
  )
}

function AssetUploader({
  portalId, kind, label, hint, currentUrl,
}: {
  portalId: number
  kind: PortalAssetKind
  label: string
  hint: string
  currentUrl: string | null
}) {
  const upload = useUploadPortalAsset(portalId)
  const remove = useDeletePortalAsset(portalId)
  const [removing, setRemoving] = useState(false)

  function handlePick(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0]
    if (!file) return
    upload.mutate({ kind, file }, {
      onSuccess: () => toast(`${label} atualizado`, 'success'),
      onError: (err: unknown) => toast((err as Error).message, 'danger'),
    })
    // Reset pra permitir re-upload do mesmo arquivo
    ;(e.target as HTMLInputElement).value = ''
  }

  return (
    <Card>
      <div class="text-xs uppercase tracking-wider text-fg-muted mb-2">{label}</div>
      <div class="rounded-md border border-dashed border-border bg-surface aspect-video grid place-items-center overflow-hidden">
        {currentUrl ? (
          <img src={currentUrl} alt={label} class="max-w-full max-h-full object-contain" />
        ) : (
          <div class="text-xs text-fg-muted text-center px-3">
            Nenhum {label.toLowerCase()} enviado
          </div>
        )}
      </div>
      <div class="text-2xs text-fg-muted mt-1.5">{hint}</div>
      <div class="flex gap-2 mt-2">
        <label class="flex-1">
          <input
            type="file"
            class="sr-only"
            accept={
              kind === 'favicon'
                ? '.png,.ico,.svg,image/*'
                : kind === 'hero'
                  ? '.png,.jpg,.jpeg,.webp,image/*'
                  : '.png,.jpg,.jpeg,.webp,.svg,.gif,image/*'
            }
            onChange={handlePick}
            disabled={upload.isPending}
          />
          <span
            class={`inline-flex items-center gap-1.5 px-2 py-1.5 rounded text-xs cursor-pointer w-full justify-center ${
              upload.isPending
                ? 'bg-surface-3 text-fg-muted'
                : 'bg-accent text-fg-on-brand hover:bg-accent/90'
            }`}
          >
            <ImagePlus size={12} />
            {upload.isPending ? 'Enviando…' : currentUrl ? 'Trocar' : 'Enviar'}
          </span>
        </label>
        {currentUrl && (
          <button
            type="button"
            class="size-8 rounded grid place-items-center text-fg-muted hover:text-danger hover:bg-surface-3 disabled:opacity-50"
            onClick={() => setRemoving(true)}
            disabled={remove.isPending}
            aria-label="Remover"
          >
            <Trash2 size={12} />
          </button>
        )}
      </div>

      {removing && (
        <ConfirmDialog
          open
          onOpenChange={(o) => { if (!o) setRemoving(false) }}
          title={`Remover ${label.toLowerCase()}?`}
          description={`O arquivo é apagado do servidor e o portal volta a usar o default.`}
          destructive
          confirmLabel="Remover"
          loading={remove.isPending}
          onConfirm={() => remove.mutate(kind, {
            onSuccess: () => { toast(`${label} removido`, 'success'); setRemoving(false) },
            onError: (e: unknown) => toast((e as Error).message, 'danger'),
          })}
        />
      )}
    </Card>
  )
}
