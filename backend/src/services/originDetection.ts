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

  // 2. Meta Click-to-WhatsApp (Cloud API)
  if (provider === 'cloud_api') {
    const referral = webhookPayload?.referral
    if (referral) {
      return {
        originType: 'meta_ctwa',
        ctwaClid: referral.ctwa_clid || undefined,
        referralSource: referral.source_url || undefined,
        referralBody: referral.body || undefined,
        referralHeadline: referral.headline || undefined,
        referralMediaUrl: referral.media_url || undefined,
        utmSource: 'meta',
        utmMedium: 'ctwa',
        campaignId: referral.source_id || undefined,
        rawReferral: referral,
        confidence: 'high',
      }
    }
  }

  // 3. Meta Click-to-WhatsApp (Evolution API)
  if (provider === 'evolution') {
    const contextInfo = webhookPayload?.message?.extendedTextMessage?.contextInfo ||
                        webhookPayload?.contextInfo ||
                        webhookPayload?.message?.contextInfo
    const adReply = contextInfo?.externalAdReply
    if (adReply) {
      return {
        originType: 'meta_ctwa',
        referralSource: adReply.sourceUrl || undefined,
        referralBody: adReply.body || undefined,
        referralHeadline: adReply.title || undefined,
        referralMediaUrl: adReply.mediaUrl || adReply.thumbnailUrl || undefined,
        utmSource: 'meta',
        utmMedium: 'ctwa',
        rawReferral: adReply,
        confidence: 'high',
      }
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
  return text.replace(/\s*#ref:[a-z0-9\-_]+(?::[a-z0-9\-]+)?/gi, '').trim()
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
