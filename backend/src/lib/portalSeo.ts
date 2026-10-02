// src/lib/portalSeo.ts
//
// SEO das telas do portal além da inscrição: tela de acesso (login) e área
// logada (portal, documentos, contrato, senha). Mora em
// EnrollmentPortal.seoTelas e é editado em Configurações › Domínio + SEO.
//
// Regras:
// - Título de cada tela = "<tela> | <marca>". A marca é o nome da instituição
//   (seoTelas.marca), ou o nome da unidade, ou o do portal.
// - A área logada nunca entra no Google: é pessoal e só abre com sessão.
// - Inscrição e login entram por padrão; cada uma pode ser tirada do Google.

import { prisma } from './prisma.js'
import type { CabecalhoPortal } from './portalApp.js'
import { lerEduGeral, vestirMarca } from './eduGeral.js'

export interface SeoTelas {
  marca?: string | null
  login?: { titulo?: string | null; descricao?: string | null }
  area?: { descricao?: string | null }
  indexarInscricao?: boolean
  indexarLogin?: boolean
}

export type TelaDoPortal = 'login' | 'portal' | 'senha' | 'documentos' | 'contrato'

/** Nome da tela na aba do navegador (área logada: fixo, a pessoa já sabe onde está). */
const TELA: Record<TelaDoPortal, { titulo: string; caminho: string }> = {
  login: { titulo: 'Acesse sua inscrição', caminho: '/portal/login' },
  portal: { titulo: 'Meu portal', caminho: '/portal' },
  senha: { titulo: 'Criar senha', caminho: '/portal/senha' },
  documentos: { titulo: 'Meus documentos', caminho: '/portal/documentos' },
  contrato: { titulo: 'Meu contrato', caminho: '/portal/contrato' },
}

const texto = (v: unknown, max: number): string | null => {
  const s = typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : ''
  return s ? s.slice(0, max) : null
}

/** Limpa o que vem do admin: só os campos conhecidos, aparados e com limite. */
export function normalizarSeoTelas(v: unknown): SeoTelas | null {
  if (!v || typeof v !== 'object') return null
  const o = v as any
  const out: SeoTelas = {
    marca: texto(o.marca, 80),
    login: { titulo: texto(o.login?.titulo, 120), descricao: texto(o.login?.descricao, 300) },
    area: { descricao: texto(o.area?.descricao, 300) },
    indexarInscricao: o.indexarInscricao !== false,
    indexarLogin: o.indexarLogin !== false,
  }
  return out
}

export function lerSeoTelas(v: unknown): SeoTelas {
  return (v && typeof v === 'object' ? v : {}) as SeoTelas
}

/** Nome que vai depois do "|" nos títulos e no og:site_name. */
export function marcaDoSeo(p: { nome: string; seoTelas?: unknown; unit?: { nome?: string | null } | null }, nomeGeral?: string | null): string {
  // Portal › Configurações Gerais (nome da instituição) › unidade › portal.
  return texto(lerSeoTelas(p.seoTelas).marca, 80) || texto(nomeGeral, 80) || texto(p.unit?.nome, 80) || p.nome
}

/**
 * Cabeçalho de uma tela de acesso/área logada, a partir do portal da marca
 * (o mesmo que o login escolhe: o pedido, o da inscrição, o último visitado).
 */
export async function cabecalhoDaTela(slug: string | null | undefined, tela: TelaDoPortal): Promise<CabecalhoPortal> {
  const p = slug
    ? await prisma.enrollmentPortal.findFirst({
      where: { slug, active: true },
      select: {
        id: true, slug: true, nome: true, customDomain: true, ogImageUrl: true, seoTelas: true,
        brandFaviconUrl: true, brandPrimaryColor: true, unit: { select: { nome: true } },
      },
    }).catch(() => null)
    : null
  const t = TELA[tela]
  const seo = lerSeoTelas(p?.seoTelas)
  // Configurações Gerais: o que o portal não definiu (ou quando não há portal).
  const g = await lerEduGeral().catch(() => null)
  // O que vale de marca/SEO, já com o que o portal segue das Gerais.
  const v = g && p ? vestirMarca({ id: p.id, brandFaviconUrl: p.brandFaviconUrl, brandPrimaryColor: p.brandPrimaryColor, ogImageUrl: p.ogImageUrl }, g) : null
  const marca = p ? marcaDoSeo(p, g?.identidade.nome) : (g?.identidade.nome ?? '')
  const comMarca = (s: string) => (marca && !s.includes(marca) ? `${s} | ${marca}` : s)

  const titulo = tela === 'login' ? (texto(seo.login?.titulo, 120) || comMarca(t.titulo)) : comMarca(t.titulo)
  const descricao = tela === 'login'
    ? texto(seo.login?.descricao, 300) || `Acompanhe sua inscrição${marca ? ` na ${marca}` : ''}: etapas, documentos, contrato e pagamento.`
    : texto(seo.area?.descricao, 300) || `Portal do candidato e do aluno${marca ? ` — ${marca}` : ''}.`

  return {
    nome: titulo,
    slug: p?.slug || 'portal',
    metaTitle: titulo,
    metaDescription: descricao,
    ogImageUrl: v ? v.ogImageUrl : g?.seo.ogImageUrl ?? null,
    brandFaviconUrl: v ? v.brandFaviconUrl : g?.identidade.faviconUrl ?? null,
    brandPrimaryColor: v ? v.brandPrimaryColor : g?.aparencia.corPrincipal ?? null,
    customDomain: p?.customDomain ?? null,
    caminho: t.caminho,
    nomeDoSite: marca || null,
    indexar: tela === 'login' ? seo.indexarLogin !== false : false,
  }
}
