// src/services/competitorRadar.ts
//
// Radar de Concorrentes (F2) — descobre agências de marketing por região via
// Google Maps (actor compass/crawler-google-places no Apify) e guarda o que
// interessa para prospecção competitiva.
//
// O alvo comercial não é a agência: é a CARTEIRA dela. A agência é o ponto de
// partida — o site dela publica cases e logos de cliente, e cada cliente vira
// candidato quando o detector de stack (webStackDetect.ts) mostra lacuna.
//
// Sobre reviews: medido na prática, agências mantêm nota ~5,0 no Google porque
// pedem avaliação aos clientes satisfeitos. Negativa com texto é rara. Por isso
// o coletor NÃO depende disso — captura quando existe, mas o sinal principal é
// a carteira + a lacuna técnica dos clientes dela.
//
// LGPD: de cada review guardamos nota, texto, data e resposta do dono. Nome,
// foto, perfil e id do avaliador são descartados na ingestão — o alvo é a
// empresa contratante citada no texto, nunca a pessoa que escreveu.

import { prisma } from '../lib/prisma.js'
import { runActor, checkCredits, lastRunUsage, ApifyError } from './apifyClient.js'
import { normalizeDomain, scanAndSave } from './webStackDetect.js'

const ACTOR = 'compass~crawler-google-places'

// Medido em 2026-07-23: US$ 0,0257 para 3 lugares × 5 reviews ≈ US$ 0,009/lugar.
// Serve para estimar antes de gastar, não é preço contratual.
const USD_PER_PLACE = 0.009

export interface DiscoverOptions {
  term?: string
  location: string
  maxPlaces?: number
  maxReviewsPerPlace?: number
  /** Roda o detector de stack no site de cada agência encontrada. */
  scanSites?: boolean
}

export interface DiscoverResult {
  found: number
  created: number
  updated: number
  negativeReviews: number
  estimatedUsd: number
  actualUsd: number | null
  creditsRemainingUsd: number | null
}

function pickDomain(website: string | null | undefined): string | null {
  if (!website) return null
  const d = normalizeDomain(website)
  return d && /\./.test(d) ? d : null
}

/**
 * Descobre agências numa praça e persiste.
 * Idempotente por placeId — rodar de novo atualiza nota/contagem.
 */
export async function discoverAgencies(opts: DiscoverOptions): Promise<DiscoverResult> {
  const term = opts.term?.trim() || 'agência de marketing digital'
  const location = opts.location.trim()
  const maxPlaces = Math.max(1, Math.min(opts.maxPlaces ?? 20, 120))
  const maxReviews = Math.max(0, Math.min(opts.maxReviewsPerPlace ?? 10, 50))
  if (!location) throw new ApifyError('location é obrigatório (ex.: "Goiânia, GO")')

  const estimatedUsd = Number((maxPlaces * USD_PER_PLACE).toFixed(4))

  // Trava de custo: a conta é FREE (US$ 5/mês) e estourar trava tudo até virar o mês.
  const credits = await checkCredits()
  if (credits.remainingUsd !== null && credits.remainingUsd < estimatedUsd) {
    throw new ApifyError(
      `Crédito Apify insuficiente: restam US$ ${credits.remainingUsd} e esta busca deve custar ~US$ ${estimatedUsd}. ` +
      `Reduza maxPlaces ou aguarde a renovação mensal.`,
    )
  }

  const { items } = await runActor<any>(ACTOR, {
    searchStringsArray: [term],
    locationQuery: location,
    maxCrawledPlacesPerSearch: maxPlaces,
    language: 'pt-BR',
    maxReviews,
    reviewsSort: 'lowestRanking', // as piores primeiro — se houver negativa, vem antes
    // Minimização: pedimos ao actor para não coletar identificação do avaliador.
    scrapeReviewerName: false,
    scrapeReviewId: true, // necessário para dedupe
    scrapeReviewUrl: false,
    scrapeResponseFromOwnerText: true,
  }, { maxItems: maxPlaces, timeoutMs: 8 * 60_000 })

  let created = 0, updated = 0, negativeReviews = 0

  for (const p of items) {
    const placeId = String(p.placeId || p.cid || p.fid || '').trim()
    if (!placeId) continue

    const website = p.website || null
    const domain = pickDomain(website)

    const data = {
      name: String(p.title || '').slice(0, 191) || 'sem nome',
      categories: [p.categoryName, ...(Array.isArray(p.categories) ? p.categories : [])]
        .filter(Boolean).join(', ').slice(0, 255) || null,
      address: p.address || null,
      city: (p.city || '').slice(0, 120) || null,
      uf: (p.state || '').slice(0, 60) || null,
      website: website ? String(website).slice(0, 255) : null,
      domain,
      phone: p.phone ? String(p.phone).slice(0, 40) : null,
      rating: typeof p.totalScore === 'number' ? p.totalScore : null,
      reviewsCount: typeof p.reviewsCount === 'number' ? p.reviewsCount : null,
      searchTerm: term.slice(0, 191),
      lastScanAt: new Date(),
    }

    const existing = await prisma.competitorAgency.findUnique({ where: { placeId }, select: { id: true } })
    const agency = existing
      ? await prisma.competitorAgency.update({ where: { placeId }, data })
      : await prisma.competitorAgency.create({ data: { placeId, ...data } })
    existing ? updated++ : created++

    // Só negativas COM texto: 1 estrela sem comentário não diz quem reclamou nem do quê.
    const negatives = (Array.isArray(p.reviews) ? p.reviews : []).filter(
      (r: any) => (r?.stars ?? 5) <= 2 && String(r?.text || '').trim().length > 0,
    )

    for (const r of negatives) {
      const externalId = String(r.reviewId || `${placeId}:${r.publishedAtDate || ''}:${String(r.text).slice(0, 40)}`)
      const publishedAt = r.publishedAtDate ? new Date(r.publishedAtDate) : null
      const row = {
        agencyId: agency.id,
        stars: Number(r.stars) || 1,
        text: String(r.text).slice(0, 8000),
        publishedAt: publishedAt && !isNaN(publishedAt.getTime()) ? publishedAt : null,
        ownerReplied: !!r.responseFromOwnerText,
      }
      await prisma.competitorReview.upsert({
        where: { externalId },
        create: { externalId, ...row },
        update: row,
      })
      negativeReviews++
    }

    await prisma.competitorAgency.update({
      where: { id: agency.id },
      data: { negativeWithText: await prisma.competitorReview.count({ where: { agencyId: agency.id } }) },
    })

    // A própria agência é um bom teste do detector: agência sem pixel no
    // próprio site é argumento de venda pronto.
    if (opts.scanSites && domain) {
      try { await scanAndSave(domain) } catch { /* site fora do ar não invalida a coleta */ }
    }
  }

  const usage = await lastRunUsage(ACTOR)
  const after = await checkCredits().catch(() => null)

  return {
    found: items.length,
    created,
    updated,
    negativeReviews,
    estimatedUsd,
    actualUsd: usage.usageUsd,
    creditsRemainingUsd: after?.remainingUsd ?? null,
  }
}
