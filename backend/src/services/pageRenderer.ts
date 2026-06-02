// src/services/pageRenderer.ts
// Engine de renderização de Landing Pages — JSON → HTML limpo, semântico, SEO-first
// Produz HTML puro sem dependência de frameworks JS

import sanitizeHtml from 'sanitize-html'

// Sanitização permissiva para conteúdo rich-text (renderText, FAQ, columns, custom HTML section)
const RICH_HTML_OPTS: sanitizeHtml.IOptions = {
  allowedTags: [
    'h1','h2','h3','h4','h5','h6','p','a','ul','ol','li','b','i','strong','em','u','s','br','hr',
    'blockquote','code','pre','span','div','img','figure','figcaption','table','thead','tbody','tr','th','td',
    'sup','sub','small','mark','del','ins','video','source','iframe'
  ],
  allowedAttributes: {
    '*': ['class','style','id','title','lang','dir'],
    a: ['href','name','target','rel'],
    img: ['src','alt','width','height','loading','srcset','sizes'],
    video: ['src','controls','poster','width','height','preload','playsinline','muted'],
    source: ['src','type'],
    iframe: ['src','width','height','frameborder','allow','allowfullscreen','loading'],
    table: ['border','cellpadding','cellspacing']
  },
  allowedSchemes: ['http','https','mailto','tel'],
  allowedSchemesByTag: { img: ['http','https','data'] },
  allowedIframeHostnames: ['www.youtube.com','youtube.com','player.vimeo.com','www.google.com'],
  disallowedTagsMode: 'discard',
  transformTags: {
    a: (tagName, attribs) => ({ tagName, attribs: { ...attribs, rel: 'noopener noreferrer nofollow' } })
  }
}

// Sanitização rigorosa para customHead (apenas meta/link/style/script tags seguras)
const HEAD_HTML_OPTS: sanitizeHtml.IOptions = {
  allowedTags: ['meta','link','style','title','script','noscript'],
  allowedAttributes: {
    meta: ['name','content','property','charset','http-equiv'],
    link: ['rel','href','type','crossorigin','integrity','sizes','as','media'],
    style: ['type','media'],
    script: ['src','type','async','defer','crossorigin','integrity','nonce'],
    title: []
  },
  allowedSchemes: ['http','https'],
  allowedSchemesByTag: {},
  disallowedTagsMode: 'discard'
}

/** Conteúdo "escapado" (&lt;p&gt;) que deveria ser HTML → decodifica antes de renderizar.
 *  Só decodifica quando parece escapado E não há tags cruas, pra não destruir HTML real.
 *  Espelha components/ui/RichText.tsx#decodeIfEscaped do frontend (corrige dados entity-encoded). */
function decodeIfEscaped(str: string): string {
  if (!/&lt;|&gt;/.test(str) || /<[a-z!/]/i.test(str)) return str
  return str
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&#x27;|&apos;/gi, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
}

function sanitizeRich(str: string | null | undefined): string {
  if (!str) return ''
  return sanitizeHtml(decodeIfEscaped(str), RICH_HTML_OPTS)
}

function sanitizeHead(str: string | null | undefined): string {
  if (!str) return ''
  return sanitizeHtml(str, HEAD_HTML_OPTS)
}

// CSS precisa neutralizar vetores: url(javascript:...), expression(), @import externo, </style>
function sanitizeCss(str: string | null | undefined): string {
  if (!str) return ''
  return String(str)
    .replace(/<\/\s*style\s*>/gi, '')
    .replace(/expression\s*\(/gi, '')
    .replace(/javascript\s*:/gi, '')
    .replace(/vbscript\s*:/gi, '')
    .replace(/@import[^;]*;?/gi, '')
    .replace(/behavior\s*:/gi, '')
    .slice(0, 50000)
}

interface PageSection {
  id: string
  type: string
  visible: boolean
  props: Record<string, any>
  style?: Record<string, string>
}

interface PageData {
  slug: string
  title: string
  metaTitle?: string | null
  metaDescription?: string | null
  ogImage?: string | null
  favicon?: string | null
  sections: any
  globalStyles?: any
  customCss?: string | null
  customHead?: string | null
  trackingEnabled?: boolean
  formId?: number | null
}

interface RenderOptions {
  preview?: boolean
  baseUrl?: string
  // Modo editor: embrulha cada seção com data-lp-section-id, injeta overlay de
  // seleção (hover/click → postMessage ao parent) e torna a página inerte
  // (links/forms não navegam). Usado pelo canvas ao vivo do editor dedicado.
  edit?: boolean
}

// ─── Escape HTML ─────────────────────────────────
function esc(str: string | null | undefined): string {
  if (!str) return ''
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function raw(str: string | null | undefined): string {
  return str || ''
}

// ─── CSS Generator ───────────────────────────────
function generateCSS(gs: any): string {
  const s = gs || {}
  // Resolução com fallback. Mantenha sincronizado com `getDefaultStyles()` em
  // `routes/pages.ts` e com o painel `LandingAppearancePanel.tsx` no frontend.
  const primary           = s.primaryColor       || '#1a73e8'
  const secondary         = s.secondaryColor     || '#202124'
  const accent            = s.accentColor        || '#34a853'
  const bg                = s.backgroundColor    || '#ffffff'
  const textColor         = s.textColor          || '#202124'
  const textMuted         = s.textMuted          || '#5f6368'
  const headingColor      = s.headingColor       || textColor
  const linkColor         = s.linkColor          || primary
  const linkHoverColor    = s.linkHoverColor     || primary
  const borderColor       = s.borderColor        || '#e5e7eb'
  const cardBg            = s.cardBgColor        || '#ffffff'
  const cardBorder        = s.cardBorderColor    || borderColor

  const buttonBg          = s.buttonBgColor      || primary
  const buttonText        = s.buttonTextColor    || '#ffffff'
  const buttonHoverBg     = s.buttonHoverBgColor || ''
  const buttonRadius      = s.buttonRadius       || s.borderRadius || '8px'
  const buttonPadding     = s.buttonPadding      || '14px 32px'
  const buttonFontWeight  = s.buttonFontWeight   || '600'
  const buttonFontSize    = s.buttonFontSize     || '16px'

  const fontFamily        = s.fontFamily         || "'Inter', 'Segoe UI', system-ui, -apple-system, sans-serif"
  const headingFontFamily = s.headingFontFamily  || fontFamily
  const fontSizeBase      = s.fontSizeBase       || '16px'
  const fontSizeH1        = s.fontSizeH1         || 'clamp(28px, 5vw, 48px)'
  const fontSizeH2        = s.fontSizeH2         || 'clamp(24px, 4vw, 36px)'
  const fontSizeH3        = s.fontSizeH3         || 'clamp(20px, 3vw, 28px)'
  const fontWeightHeading = s.fontWeightHeading  || '800'
  const lineHeightBody    = s.lineHeightBody     || '1.6'
  const lineHeightHeading = s.lineHeightHeading  || '1.15'

  const borderRadius      = s.borderRadius       || '8px'
  const maxWidth          = s.maxWidth           || '1140px'
  const sectionPaddingY   = s.sectionPaddingY    || '64px'
  const containerPaddingX = s.containerPaddingX  || '24px'
  const sectionPadMobile  = s.sectionPaddingMobile || '40px'

  return `
:root {
  --primary: ${primary};
  --secondary: ${secondary};
  --accent: ${accent};
  --bg: ${bg};
  --text: ${textColor};
  --text-muted: ${textMuted};
  --heading: ${headingColor};
  --link: ${linkColor};
  --link-hover: ${linkHoverColor};
  --border: ${borderColor};
  --card-bg: ${cardBg};
  --card-border: ${cardBorder};
  --btn-bg: ${buttonBg};
  --btn-text: ${buttonText};
  --btn-hover-bg: ${buttonHoverBg || buttonBg};
  --btn-radius: ${buttonRadius};
  --btn-padding: ${buttonPadding};
  --btn-weight: ${buttonFontWeight};
  --btn-size: ${buttonFontSize};
  --font: ${fontFamily};
  --font-heading: ${headingFontFamily};
  --fs-base: ${fontSizeBase};
  --fs-h1: ${fontSizeH1};
  --fs-h2: ${fontSizeH2};
  --fs-h3: ${fontSizeH3};
  --fw-heading: ${fontWeightHeading};
  --lh-body: ${lineHeightBody};
  --lh-heading: ${lineHeightHeading};
  --radius: ${borderRadius};
  --max-w: ${maxWidth};
  --section-py: ${sectionPaddingY};
  --container-px: ${containerPaddingX};
}

*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

html { scroll-behavior: smooth; -webkit-text-size-adjust: 100%; font-size: var(--fs-base); }

body {
  font-family: var(--font);
  color: var(--text);
  background: var(--bg);
  line-height: var(--lh-body);
  -webkit-font-smoothing: antialiased;
  overflow-x: hidden;
}

h1, h2, h3, h4, h5, h6 {
  font-family: var(--font-heading);
  font-weight: var(--fw-heading);
  line-height: var(--lh-heading);
  color: var(--heading);
}

img { max-width: 100%; height: auto; display: block; }
a { color: var(--link); text-decoration: none; }
a:hover { color: var(--link-hover); text-decoration: underline; }

.container { width: 100%; max-width: var(--max-w); margin: 0 auto; padding: 0 var(--container-px); }

/* ── Section base ── */
.lp-section { padding: var(--section-py) 0; }
/* Tira o respiro do topo apenas da PRIMEIRA seção real da página (hero colado no topo).
   Usa main > :first-child para não atingir cada seção envolvida em wrapper de anim/estilo/editor. */
main > *:first-child.lp-section,
main > *:first-child .lp-section { padding-top: 0; }

@media (max-width: 768px) {
  .lp-section { padding: ${sectionPadMobile} 0; }
  .container { padding: 0 16px; }
}

/* ── Hero ── */
.lp-hero {
  padding: 80px 0;
  text-align: center;
  position: relative;
  overflow: hidden;
}
.lp-hero--bg {
  background-size: cover;
  background-position: center;
  color: #fff;
}
.lp-hero--bg::before {
  content: '';
  position: absolute;
  inset: 0;
  background: rgba(0,0,0,0.5);
}
.lp-hero--bg .container { position: relative; z-index: 1; }
.lp-hero__badge {
  display: inline-block;
  padding: 6px 16px;
  background: var(--primary);
  color: #fff;
  border-radius: 20px;
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 20px;
}
.lp-hero h1 {
  font-size: var(--fs-h1);
  font-weight: var(--fw-heading);
  line-height: var(--lh-heading);
  margin-bottom: 16px;
  letter-spacing: -0.02em;
}
.lp-hero__sub {
  font-size: clamp(16px, 2.5vw, 20px);
  color: var(--text-muted);
  max-width: 640px;
  margin: 0 auto 32px;
  line-height: 1.5;
}
.lp-hero--bg .lp-hero__sub { color: rgba(255,255,255,0.85); }
.lp-hero__cta { display: flex; flex-wrap: wrap; gap: 14px; margin-top: 4px; }

/* Hero variação: split (texto + imagem) */
.lp-hero--split { text-align: left; }
.lp-hero__split { display: grid; grid-template-columns: 1.05fr 1fr; gap: 48px; align-items: center; }
.lp-hero--split .lp-hero__sub { max-width: 540px; margin-left: 0; margin-right: 0; }
.lp-hero--split .lp-hero__media img { width: 100%; border-radius: 18px; box-shadow: 0 30px 60px -22px rgba(15,23,42,0.35); }
@media (max-width: 768px) {
  .lp-hero__split { grid-template-columns: 1fr; gap: 28px; }
  .lp-hero--split, .lp-hero--split .lp-hero__col { text-align: center; }
  .lp-hero--split .lp-hero__cta { justify-content: center; }
  .lp-hero--split .lp-hero__sub { margin-left: auto; margin-right: auto; }
}

/* Hero variação: gradiente/mesh */
.lp-hero--gradient { background: linear-gradient(135deg, var(--hg-from), var(--hg-to)); color: #fff; position: relative; }
.lp-hero--gradient::after { content: ''; position: absolute; inset: 0; background: radial-gradient(60% 75% at 50% -10%, rgba(255,255,255,0.20), transparent 60%); pointer-events: none; }
.lp-hero--gradient .container { position: relative; z-index: 1; }
.lp-hero--gradient h1 { color: #fff; }
.lp-hero--gradient .lp-hero__sub { color: rgba(255,255,255,0.88); }
.lp-hero--gradient .lp-hero__badge { background: rgba(255,255,255,0.18); -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px); }

/* Logos — marquee (rolagem infinita "as seen on") */
.lp-logos__marquee { overflow: hidden; margin-top: 28px; -webkit-mask-image: linear-gradient(90deg, transparent, #000 8%, #000 92%, transparent); mask-image: linear-gradient(90deg, transparent, #000 8%, #000 92%, transparent); }
.lp-logos__track { display: inline-flex; align-items: center; gap: 56px; padding: 8px 28px; animation: lp-marquee 28s linear infinite; will-change: transform; }
.lp-logos__track img { height: 40px; width: auto; object-fit: contain; opacity: 0.65; filter: grayscale(1); transition: opacity 0.2s, filter 0.2s; }
.lp-logos__track img:hover { opacity: 1; filter: none; }
@keyframes lp-marquee { from { transform: translateX(0); } to { transform: translateX(-50%); } }
@media (prefers-reduced-motion: reduce) { .lp-logos__track { animation: none; } }

/* Sticky CTA bar */
.lp-sticky-cta { position: fixed; left: 0; right: 0; z-index: 1000; background: var(--secondary); color: #fff; box-shadow: 0 -6px 24px rgba(0,0,0,0.18); }
.lp-sticky-cta--bottom { bottom: 0; }
.lp-sticky-cta--top { top: 0; box-shadow: 0 6px 24px rgba(0,0,0,0.18); }
.lp-sticky-cta__inner { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 12px 0; }
.lp-sticky-cta__text { font-weight: 600; font-size: 15px; }
.lp-sticky-cta .btn { white-space: nowrap; }
@media (max-width: 600px) { .lp-sticky-cta__inner { flex-direction: column; gap: 8px; padding: 10px 0; } .lp-sticky-cta__text { font-size: 13px; text-align: center; } }

/* Bento grid */
.lp-bento { display: grid; grid-template-columns: repeat(3, 1fr); gap: 18px; margin-top: 40px; grid-auto-flow: dense; }
.lp-bento__card { background: var(--card-bg); border: 1px solid var(--card-border); border-radius: 18px; padding: 28px; transition: transform 0.2s, box-shadow 0.2s; min-height: 160px; }
.lp-bento__card:hover { transform: translateY(-3px); box-shadow: 0 16px 40px -16px rgba(15,23,42,0.25); }
.lp-bento__icon { font-size: 30px; margin-bottom: 14px; }
.lp-bento__card h3 { font-size: 19px; font-weight: 700; margin-bottom: 8px; }
.lp-bento__card p { color: var(--text-muted); font-size: 14px; line-height: 1.6; }
@media (max-width: 860px) { .lp-bento { grid-template-columns: repeat(2, 1fr); } .lp-bento__card { grid-column: auto !important; grid-row: auto !important; } }
@media (max-width: 560px) { .lp-bento { grid-template-columns: 1fr; } }

/* Before/After comparador */
.lp-ba { position: relative; max-width: 760px; margin: 32px auto 0; border-radius: 16px; overflow: hidden; line-height: 0; user-select: none; touch-action: none; }
.lp-ba__img { display: block; width: 100%; height: auto; }
.lp-ba__before-img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.lp-ba__handle { position: absolute; top: 0; bottom: 0; width: 3px; background: #fff; transform: translateX(-50%); box-shadow: 0 0 0 1px rgba(0,0,0,0.12); pointer-events: none; }
.lp-ba__handle::after { content: ''; position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 40px; height: 40px; border-radius: 50%; background: #fff; box-shadow: 0 2px 10px rgba(0,0,0,0.28); }
.lp-ba__range { position: absolute; inset: 0; width: 100%; height: 100%; margin: 0; opacity: 0; cursor: ew-resize; }
.lp-ba__label { position: absolute; bottom: 14px; padding: 5px 11px; border-radius: 999px; background: rgba(0,0,0,0.6); color: #fff; font: 600 12px/1 system-ui, sans-serif; }
.lp-ba__label--before { left: 14px; }
.lp-ba__label--after { right: 14px; }

/* Navbar */
.lp-nav { background: rgba(255,255,255,0.82); -webkit-backdrop-filter: saturate(180%) blur(12px); backdrop-filter: saturate(180%) blur(12px); border-bottom: 1px solid var(--border); z-index: 900; }
.lp-nav--sticky { position: sticky; top: 0; }
.lp-nav__inner { display: flex; align-items: center; gap: 24px; padding: 12px 0; }
.lp-nav__brand { display: inline-flex; align-items: center; gap: 8px; font-weight: 800; font-size: 18px; color: var(--heading); text-decoration: none; }
.lp-nav__brand:hover { text-decoration: none; }
.lp-nav__logo { height: 32px; width: auto; }
.lp-nav__links { display: flex; align-items: center; gap: 22px; }
.lp-nav__links a { color: var(--text); font-size: 14px; font-weight: 500; text-decoration: none; }
.lp-nav__links a:hover { color: var(--primary); text-decoration: none; }
.lp-nav__cta { margin-left: auto; padding: 9px 18px; font-size: 14px; }
@media (max-width: 760px) { .lp-nav__links { display: none; } }

/* ── Buttons ── */
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: var(--btn-padding);
  font-size: var(--btn-size);
  font-weight: var(--btn-weight);
  border-radius: var(--btn-radius);
  border: none;
  cursor: pointer;
  transition: transform 0.15s, box-shadow 0.15s, background 0.15s;
  font-family: var(--font);
  text-decoration: none;
  line-height: 1;
}
.btn:hover { transform: translateY(-1px); box-shadow: 0 4px 12px rgba(0,0,0,0.15); text-decoration: none; }
.btn:active { transform: translateY(0); }
.btn--primary { background: var(--btn-bg); color: var(--btn-text); box-shadow: 0 6px 18px -6px color-mix(in srgb, var(--btn-bg) 70%, transparent); }
.btn--primary:hover { background: var(--btn-hover-bg); color: var(--btn-text); box-shadow: 0 12px 26px -6px color-mix(in srgb, var(--btn-bg) 60%, transparent); }
.btn--outline { background: transparent; border: 2px solid var(--btn-bg); color: var(--btn-bg); }
.btn--outline:hover { background: var(--btn-bg); color: var(--btn-text); }
.btn--large { padding: 18px 40px; font-size: 18px; }

/* ── Features ── */
.lp-features__grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 32px;
  margin-top: 40px;
}
.lp-feature-card {
  padding: 32px;
  background: var(--card-bg);
  border: 1px solid var(--card-border);
  border-radius: 16px;
  transition: box-shadow 0.2s, transform 0.2s;
}
.lp-feature-card:hover { box-shadow: 0 16px 40px -16px rgba(15,23,42,0.18); transform: translateY(-3px); }
.lp-feature-card__icon {
  width: 48px;
  height: 48px;
  border-radius: 12px;
  background: color-mix(in srgb, var(--primary) 10%, transparent);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 24px;
  margin-bottom: 16px;
}
.lp-feature-card h3 {
  font-size: 18px;
  font-weight: 700;
  margin-bottom: 8px;
}
.lp-feature-card p { color: var(--text-muted); font-size: 14px; line-height: 1.6; }

/* ── Section headings ── */
.lp-section__heading {
  text-align: center;
  max-width: 640px;
  margin: 0 auto;
}
.lp-section__heading h2 {
  font-size: clamp(24px, 4vw, 36px);
  font-weight: 800;
  line-height: 1.2;
  margin-bottom: 12px;
}
.lp-section__heading p {
  color: var(--text-muted);
  font-size: 16px;
}

/* ── Testimonials ── */
.lp-testimonials__grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: 24px;
  margin-top: 40px;
}
.lp-testimonial {
  background: #fff;
  border: 1px solid #e8eaed;
  border-radius: 12px;
  padding: 28px;
}
.lp-testimonial__text {
  font-size: 15px;
  line-height: 1.7;
  color: var(--text);
  margin-bottom: 20px;
  font-style: italic;
}
.lp-testimonial__author {
  display: flex;
  align-items: center;
  gap: 12px;
}
.lp-testimonial__avatar {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  background: color-mix(in srgb, var(--primary) 15%, transparent);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  font-weight: 700;
  color: var(--primary);
}
.lp-testimonial__name { font-weight: 600; font-size: 14px; }
.lp-testimonial__role { font-size: 12px; color: var(--text-muted); }

/* ── CTA ── */
.lp-cta {
  background: var(--primary);
  color: #fff;
  text-align: center;
  padding: 64px 0;
  border-radius: 0;
}
.lp-cta h2 { font-size: clamp(24px, 4vw, 36px); font-weight: 800; margin-bottom: 12px; }
.lp-cta p { font-size: 16px; opacity: 0.9; margin-bottom: 32px; max-width: 540px; margin-left: auto; margin-right: auto; }
.lp-cta .btn--primary { background: #fff; color: var(--primary); }

/* ── Text / Content ── */
.lp-text { font-size: 16px; line-height: 1.8; }
.lp-text h2 { font-size: 28px; font-weight: 700; margin-bottom: 16px; }
.lp-text p + p { margin-top: 16px; }
.lp-text ul, .lp-text ol { padding-left: 24px; margin: 16px 0; }
.lp-text li { margin-bottom: 8px; }

/* ── FAQ ── */
.lp-faq__list { max-width: 720px; margin: 40px auto 0; }
.lp-faq__item { border-bottom: 1px solid #e8eaed; }
.lp-faq__question {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 20px 0;
  font-size: 16px;
  font-weight: 600;
  cursor: pointer;
  background: none;
  border: none;
  width: 100%;
  text-align: left;
  color: var(--text);
  font-family: var(--font);
}
.lp-faq__question::after { content: '+'; font-size: 22px; color: var(--text-muted); transition: transform 0.2s; }
.lp-faq__item.open .lp-faq__question::after { content: '−'; }
.lp-faq__answer {
  max-height: 0;
  overflow: hidden;
  transition: max-height 0.3s ease, padding 0.3s;
  font-size: 15px;
  color: var(--text-muted);
  line-height: 1.7;
}
.lp-faq__item.open .lp-faq__answer { max-height: 500px; padding-bottom: 20px; }

/* ── Form ── */
.lp-form-section { background: #f8f9fa; }
.lp-form-wrap {
  max-width: 540px;
  margin: 32px auto 0;
  background: #fff;
  border: 1px solid #e8eaed;
  border-radius: 12px;
  padding: 32px;
}
.lp-field { margin-bottom: 18px; }
.lp-field label {
  display: block;
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
  margin-bottom: 6px;
}
.lp-field input, .lp-field select, .lp-field textarea {
  width: 100%;
  padding: 12px 16px;
  border: 1px solid #dadce0;
  border-radius: var(--radius);
  font-size: 15px;
  font-family: var(--font);
  color: var(--text);
  background: #fff;
  transition: border-color 0.2s;
  outline: none;
}
.lp-field input:focus, .lp-field select:focus, .lp-field textarea:focus {
  border-color: var(--primary);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--primary) 15%, transparent);
}
.lp-field textarea { min-height: 100px; resize: vertical; }
.lp-field .lp-field__error { font-size: 12px; color: #c5221f; margin-top: 4px; display: none; }
.lp-field.has-error input, .lp-field.has-error select, .lp-field.has-error textarea { border-color: #c5221f; }
.lp-field.has-error .lp-field__error { display: block; }
.lp-form__success {
  text-align: center;
  padding: 40px 20px;
  display: none;
}
.lp-form__success h3 { font-size: 22px; font-weight: 700; color: var(--accent); margin-bottom: 8px; }
.lp-form__success p { color: var(--text-muted); }

/* ── Video ── */
.lp-video__wrap {
  max-width: 800px;
  margin: 32px auto 0;
  border-radius: 12px;
  overflow: hidden;
  position: relative;
  padding-bottom: 56.25%;
  height: 0;
}
.lp-video__wrap iframe {
  position: absolute;
  top: 0; left: 0;
  width: 100%; height: 100%;
  border: none;
}

/* ── Logos ── */
.lp-logos__grid {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  align-items: center;
  gap: 40px;
  margin-top: 32px;
  opacity: 0.6;
}
.lp-logos__grid img { height: 32px; object-fit: contain; filter: grayscale(100%); transition: filter 0.2s, opacity 0.2s; }
.lp-logos__grid img:hover { filter: grayscale(0); opacity: 1; }

/* ── Footer ── */
.lp-footer {
  padding: 32px 0;
  text-align: center;
  font-size: 13px;
  color: var(--text-muted);
  border-top: 1px solid #e8eaed;
}
.lp-footer a { color: var(--text-muted); }

/* ── Pricing ── */
.lp-pricing__grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 24px;
  margin-top: 40px;
}
.lp-pricing-card {
  background: #fff;
  border: 1px solid #e8eaed;
  border-radius: 12px;
  padding: 32px;
  text-align: center;
  position: relative;
  transition: box-shadow 0.2s;
}
.lp-pricing-card:hover { box-shadow: 0 8px 24px rgba(0,0,0,0.08); }
.lp-pricing-card--featured { border-color: var(--primary); box-shadow: 0 4px 16px rgba(26,115,232,0.15); }
.lp-pricing-card__badge {
  position: absolute;
  top: -12px;
  left: 50%;
  transform: translateX(-50%);
  background: var(--primary);
  color: #fff;
  padding: 4px 16px;
  border-radius: 12px;
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
}
.lp-pricing-card h3 { font-size: 20px; font-weight: 700; margin-bottom: 8px; }
.lp-pricing-card__price { font-size: 40px; font-weight: 800; color: var(--primary); margin: 12px 0; }
.lp-pricing-card__price span { font-size: 16px; font-weight: 400; color: var(--text-muted); }
.lp-pricing-card ul { list-style: none; text-align: left; margin: 20px 0; }
.lp-pricing-card li { padding: 8px 0; border-bottom: 1px solid #f1f3f4; font-size: 14px; color: var(--text); }
.lp-pricing-card li::before { content: '✓'; color: var(--accent); margin-right: 8px; font-weight: 700; }

/* ── Preview banner ── */
.preview-banner {
  position: fixed;
  top: 0; left: 0; right: 0;
  background: #fef7e0;
  color: #b06000;
  text-align: center;
  padding: 8px;
  font-size: 13px;
  font-weight: 600;
  z-index: 9999;
  border-bottom: 2px solid #f5c518;
}
.preview-banner ~ * { margin-top: 40px; }

/* ── Logo/Brand ── */
.lp-logo-section { text-align: center; }
.lp-logo-section img { max-height: 60px; display: inline-block; }

/* ── Spacer ── */
.lp-spacer { min-height: 24px; }

/* ── Divider ── */
.lp-divider hr {
  border: none;
  border-top: 1px solid #e8eaed;
  margin: 0 auto;
  max-width: var(--max-w);
}
.lp-divider--thick hr { border-top-width: 3px; }
.lp-divider--dotted hr { border-top-style: dotted; }
.lp-divider--dashed hr { border-top-style: dashed; }
.lp-divider--colored hr { border-top-color: var(--primary); }

/* ── Carousel (images + videos) ── */
.lp-carousel { position: relative; overflow: hidden; }
.lp-carousel__track {
  display: flex;
  gap: 16px;
  overflow-x: auto;
  scroll-snap-type: x mandatory;
  scrollbar-width: none;
  -webkit-overflow-scrolling: touch;
  scroll-behavior: smooth;
  padding-bottom: 8px;
}
.lp-carousel__track::-webkit-scrollbar { display: none; }
.lp-carousel__item {
  flex: 0 0 auto;
  scroll-snap-align: start;
  border-radius: 12px;
  overflow: hidden;
}
.lp-carousel__item img { width: 100%; height: 100%; object-fit: cover; display: block; }
.lp-carousel__nav {
  display: flex;
  justify-content: center;
  gap: 8px;
  margin-top: 16px;
}
.lp-carousel__btn {
  width: 40px; height: 40px;
  border-radius: 50%;
  border: 1px solid #e8eaed;
  background: #fff;
  color: var(--text);
  cursor: pointer;
  font-size: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background .15s, box-shadow .15s;
}
.lp-carousel__btn:hover { background: #f8f9fa; box-shadow: 0 2px 8px rgba(0,0,0,0.08); }

/* ── Map ── */
.lp-map__wrap {
  border-radius: 12px;
  overflow: hidden;
  margin-top: 24px;
}
.lp-map__wrap iframe { width: 100%; border: none; display: block; }

/* ── Stats / Numbers ── */
.lp-stats__grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 24px;
  margin-top: 40px;
  text-align: center;
}
.lp-stat__number {
  font-size: clamp(32px, 5vw, 52px);
  font-weight: 800;
  color: var(--primary);
  line-height: 1.1;
}
.lp-stat__label { font-size: 14px; color: var(--text-muted); margin-top: 6px; }

/* ── Countdown ── */
.lp-countdown__grid {
  display: flex;
  justify-content: center;
  gap: 16px;
  margin-top: 32px;
}
.lp-countdown__unit {
  background: var(--primary);
  color: #fff;
  border-radius: 12px;
  padding: 16px 20px;
  min-width: 80px;
  text-align: center;
}
.lp-countdown__val { font-size: 36px; font-weight: 800; line-height: 1; }
.lp-countdown__lbl { font-size: 11px; text-transform: uppercase; opacity: 0.8; margin-top: 4px; }

@media (max-width: 480px) {
  .lp-countdown__unit { min-width: 60px; padding: 12px 10px; }
  .lp-countdown__val { font-size: 24px; }
}

/* ── Gallery grid ── */
.lp-gallery__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 8px;
  margin-top: 32px;
}
.lp-gallery__grid img {
  width: 100%;
  aspect-ratio: 1;
  object-fit: cover;
  border-radius: 8px;
  transition: transform .2s, box-shadow .2s;
  cursor: pointer;
}
.lp-gallery__grid img:hover { transform: scale(1.03); box-shadow: 0 4px 16px rgba(0,0,0,0.12); }

/* ── Team ── */
.lp-team__grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 24px;
  margin-top: 40px;
  text-align: center;
}
.lp-team__member img {
  width: 100px; height: 100px;
  border-radius: 50%;
  object-fit: cover;
  margin: 0 auto 12px;
  border: 3px solid #e8eaed;
}
.lp-team__name { font-size: 16px; font-weight: 700; }
.lp-team__role { font-size: 13px; color: var(--text-muted); }
.lp-team__bio { font-size: 13px; color: var(--text-muted); margin-top: 6px; line-height: 1.5; }

/* ── Contact info ── */
.lp-contact__grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 20px;
  margin-top: 32px;
}
.lp-contact__item {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  padding: 20px;
  background: #fff;
  border: 1px solid #e8eaed;
  border-radius: 10px;
}
.lp-contact__icon {
  width: 40px; height: 40px;
  border-radius: 10px;
  background: color-mix(in srgb, var(--primary) 10%, transparent);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  flex-shrink: 0;
}
.lp-contact__label { font-size: 12px; color: var(--text-muted); }
.lp-contact__value { font-size: 14px; font-weight: 600; color: var(--text); margin-top: 2px; }

/* ── Social links ── */
.lp-social__links {
  display: flex;
  justify-content: center;
  gap: 12px;
  margin-top: 24px;
}
.lp-social__link {
  width: 44px; height: 44px;
  border-radius: 50%;
  background: #f1f3f4;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 20px;
  color: var(--text);
  text-decoration: none;
  transition: background .15s, transform .15s;
}
.lp-social__link:hover { background: var(--primary); color: #fff; transform: scale(1.1); text-decoration: none; }

/* ── Banner / Notification bar ── */
.lp-banner {
  padding: 12px 0;
  text-align: center;
  font-size: 14px;
  font-weight: 600;
}
`
}

// ─── Google Fonts loader ──────────────────────────
// Aceita 2 formatos no campo `gs.googleFonts`:
//   1) Sintaxe pipe (legível): "Inter:400,600,800|Poppins:400,700"
//   2) URL completa: "https://fonts.googleapis.com/css2?..." (passa direto)
// Se vazio, mantém o default da plataforma (Inter) — não quebra páginas
// existentes que sempre usaram Inter implicitamente.
function buildGoogleFontsLink(gs: any): string {
  const raw = String((gs?.googleFonts ?? '')).trim()

  // URL completa: confiamos e injetamos como está (mas validamos o domínio)
  if (raw.startsWith('http')) {
    if (raw.startsWith('https://fonts.googleapis.com/')) {
      return `<link href="${raw.replace(/"/g, '&quot;')}" rel="stylesheet">`
    }
    return '' // URL não-Google ignorada por segurança
  }

  // Default Inter quando vazio
  if (!raw) {
    return `<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">`
  }

  // Sintaxe pipe → converte pra css2?family=...
  const families = raw.split('|').map((part) => {
    const [name, weights] = part.split(':')
    const cleanName = (name || '').trim().replace(/\s+/g, '+')
    if (!cleanName) return ''
    const wList = (weights || '400').split(',').map((w) => w.trim()).filter((w) => /^[1-9]\d{2}$/.test(w))
    return `family=${cleanName}${wList.length > 0 ? `:wght@${wList.join(';')}` : ''}`
  }).filter(Boolean)
  if (families.length === 0) return ''
  return `<link href="https://fonts.googleapis.com/css2?${families.join('&')}&display=swap" rel="stylesheet">`
}

// ─── Section Renderers ───────────────────────────

// Helper: build inline style string from object of possible css props
function is(obj: Record<string, string | undefined | null>): string {
  const parts = Object.entries(obj).filter(([,v]) => v).map(([k,v]) => `${k.replace(/[A-Z]/g, m => '-' + m.toLowerCase())}:${v}`)
  return parts.length ? ` style="${parts.join(';')}"` : ''
}

function renderHero(p: any): string {
  const variant = p.variant || (p.backgroundImage ? 'image' : 'centered')
  const align = p.alignment || 'center'
  const ctaJustify = align === 'center' ? 'center' : align === 'right' ? 'flex-end' : 'flex-start'

  const badge = p.badge ? `<span class="lp-hero__badge"${is({ background: p.badgeBg, color: p.badgeColor, 'font-size': p.badgeSize })}>${esc(p.badge)}</span>` : ''
  const h1 = `<h1${is({ color: p.headlineColor, 'font-size': p.headlineSize, 'font-weight': p.headlineWeight, 'letter-spacing': p.headlineSpacing })}>${esc(p.headline)}</h1>`
  const sub = p.subheadline ? `<p class="lp-hero__sub"${is({ color: p.subColor, 'font-size': p.subSize, 'max-width': p.subMaxWidth })}>${esc(p.subheadline)}</p>` : ''
  const cta1 = p.ctaText ? `<a href="${esc(p.ctaLink || '#form')}" class="btn btn--primary btn--large"${is({ background: p.btnBg, color: p.btnColor, 'border-radius': p.btnRadius, 'font-size': p.btnSize, padding: p.btnPadding })}>${esc(p.ctaText)}</a>` : ''
  const cta2 = p.secondaryCtaText ? `<a href="${esc(p.secondaryCtaLink || '#')}" class="btn btn--outline"${is({ 'border-color': p.btn2Border, color: p.btn2Color })}>${esc(p.secondaryCtaText)}</a>` : ''
  const ctas = (cta1 || cta2) ? `<div class="lp-hero__cta" style="justify-content:${ctaJustify}">${cta1}${cta2}</div>` : ''
  const inner = `${badge}${h1}${sub}${ctas}`

  if (variant === 'split') {
    const img = p.image || p.backgroundImage || ''
    const colAlign = align === 'center' ? 'left' : align
    return `
<section class="lp-section lp-hero lp-hero--split">
  <div class="container lp-hero__split">
    <div class="lp-hero__col" style="text-align:${colAlign}">${inner}</div>
    ${img ? `<div class="lp-hero__media"><img src="${esc(img)}" alt="${esc(p.imageAlt || '')}" loading="eager"></div>` : ''}
  </div>
</section>`
  }

  if (variant === 'gradient') {
    const from = p.gradientFrom || 'var(--primary)'
    const to = p.gradientTo || 'var(--secondary)'
    return `
<section class="lp-section lp-hero lp-hero--gradient" style="--hg-from:${esc(from)};--hg-to:${esc(to)}">
  <div class="container" style="text-align:${align}">${inner}</div>
</section>`
  }

  const hasBg = variant === 'image' && !!p.backgroundImage
  return `
<section class="lp-section lp-hero${hasBg ? ' lp-hero--bg' : ''}"${hasBg ? ` style="background-image:url('${esc(p.backgroundImage)}')"` : ''}>
  <div class="container" style="text-align:${align}">${inner}</div>
</section>`
}

function renderFeatures(p: any): string {
  const items: any[] = p.items || []
  return `
<section class="lp-section" id="${p.anchorId || ''}">
  <div class="container">
    <div class="lp-section__heading">
      ${p.heading ? `<h2${is({ color: p.headingColor, 'font-size': p.headingSize })}>${esc(p.heading)}</h2>` : ''}
      ${p.subheading ? `<p${is({ color: p.subColor })}>${esc(p.subheading)}</p>` : ''}
    </div>
    <div class="lp-features__grid"${is({ gap: p.gridGap })}>
      ${items.map(f => `
      <article class="lp-feature-card"${is({ background: p.cardBg, 'border-color': p.cardBorder, 'border-radius': p.cardRadius })}>
        <div class="lp-feature-card__icon"${is({ background: p.iconBg, color: p.iconColor, 'font-size': p.iconSize })}>${sanitizeRich(f.icon || '✦')}</div>
        <h3${is({ color: p.titleColor, 'font-size': p.titleSize })}>${esc(f.title)}</h3>
        <p${is({ color: p.descColor })}>${esc(f.description)}</p>
      </article>`).join('')}
    </div>
  </div>
</section>`
}

function renderTestimonials(p: any): string {
  const items: any[] = p.items || []
  return `
<section class="lp-section">
  <div class="container">
    <div class="lp-section__heading">
      ${p.heading ? `<h2${is({ color: p.headingColor, 'font-size': p.headingSize })}>${esc(p.heading)}</h2>` : ''}
      ${p.subheading ? `<p${is({ color: p.subColor })}>${esc(p.subheading)}</p>` : ''}
    </div>
    <div class="lp-testimonials__grid">
      ${items.map(t => `
      <article class="lp-testimonial"${is({ background: p.cardBg, 'border-color': p.cardBorder, 'border-radius': p.cardRadius })}>
        <p class="lp-testimonial__text"${is({ color: p.quoteColor, 'font-size': p.quoteSize })}>"${esc(t.text)}"</p>
        <div class="lp-testimonial__author">
          <div class="lp-testimonial__avatar"${is({ background: p.avatarBg, color: p.avatarColor })}>${esc((t.name || '?')[0].toUpperCase())}</div>
          <div>
            <div class="lp-testimonial__name"${is({ color: p.nameColor })}>${esc(t.name)}</div>
            ${t.role ? `<div class="lp-testimonial__role"${is({ color: p.roleColor })}>${esc(t.role)}</div>` : ''}
          </div>
        </div>
      </article>`).join('')}
    </div>
  </div>
</section>`
}

function renderCta(p: any): string {
  return `
<section class="lp-section lp-cta"${is({ background: p.bgColor, 'border-radius': p.radius })}>
  <div class="container">
    <h2${is({ color: p.headingColor, 'font-size': p.headingSize })}>${esc(p.heading)}</h2>
    ${p.subheading ? `<p${is({ color: p.subColor, 'font-size': p.subSize })}>${esc(p.subheading)}</p>` : ''}
    ${p.ctaText ? `<a href="${esc(p.ctaLink || '#form')}" class="btn btn--primary btn--large"${is({ background: p.btnBg, color: p.btnColor, 'border-radius': p.btnRadius })}>${esc(p.ctaText)}</a>` : ''}
  </div>
</section>`
}

function renderText(p: any): string {
  return `
<section class="lp-section">
  <div class="container lp-text">
    ${p.heading ? `<h2>${esc(p.heading)}</h2>` : ''}
    ${sanitizeRich(p.content || '')}
  </div>
</section>`
}

function renderFaq(p: any): string {
  const items: any[] = p.items || []
  return `
<section class="lp-section">
  <div class="container">
    <div class="lp-section__heading">
      ${p.heading ? `<h2${is({ color: p.headingColor, 'font-size': p.headingSize })}>${esc(p.heading)}</h2>` : ''}
      ${p.subheading ? `<p${is({ color: p.subColor })}>${esc(p.subheading)}</p>` : ''}
    </div>
    <div class="lp-faq__list">
      ${items.map(f => `
      <div class="lp-faq__item"${is({ 'border-color': p.borderColor })}>
        <button class="lp-faq__question"${is({ color: p.questionColor, 'font-size': p.questionSize })} onclick="this.parentElement.classList.toggle('open')">${esc(f.question)}</button>
        <div class="lp-faq__answer"${is({ color: p.answerColor })}><p>${esc(f.answer)}</p></div>
      </div>`).join('')}
    </div>
  </div>
</section>`
}

function renderForm(p: any, formFields?: any[], formSettings?: any): string {
  const heading = p.heading || ''
  const sub = p.subheading || ''
  const formId = p.formId
  const fields: any[] = formFields || []
  const settings = formSettings || {}

  return `
<section class="lp-section lp-form-section" id="form"${is({ background: p.sectionBg })}>
  <div class="container">
    <div class="lp-section__heading">
      ${heading ? `<h2${is({ color: p.headingColor, 'font-size': p.headingSize })}>${esc(heading)}</h2>` : ''}
      ${sub ? `<p${is({ color: p.subColor })}>${esc(sub)}</p>` : ''}
    </div>
    <div class="lp-form-wrap"${is({ background: p.formBg, 'border-color': p.formBorder, 'border-radius': p.formRadius, 'box-shadow': p.formShadow })}>
      <form id="lp-form" novalidate onsubmit="return handleLPFormSubmit(event, ${formId})">
        ${fields.map(f => renderFormField(f)).join('')}
        <button type="submit" class="btn btn--primary"${is({ width: '100%', 'margin-top': '8px', background: p.btnBg, color: p.btnColor, 'border-radius': p.btnRadius, 'font-size': p.btnSize })}>${esc(settings.submitText || 'Enviar')}</button>
      </form>
      <div class="lp-form__success" id="lp-form-success">
        <h3>${esc(settings.successTitle || 'Enviado com sucesso!')}</h3>
        <p>${esc(settings.successMessage || 'Entraremos em contato em breve.')}</p>
      </div>
    </div>
  </div>
</section>`
}

function renderFormField(f: any): string {
  const req = f.required ? 'required' : ''
  const id = `f-${f.key}`

  if (f.type === 'select') {
    const options: any[] = f.options || []
    return `
    <div class="lp-field">
      <label for="${id}">${esc(f.label)}${f.required ? ' *' : ''}</label>
      <select id="${id}" name="${esc(f.key)}" ${req}>
        <option value="">${esc(f.placeholder || 'Selecione...')}</option>
        ${options.map(o => `<option value="${esc(o.value)}">${esc(o.label)}</option>`).join('')}
      </select>
      <div class="lp-field__error">Preencha este campo</div>
    </div>`
  }

  if (f.type === 'textarea') {
    return `
    <div class="lp-field">
      <label for="${id}">${esc(f.label)}${f.required ? ' *' : ''}</label>
      <textarea id="${id}" name="${esc(f.key)}" placeholder="${esc(f.placeholder || '')}" ${req}></textarea>
      <div class="lp-field__error">Preencha este campo</div>
    </div>`
  }

  if (f.type === 'checkbox') {
    return `
    <div class="lp-field" style="display:flex;align-items:flex-start;gap:10px">
      <input type="checkbox" id="${id}" name="${esc(f.key)}" ${req} style="width:auto;margin-top:3px">
      <label for="${id}" style="font-weight:400;font-size:14px">${esc(f.label)}</label>
    </div>`
  }

  if (f.type === 'hidden') {
    return `<input type="hidden" name="${esc(f.key)}" value="${esc(f.defaultValue || '')}">`
  }

  const inputType = f.type === 'phone' ? 'tel' : f.type === 'email' ? 'email' : 'text'
  return `
    <div class="lp-field">
      <label for="${id}">${esc(f.label)}${f.required ? ' *' : ''}</label>
      <input type="${inputType}" id="${id}" name="${esc(f.key)}" placeholder="${esc(f.placeholder || '')}" ${req}>
      <div class="lp-field__error">Preencha este campo</div>
    </div>`
}

function renderVideo(p: any): string {
  let embedUrl = ''
  const url = p.url || ''
  // YouTube
  const ytMatch = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]+)/)
  if (ytMatch) embedUrl = `https://www.youtube-nocookie.com/embed/${ytMatch[1]}`
  // Vimeo
  const vimeoMatch = url.match(/vimeo\.com\/(\d+)/)
  if (vimeoMatch) embedUrl = `https://player.vimeo.com/video/${vimeoMatch[1]}`

  return `
<section class="lp-section">
  <div class="container">
    <div class="lp-section__heading">
      ${p.heading ? `<h2>${esc(p.heading)}</h2>` : ''}
      ${p.subheading ? `<p>${esc(p.subheading)}</p>` : ''}
    </div>
    ${embedUrl ? `<div class="lp-video__wrap"><iframe src="${esc(embedUrl)}" loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope" allowfullscreen title="${esc(p.heading || 'Video')}"></iframe></div>` : ''}
  </div>
</section>`
}

function renderLogos(p: any): string {
  const items: any[] = p.items || []
  const variant = p.variant || 'grid'
  const heading = p.heading ? `<div class="lp-section__heading"><h2>${esc(p.heading)}</h2></div>` : ''
  if (variant === 'marquee' && items.length) {
    const row = items.map(l => `<img src="${esc(l.url)}" alt="${esc(l.alt || '')}" loading="lazy">`).join('')
    return `
<section class="lp-section">
  <div class="container">${heading}</div>
  <div class="lp-logos__marquee">
    <div class="lp-logos__track">${row}${row}</div>
  </div>
</section>`
  }
  return `
<section class="lp-section">
  <div class="container">
    ${heading}
    <div class="lp-logos__grid">
      ${items.map(l => `<img src="${esc(l.url)}" alt="${esc(l.alt || '')}" loading="lazy">`).join('')}
    </div>
  </div>
</section>`
}

function renderPricing(p: any): string {
  const items: any[] = p.items || []
  return `
<section class="lp-section"${p.anchorId ? ` id="${esc(p.anchorId)}"` : ''}>
  <div class="container">
    <div class="lp-section__heading">
      ${p.heading ? `<h2>${esc(p.heading)}</h2>` : ''}
      ${p.subheading ? `<p>${esc(p.subheading)}</p>` : ''}
    </div>
    <div class="lp-pricing__grid">
      ${items.map(item => `
      <div class="lp-pricing-card${item.featured ? ' lp-pricing-card--featured' : ''}"${is({ background: p.cardBg, 'border-radius': p.cardRadius })}>
        ${item.badge ? `<span class="lp-pricing-card__badge"${is({ background: p.badgeBg })}>${esc(item.badge)}</span>` : ''}
        <h3${is({ color: p.nameColor })}>${esc(item.name)}</h3>
        <div class="lp-pricing-card__price"${is({ color: p.priceColor })}>${esc(item.price)}<span>${item.period ? '/' + esc(item.period) : ''}</span></div>
        <ul>${(item.features || []).map((f: string) => `<li>${esc(f)}</li>`).join('')}</ul>
        ${item.ctaText ? `<a href="${esc(item.ctaLink || '#form')}" class="btn btn--primary"${is({ width: '100%', background: p.btnBg, color: p.btnColor, 'border-radius': p.btnRadius })}>${esc(item.ctaText)}</a>` : ''}
      </div>`).join('')}
    </div>
  </div>
</section>`
}

function renderFooter(p: any): string {
  return `
<footer class="lp-section lp-footer">
  <div class="container">
    <p>${esc(p.text || `© ${new Date().getFullYear()} Todos os direitos reservados.`)}</p>
    ${p.links ? `<p style="margin-top:8px">${(p.links as any[]).map(l => `<a href="${esc(l.url)}">${esc(l.label)}</a>`).join(' · ')}</p>` : ''}
  </div>
</footer>`
}

function renderImage(p: any): string {
  return `
<section class="lp-section">
  <div class="container" style="text-align:${p.alignment || 'center'}">
    ${p.heading ? `<div class="lp-section__heading"><h2>${esc(p.heading)}</h2></div>` : ''}
    <img src="${esc(p.url)}" alt="${esc(p.alt || '')}" style="max-width:${p.maxWidth || '100%'};margin:24px auto 0;border-radius:12px" loading="lazy">
    ${p.caption ? `<p style="margin-top:12px;font-size:13px;color:var(--text-muted)">${esc(p.caption)}</p>` : ''}
  </div>
</section>`
}

// ─── New section renderers ───────────────────────

function renderLogo(p: any): string {
  return `
<section class="lp-section lp-logo-section" style="padding:${p.padding || '24px'} 0">
  <div class="container" style="text-align:${p.alignment || 'center'}">
    ${p.url ? `<a href="${esc(p.link || '/')}"${p.link ? ' target="_blank"' : ''}><img src="${esc(p.url)}" alt="${esc(p.alt || 'Logo')}" style="max-height:${p.maxHeight || '60px'};display:inline-block"></a>` : `<div style="font-size:24px;font-weight:800;color:var(--primary)">${esc(p.text || 'Sua Marca')}</div>`}
  </div>
</section>`
}

function renderSpacer(p: any): string {
  const h = p.height || 48
  return `<div class="lp-spacer" style="height:${h}px" aria-hidden="true"></div>`
}

function renderDivider(p: any): string {
  const variant = p.variant || 'solid'
  const classes = ['lp-divider']
  if (variant === 'thick') classes.push('lp-divider--thick')
  if (variant === 'dotted') classes.push('lp-divider--dotted')
  if (variant === 'dashed') classes.push('lp-divider--dashed')
  if (p.colored) classes.push('lp-divider--colored')
  return `
<div class="${classes.join(' ')}" style="padding:${p.padding || '16px'} 0">
  <hr style="max-width:${p.width || '100%'}">
</div>`
}

function renderCarouselImages(p: any): string {
  const items: any[] = p.items || []
  const itemW = p.itemWidth || '320px'
  const itemH = p.itemHeight || '220px'
  const cfg: any = { spaceBetween: parseInt(p.gap) || 16 }
  if (p.autoplay) cfg.autoplay = { delay: parseInt(p.autoplayDelay) || 3500, disableOnInteraction: false }
  if (items.length > 2) cfg.loop = true
  return `
<section class="lp-section">
  <div class="container">
    ${p.heading ? `<div class="lp-section__heading"><h2>${esc(p.heading)}</h2></div>` : ''}
    ${p.subheading ? `<div class="lp-section__heading"><p>${esc(p.subheading)}</p></div>` : ''}
    <div class="swiper lp-swiper" data-swiper="${esc(JSON.stringify(cfg))}">
      <div class="swiper-wrapper">
        ${items.map(item => `
        <div class="swiper-slide" style="width:${itemW}">
          <img src="${esc(item.url)}" alt="${esc(item.alt || '')}" loading="lazy" style="width:${itemW};height:${itemH};object-fit:cover;border-radius:14px;display:block">
        </div>`).join('')}
      </div>
      ${items.length > 1 ? `<div class="swiper-button-prev"></div><div class="swiper-button-next"></div><div class="swiper-pagination"></div>` : ''}
    </div>
  </div>
</section>`
}

function renderCarouselVideos(p: any): string {
  const items: any[] = p.items || []

  function getEmbed(url: string): string {
    const yt = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]+)/)
    if (yt) return `https://www.youtube-nocookie.com/embed/${yt[1]}`
    const vm = url.match(/vimeo\.com\/(\d+)/)
    if (vm) return `https://player.vimeo.com/video/${vm[1]}`
    return ''
  }

  return `
<section class="lp-section">
  <div class="container">
    ${p.heading ? `<div class="lp-section__heading"><h2>${esc(p.heading)}</h2></div>` : ''}
    <div class="swiper lp-swiper" data-swiper="${esc(JSON.stringify({ spaceBetween: 16 }))}">
      <div class="swiper-wrapper">
        ${items.map(item => {
          const embed = getEmbed(item.url || '')
          return embed ? `
        <div class="swiper-slide" style="width:480px;max-width:90vw">
          <iframe src="${esc(embed)}" style="width:100%;aspect-ratio:16/9;border:none;border-radius:14px" loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope" allowfullscreen title="${esc(item.title || '')}"></iframe>
        </div>` : ''
        }).join('')}
      </div>
      ${items.length > 1 ? `<div class="swiper-button-prev"></div><div class="swiper-button-next"></div><div class="swiper-pagination"></div>` : ''}
    </div>
  </div>
</section>`
}

function renderMap(p: any): string {
  const address = p.address || ''
  const embedUrl = p.embedUrl || (address ? `https://maps.google.com/maps?q=${encodeURIComponent(address)}&output=embed` : '')
  const height = p.height || '400'
  return `
<section class="lp-section">
  <div class="container">
    ${p.heading ? `<div class="lp-section__heading"><h2>${esc(p.heading)}</h2></div>` : ''}
    ${p.subheading ? `<div class="lp-section__heading"><p>${esc(p.subheading)}</p></div>` : ''}
    ${embedUrl ? `<div class="lp-map__wrap"><iframe src="${esc(embedUrl)}" height="${height}" loading="lazy" referrerpolicy="no-referrer-when-downgrade" title="${esc(p.heading || 'Mapa')}"></iframe></div>` : '<p style="text-align:center;color:var(--text-muted);margin-top:24px">Configure o endereco ou URL de embed do mapa.</p>'}
  </div>
</section>`
}

function renderRawHtml(p: any): string {
  return `
<section class="lp-section">
  <div class="container">
    ${sanitizeRich(p.html || '<!-- Insira seu HTML aqui -->')}
  </div>
</section>`
}

function renderStats(p: any): string {
  const items: any[] = p.items || []
  return `
<section class="lp-section"${p.background ? ` style="background:${p.background};color:#fff"` : ''}>
  <div class="container">
    ${p.heading ? `<div class="lp-section__heading"><h2${is({ color: p.headingColor, 'font-size': p.headingSize })}>${esc(p.heading)}</h2></div>` : ''}
    <div class="lp-stats__grid"${is({ gap: p.gridGap })}>
      ${items.map(s => {
        // Contador animado: separa prefixo/dígitos/sufixo (ex.: "+1.200" , "98%").
        const raw = String(s.number ?? '')
        const m = raw.match(/^(\D*)([\d.,]+)(\D*)$/)
        let counterAttr = ''
        if (m) {
          const digits = m[2].replace(/[.,](?=\d{3}\b)/g, '').replace(/[.,]/g, '')
          const n = parseInt(digits, 10)
          if (!Number.isNaN(n) && n > 0) {
            counterAttr = ` data-counter="${n}" data-counter-prefix="${esc(m[1])}" data-counter-suffix="${esc(m[3])}"`
          }
        }
        return `
      <div>
        <div class="lp-stat__number"${is({ color: p.numberColor || (p.background ? '#fff' : undefined), 'font-size': p.numberSize })}${counterAttr}>${esc(raw)}</div>
        <div class="lp-stat__label"${is({ color: p.labelColor || (p.background ? 'rgba(255,255,255,0.8)' : undefined) })}>${esc(s.label)}</div>
      </div>`
      }).join('')}
    </div>
  </div>
</section>`
}

function renderCountdown(p: any): string {
  const target = p.targetDate || ''
  const id = 'cd_' + Math.random().toString(36).slice(2, 8)
  return `
<section class="lp-section">
  <div class="container" style="text-align:center">
    ${p.heading ? `<div class="lp-section__heading"><h2>${esc(p.heading)}</h2></div>` : ''}
    ${p.subheading ? `<p style="color:var(--text-muted);margin-bottom:8px">${esc(p.subheading)}</p>` : ''}
    <div class="lp-countdown__grid" id="${id}">
      <div class="lp-countdown__unit"><div class="lp-countdown__val" id="${id}_d">00</div><div class="lp-countdown__lbl">Dias</div></div>
      <div class="lp-countdown__unit"><div class="lp-countdown__val" id="${id}_h">00</div><div class="lp-countdown__lbl">Horas</div></div>
      <div class="lp-countdown__unit"><div class="lp-countdown__val" id="${id}_m">00</div><div class="lp-countdown__lbl">Min</div></div>
      <div class="lp-countdown__unit"><div class="lp-countdown__val" id="${id}_s">00</div><div class="lp-countdown__lbl">Seg</div></div>
    </div>
    ${p.ctaText ? `<a href="${esc(p.ctaLink || '#form')}" class="btn btn--primary btn--large" style="margin-top:32px">${esc(p.ctaText)}</a>` : ''}
  </div>
</section>
${target ? `<script>(function(){var t=new Date('${esc(target)}').getTime();function u(){var n=t-Date.now();if(n<0){document.getElementById('${id}').innerHTML='<div style="font-size:18px;font-weight:700;color:var(--primary)">Evento iniciado!</div>';return}var d=Math.floor(n/86400000),h=Math.floor((n%86400000)/3600000),m=Math.floor((n%3600000)/60000),s=Math.floor((n%60000)/1000);document.getElementById('${id}_d').textContent=String(d).padStart(2,'0');document.getElementById('${id}_h').textContent=String(h).padStart(2,'0');document.getElementById('${id}_m').textContent=String(m).padStart(2,'0');document.getElementById('${id}_s').textContent=String(s).padStart(2,'0')}u();setInterval(u,1000)})();</script>` : ''}`
}

function renderGallery(p: any): string {
  const items: any[] = p.items || []
  const cols = p.columns || 3
  return `
<section class="lp-section">
  <div class="container">
    ${p.heading ? `<div class="lp-section__heading"><h2>${esc(p.heading)}</h2></div>` : ''}
    <div class="lp-gallery__grid" style="grid-template-columns:repeat(${cols},1fr)">
      ${items.map(img => `<img src="${esc(img.url)}" alt="${esc(img.alt || '')}" loading="lazy">`).join('')}
    </div>
  </div>
</section>`
}

function renderTeam(p: any): string {
  const items: any[] = p.items || []
  return `
<section class="lp-section">
  <div class="container">
    <div class="lp-section__heading">
      ${p.heading ? `<h2>${esc(p.heading)}</h2>` : ''}
      ${p.subheading ? `<p>${esc(p.subheading)}</p>` : ''}
    </div>
    <div class="lp-team__grid">
      ${items.map(m => `
      <div class="lp-team__member">
        ${m.photo ? `<img src="${esc(m.photo)}" alt="${esc(m.name)}" loading="lazy">` : `<div style="width:100px;height:100px;border-radius:50%;background:color-mix(in srgb,var(--primary) 15%,transparent);margin:0 auto 12px;display:flex;align-items:center;justify-content:center;font-size:32px;font-weight:700;color:var(--primary)">${esc((m.name || '?')[0])}</div>`}
        <div class="lp-team__name">${esc(m.name)}</div>
        ${m.role ? `<div class="lp-team__role">${esc(m.role)}</div>` : ''}
        ${m.bio ? `<div class="lp-team__bio">${esc(m.bio)}</div>` : ''}
      </div>`).join('')}
    </div>
  </div>
</section>`
}

function renderContact(p: any): string {
  const items: any[] = p.items || []
  const iconMap: Record<string, string> = {
    phone: '📞', email: '✉️', whatsapp: '💬', address: '📍', hours: '🕐', site: '🌐'
  }
  return `
<section class="lp-section">
  <div class="container">
    <div class="lp-section__heading">
      ${p.heading ? `<h2>${esc(p.heading)}</h2>` : ''}
      ${p.subheading ? `<p>${esc(p.subheading)}</p>` : ''}
    </div>
    <div class="lp-contact__grid">
      ${items.map(c => `
      <div class="lp-contact__item">
        <div class="lp-contact__icon">${iconMap[c.type] || '📌'}</div>
        <div>
          <div class="lp-contact__label">${esc(c.label)}</div>
          <div class="lp-contact__value">${c.link ? `<a href="${esc(c.link)}">${esc(c.value)}</a>` : esc(c.value)}</div>
        </div>
      </div>`).join('')}
    </div>
  </div>
</section>`
}

function renderSocial(p: any): string {
  const items: any[] = p.items || []
  const iconMap: Record<string, string> = {
    instagram: '📸', facebook: '👤', linkedin: '💼', twitter: '🐦', youtube: '▶️', tiktok: '🎵', whatsapp: '💬', github: '💻', pinterest: '📌', telegram: '✈️'
  }
  return `
<section class="lp-section" style="padding:24px 0">
  <div class="container" style="text-align:center">
    ${p.heading ? `<div style="font-size:14px;font-weight:600;color:var(--text-muted);margin-bottom:12px">${esc(p.heading)}</div>` : ''}
    <div class="lp-social__links">
      ${items.map(s => `<a href="${esc(s.url)}" target="_blank" rel="noopener" class="lp-social__link" title="${esc(s.label || s.platform)}">${iconMap[s.platform] || '🔗'}</a>`).join('')}
    </div>
  </div>
</section>`
}

function renderBanner(p: any): string {
  const bg = p.backgroundColor || 'var(--primary)'
  const color = p.textColor || '#fff'
  return `
<div class="lp-banner" style="background:${bg};color:${color}">
  <div class="container">
    ${p.icon ? `<span style="margin-right:8px">${esc(p.icon)}</span>` : ''}${esc(p.text || '')}
    ${p.ctaText ? ` <a href="${esc(p.ctaLink || '#')}" style="color:${color};text-decoration:underline;font-weight:700;margin-left:8px">${esc(p.ctaText)}</a>` : ''}
  </div>
</div>`
}

function renderAccordion(p: any): string {
  const items: any[] = p.items || []
  return `
<section class="lp-section">
  <div class="container">
    <div class="lp-section__heading">
      ${p.heading ? `<h2>${esc(p.heading)}</h2>` : ''}
      ${p.subheading ? `<p>${esc(p.subheading)}</p>` : ''}
    </div>
    <div class="lp-faq__list">
      ${items.map(item => `
      <div class="lp-faq__item">
        <button class="lp-faq__question" onclick="this.parentElement.classList.toggle('open')">${esc(item.title)}</button>
        <div class="lp-faq__answer">${sanitizeRich(item.content || '')}</div>
      </div>`).join('')}
    </div>
  </div>
</section>`
}

function renderColumns(p: any): string {
  const cols: any[] = p.columns || []
  const gap = p.gap || '32px'
  return `
<section class="lp-section">
  <div class="container">
    ${p.heading ? `<div class="lp-section__heading"><h2>${esc(p.heading)}</h2></div>` : ''}
    <div style="display:grid;grid-template-columns:repeat(${cols.length || 2},1fr);gap:${gap};margin-top:${p.heading ? '32px' : '0'}">
      ${cols.map(col => `<div class="lp-text">${sanitizeRich(col.content || '')}</div>`).join('')}
    </div>
  </div>
</section>`
}

// ─── Section renderer map ────────────────────────
// ── Navbar (cabeçalho de navegação, opcionalmente fixo) ──
function renderNavbar(p: any): string {
  const links: any[] = p.links || []
  const brand = p.brandImage
    ? `<img src="${esc(p.brandImage)}" alt="${esc(p.brandText || '')}" class="lp-nav__logo">`
    : `<span class="lp-nav__brandtext">${esc(p.brandText || 'Marca')}</span>`
  return `
<header class="lp-nav${p.sticky === false ? '' : ' lp-nav--sticky'}"${is({ background: p.bgColor })}>
  <div class="container lp-nav__inner">
    <a href="${esc(p.brandLink || '#')}" class="lp-nav__brand">${brand}</a>
    <nav class="lp-nav__links">
      ${links.map(l => `<a href="${esc(l.href || '#')}">${esc(l.label || '')}</a>`).join('')}
    </nav>
    ${p.ctaText ? `<a href="${esc(p.ctaLink || '#form')}" class="btn btn--primary lp-nav__cta">${esc(p.ctaText)}</a>` : ''}
  </div>
</header>`
}

// ── Sticky CTA bar (barra de conversão fixa) ──
function renderStickyCta(p: any): string {
  const pos = p.position === 'top' ? 'top' : 'bottom'
  const style = is({ background: p.bgColor, color: p.textColor })
  return `
<div class="lp-sticky-cta lp-sticky-cta--${pos}"${style}>
  <div class="container lp-sticky-cta__inner">
    <span class="lp-sticky-cta__text">${esc(p.text || '')}</span>
    ${p.ctaText ? `<a href="${esc(p.ctaLink || '#form')}" class="btn btn--primary"${is({ background: p.btnBg, color: p.btnColor })}>${esc(p.ctaText)}</a>` : ''}
  </div>
</div>`
}

// ── Bento grid (cards assimétricos modernos) ──
function renderBento(p: any): string {
  const items: any[] = p.items || []
  return `
<section class="lp-section">
  <div class="container">
    ${p.heading ? `<div class="lp-section__heading"><h2>${esc(p.heading)}</h2>${p.subheading ? `<p>${esc(p.subheading)}</p>` : ''}</div>` : ''}
    <div class="lp-bento">
      ${items.map(it => `
      <div class="lp-bento__card"${is({ 'grid-column': it.span === '2' ? 'span 2' : undefined, 'grid-row': it.tall ? 'span 2' : undefined, background: it.bg, color: it.color })}>
        ${it.icon ? `<div class="lp-bento__icon">${esc(it.icon)}</div>` : ''}
        ${it.title ? `<h3>${esc(it.title)}</h3>` : ''}
        ${it.text ? `<p>${esc(it.text)}</p>` : ''}
      </div>`).join('')}
    </div>
  </div>
</section>`
}

// ── Before/After (comparador de imagens com handle arrastável) ──
function renderBeforeAfter(p: any): string {
  const before = esc(p.beforeUrl || '')
  const after = esc(p.afterUrl || '')
  return `
<section class="lp-section">
  <div class="container">
    ${p.heading ? `<div class="lp-section__heading"><h2>${esc(p.heading)}</h2></div>` : ''}
    <div class="lp-ba" data-ba style="--pos:50%">
      <img class="lp-ba__img" src="${after}" alt="${esc(p.afterLabel || 'Depois')}" loading="lazy">
      <img class="lp-ba__img lp-ba__before-img" src="${before}" alt="${esc(p.beforeLabel || 'Antes')}" loading="lazy" style="clip-path:inset(0 50% 0 0)">
      <div class="lp-ba__handle" style="left:50%"></div>
      <input type="range" class="lp-ba__range" min="0" max="100" value="50" aria-label="Comparar antes e depois">
      <span class="lp-ba__label lp-ba__label--before">${esc(p.beforeLabel || 'Antes')}</span>
      <span class="lp-ba__label lp-ba__label--after">${esc(p.afterLabel || 'Depois')}</span>
    </div>
  </div>
</section>`
}

const RENDERERS: Record<string, (p: any, formFields?: any[], formSettings?: any) => string> = {
  hero: renderHero,
  navbar: renderNavbar,
  sticky_cta: renderStickyCta,
  bento: renderBento,
  before_after: renderBeforeAfter,
  features: renderFeatures,
  testimonials: renderTestimonials,
  cta: renderCta,
  text: renderText,
  faq: renderFaq,
  form: renderForm,
  video: renderVideo,
  logos: renderLogos,
  pricing: renderPricing,
  footer: renderFooter,
  image: renderImage,
  logo: renderLogo,
  spacer: renderSpacer,
  divider: renderDivider,
  carousel_images: renderCarouselImages,
  carousel_videos: renderCarouselVideos,
  map: renderMap,
  raw_html: renderRawHtml,
  stats: renderStats,
  countdown: renderCountdown,
  gallery: renderGallery,
  team: renderTeam,
  contact: renderContact,
  social: renderSocial,
  banner: renderBanner,
  accordion: renderAccordion,
  columns: renderColumns,
  scheduling: renderScheduling,
}

// Bloco de Agendamento: incorpora a página pública de um tipo de reunião (/agendar/:slug)
// num iframe. O slug é configurado no editor da landing. Same-origin → URL relativa.
function renderScheduling(p: any): string {
  const slug = (p.slug || '').trim()
  const height = Number(p.height) > 0 ? Number(p.height) : 760
  return `
<section class="lp-section">
  <div class="container">
    ${p.heading ? `<div class="lp-section__heading"><h2>${esc(p.heading)}</h2></div>` : ''}
    ${p.subheading ? `<div class="lp-section__heading"><p>${esc(p.subheading)}</p></div>` : ''}
    ${slug
      ? `<div class="lp-scheduling__wrap" style="max-width:820px;margin:0 auto"><iframe src="/agendar/${encodeURIComponent(slug)}?embed=1" style="width:100%;height:${height}px;border:0;border-radius:14px;background:transparent" loading="lazy" title="${esc(p.heading || 'Agendar reuniao')}"></iframe></div>`
      : '<p style="text-align:center;color:var(--text-muted);margin-top:24px">Selecione um tipo de reuniao no painel do bloco para exibir a agenda.</p>'}
  </div>
</section>`
}

// ─── Form submit JS (inline, minimal) ────────────
function getFormScript(apiBase: string): string {
  return `
<script>
function handleLPFormSubmit(e, formId) {
  e.preventDefault();
  var form = e.target;
  var btn = form.querySelector('button[type="submit"]');
  var fields = form.querySelectorAll('input, select, textarea');
  var data = {};
  var valid = true;

  fields.forEach(function(f) {
    f.closest('.lp-field')?.classList.remove('has-error');
    if (f.type === 'checkbox') { data[f.name] = f.checked; }
    else if (f.name) { data[f.name] = f.value; }
    if (f.required && !f.value && f.type !== 'hidden') {
      f.closest('.lp-field')?.classList.add('has-error');
      valid = false;
    }
  });

  if (!valid) return false;

  btn.disabled = true;
  btn.textContent = 'Enviando...';

  var payload = { data: data };
  if (typeof BT !== 'undefined' && BT.getVisitorId) payload.bt_vid = BT.getVisitorId();
  try { payload.pageSlug = location.pathname.replace('/p/', ''); } catch(ex) {}
  try {
    var sp = new URL(location.href).searchParams;
    if (sp.get('utm_source')) payload.utmSource = sp.get('utm_source');
    if (sp.get('utm_medium')) payload.utmMedium = sp.get('utm_medium');
    if (sp.get('utm_campaign')) payload.utmCampaign = sp.get('utm_campaign');
  } catch(ex) {}

  fetch('${apiBase}/api/forms/submit/' + formId, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  }).then(function(r) { return r.json(); }).then(function(res) {
    if (res.ok) {
      form.style.display = 'none';
      document.getElementById('lp-form-success').style.display = 'block';
      if (typeof BT !== 'undefined') {
        // Identificar visitante com dados do form
        var identData = {};
        if (data.email) identData.email = data.email;
        if (data.whatsapp) identData.phone = data.whatsapp;
        if (data.telefone) identData.phone = data.telefone;
        if (data.phone) identData.phone = data.phone;
        if (data.nome) identData.name = data.nome;
        if (data.name) identData.name = data.name;
        if (Object.keys(identData).length > 0 && BT.identify) BT.identify(identData);
        if (BT.track) BT.track('form_conversion', { formId: formId });
      }
      if (res.redirect) window.location.href = res.redirect;
    } else {
      btn.disabled = false;
      btn.textContent = btn.dataset.original || 'Enviar';
      alert(res.error || 'Erro ao enviar. Tente novamente.');
    }
  }).catch(function() {
    btn.disabled = false;
    btn.textContent = btn.dataset.original || 'Enviar';
    alert('Erro de conexao. Tente novamente.');
  });

  return false;
}
</script>`
}

// ─── Main render function ────────────────────────

// ── Modo editor: estilos de seleção/hover do canvas ───────────────────
const LP_EDIT_CSS = `
.lp-edit-wrap{position:relative;cursor:pointer;outline:1px dashed transparent;outline-offset:-2px;transition:outline-color .12s ease}
.lp-edit-wrap:hover{outline-color:rgba(37,99,235,.55)}
.lp-edit-wrap.lp-sel{outline:2px solid #2563eb;outline-offset:-2px}
.lp-edit-wrap.lp-sel::before{content:attr(data-lp-section-type);position:absolute;top:0;left:0;z-index:99999;background:#2563eb;color:#fff;font:600 11px/1.2 system-ui,sans-serif;padding:3px 7px;border-radius:0 0 5px 0;pointer-events:none;text-transform:capitalize;letter-spacing:.02em}
.lp-edit-wrap.lp-empty{min-height:48px}
`

// Script (roda dentro do iframe) que faz a ponte de seleção com o editor.
const LP_EDIT_SCRIPT = `<script>(function(){
  function find(id){var a=document.querySelectorAll('[data-lp-section-id]');for(var i=0;i<a.length;i++){if(a[i].getAttribute('data-lp-section-id')===id)return a[i];}return null;}
  function clear(){var a=document.querySelectorAll('.lp-edit-wrap.lp-sel');for(var i=0;i<a.length;i++)a[i].classList.remove('lp-sel');}
  function select(id,scroll){clear();var el=find(id);if(el){el.classList.add('lp-sel');if(scroll)el.scrollIntoView({behavior:'smooth',block:'center'});}}
  document.addEventListener('click',function(e){var t=e.target;if(!t||!t.closest)return;var w=t.closest('[data-lp-section-id]');if(!w)return;e.preventDefault();e.stopPropagation();var id=w.getAttribute('data-lp-section-id');select(id,false);parent.postMessage({source:'lp-canvas',type:'select',id:id},'*');},true);
  document.addEventListener('submit',function(e){e.preventDefault();},true);
  window.addEventListener('message',function(e){var d=e.data||{};if(d.type==='lp-highlight'&&d.id){select(d.id,!!d.scroll);}});
  parent.postMessage({source:'lp-canvas',type:'ready'},'*');
})();</script>`

export function renderPage(
  page: PageData,
  options: RenderOptions = {},
  formFields?: any[],
  formSettings?: any
): string {
  const sections: PageSection[] = Array.isArray(page.sections) ? page.sections : []
  const gs = page.globalStyles || {}
  const baseUrl = options.baseUrl || ''

  const title = page.metaTitle || page.title
  const description = page.metaDescription || ''

  // Render visible sections
  const bodyHtml = sections
    .filter(s => s.visible !== false)
    .map(s => {
      const renderer = RENDERERS[s.type]
      if (!renderer) return `<!-- unknown section type: ${s.type} -->`

      // Per-section style wrapper
      const style = s.style || {}
      const styles: string[] = []

      // Background: solid, gradient or image
      if (style.gradient && style.gradientFrom && style.gradientTo) {
        const dir = style.gradientDirection || '135deg'
        styles.push(`background:linear-gradient(${dir},${style.gradientFrom},${style.gradientTo})`)
      } else if (style.backgroundImage) {
        styles.push(`background-image:url('${style.backgroundImage}')`)
        styles.push('background-size:cover')
        styles.push('background-position:center')
      } else if (style.backgroundColor) {
        styles.push(`background-color:${style.backgroundColor}`)
      }

      if (style.textColor) styles.push(`color:${style.textColor}`)
      if (style.padding) styles.push(`padding:${style.padding}`)
      if (style.paddingTop) styles.push(`padding-top:${style.paddingTop}`)
      if (style.paddingBottom) styles.push(`padding-bottom:${style.paddingBottom}`)
      if (style.borderRadius) styles.push(`border-radius:${style.borderRadius}`)
      if (style.borderTop) styles.push(`border-top:${style.borderTop}`)
      if (style.borderBottom) styles.push(`border-bottom:${style.borderBottom}`)
      if (style.maxWidth) styles.push(`max-width:${style.maxWidth};margin-left:auto;margin-right:auto`)
      if (style.textAlign) styles.push(`text-align:${style.textAlign}`)
      if (style.opacity) styles.push(`opacity:${style.opacity}`)
      if (style.overflow) styles.push(`overflow:${style.overflow}`)
      if (style.boxShadow) styles.push(`box-shadow:${style.boxShadow}`)

      // Overlay for background images
      const needsOverlay = style.backgroundImage && style.overlayColor

      const sectionStyle = styles.join(';')

      const html = s.type === 'form'
        ? renderer(s.props, formFields, formSettings)
        : renderer(s.props)

      let out: string
      if (needsOverlay) {
        out = `<div style="${sectionStyle};position:relative"><div style="position:absolute;inset:0;background:${style.overlayColor};pointer-events:none"></div><div style="position:relative">${html}</div></div>`
      } else {
        out = sectionStyle
          ? `<div style="${sectionStyle}">${html}</div>`
          : html
      }

      // Modo editor: cada seção vira um alvo selecionável pelo canvas.
      if (options.edit) {
        return `<div data-lp-section-id="${esc(s.id)}" data-lp-section-type="${esc(s.type)}" class="lp-edit-wrap">${out}</div>`
      }

      // Camada FX (só na página pública): animação de entrada + parallax.
      const an = style.animation && style.animation !== 'none' ? String(style.animation) : ''
      const ad = an && style.animDelay ? String(style.animDelay) : ''
      const ef = style.effect && style.effect !== 'none' ? String(style.effect) : ''
      const da: string[] = []
      if (an) da.push(`data-anim="${esc(an)}"`)
      if (ad) da.push(`data-anim-delay="${esc(ad)}"`)
      if (ef === 'parallax') da.push('data-parallax="16"')
      if (da.length) out = `<div ${da.join(' ')}>${out}</div>`
      return out
    })
    .join('\n')

  const hasForm = sections.some(s => s.type === 'form' && s.visible !== false)
  const ogUrl = `${baseUrl}/p/${page.slug}`

  // ── Camada FX: injeção condicional (só carrega o que a página usa) ──
  const visibleSecs = sections.filter(s => s.visible !== false)
  const needsAnim = visibleSecs.some(s => {
    const st: any = s.style || {}
    return (st.animation && st.animation !== 'none') || (st.effect && st.effect !== 'none') || s.type === 'stats'
  })
  const needsSwiper = visibleSecs.some(s => s.type === 'carousel_images' || s.type === 'carousel_videos')
  const needsBA = visibleSecs.some(s => s.type === 'before_after')
  const needsSmooth = gs.smoothScroll === true || gs.smoothScroll === 'true'
  const fxBase = `${baseUrl}/uploads/fx`
  const fxHead = needsSwiper ? `<link rel="stylesheet" href="${fxBase}/swiper-bundle.min.css">` : ''
  const fxScripts = (() => {
    const parts: string[] = []
    if (!options.edit && (needsAnim || needsSmooth)) {
      parts.push(`<script defer src="${fxBase}/gsap.min.js"></script>`)
      if (needsAnim) parts.push(`<script defer src="${fxBase}/ScrollTrigger.min.js"></script>`)
    }
    if (!options.edit && needsSmooth) {
      parts.push(`<script defer src="${fxBase}/lenis.min.js"></script>`)
      parts.push(`<script>window.__LP_SMOOTH__=true;</script>`)
    }
    if (needsSwiper) parts.push(`<script defer src="${fxBase}/swiper-bundle.min.js"></script>`)
    const anyFx = needsSwiper || needsBA || (!options.edit && (needsAnim || needsSmooth))
    if (anyFx) parts.push(`<script defer src="${fxBase}/lp-fx.js"></script>`)
    return parts.join('\n  ')
  })()

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)}</title>
  ${description ? `<meta name="description" content="${esc(description)}">` : ''}
  <meta name="robots" content="${options.preview ? 'noindex, nofollow' : 'index, follow'}">
  <link rel="canonical" href="${esc(ogUrl)}">

  <!-- Open Graph -->
  <meta property="og:type" content="website">
  <meta property="og:title" content="${esc(title)}">
  ${description ? `<meta property="og:description" content="${esc(description)}">` : ''}
  <meta property="og:url" content="${esc(ogUrl)}">
  ${page.ogImage ? `<meta property="og:image" content="${esc(page.ogImage)}">` : ''}

  <!-- Twitter -->
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${esc(title)}">
  ${description ? `<meta name="twitter:description" content="${esc(description)}">` : ''}

  ${page.favicon ? `<link rel="icon" href="${esc(page.favicon)}">` : ''}

  <!-- Fonts -->
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  ${buildGoogleFontsLink(gs)}

  <style>${generateCSS(gs)}</style>
  ${page.customCss ? `<style>${sanitizeCss(page.customCss)}</style>` : ''}
  ${options.edit ? `<style>${LP_EDIT_CSS}</style>` : ''}
  ${fxHead}

  <!-- JSON-LD -->
  <script type="application/ld+json">
  ${JSON.stringify({
    "@context": "https://schema.org",
    "@type": "WebPage",
    "name": title,
    "description": description,
    "url": ogUrl,
  })}
  </script>

  ${sanitizeHead(page.customHead)}
</head>
<body>
  ${options.preview ? '<div class="preview-banner">PREVIEW — Esta pagina nao esta publicada</div>' : ''}

  <main>
    ${bodyHtml}
  </main>

  ${hasForm ? getFormScript(baseUrl) : ''}

  ${page.trackingEnabled && !options.preview ? `<script async src="${baseUrl}/api/t/bt.js"></script>` : ''}
  ${fxScripts}
  ${options.edit ? LP_EDIT_SCRIPT : ''}
</body>
</html>`
}

// ─── 404 Page ────────────────────────────────────

export function render404(): string {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Pagina nao encontrada</title>
  <meta name="robots" content="noindex">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap" rel="stylesheet">
  <style>
    body { font-family: 'Inter', sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; background: #f8f9fa; color: #202124; text-align: center; }
    h1 { font-size: 64px; font-weight: 800; color: #dadce0; margin-bottom: 8px; }
    p { font-size: 16px; color: #5f6368; }
    a { color: #1a73e8; font-weight: 600; }
  </style>
</head>
<body>
  <div>
    <h1>404</h1>
    <p>Pagina nao encontrada.</p>
  </div>
</body>
</html>`
}
