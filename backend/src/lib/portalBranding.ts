// Helper compartilhado entre /portal/:slug (vestibular) e /candidato/:code
// (candidato). Gera <style>/<link> a partir dos campos brand* do EnrollmentPortal.
//
// O objetivo é que o portal tenha aparência customizada já no SSR — sem
// flash de tema padrão antes do JS aplicar.

const FONT_LINKS: Record<string, { href: string; family: string }> = {
  inter:   { href: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap',           family: "'Inter', system-ui, sans-serif" },
  roboto:  { href: 'https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700&display=swap',              family: "'Roboto', system-ui, sans-serif" },
  poppins: { href: 'https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&display=swap',         family: "'Poppins', system-ui, sans-serif" },
}

const RADIUS_MAP: Record<string, { card: string; input: string; button: string }> = {
  sharp:    { card: '4px',  input: '3px', button: '3px'  },
  medium:   { card: '10px', input: '8px', button: '8px'  },
  rounded:  { card: '16px', input: '12px', button: '999px' },
}

function escAttr(s: string | null | undefined): string {
  if (!s) return ''
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// hex → luminance (0..1) e cor de texto contrastante (preto ou branco).
// Usado para garantir legibilidade sobre o botão primário, sem o admin
// precisar pensar na cor do texto.
function contrastColorFor(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return '#ffffff'
  const r = parseInt(m[1].slice(0, 2), 16)
  const g = parseInt(m[1].slice(2, 4), 16)
  const b = parseInt(m[1].slice(4, 6), 16)
  // Luminância relativa (sRGB)
  const srgb = [r, g, b].map(v => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  })
  const lum = 0.2126 * srgb[0] + 0.7152 * srgb[1] + 0.0722 * srgb[2]
  return lum > 0.5 ? '#1a2332' : '#ffffff'
}

// Escurece um hex para gerar a cor de hover (--primary-dark) automaticamente.
function darken(hex: string, amount = 0.15): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return hex
  const r = Math.max(0, parseInt(m[1].slice(0, 2), 16) - Math.round(255 * amount))
  const g = Math.max(0, parseInt(m[1].slice(2, 4), 16) - Math.round(255 * amount))
  const b = Math.max(0, parseInt(m[1].slice(4, 6), 16) - Math.round(255 * amount))
  return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('')
}

export interface PortalBrandFields {
  brandLogoUrl?: string | null
  brandLogoLink?: string | null
  brandFaviconUrl?: string | null
  brandPrimaryColor?: string | null
  brandHeroEnabled?: boolean | null
  brandHeroUrl?: string | null
  brandHeroTitle?: string | null
  brandHeroSubtitle?: string | null
  brandHeroOverlayOpacity?: number | null
  brandFooterText?: string | null
  brandFontFamily?: string | null
  brandRadiusScale?: string | null
}

// Retorna fragmentos prontos para concatenar dentro de <head>.
export function renderBrandingHead(p: PortalBrandFields): {
  fontLink: string
  faviconLink: string
  cssVars: string
} {
  const font = p.brandFontFamily ? FONT_LINKS[p.brandFontFamily] : undefined
  const fontFamily = font?.family || "'Inter', system-ui, sans-serif"
  const fontLink = font
    ? `<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="${escAttr(font.href)}" rel="stylesheet">`
    : `<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">`

  const faviconLink = p.brandFaviconUrl
    ? `<link rel="icon" href="${escAttr(p.brandFaviconUrl)}">`
    : ''

  const primary = (p.brandPrimaryColor && /^#[0-9a-f]{6}$/i.test(p.brandPrimaryColor)) ? p.brandPrimaryColor : '#1a73e8'
  const primaryDark = darken(primary, 0.15)
  const primaryFg = contrastColorFor(primary)
  const radius = RADIUS_MAP[p.brandRadiusScale || ''] || RADIUS_MAP.medium

  const cssVars = `:root{
  --primary:${primary};
  --primary-dark:${primaryDark};
  --primary-fg:${primaryFg};
  --font-base:${fontFamily};
  --radius-card:${radius.card};
  --radius:${radius.card};
  --radius-input:${radius.input};
  --radius-button:${radius.button};
}
html,body{font-family:var(--font-base)}
.btn-primary,button.btn-primary{color:var(--primary-fg) !important}`

  return { fontLink, faviconLink, cssVars }
}

// Renderiza header com logo (se houver) — usado na página do vestibular.
export function renderBrandHeader(p: PortalBrandFields, fallbackTitle: string, fallbackSubtitle: string): string {
  if (p.brandLogoUrl) {
    const link = p.brandLogoLink
    const img = `<img src="${escAttr(p.brandLogoUrl)}" alt="${escAttr(fallbackTitle)}" style="max-height:60px;max-width:240px;width:auto;height:auto;display:block;margin:0 auto">`
    const wrapped = link ? `<a href="${escAttr(link)}" target="_blank" rel="noopener" style="display:inline-block">${img}</a>` : img
    return `<div class="portal-header" style="text-align:center;margin-bottom:18px;padding:14px 0">${wrapped}</div>`
  }
  return `<div class="portal-header">
    <h1 class="portal-title">${escAttr(fallbackTitle)}</h1>
    <div class="portal-subtitle">${escAttr(fallbackSubtitle)}</div>
  </div>`
}

// Banner/hero opcional renderizado entre header e formulário.
// Se brandHeroEnabled for false, retorna string vazia (admin desligou).
export function renderBrandHero(p: PortalBrandFields): string {
  if (p.brandHeroEnabled === false) return ''
  const hasContent = p.brandHeroUrl || p.brandHeroTitle || p.brandHeroSubtitle
  if (!hasContent) return ''

  const overlay = Math.max(0, Math.min(80, p.brandHeroOverlayOpacity ?? 35)) / 100
  const bgImage = p.brandHeroUrl
    ? `linear-gradient(rgba(0,0,0,${overlay}),rgba(0,0,0,${overlay})), url('${escAttr(p.brandHeroUrl)}')`
    : `linear-gradient(135deg, var(--primary), var(--primary-dark))`
  const title = p.brandHeroTitle ? escAttr(p.brandHeroTitle) : ''
  const subtitle = p.brandHeroSubtitle ? escAttr(p.brandHeroSubtitle) : ''

  return `<section class="portal-hero" style="background:${bgImage};background-size:cover;background-position:center;color:#fff;border-radius:var(--radius-card);padding:clamp(36px,7vw,72px) clamp(20px,4vw,40px);text-align:center;margin-bottom:24px;text-shadow:0 2px 8px rgba(0,0,0,.3)">
    ${title ? `<h1 style="font-size:clamp(1.5rem,4vw,2.5rem);font-weight:700;margin:0 0 10px">${title}</h1>` : ''}
    ${subtitle ? `<p style="font-size:clamp(.95rem,1.6vw,1.15rem);max-width:640px;margin:0 auto;opacity:.96;line-height:1.5">${subtitle}</p>` : ''}
  </section>`
}

// Footer dinâmico. Aceita Markdown leve: **bold**, [link](url) e quebra de linha.
export function renderBrandFooter(p: PortalBrandFields, fallback: string): string {
  const raw = (p.brandFooterText || '').trim()
  if (!raw) return `<div class="portal-footer">${escAttr(fallback)}</div>`
  const escaped = escAttr(raw)
    .replace(/\n/g, '<br>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, txt, url) => {
      const u = String(url).trim()
      // Só permite http(s) e mailto
      if (!/^(https?:|mailto:)/i.test(u)) return txt
      return `<a href="${escAttr(u)}" target="_blank" rel="noopener">${txt}</a>`
    })
  return `<div class="portal-footer" style="margin-top:30px;padding:20px 16px;text-align:center;font-size:12px;color:var(--muted);line-height:1.6">${escaped}</div>`
}
