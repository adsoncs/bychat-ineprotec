// src/lib/qrRender.ts
// Desenha o QR em SVG a partir da matriz da lib `qrcode`, para dar o que o
// QRCode.toString não dá: módulos arredondados/pontos, cantos (olhos) com cor
// própria, logo no centro e moldura com chamada ("Escaneie aqui").
// O PNG é rasterizado no navegador a partir deste SVG — sem dependência nativa.

import QRCode from 'qrcode'

export type QrDotStyle = 'square' | 'rounded' | 'dots'
export type QrEyeStyle = 'square' | 'rounded' | 'circle'
export type QrEc = 'L' | 'M' | 'Q' | 'H'

export interface QrStyle {
  foreground?: string
  background?: string
  eyeColor?: string
  dotStyle?: QrDotStyle
  eyeStyle?: QrEyeStyle
  margin?: number
  errorCorrection?: QrEc
  logo?: string | null        // data URL (png/jpg/svg/webp)
  logoSize?: number           // fração do lado do QR (0.12 a 0.30)
  frameText?: string | null   // chamada embaixo do QR; vazio = sem moldura
  frameColor?: string
  frameTextColor?: string
}

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i
function hex(v: unknown, fallback: string): string {
  const s = String(v ?? '').trim()
  return HEX.test(s) ? s.toUpperCase() : fallback
}
function esc(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
}

const LOGO_RE = /^data:image\/(png|jpe?g|webp|gif|svg\+xml);base64,[a-z0-9+/=\s]+$/i
export const LOGO_MAX_CHARS = 400_000 // ~300 KB de imagem

/** Normaliza o estilo vindo do cliente — tudo que não for válido cai no padrão. */
export function sanitizeQrStyle(raw: any): Required<QrStyle> {
  const r = raw && typeof raw === 'object' ? raw : {}
  const logo = typeof r.logo === 'string' && r.logo.length <= LOGO_MAX_CHARS && LOGO_RE.test(r.logo) ? r.logo : null
  const fg = hex(r.foreground, '#000000')
  const dotStyle: QrDotStyle = (['square', 'rounded', 'dots'] as const).includes(r.dotStyle) ? r.dotStyle : 'square'
  let errorCorrection: QrEc = (['L', 'M', 'Q', 'H'] as const).includes(r.errorCorrection) ? r.errorCorrection : 'M'
  // Logo cobre módulos e pontos encolhem o desenho: abaixo disso o QR deixa de
  // ler em parte dos celulares (medido com leitor real, não estimado).
  if (logo) errorCorrection = 'H'
  else if (dotStyle === 'dots' && (errorCorrection === 'L' || errorCorrection === 'M')) errorCorrection = 'Q'
  return {
    foreground: fg,
    background: hex(r.background, '#FFFFFF'),
    eyeColor: hex(r.eyeColor, fg),
    dotStyle,
    eyeStyle: (['square', 'rounded', 'circle'] as const).includes(r.eyeStyle) ? r.eyeStyle : 'square',
    margin: Math.min(8, Math.max(0, Number.isFinite(Number(r.margin)) ? Math.round(Number(r.margin)) : 2)),
    errorCorrection,
    logo,
    logoSize: Math.min(0.3, Math.max(0.12, Number(r.logoSize) || 0.22)),
    frameText: typeof r.frameText === 'string' && r.frameText.trim() ? r.frameText.trim().slice(0, 40) : null,
    frameColor: hex(r.frameColor, fg),
    frameTextColor: hex(r.frameTextColor, '#FFFFFF'),
  }
}

/** SVG final do QR. `size` é só a largura declarada — o desenho é vetor. */
export function renderQrSvg(data: string, rawStyle: any, size = 512): string {
  const st = sanitizeQrStyle(rawStyle)
  const qr = QRCode.create(data, { errorCorrectionLevel: st.errorCorrection })
  const n = qr.modules.size
  const m = st.margin
  const total = n + m * 2

  // Área dos 3 olhos (7x7) — desenhados à parte.
  const eyes: Array<[number, number]> = [[0, 0], [n - 7, 0], [0, n - 7]]
  const inEye = (r: number, c: number) => eyes.some(([er, ec]) => r >= er && r < er + 7 && c >= ec && c < ec + 7)

  // Espaço livre para o logo (quadrado central, módulos inteiros).
  let logoBox: { x: number; s: number } | null = null
  if (st.logo) {
    let s = Math.round(n * st.logoSize)
    if ((n - s) % 2) s += 1
    logoBox = { x: (n - s) / 2, s }
  }
  const inLogo = (r: number, c: number) =>
    !!logoBox && r >= logoBox.x - 1 && r < logoBox.x + logoBox.s + 1 && c >= logoBox.x - 1 && c < logoBox.x + logoBox.s + 1

  const parts: string[] = []
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (!qr.modules.get(r, c) || inEye(r, c) || inLogo(r, c)) continue
      const x = c + m, y = r + m
      // Módulos encostados (sem folga): com espaço entre eles os leitores mais
      // simples perdem a linha de sincronia e o QR deixa de ler.
      // Linha/coluna 6 são a sincronia que o leitor usa para medir a grade:
      // ficam quadradas mesmo no estilo pontos.
      if (st.dotStyle === 'dots' && r !== 6 && c !== 6) parts.push(`<circle cx="${x + 0.5}" cy="${y + 0.5}" r="0.5"/>`)
      else if (st.dotStyle === 'dots') parts.push(`<rect x="${x}" y="${y}" width="1" height="1" rx="0.3"/>`)
      else if (st.dotStyle === 'rounded') parts.push(`<rect x="${x}" y="${y}" width="1" height="1" rx="0.3"/>`)
      else parts.push(`<rect x="${x}" y="${y}" width="1.02" height="1.02"/>`)
    }
  }

  const eyeSvg = eyes.map(([er, ec]) => {
    const x = ec + m, y = er + m
    if (st.eyeStyle === 'circle') {
      return `<circle cx="${x + 3.5}" cy="${y + 3.5}" r="3" fill="none" stroke="${st.eyeColor}" stroke-width="1"/>` +
        `<circle cx="${x + 3.5}" cy="${y + 3.5}" r="1.5" fill="${st.eyeColor}"/>`
    }
    const ro = st.eyeStyle === 'rounded' ? 1.6 : 0
    const ri = st.eyeStyle === 'rounded' ? 0.8 : 0
    return `<rect x="${x + 0.5}" y="${y + 0.5}" width="6" height="6" rx="${ro}" fill="none" stroke="${st.eyeColor}" stroke-width="1"/>` +
      `<rect x="${x + 2}" y="${y + 2}" width="3" height="3" rx="${ri}" fill="${st.eyeColor}"/>`
  }).join('')

  let logoSvg = ''
  if (logoBox && st.logo) {
    const lx = logoBox.x + m, ls = logoBox.s
    logoSvg = `<rect x="${lx - 0.5}" y="${lx - 0.5}" width="${ls + 1}" height="${ls + 1}" rx="1" fill="${st.background}"/>` +
      `<image href="${st.logo}" x="${lx}" y="${lx}" width="${ls}" height="${ls}" preserveAspectRatio="xMidYMid meet"/>`
  }

  // Moldura: faixa embaixo com a chamada, borda na cor da moldura.
  const frameH = st.frameText ? Math.max(5, Math.round(total * 0.16)) : 0
  const pad = st.frameText ? 1.2 : 0
  const W = total + pad * 2
  const H = total + pad * 2 + frameH
  const frame = st.frameText
    ? `<rect x="0" y="0" width="${W}" height="${H}" rx="2" fill="${st.frameColor}"/>` +
      `<rect x="${pad}" y="${pad}" width="${total}" height="${total}" rx="1" fill="${st.background}"/>` +
      `<text x="${W / 2}" y="${total + pad * 2 + frameH / 2}" fill="${st.frameTextColor}" font-family="Arial,Helvetica,sans-serif" font-weight="700" font-size="${(frameH * 0.42).toFixed(2)}" text-anchor="middle" dominant-baseline="central">${esc(st.frameText)}</text>`
    : `<rect width="${total}" height="${total}" fill="${st.background}"/>`

  const height = Math.round(size * (H / W))
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${size}" height="${height}" shape-rendering="${st.dotStyle === 'square' ? 'crispEdges' : 'geometricPrecision'}">` +
    frame +
    `<g transform="translate(${pad},${pad})"><g fill="${st.foreground}">${parts.join('')}</g>${eyeSvg}${logoSvg}</g>` +
    `</svg>`
}
