// src/lib/portalMarca.ts
// A marca das telas de acesso do portal (/portal/login, /portal/senha…).
//
// O login é um só para todos os portais da instituição, mas quem chega nele
// veio de um portal — e precisa ver as cores, a fonte e o logo desse portal,
// não um tema genérico. A escolha segue esta ordem:
//   1. `?portal=<slug>` na URL (o botão "Entrar" de cada portal manda);
//   2. o cookie gravado na última visita com o parâmetro — assim o erro de
//      senha e o "receber link", que recarregam a página, não perdem a marca;
//   3. o primeiro portal ativo com marca configurada (cor principal);
//   4. o primeiro portal ativo.
// Sem portal nenhum, as telas ficam no tema padrão de antes.

import type { FastifyReply, FastifyRequest } from 'fastify'
import { prisma } from './prisma.js'

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
}

const CAMPOS = {
  slug: true, nome: true, brandPrimaryColor: true, brandSecondaryColor: true, brandFontFamily: true,
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

export async function marcaDoAcesso(req: FastifyRequest, reply?: FastifyReply): Promise<MarcaDoAcesso | null> {
  const pedido = (req.query as any)?.portal
  const lembrado = doCookie(req)
  let p: any = null
  for (const slug of [pedido, lembrado]) {
    if (!slugValido(slug)) continue
    p = await prisma.enrollmentPortal.findFirst({ where: { slug, active: true }, select: CAMPOS })
    if (p) {
      // Só grava quando veio pela URL: é a escolha explícita de quem clicou em
      // "Entrar" naquele portal. Cookie comum (não é credencial), 90 dias.
      if (slug === pedido && reply) {
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
  }
}

/** `pagina()` já com a marca do portal resolvida para esta requisição. */
export async function paginaComMarca(req: FastifyRequest, reply: FastifyReply | undefined, titulo: string, conteudo: string): Promise<string> {
  const { pagina } = await import('./portalHtml.js')
  return pagina(titulo, conteudo, await marcaDoAcesso(req, reply).catch(() => null))
}
