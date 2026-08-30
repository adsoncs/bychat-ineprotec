import { usePublicAppearance } from '@/hooks/useSettings'
import { cn } from '@/lib/cn'

interface BrandLogoProps {
  /** 'admin' (sidebar/topbar/login) ou 'lp' (landing page) */
  variant?: 'admin' | 'lp'
  /** ícone-only (apenas badge com iniciais ou logo recortado) */
  iconOnly?: boolean
  /** classe extra para o container */
  class?: string
  /** tamanho do badge quando iconOnly. Padrão: size-7 */
  iconSize?: 'sm' | 'md' | 'lg'
}

const ICON_SIZES = { sm: 'size-6 text-3xs', md: 'size-7 text-xs', lg: 'size-9 text-sm' }

function getInitials(name: string, accent: string): string {
  const cleaned = (name || '').trim()
  if (!cleaned) return '·'
  const parts = cleaned.split(/\s+/).filter(Boolean)
  if (parts.length >= 2) {
    return (parts[0]!.charAt(0) + parts[1]!.charAt(0)).toUpperCase()
  }
  // Uma palavra: tenta separar pelo accent (ex: BeyondHub + accent=Hub → "BH")
  const lower = cleaned.toLowerCase()
  const acc = (accent || '').trim().toLowerCase()
  if (acc && lower.endsWith(acc) && cleaned.length > acc.length) {
    return (cleaned.charAt(0) + cleaned.charAt(cleaned.length - acc.length)).toUpperCase()
  }
  return cleaned.slice(0, 2).toUpperCase()
}

export function BrandLogo({ variant = 'admin', iconOnly = false, class: className, iconSize = 'md' }: BrandLogoProps) {
  const { data } = usePublicAppearance()
  const cfg = data?.appearance ?? {}

  const prefix = variant === 'admin' ? 'admin' : 'lp'
  const get = (key: string, fallback: string): string => {
    const v = cfg[key]
    return v && v.length > 0 ? v : fallback
  }
  const mode = get(`appearance.${prefix}_logo_mode`, 'text')
  const url = get(`appearance.${prefix}_logo_url`, '')
  const name = get(`appearance.${prefix}_brand_name`, 'ByChat Beyond')
  const accent = get(`appearance.${prefix}_brand_accent`, '')
  const accentColor =
    variant === 'admin'
      ? get('appearance.primary_color', '#1a73e8')
      : get('appearance.landing_gold', '#d1ae60')

  const sizeDefault = variant === 'admin' ? 16 : 18
  const sizePx = Number.parseInt(get(`appearance.${prefix}_logo_size`, String(sizeDefault)), 10) || sizeDefault
  const imageHeightPx = Math.round(sizePx * 1.75)
  const imageMaxWidthPx = Math.round(sizePx * 10)

  const hasImage = mode === 'image' && Boolean(url)
  const hasAccent = accent && name.includes(accent)
  const head = hasAccent ? name.slice(0, name.indexOf(accent)) : name
  const tail = hasAccent ? name.slice(name.indexOf(accent) + accent.length) : ''

  if (iconOnly) {
    return (
      <span class={cn('inline-flex shrink-0 items-center justify-center', className)}>
        {hasImage ? (
          <img
            src={url}
            alt={name}
            class={cn('rounded-md object-contain', ICON_SIZES[iconSize])}
          />
        ) : (
          <span
            aria-hidden="true"
            class={cn(
              'flex items-center justify-center rounded-md font-bold text-fg-on-brand',
              ICON_SIZES[iconSize],
            )}
            style={{ background: accentColor }}
          >
            {getInitials(name, accent)}
          </span>
        )}
      </span>
    )
  }

  if (hasImage) {
    return (
      <span class={cn('inline-flex items-center', className)}>
        <img
          src={url}
          alt={name}
          class="object-contain"
          style={{ height: `${imageHeightPx}px`, maxWidth: `${imageMaxWidthPx}px` }}
        />
      </span>
    )
  }

  return (
    <span
      class={cn('inline-flex items-center font-semibold tracking-tight', className)}
      style={{ fontSize: `${sizePx}px`, lineHeight: 1 }}
    >
      {head}
      {hasAccent ? <b style={{ color: accentColor, fontWeight: 700 }}>{accent}</b> : null}
      {tail}
    </span>
  )
}
