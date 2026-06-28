// Corroboração de identidade para descobertas SOCIAIS (LinkedIn/Instagram/etc).
//
// Problema que isto resolve: buscar "José Xavier da Silva site:instagram.com" no
// Google/DDG retorna QUALQUER homônimo. Aparecer na busca pelo nome != ser a
// pessoa. Por isso:
//   - âncora forte (handle == local-part do e-mail do lead) → FATO verificado.
//   - qualquer casamento por NOME (mesmo nome completo) → CANDIDATO a verificar
//     (nunca fato automático): nome não identifica uma pessoa de forma única.
// O agente confirma/descarta os candidatos no painel; social.ts pode promover um
// candidato a fato se o scraping trouxer sinal corroborante (empresa/cidade conhecida).
import { prisma } from '../../lib/prisma.js'
import type { LeadSeed } from './types.js'

function deaccent(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

const STOPWORDS = new Set(['da', 'de', 'do', 'dos', 'das', 'e', 'di', 'du', 'ne', 'la'])

/** Tokens significativos do nome (sem acento, minúsculos, sem partículas, ≥3 chars). */
export function nameTokens(nome?: string | null): string[] {
  return deaccent((nome || '').toLowerCase())
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t))
}

/** Slug/handle do perfil (último segmento do path da URL). */
export function urlHandle(url: string): string {
  try {
    const u = new URL(url)
    const seg = u.pathname.split('/').filter(Boolean).pop() || ''
    return deaccent(seg.toLowerCase()).replace(/[^a-z0-9]/g, '')
  } catch {
    return ''
  }
}

export interface Corroboration {
  kind: 'fact' | 'candidate'
  confidence: number
  reason: string
}

/**
 * Decide se uma URL social descoberta deve ser FATO ou CANDIDATO.
 * baseConfidence = confiança "da plataforma" calculada pelo provider.
 */
export function corroborateSocialUrl(seed: LeadSeed, url: string, baseConfidence: number): Corroboration {
  const handle = urlHandle(url)
  const email = (seed.email || '').trim().toLowerCase()
  const emailLocal = email.includes('@') ? email.split('@')[0].replace(/[^a-z0-9]/g, '') : ''

  // Âncora forte: o handle contém o local-part do e-mail (≥4 chars) → mesma identidade.
  if (emailLocal.length >= 4 && handle.includes(emailLocal)) {
    return { kind: 'fact', confidence: Math.min(baseConfidence, 0.9), reason: 'handle casa com o e-mail do lead' }
  }

  // Casamento por nome: conta quantos tokens do nome estão no handle.
  const tokens = nameTokens(seed.nome)
  const hit = tokens.filter((t) => handle.includes(t))
  const allTokens = tokens.length >= 2 && hit.length === tokens.length

  // Mesmo nome completo NÃO basta para virar fato (homônimos). Vira candidato, com
  // confiança proporcional à força do casamento (nunca acima de 0.35).
  const conf = allTokens ? 0.35 : hit.length >= 1 ? 0.25 : 0.15
  const reason = allTokens
    ? 'nome completo aparece no perfil — confirme se é a pessoa certa'
    : hit.length >= 1
      ? 'casamento parcial por nome — verifique'
      : 'sem casamento claro de identidade'
  return { kind: 'candidate', confidence: Math.min(conf, baseConfidence), reason }
}

// ── Toggle da busca social por nome (Setting; default OFF) ──────────────────
// Liga/desliga a DESCOBERTA social por nome (google/googleCse scraping de redes).
// Desligado por padrão: sem ele, o motor não anexa social não-verificado e a
// alucinação some. O admin liga em Inteligência quando quiser o balde de candidatos.
let cache: { value: boolean; at: number } | null = null
const TTL = 60_000

export async function socialSearchEnabled(): Promise<boolean> {
  if (cache && Date.now() - cache.at < TTL) return cache.value
  let value = false
  try {
    const row = await prisma.setting.findUnique({ where: { key: 'enrichment.socialSearch.enabled' }, select: { value: true } })
    const v: any = row?.value
    value = v === true || v === 'true' || v === '1' || v?.enabled === true || v?.value === true
  } catch { /* default false */ }
  cache = { value, at: Date.now() }
  return value
}

export function invalidateSocialSearchCache() { cache = null }
