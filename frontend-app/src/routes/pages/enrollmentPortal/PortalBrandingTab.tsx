import { useState, useEffect } from 'preact/hooks'
import { ImagePlus, Trash2, Save, AlertCircle } from 'lucide-preact'
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
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { toast } from '@/lib/toast'

const FONT_OPTIONS: { value: FontFamily; label: string }[] = [
  { value: 'inter',   label: 'Inter (moderna)' },
  { value: 'roboto',  label: 'Roboto (neutra)' },
  { value: 'poppins', label: 'Poppins (geométrica)' },
  { value: 'system',  label: 'Sistema (default OS)' },
]

const RADIUS_OPTIONS: { value: RadiusScale; label: string }[] = [
  { value: 'sharp',   label: 'Sharp (sem arredondamento)' },
  { value: 'medium',  label: 'Médio' },
  { value: 'rounded', label: 'Arredondado' },
]

export function PortalBrandingTab({ portal }: { portal: EnrollmentPortal }) {
  // Estado local controlado pelos campos de texto/cor — uploads são imediatos.
  const [brandPrimaryColor, setBrandPrimaryColor] = useState(portal.brandPrimaryColor ?? '#1a73e8')
  const [brandFontFamily, setBrandFontFamily] = useState<FontFamily>(portal.brandFontFamily ?? 'inter')
  const [brandRadiusScale, setBrandRadiusScale] = useState<RadiusScale>(portal.brandRadiusScale ?? 'medium')
  const [brandLogoLink, setBrandLogoLink] = useState(portal.brandLogoLink ?? '')
  const [brandHeroEnabled, setBrandHeroEnabled] = useState(portal.brandHeroEnabled)
  const [brandHeroTitle, setBrandHeroTitle] = useState(portal.brandHeroTitle ?? '')
  const [brandHeroSubtitle, setBrandHeroSubtitle] = useState(portal.brandHeroSubtitle ?? '')
  const [brandHeroOverlayOpacity, setBrandHeroOverlayOpacity] = useState(
    String(portal.brandHeroOverlayOpacity ?? 40),
  )
  const [brandFooterText, setBrandFooterText] = useState(portal.brandFooterText ?? '')
  const [dirty, setDirty] = useState(false)

  // Mantém o estado em sync se o portal for atualizado externamente (upload).
  // Usa portal completo nas deps; setters são estáveis e o efeito só roda quando portal muda.
  useEffect(() => {
    setBrandPrimaryColor(portal.brandPrimaryColor ?? '#1a73e8')
    setBrandFontFamily(portal.brandFontFamily ?? 'inter')
    setBrandRadiusScale(portal.brandRadiusScale ?? 'medium')
    setBrandLogoLink(portal.brandLogoLink ?? '')
    setBrandHeroEnabled(portal.brandHeroEnabled)
    setBrandHeroTitle(portal.brandHeroTitle ?? '')
    setBrandHeroSubtitle(portal.brandHeroSubtitle ?? '')
    setBrandHeroOverlayOpacity(String(portal.brandHeroOverlayOpacity ?? 40))
    setBrandFooterText(portal.brandFooterText ?? '')
    setDirty(false)
  }, [
    portal.brandPrimaryColor,
    portal.brandFontFamily,
    portal.brandRadiusScale,
    portal.brandLogoLink,
    portal.brandHeroEnabled,
    portal.brandHeroTitle,
    portal.brandHeroSubtitle,
    portal.brandHeroOverlayOpacity,
    portal.brandFooterText,
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
      brandLogoLink: brandLogoLink.trim() || null,
      brandHeroEnabled,
      brandHeroTitle: brandHeroTitle.trim() || null,
      brandHeroSubtitle: brandHeroSubtitle.trim() || null,
      brandHeroOverlayOpacity: Number.isFinite(overlay) ? Math.max(0, Math.min(80, overlay)) : null,
      brandFooterText: brandFooterText.trim() || null,
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
            <div class="text-xs text-fg-subtle mt-0.5">
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
        <div class="text-xs uppercase tracking-wider text-fg-subtle mb-3">Cores e tipografia</div>
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <ColorPicker
            label="Cor primária"
            value={brandPrimaryColor}
            onChange={markDirty(setBrandPrimaryColor)}
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
        <div class="text-xs uppercase tracking-wider text-fg-subtle mb-3">Hero (capa do portal)</div>
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
        <div class="text-xs uppercase tracking-wider text-fg-subtle mb-3">Logo + rodapé</div>
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
      <div class="text-xs uppercase tracking-wider text-fg-subtle mb-2">{label}</div>
      <div class="rounded-md border border-dashed border-border bg-surface aspect-video grid place-items-center overflow-hidden">
        {currentUrl ? (
          <img src={currentUrl} alt={label} class="max-w-full max-h-full object-contain" />
        ) : (
          <div class="text-xs text-fg-subtle text-center px-3">
            Nenhum {label.toLowerCase()} enviado
          </div>
        )}
      </div>
      <div class="text-[0.6875rem] text-fg-subtle mt-1.5">{hint}</div>
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
                ? 'bg-surface-3 text-fg-subtle'
                : 'bg-accent text-white hover:bg-accent/90'
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
