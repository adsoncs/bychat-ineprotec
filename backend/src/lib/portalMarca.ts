// src/lib/portalMarca.ts
// A marca das telas de acesso do portal (/portal/login, /portal/senha…).
//
// O login é um só para todos os portais da instituição, mas quem chega nele
// veio de um portal — e precisa ver as cores, a fonte e o logo desse portal,
// não um tema genérico. A escolha segue esta ordem:
//   1. `?portal=<slug>` na URL (o botão "Entrar" de cada portal manda) ou o
//      portal que a própria página indicou (ex.: /candidato/:code);
//   2. quem está logado: o portal da inscrição mais recente dessa pessoa;
//   3. o cookie gravado na última visita com o parâmetro — assim o erro de
//      senha e o "receber link", que recarregam a página, não perdem a marca;
//   4. o primeiro portal ativo com marca configurada (cor principal);
//   5. o primeiro portal ativo.
// Sem portal nenhum, as telas ficam no tema padrão de antes.

import type { FastifyReply, FastifyRequest } from 'fastify'
import { prisma } from './prisma.js'
import { contaDaRequisicao } from './portalSession.js'

const COOKIE = 'portal_marca'

export interface MarcaDoAcesso {
  slug: string
  nome: string
  corPrincipal: string | null
  corApoio: string | null
  fonte: string | null
  raio: string | null
  logoUrl: string | null
  logoLink: string | null
  faviconUrl: string | null
  fundoDe: string | null
  fundoPara: string | null
  botaoFormato: string | null
  botaoCaixaAlta: boolean
  /** Campos brand* como estão no portal — o app do portal aplica com o mesmo código da inscrição. */
  bruto: Record<string, unknown>
}

const CAMPOS = {
  slug: true, nome: true, brandHeaderStyle: true, brandStepStyle: true, brandTypeScale: true, brandContentWidth: true, brandFooterText: true, brandPrimaryColor: true, brandSecondaryColor: true, brandFontFamily: true,
  brandRadiusScale: true, brandLogoUrl: true, brandLogoLink: true, brandFaviconUrl: true,
  brandBackdropFrom: true, brandBackdropTo: true, brandButtonShape: true, brandButtonUppercase: true,
} as const

function doCookie(req: FastifyRequest): string | null {
  for (const parte of String(req.headers.cookie || '').split(';')) {
    const [k, ...resto] = parte.trim().split('=')
    if (k === COOKIE) return decodeURIComponent(resto.join('='))
  }
  return null
}

const slugValido = (s: unknown): s is string => typeof s === 'string' && /^[a-z0-9-]{1,120}$/.test(s)

export async function marcaDoAcesso(req: FastifyRequest, reply?: FastifyReply, slugDaPagina?: string | null): Promise<MarcaDoAcesso | null> {
  const pedido = slugDaPagina || (req.query as any)?.portal
  const lembrado = doCookie(req)
  // Logado: a inscrição mais recente diz de qual portal a pessoa é.
  let daConta: string | null = null
  if (!slugValido(pedido)) {
    const conta = await contaDaRequisicao(req).catch(() => null)
    if (conta) {
      const r = await prisma.enrollmentRegistration.findFirst({
        where: { leadId: conta.leadId, portal: { active: true } },
        orderBy: { id: 'desc' },
        select: { portal: { select: { slug: true } } },
      }).catch(() => null)
      daConta = r?.portal?.slug ?? null
    }
  }
  let p: any = null
  for (const slug of [pedido, daConta, lembrado]) {
    if (!slugValido(slug)) continue
    p = await prisma.enrollmentPortal.findFirst({ where: { slug, active: true }, select: CAMPOS })
    if (p) {
      // Só grava quando veio pela URL: é a escolha explícita de quem clicou em
      // "Entrar" naquele portal. Cookie comum (não é credencial), 90 dias.
      if (slug === pedido && !slugDaPagina && reply) {
        reply.header('set-cookie', `${COOKIE}=${encodeURIComponent(slug)}; Path=/portal; Max-Age=${90 * 86400}; SameSite=Lax`)
      }
      break
    }
  }
  if (!p) {
    p = await prisma.enrollmentPortal.findFirst({ where: { active: true, brandPrimaryColor: { not: null } }, orderBy: { id: 'asc' }, select: CAMPOS })
      ?? await prisma.enrollmentPortal.findFirst({ where: { active: true }, orderBy: { id: 'asc' }, select: CAMPOS })
  }
  if (!p) return null
  return {
    slug: p.slug,
    nome: p.nome,
    corPrincipal: p.brandPrimaryColor,
    corApoio: p.brandSecondaryColor,
    fonte: p.brandFontFamily,
    raio: p.brandRadiusScale,
    logoUrl: p.brandLogoUrl,
    logoLink: p.brandLogoLink,
    faviconUrl: p.brandFaviconUrl,
    fundoDe: p.brandBackdropFrom,
    fundoPara: p.brandBackdropTo,
    botaoFormato: p.brandButtonShape,
    botaoCaixaAlta: !!p.brandButtonUppercase,
    bruto: p,
  }
}

const hex = (c: string | null | undefined): string | null => (c && /^#[0-9a-f]{6}$/i.test(c.trim()) ? c.trim() : null)
function contraste(c: string): string {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const v = parseInt(c.slice(i, i + 2), 16) / 255
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
  })
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b! > 0.45 ? '#16211f' : '#ffffff'
}
const escA = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string))
const FONTES_SSR: Record<string, { familia: string; href?: string }> = {
  inter: { familia: "'Inter', system-ui, sans-serif", href: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap' },
  roboto: { familia: "'Roboto', system-ui, sans-serif", href: 'https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700&display=swap' },
  poppins: { familia: "'Poppins', system-ui, sans-serif", href: 'https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700&display=swap' },
  system: { familia: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif' },
}
const RAIOS_SSR: Record<string, string> = { sharp: '2px', medium: '12px', rounded: '20px' }

/**
 * Camada de marca para páginas SSR que têm casca própria (portal do ERP,
 * negociação, candidato). Só sobrepõe: cor de botão e link, fonte, cantos,
 * fundo e logo — a estrutura de cada página continua a dela.
 */
export function camadaDeMarcaSsr(m: MarcaDoAcesso): { head: string; topo: string } {
  const cor = hex(m.corPrincipal)
  const apoio = hex(m.corApoio) ?? cor
  const fonte = FONTES_SSR[String(m.fonte ?? '')]
  const raio = RAIOS_SSR[String(m.raio ?? '')]
  const r: string[] = []
  if (cor) {
    r.push(`:root{--primary:${cor};--marca:${cor};--primary-fg:${contraste(cor)}}`)
    r.push(`button:not(.sec):not(.btn-secondary):not([class*="ghost"]),input[type=submit],.btn-primary{background:${cor}!important;color:${contraste(cor)}!important;border-color:${cor}!important}`)
    r.push(`a{color:${apoio}}.tabs a{color:${apoio}}`)
  }
  if (fonte) r.push(`body,input,button,select,textarea{font-family:${fonte.familia}!important}`)
  if (raio) r.push(`.card{border-radius:${raio}!important}`)
  if (m.botaoFormato === 'pill') r.push('button,input[type=submit]{border-radius:999px!important}')
  if (m.botaoCaixaAlta) r.push('button:not(.sec),input[type=submit]{text-transform:uppercase;letter-spacing:.05em}')
  const de = hex(m.fundoDe), para = hex(m.fundoPara)
  if (de && para) r.push(`body{background:linear-gradient(120deg,${de} 0%,#f5f7f5 45%,${para} 100%) fixed!important}`)
  r.push('.marca-portal{text-align:center;margin:0 0 16px}.marca-portal img{max-height:52px;max-width:220px;width:auto;height:auto}.marca-portal span{font-weight:650}')
  const head = [
    fonte?.href ? `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="${escA(fonte.href)}" rel="stylesheet">` : '',
    m.faviconUrl ? `<link rel="icon" href="${escA(m.faviconUrl)}">` : '',
    cor ? `<meta name="theme-color" content="${cor}">` : '',
    `<style data-marca-portal>${r.join('\n')}</style>`,
  ].join('')
  const img = m.logoUrl ? `<img src="${escA(m.logoUrl)}" alt="${escA(m.nome)}">` : `<span>${escA(m.nome)}</span>`
  const topo = `<div class="marca-portal">${m.logoUrl && m.logoLink ? `<a href="${escA(m.logoLink)}">${img}</a>` : img}</div>`
  return { head, topo }
}

/**
 * Gancho único: toda página HTML das áreas do portal que não montam a marca
 * sozinhas recebe a camada acima. Registrado no servidor antes das rotas.
 * A página pode indicar o próprio portal no header `x-portal-slug`.
 */
const AREAS_SSR = [/^\/portal\/aca\//, /^\/portal\/entrar/, /^\/candidato(\/|$|\?)/]
export function registrarMarcaSsr(app: { addHook: (n: 'onSend', h: (req: FastifyRequest, reply: FastifyReply, payload: unknown, done: (err: Error | null, p?: unknown) => void) => void) => unknown }): void {
  // Estilo callback, de propósito: este gancho roda em TODA requisição do
  // servidor. Assíncrono, ele atrasaria o envio de qualquer rota — e rota
  // async que chama reply.send() sem `return` passava a responder vazia.
  // Aqui só as páginas HTML das áreas do portal esperam pelo banco.
  app.addHook('onSend', (req, reply, payload, done) => {
    if (typeof payload !== 'string' || req.method !== 'GET'
      || !AREAS_SSR.some((re) => re.test(req.url))
      || !String(reply.getHeader('content-type') || '').includes('text/html')
      || payload.includes('data-marca-portal') || !payload.includes('</head>')) {
      done(null, payload)
      return
    }
    const hint = reply.getHeader('x-portal-slug')
    reply.removeHeader('x-portal-slug')
    marcaDoAcesso(req, undefined, hint ? String(hint) : null)
      .then((m) => {
        if (!m) return done(null, payload)
        const c = camadaDeMarcaSsr(m)
        // O logo só entra onde a página não tem o dela (o candidato mostra o seu).
        const comLogo = !/^\/candidato/.test(req.url)
        done(null, payload
          .replace('</head>', `${c.head}</head>`)
          .replace(/<body([^>]*)>/i, (t) => (comLogo ? `${t}${c.topo}` : t)))
      })
      .catch(() => done(null, payload))
  })
}

/** `pagina()` já com a marca do portal resolvida para esta requisição. */
export async function paginaComMarca(req: FastifyRequest, reply: FastifyReply | undefined, titulo: string, conteudo: string): Promise<string> {
  const { pagina } = await import('./portalHtml.js')
  return pagina(titulo, conteudo, await marcaDoAcesso(req, reply).catch(() => null))
}
