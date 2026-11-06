// src/services/originDetection.ts
// Detecção automática de origem de conversas no WhatsApp — Fase 7

import { prisma } from '../lib/prisma.js'
import { recordTouchpoint } from './attribution.js'

export interface OriginData {
  originType: string         // trackable_link, meta_ctwa, google_ads, meta_lead_ads, organic, web_form, manual
  trackableLinkId?: number
  ctwaClid?: string
  gclid?: string
  utmSource?: string
  utmMedium?: string
  utmCampaign?: string
  utmContent?: string
  utmTerm?: string
  campaignId?: string
  campaignName?: string
  adsetId?: string
  adsetName?: string
  adId?: string
  adName?: string
  fbclid?: string
  /** Clique do link rastreável reconhecido pelo código na mensagem. */
  clickId?: number
  pixelSessionId?: string    // Visitor ID do pixel JS — cruza anônimo→lead
  referralSource?: string
  referralBody?: string
  referralHeadline?: string
  referralMediaUrl?: string
  rawReferral?: any
  confidence: string         // high, medium, low
}

/**
 * Detecta a origem de uma conversa com base na mensagem e dados do webhook.
 * Retorna null se não conseguir determinar (será classificado como orgânico depois).
 */
export async function detectOrigin(
  phone: string,
  messageText: string,
  webhookPayload: any,
  provider: 'evolution' | 'cloud_api'
): Promise<OriginData | null> {

  // 1. Trackable Link Reference: #ref:SLUG[:sessionId]
  const refMatch = messageText.match(/#ref:([a-z0-9\-_]+)(?::([a-z0-9\-]+))?/i)
  if (refMatch) {
    const slug = refMatch[1]
    const sessionId = refMatch[2]
    const link = await prisma.trackableLink.findUnique({ where: { slug } })
    if (link) {
      // Increment leads generated
      prisma.trackableLink.update({
        where: { id: link.id },
        data: { leadsGenerated: { increment: 1 } }
      }).catch(() => {})

      return {
        originType: 'trackable_link',
        trackableLinkId: link.id,
        utmSource: link.utmSource || undefined,
        utmMedium: link.utmMedium || undefined,
        utmCampaign: link.utmCampaign || undefined,
        utmContent: link.utmContent || undefined,
        utmTerm: link.utmTerm || undefined,
        campaignId: link.campaignId || undefined,
        campaignName: link.campaignName || undefined,
        pixelSessionId: sessionId,
        confidence: 'high',
      }
    }
  }

  // 1b. Link rastreável: código do clique que o link pôs na mensagem pré-preenchida.
  const doClique = await origemDoCodigoDoLink(messageText)
  if (doClique) return doClique

  // 2. Meta Click-to-WhatsApp (Cloud API)
  if (provider === 'cloud_api') {
    const referral = webhookPayload?.referral
    if (referral) {
      return comNomesDoAnuncio({
        originType: 'meta_ctwa',
        ctwaClid: referral.ctwa_clid || undefined,
        referralSource: referral.source_url || undefined,
        referralBody: referral.body || undefined,
        referralHeadline: referral.headline || undefined,
        referralMediaUrl: referral.media_url || undefined,
        utmSource: 'meta',
        utmMedium: 'ctwa',
        // source_id é o id do ANÚNCIO (ou do post, em source_type=post), não da
        // campanha: até 05/11/2026 ele ia para campaignId.
        adId: String(referral.source_type || 'ad').toLowerCase() === 'ad' && referral.source_id ? String(referral.source_id) : undefined,
        rawReferral: referral,
        confidence: 'high',
      })
    }
  }

  // 3. Meta Click-to-WhatsApp (Evolution API)
  if (provider === 'evolution') {
    const contextInfo = webhookPayload?.message?.extendedTextMessage?.contextInfo ||
                        webhookPayload?.contextInfo ||
                        webhookPayload?.message?.contextInfo
    const adReply = contextInfo?.externalAdReply
    // Só anúncio: externalAdReply também aparece em link com prévia comum.
    const veioDeAnuncio = adReply && (adReply.sourceId || adReply.ctwaClid || contextInfo?.conversionSource === 'FB_Ads' || contextInfo?.entryPointConversionSource === 'ctwa_ad')
    if (veioDeAnuncio) {
      const { thumbnail: _t, ...semMiniatura } = adReply
      return comNomesDoAnuncio({
        originType: 'meta_ctwa',
        ctwaClid: adReply.ctwaClid || undefined,
        referralSource: adReply.sourceUrl || undefined,
        referralBody: adReply.body || undefined,
        referralHeadline: adReply.title || undefined,
        referralMediaUrl: adReply.mediaUrl || adReply.thumbnailUrl || undefined,
        utmSource: 'meta',
        utmMedium: 'ctwa',
        adId: String(adReply.sourceType || 'ad').toLowerCase() === 'ad' && adReply.sourceId ? String(adReply.sourceId) : undefined,
        rawReferral: semMiniatura,
        confidence: 'high',
      })
    }
  }

  // 4. Google Ads (GCLID in message text)
  const gclidMatch = messageText.match(/gclid[=:]([a-zA-Z0-9_-]+)/i)
  if (gclidMatch) {
    return {
      originType: 'google_ads',
      gclid: gclidMatch[1],
      utmSource: 'google',
      utmMedium: 'cpc',
      confidence: 'high',
    }
  }

  // 5. If no tracking data detected, return null (will be organic)
  return null
}

/**
 * Remove referências de tracking do texto da mensagem.
 */
export function stripTrackingRef(text: string): string {
  return text.replace(/\s*#ref:[a-z0-9\-_]+(?::[a-z0-9\-]+)?/gi, '').replace(CODIGO_DO_LINK, '').trim()
}

// ── Código do clique do link rastreável ─────────────────────────────────────
//
// O WhatsApp não carrega nada do clique, a não ser o texto pré-preenchido. Cada
// clique ganha um código na mensagem ("Olá! (cód. A7F2K)"), e é por ele que o
// lead encontra o clique, com as UTMs e o gclid/fbclid daquele acesso.
const CODIGO_DO_LINK = /\s*\(c[óo]d\.?\s*([A-Z0-9]{4,8})\)/i
const VALIDADE_DO_CODIGO_MS = 30 * 24 * 60 * 60 * 1000

async function origemDoCodigoDoLink(texto: string): Promise<OriginData | null> {
  const m = texto.match(CODIGO_DO_LINK)
  if (!m) return null
  const clique = await prisma.trackableLinkClick.findUnique({ where: { codigo: m[1]!.toUpperCase() }, include: { link: true } })
  if (!clique || Date.now() - clique.createdAt.getTime() > VALIDADE_DO_CODIGO_MS) return null
  const l = clique.link
  return {
    originType: 'trackable_link',
    trackableLinkId: l.id,
    clickId: clique.id,
    gclid: clique.gclid || undefined,
    fbclid: clique.fbclid || undefined,
    ctwaClid: clique.ctwaClid || undefined,
    // O que veio na URL daquele acesso vence o padrão do link.
    utmSource: clique.utmSource || l.utmSource || undefined,
    utmMedium: clique.utmMedium || l.utmMedium || undefined,
    utmCampaign: clique.utmCampaign || l.utmCampaign || undefined,
    utmContent: clique.utmContent || l.utmContent || undefined,
    utmTerm: clique.utmTerm || l.utmTerm || undefined,
    campaignId: l.campaignId || undefined,
    campaignName: l.campaignName || undefined,
    pixelSessionId: clique.sessionId || undefined,
    confidence: 'high',
  }
}

// ── Nomes do anúncio ────────────────────────────────────────────────────────
//
// Anúncio para WhatsApp não tem UTM: chega só o id. Campanha, conjunto e anúncio
// saem dos custos já sincronizados da Meta, sem outra chamada à API.
async function nomesDoAnuncio(adId: string) {
  return prisma.campaignCost.findFirst({
    where: { adId },
    orderBy: { date: 'desc' },
    select: { campaignId: true, campaignName: true, adsetId: true, adsetName: true, adName: true },
  }).catch(() => null)
}

async function comNomesDoAnuncio(o: OriginData): Promise<OriginData> {
  if (!o.adId) return o
  const n = await nomesDoAnuncio(o.adId)
  if (!n) return o
  return {
    ...o,
    campaignId: n.campaignId, campaignName: n.campaignName,
    adsetId: n.adsetId || undefined, adsetName: n.adsetName || undefined, adName: n.adName || undefined,
    utmCampaign: n.campaignName, utmContent: n.adName || undefined, utmTerm: n.adsetName || undefined,
  }
}

/** Anúncio novo só entra nos custos na sincronização seguinte: completa depois. */
export async function completarAnunciosPendentes(): Promise<number> {
  const pendentes = await prisma.lead.findMany({
    where: { adId: { not: null }, campaignName: null, originType: 'meta_ctwa', createdAt: { gte: new Date(Date.now() - 7 * 86_400_000) } },
    select: { id: true, adId: true }, take: 200,
  })
  let n = 0
  for (const l of pendentes) {
    const a = await nomesDoAnuncio(l.adId!)
    if (!a) continue
    await prisma.lead.update({ where: { id: l.id }, data: { campaignId: a.campaignId, campaignName: a.campaignName, adsetId: a.adsetId, adsetName: a.adsetName, adName: a.adName, utmCampaign: a.campaignName, utmContent: a.adName, utmTerm: a.adsetName } })
    n++
  }
  return n
}

let timerDosAnuncios: NodeJS.Timeout | null = null
export function startCompletarAnuncios(): void {
  if (timerDosAnuncios) return
  timerDosAnuncios = setInterval(() => { completarAnunciosPendentes().catch((e) => console.warn('[origem] completar anúncios:', e?.message)) }, 60 * 60_000)
  timerDosAnuncios.unref?.()
}

// ── Gravação, em qualquer caminho da mensagem ───────────────────────────────

const ORIGEM_FRACA = new Set(['whatsapp', 'direct', 'organic', 'chat'])
const CAMPOS_DE_ORIGEM = ['ctwaClid', 'gclid', 'fbclid', 'trackableLinkId', 'utmSource', 'utmMedium', 'utmCampaign', 'utmContent', 'utmTerm', 'campaignId', 'campaignName', 'adsetId', 'adsetName', 'adId', 'adName'] as const

/**
 * Liga a origem detectada ao lead da conversa, seja qual for o caminho (atendimento
 * humano, chatbot, jornada de IA). Contato novo: o lead nasce em outra parte do
 * fluxo, então procura de novo por alguns segundos.
 *
 * Primeiro toque manda: de quem já é contato só preenche o que está vazio, troca
 * uma origem genérica ("whatsapp") e registra o novo toque.
 */
export async function registrarOrigemDaConversa(origem: OriginData, acharLead: () => Promise<{ id: number } | null>, esperas: number[] = [0, 3000, 10000, 30000]): Promise<void> {
  for (const ms of esperas) {
    if (ms) await new Promise((r) => setTimeout(r, ms))
    const achado = await acharLead().catch(() => null)
    if (achado) { await aplicarOrigem(achado.id, origem); return }
  }
}

async function aplicarOrigem(leadId: number, origem: OriginData): Promise<void> {
  try {
    const lead: any = await prisma.lead.findUnique({ where: { id: leadId } })
    if (!lead) return
    const jaTemOrigem = await prisma.leadOrigin.findUnique({ where: { leadId }, select: { id: true } })
    if (!jaTemOrigem && ORIGEM_FRACA.has(String(lead.originType ?? 'whatsapp'))) {
      await saveLeadOrigin(leadId, origem)
    } else {
      const data: Record<string, unknown> = {}
      for (const c of CAMPOS_DE_ORIGEM) if (!lead[c] && (origem as any)[c]) data[c] = (origem as any)[c]
      if (Object.keys(data).length) await prisma.lead.update({ where: { id: leadId }, data })
      // O mesmo clique chega em toda mensagem da Evolution: um toque só.
      const repetido = origem.ctwaClid
        ? await prisma.leadTouchpoint.findFirst({ where: { leadId, ctwaClid: origem.ctwaClid }, select: { id: true } })
        : origem.clickId
          ? await prisma.trackableLinkClick.findFirst({ where: { id: origem.clickId, leadId }, select: { id: true } })
          : null
      if (!repetido && !jaFoiEsteAnuncio(lead, origem)) {
        await recordTouchpoint({
          leadId, channel: origem.originType, source: origem.utmSource, medium: origem.utmMedium, campaign: origem.utmCampaign,
          campaignId: origem.campaignId, content: origem.utmContent, term: origem.utmTerm, gclid: origem.gclid, ctwaClid: origem.ctwaClid,
        })
      }
    }
    await ligarCliqueAoLead(leadId, origem)
  } catch (e: any) {
    console.error('[origem] não gravou:', e?.message)
  }
}

const jaFoiEsteAnuncio = (lead: any, o: OriginData) => !o.ctwaClid && !o.clickId && !!o.adId && lead.adId === o.adId

/** Conta o lead no link uma vez só, mesmo que o código volte em outra mensagem. */
async function ligarCliqueAoLead(leadId: number, o: OriginData): Promise<void> {
  if (!o.clickId || !o.trackableLinkId) return
  const r = await prisma.trackableLinkClick.updateMany({ where: { id: o.clickId, leadId: null }, data: { leadId } })
  if (r.count) await prisma.trackableLink.update({ where: { id: o.trackableLinkId }, data: { leadsGenerated: { increment: 1 } } })
}

/**
 * Salva a origem do lead no banco de dados.
 */
export async function saveLeadOrigin(leadId: number, origin: OriginData): Promise<void> {
  try {
    // Upsert LeadOrigin
    await prisma.leadOrigin.upsert({
      where: { leadId },
      create: {
        leadId,
        originType: origin.originType,
        trackableLinkId: origin.trackableLinkId || null,
        ctwaClid: origin.ctwaClid || null,
        gclid: origin.gclid || null,
        utmSource: origin.utmSource || null,
        utmMedium: origin.utmMedium || null,
        utmCampaign: origin.utmCampaign || null,
        utmContent: origin.utmContent || null,
        utmTerm: origin.utmTerm || null,
        referralSource: origin.referralSource || null,
        referralBody: origin.referralBody || null,
        referralHeadline: origin.referralHeadline || null,
        referralMediaUrl: origin.referralMediaUrl || null,
        rawReferral: origin.rawReferral || undefined,
        confidence: origin.confidence,
      },
      update: {
        originType: origin.originType,
        trackableLinkId: origin.trackableLinkId || null,
        ctwaClid: origin.ctwaClid || null,
        gclid: origin.gclid || null,
        utmSource: origin.utmSource || null,
        utmMedium: origin.utmMedium || null,
        utmCampaign: origin.utmCampaign || null,
        utmContent: origin.utmContent || null,
        utmTerm: origin.utmTerm || null,
        referralSource: origin.referralSource || null,
        referralBody: origin.referralBody || null,
        referralHeadline: origin.referralHeadline || null,
        referralMediaUrl: origin.referralMediaUrl || null,
        rawReferral: origin.rawReferral || undefined,
        confidence: origin.confidence,
      }
    })

    // Update lead with denormalized origin data
    await prisma.lead.update({
      where: { id: leadId },
      data: {
        originType: origin.originType,
        ctwaClid: origin.ctwaClid || null,
        gclid: origin.gclid || null,
        trackableLinkId: origin.trackableLinkId || null,
        utmSource: origin.utmSource || null,
        utmMedium: origin.utmMedium || null,
        utmCampaign: origin.utmCampaign || null,
        utmContent: origin.utmContent || null,
        utmTerm: origin.utmTerm || null,
        campaignId: origin.campaignId || undefined,
        campaignName: origin.campaignName || undefined,
        adsetId: origin.adsetId || undefined,
        adsetName: origin.adsetName || undefined,
        adId: origin.adId || undefined,
        adName: origin.adName || undefined,
        fbclid: origin.fbclid || undefined,
      }
    })
    // Cruza visitor anônimo do pixel → lead identificado (jornada completa)
    if (origin.pixelSessionId) {
      prisma.pixelVisitor.update({
        where: { visitorId: origin.pixelSessionId },
        data: { leadId, identifiedAt: new Date() },
      }).catch(() => {})
    }

    // Registrar touchpoint para atribuição multi-touch
    recordTouchpoint({
      leadId,
      channel: origin.originType,
      source: origin.utmSource,
      medium: origin.utmMedium,
      campaign: origin.utmCampaign,
      campaignId: origin.campaignId,
      content: origin.utmContent,
      term: origin.utmTerm,
      gclid: origin.gclid,
      ctwaClid: origin.ctwaClid,
    }).catch(() => {}) // Fire-and-forget

  } catch (err) {
    console.error('Error saving lead origin:', err)
  }
}
