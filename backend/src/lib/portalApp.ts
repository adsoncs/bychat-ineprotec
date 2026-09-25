// src/lib/portalApp.ts
//
// Serve a aplicação do portal (portal-app/dist) com o <head> preenchido no
// servidor. A tela é uma aplicação, mas título, descrição, Open Graph e favicon
// precisam existir no HTML que chega ao robô do buscador e ao preview do
// WhatsApp — que não executam JavaScript.

import fs from 'fs'
import { renderPixels } from './portalPixels.js'
import path from 'path'
import { fileURLToPath } from 'url'

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
export const DIST_PORTAL = path.join(raiz, 'portal-app', 'dist')

export function portalAppDisponivel(): boolean {
  return fs.existsSync(path.join(DIST_PORTAL, 'index.html'))
}

const esc = (s: unknown): string =>
  String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string))

export interface CabecalhoPortal {
  nome: string
  metaTitle?: string | null
  metaDescription?: string | null
  ogImageUrl?: string | null
  brandFaviconUrl?: string | null
  brandPrimaryColor?: string | null
  customCss?: string | null
  /** Aba SEO do builder: GA4, GTM, Meta, TikTok, LinkedIn. */
  pixelConfig?: unknown
  customHeadJs?: string | null
  customBodyJs?: string | null
  slug: string
}

/**
 * Injeta o <head> no index.html do build. O marcador <!--HEAD--> é o único
 * ponto de costura: o resto do arquivo é o que o Vite gerou, com os hashes
 * dele — nada de reescrever caminho de asset na mão.
 */
export function paginaDoPortal(p: CabecalhoPortal, appUrl: string): string {
  const html = fs.readFileSync(path.join(DIST_PORTAL, 'index.html'), 'utf-8')
  const titulo = p.metaTitle || p.nome
  const descricao = p.metaDescription || `Faça sua inscrição em ${p.nome}.`
  const url = `${appUrl.replace(/\/$/, '')}/portal/${encodeURIComponent(p.slug)}`

  const head = [
    `<title>${esc(titulo)}</title>`,
    `<meta name="description" content="${esc(descricao)}">`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:title" content="${esc(titulo)}">`,
    `<meta property="og:description" content="${esc(descricao)}">`,
    `<meta property="og:url" content="${esc(url)}">`,
    p.ogImageUrl ? `<meta property="og:image" content="${esc(p.ogImageUrl)}">` : '',
    `<meta name="twitter:card" content="${p.ogImageUrl ? 'summary_large_image' : 'summary'}">`,
    p.brandFaviconUrl ? `<link rel="icon" href="${esc(p.brandFaviconUrl)}">` : '',
    p.brandPrimaryColor ? `<meta name="theme-color" content="${esc(p.brandPrimaryColor)}">` : '',
    `<link rel="canonical" href="${esc(url)}">`,
    // Instalável no celular: o manifesto e o service worker já existem no ERP.
    `<link rel="manifest" href="/portal/aca/manifest.webmanifest">`,
    `<meta name="apple-mobile-web-app-capable" content="yes">`,
    // A cor entra já no HTML para a primeira pintura não piscar no tom errado.
    p.brandPrimaryColor ? `<style>:root{--marca:${esc(p.brandPrimaryColor)}}</style>` : '',
    p.customCss ? `<style>${p.customCss}</style>` : '',
    // Pixels e JS próprio do <head>: são configurados no builder e valiam só na
    // tela clássica. Sem eles a instituição preenchia GA4/Meta/TikTok na aba SEO
    // e nada disparava — campanha rodando sem medição nenhuma.
    renderPixels(p.pixelConfig),
    p.customHeadJs ? `<script>${p.customHeadJs}</script>` : '',
  ].filter(Boolean).join('\n    ')

  // Fim do corpo: o tracking próprio (correlaciona visitante → lead no CRM) e o
  // JS que a instituição pediu para rodar depois da página montar.
  const fimDoCorpo = [
    `<script async src="/api/t/bt.js"></script>`,
    p.customBodyJs ? `<script>${p.customBodyJs}</script>` : '',
  ].filter(Boolean).join('\n    ')

  return html
    .replace('<!--HEAD-->', head)
    .replace('</body>', `    ${fimDoCorpo}\n  </body>`)
}
