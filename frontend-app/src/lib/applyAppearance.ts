/**
 * Aplica as configurações de aparência ao DOM em runtime:
 *   - <title>, <meta name="description">, <meta name="robots">
 *   - favicon
 *   - cores, raios, fontes via CSS custom properties em :root
 *   - códigos externos do <head> e <body> (admin)
 *
 * Tokens CSS são sobrescritos no elemento <html> com `style.setProperty`,
 * o que permite ajuste em runtime sem rebuild. Um valor vazio remove o
 * override, voltando ao default do tokens.css.
 */

const HEAD_MARKER = 'data-bh-head-injected'
const BODY_MARKER = 'data-bh-body-injected'

type Cfg = Record<string, string>

/** Defaults legados do admin antigo (sempre claro). Se o valor salvo é igual
 * ao default, não sobrescrevemos os tokens do tema (dark/light) — só aplicamos
 * customizações explícitas do usuário. */
const LEGACY_LIGHT_DEFAULTS: Record<string, string> = {
  'appearance.primary_color': '#1a73e8',
  'appearance.primary_hover': '#1557b0',
  'appearance.secondary_color': '#5f6368',
  'appearance.success_color': '#34a853',
  'appearance.error_color': '#ea4335',
  'appearance.warning_color': '#fbbc04',
  'appearance.sidebar_bg': '#fff',
  'appearance.sidebar_text': '#5f6368',
  'appearance.sidebar_active_bg': '#e8f0fe',
  'appearance.sidebar_active_text': '#1a73e8',
  'appearance.topbar_bg': '#fff',
  'appearance.topbar_text': '#202124',
  'appearance.body_bg': '#f8f9fa',
  'appearance.card_bg': '#fff',
  'appearance.card_border': '#e0e0e0',
  'appearance.text_primary': '#202124',
  'appearance.text_secondary': '#5f6368',
  'appearance.border_radius': '8',
  'appearance.font_family': 'Inter, sans-serif',
}

function get(cfg: Cfg, key: string, fallback = ''): string {
  const v = cfg[key]
  return v && v.length > 0 ? v : fallback
}

/** Normaliza cor hex para comparação: lowercase + expande #abc → #aabbcc.
 * Sem isso, '#fff' (default) e '#ffffff' (salvo pelo ColorPicker) eram
 * tratados como cores diferentes — e a customização sobrescrevia o tema. */
function normalizeColor(s: string): string {
  const v = s.trim().toLowerCase()
  const m = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(v)
  return m ? `#${m[1]}${m[1]}${m[2]}${m[2]}${m[3]}${m[3]}` : v
}

/** Lê uma customização visual: retorna '' se o valor for igual ao default
 * (para preservar os tokens semânticos do dark/light theme). */
function getOverride(cfg: Cfg, key: string): string {
  const v = cfg[key]
  if (!v || v.length === 0) return ''
  const def = LEGACY_LIGHT_DEFAULTS[key]
  if (def && normalizeColor(v) === normalizeColor(def)) return ''
  return v
}

/** Tema atual resolvido. O store coloca data-theme="light" quando claro;
 * ausência de atributo = escuro (default). */
function isLightTheme(): boolean {
  return typeof document !== 'undefined'
    && document.documentElement.getAttribute('data-theme') === 'light'
}

function setMeta(name: string, content: string): void {
  if (!content) return
  let m = document.head.querySelector<HTMLMetaElement>(`meta[name="${name}"]`)
  if (!m) {
    m = document.createElement('meta')
    m.setAttribute('name', name)
    document.head.appendChild(m)
  }
  m.setAttribute('content', content)
}

function setVar(prop: string, value: string): void {
  const root = document.documentElement
  if (value && value.length > 0) {
    root.style.setProperty(prop, value)
  } else {
    root.style.removeProperty(prop)
  }
}

/** Famílias suportadas via Google Fonts (label do select → família).
 * "Inter" já vem pré-carregada no index.html, então não precisa injeção. */
const GOOGLE_FONT_FAMILIES = new Set([
  'Roboto',
  'Open Sans',
  'Nunito',
  'Lato',
  'Montserrat',
  'Poppins',
  'Source Sans Pro',
  'Raleway',
  'Work Sans',
  'IBM Plex Sans',
  'DM Sans',
  'Manrope',
  'Google Sans',
])

const FONT_LINK_MARKER = 'data-bh-font'

/** Injeta o <link> do Google Fonts para a família escolhida (se conhecida).
 * Idempotente: limpa links antigos antes. Família "Inter" / "Sistema" são no-ops. */
function loadFontFamily(fontFamily: string): void {
  // Limpa fontes injetadas anteriormente
  document.head.querySelectorAll(`link[${FONT_LINK_MARKER}]`).forEach((el) => el.remove())

  if (!fontFamily) return

  // Extrai a primeira família da declaração CSS (antes de ", sans-serif")
  const first = fontFamily.split(',')[0]?.trim().replace(/['"]/g, '') ?? ''
  if (!first) return
  if (!GOOGLE_FONT_FAMILIES.has(first)) return

  // "Google Sans" não é distribuída pelo Google Fonts público — fallback para Poppins,
  // que é o secundário declarado nessa família.
  const fontParam = first === 'Google Sans' ? 'Poppins' : first
  const familyParam = fontParam.replace(/\s+/g, '+')
  const href = `https://fonts.googleapis.com/css2?family=${familyParam}:wght@400;500;600;700&display=swap`

  const link = document.createElement('link')
  link.rel = 'stylesheet'
  link.href = href
  link.setAttribute(FONT_LINK_MARKER, '')
  document.head.appendChild(link)
}

function applySeo(cfg: Cfg): void {
  const title = get(cfg, 'appearance.admin_page_title')
  if (title) document.title = title

  const desc = get(cfg, 'appearance.admin_page_description')
  if (desc) setMeta('description', desc)

  const allowIndex = get(cfg, 'appearance.admin_robots_index', 'noindex') === 'index'
  setMeta('robots', allowIndex ? 'index, follow' : 'noindex, nofollow')
}

function applyFavicon(cfg: Cfg): void {
  const url = get(cfg, 'appearance.favicon_url')
  if (!url) return
  let link = document.head.querySelector<HTMLLinkElement>('link[rel~="icon"]')
  if (!link) {
    link = document.createElement('link')
    link.rel = 'icon'
    document.head.appendChild(link)
  }
  if (link.href !== url) link.href = url
}

/** Mapeia cores e tokens semânticos para CSS custom properties em :root.
 * Setting → variável CSS (uma cor pode alimentar várias vars relacionadas).
 * Usa getOverride para só aplicar customizações explícitas (não defaults). */
function applyTokens(cfg: Cfg): void {
  // ── Cores de marca / acento
  const primary = getOverride(cfg, 'appearance.primary_color')
  setVar('--color-accent', primary)
  setVar('--brand-500', primary)

  const primaryHover = getOverride(cfg, 'appearance.primary_hover')
  setVar('--color-accent-hover', primaryHover)
  setVar('--brand-400', primaryHover)

  const secondary = getOverride(cfg, 'appearance.secondary_color')
  setVar('--color-info', secondary)
  setVar('--info-500', secondary)

  const success = getOverride(cfg, 'appearance.success_color')
  setVar('--color-success', success)
  setVar('--success-500', success)

  const warning = getOverride(cfg, 'appearance.warning_color')
  setVar('--color-warning', warning)
  setVar('--warning-500', warning)

  const danger = getOverride(cfg, 'appearance.error_color')
  setVar('--color-danger', danger)
  setVar('--danger-500', danger)

  // ── Superfícies/textos: customizações do "Painel Admin" foram desenhadas
  // para o tema CLARO legado (Google-style). Aplicar essas cores no tema
  // escuro destrói o contraste (fundo branco + texto branco). Por isso, no
  // tema escuro mantemos os tokens semânticos do design system intactos.
  const lightOnly = isLightTheme()
  setVar('--color-surface', lightOnly ? getOverride(cfg, 'appearance.body_bg') : '')
  setVar('--color-surface-2', lightOnly ? getOverride(cfg, 'appearance.card_bg') : '')
  setVar('--color-border', lightOnly ? getOverride(cfg, 'appearance.card_border') : '')
  setVar('--color-fg', lightOnly ? getOverride(cfg, 'appearance.text_primary') : '')
  setVar('--color-fg-muted', lightOnly ? getOverride(cfg, 'appearance.text_secondary') : '')

  // ── Sidebar (vars dedicadas, com fallback aos tokens semânticos no shell.css)
  setVar('--app-sidebar-bg', lightOnly ? getOverride(cfg, 'appearance.sidebar_bg') : '')
  setVar('--app-sidebar-text', lightOnly ? getOverride(cfg, 'appearance.sidebar_text') : '')
  setVar('--app-sidebar-active-bg', lightOnly ? getOverride(cfg, 'appearance.sidebar_active_bg') : '')
  setVar('--app-sidebar-active-text', lightOnly ? getOverride(cfg, 'appearance.sidebar_active_text') : '')

  // ── Topbar
  setVar('--app-topbar-bg', lightOnly ? getOverride(cfg, 'appearance.topbar_bg') : '')
  setVar('--app-topbar-text', lightOnly ? getOverride(cfg, 'appearance.topbar_text') : '')

  // ── Tipografia & raio
  const radius = getOverride(cfg, 'appearance.border_radius')
  if (radius) {
    const px = `${Number.parseInt(radius, 10) || 8}px`
    setVar('--radius-md', px)
  } else {
    setVar('--radius-md', '')
  }

  const fontFamily = getOverride(cfg, 'appearance.font_family')
  setVar('--font-sans', fontFamily)
  loadFontFamily(fontFamily)
}

/**
 * Injeta um trecho HTML em `container`, removendo qualquer trecho
 * previamente injetado pela mesma configuração (marcador `marker`).
 * Re-cria tags <script> manualmente para que executem (innerHTML
 * de um node já renderizado não dispara scripts).
 */
function injectExternalCode(html: string, container: HTMLElement, marker: string): void {
  // Limpa injeções anteriores
  container.querySelectorAll(`[${marker}]`).forEach((el) => el.remove())

  const trimmed = html.trim()
  if (!trimmed) return

  const tpl = document.createElement('template')
  tpl.innerHTML = trimmed

  const nodes = Array.from(tpl.content.childNodes)
  for (const node of nodes) {
    if (node.nodeType === Node.COMMENT_NODE || node.nodeType === Node.TEXT_NODE) {
      // Comentários e text nodes podem ser apêndados como estão, marcando
      // o text node não funciona — então embrulhamos em um <span> oculto
      // só para conseguir limpar depois.
      if (node.nodeType === Node.TEXT_NODE && !(node.textContent ?? '').trim()) continue
      const wrapper = document.createElement('span')
      wrapper.style.display = 'none'
      wrapper.setAttribute(marker, '')
      wrapper.appendChild(node.cloneNode(true))
      container.appendChild(wrapper)
      continue
    }
    if (node.nodeType !== Node.ELEMENT_NODE) continue

    const el = node as Element
    if (el.tagName === 'SCRIPT') {
      const original = el as HTMLScriptElement
      const s = document.createElement('script')
      // copia atributos (src, async, type, crossorigin, etc.)
      for (const a of Array.from(original.attributes)) {
        s.setAttribute(a.name, a.value)
      }
      // copia conteúdo inline
      if (original.textContent) s.textContent = original.textContent
      s.setAttribute(marker, '')
      container.appendChild(s)
    } else {
      const clone = el.cloneNode(true) as Element
      clone.setAttribute(marker, '')
      container.appendChild(clone)
    }
  }
}

function applyCustomCode(cfg: Cfg): void {
  injectExternalCode(get(cfg, 'appearance.custom_head_code'), document.head, HEAD_MARKER)
  injectExternalCode(get(cfg, 'appearance.custom_body_code'), document.body, BODY_MARKER)
}

export function applyAppearance(cfg: Cfg): void {
  applySeo(cfg)
  applyFavicon(cfg)
  applyTokens(cfg)
  applyCustomCode(cfg)
}
