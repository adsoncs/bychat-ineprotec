// src/services/leadQualification.ts
// Promove lead "só conversa" para lead qualificado.
//
// Filosofia: Conversa ≠ Lead. Mensagem WhatsApp ad-hoc cria registro mínimo
// com qualifiedAt=null. Quando há sinal real de intenção (form, portal, ads,
// chatbot completo, ato manual do operador) chamamos qualifyLead() pra marcar
// qualifiedAt+qualificationSource. Filtros de relatório/funil/kanban olham
// qualifiedAt != null. Conversas mostram tudo.

import { prisma } from '../lib/prisma.js'
import { logEvent } from './leadHistory.js'

export type QualificationSource =
  | 'form'                  // landing page / form web
  | 'enrollment_portal'     // submit de inscrição
  | 'meta_lead_ads'         // webhook Meta Lead Ads
  | 'google_ads'            // gclid presente
  | 'make'                  // automação Make.com
  | 'api'                   // POST /api/v1/leads via API key
  | 'manual'                // operador clicou + Novo Lead / Promover
  | 'chatbot_completed'     // fim de fluxo de chatbot
  | 'web_chat_completed'    // fim de chat de diagnóstico
  | 'duplicate'             // herdado de duplicação
  | 'restore'               // restaurado da lixeira

interface QualifyOptions {
  source: QualificationSource
  byUserId?: number   // para 'manual'
  byUserName?: string
  reason?: string     // texto livre opcional pra log
}

// Marca um lead como qualificado se ainda não estiver. Idempotente: se já
// está qualificado, não sobrescreve qualifiedAt (preserva primeira data).
export async function qualifyLead(leadId: number, opts: QualifyOptions): Promise<{ qualified: boolean }> {
  const cur = await prisma.lead.findUnique({ where: { id: leadId }, select: { qualifiedAt: true, nome: true } })
  if (!cur) return { qualified: false }
  if (cur.qualifiedAt) return { qualified: false } // já era qualificado

  await prisma.lead.update({
    where: { id: leadId },
    data: { qualifiedAt: new Date(), qualificationSource: opts.source },
  })
  logEvent({
    leadId,
    type: 'lead_qualified' as any,
    category: 'lifecycle',
    title: `Lead qualificado (${opts.source})`,
    source: opts.source,
    actorType: opts.byUserId ? 'operator' : 'system',
    userId: opts.byUserId,
    userName: opts.byUserName,
    description: opts.reason || undefined,
  })

  // Dispara CAPI 'Lead' fire-and-forget — feedback de qualidade pro Meta otimizar
  // o aprendizado da campanha. dedup por (leadId, eventName) já existe no service.
  // Skip silencioso se CAPI não está configurado (config retorna null).
  ;(async () => {
    try {
      const { sendCapiEvent } = await import('./metaCapi.js')
      await sendCapiEvent({ leadId, eventName: 'Lead', funnelStage: opts.source })
    } catch { /* não bloquear qualificação por falha CAPI */ }
  })()

  // Meta Lead Ads Quality Feedback — manda INTERESTED pro Meta saber que esse
  // lead foi qualificado pela equipe. Skip silencioso se lead não é Lead Ads
  // ou feature off.
  ;(async () => {
    try {
      const { sendLeadQualityFeedback } = await import('./metaLeadQualityFeedback.js')
      await sendLeadQualityFeedback({ leadId, quality: 'INTERESTED' })
    } catch { /* não bloquear */ }
  })()

  return { qualified: true }
}
