// src/services/metaLeadQualityFeedback.ts
//
// Meta Lead Ads — Quality Feedback API.
//
// Permite enviar de volta ao Meta a qualidade dos leads recebidos via Lead Ads
// (formulários nativos do Facebook/Instagram). Isso ajuda a otimização de
// campanhas de Lead Ads — o algoritmo aprende a buscar perfis parecidos com
// quem converteu (CONVERTED), excluir perfis parecidos com quem foi marcado
// como inválido (INVALID), etc.
//
// API:  POST https://graph.facebook.com/v19.0/{lead_id}?access_token=PAGE_TOKEN
//       body: { leadgen_lead_quality: 'INVALID' | 'NOT_INTERESTED' | 'INTERESTED' | 'CONVERTED' }
//
// Pré-requisitos:
//   - Lead veio de um formulário Meta Lead Ads (existe MetaLeadLog com metaLeadId+pageId)
//   - MetaIntegration ativa com pageAccessToken válido
//   - Permissão `leads_retrieval` no token (já necessária pra receber leads)
//
// Configuração: liga/desliga via Setting `meta.lead_quality_feedback_enabled`
// (default off — usuário ativa explicitamente em /app/conversions ou Configurações).

import { prisma } from '../lib/prisma.js'

export type LeadQuality = 'INVALID' | 'NOT_INTERESTED' | 'INTERESTED' | 'CONVERTED'

interface SendOpts {
  /** ID do lead no nosso banco */
  leadId: number
  /** Tipo de feedback */
  quality: LeadQuality
}

interface SendResult {
  ok: boolean
  skipped?: 'not_meta_lead' | 'no_token' | 'feature_off' | 'no_log'
  error?: string
  metaLeadId?: string
}

const FB_GRAPH_VERSION = 'v19.0'

/**
 * Lê o setting `meta.lead_quality_feedback_enabled`. Default: false (opt-in).
 */
async function isFeatureEnabled(): Promise<boolean> {
  const row = await prisma.setting.findUnique({ where: { key: 'meta.lead_quality_feedback_enabled' } })
  if (!row?.value) return false
  const raw = typeof row.value === 'string' ? row.value : String(row.value)
  return raw.replace(/^"|"$/g, '').trim().toLowerCase() === 'true'
}

/**
 * Envia feedback de qualidade pro Meta. Silencioso quando:
 *   - feature off → skipped:'feature_off'
 *   - lead não veio de Lead Ads → skipped:'not_meta_lead'
 *   - sem token na integration → skipped:'no_token'
 */
export async function sendLeadQualityFeedback({ leadId, quality }: SendOpts): Promise<SendResult> {
  if (!await isFeatureEnabled()) return { ok: false, skipped: 'feature_off' }

  // Lead precisa ter origem Meta Lead Ads — usamos metaPageId como sinal e
  // o MetaLeadLog mais recente pra recuperar o lead_id do Meta.
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: { id: true, metaPageId: true, metaFormId: true },
  })
  if (!lead || !lead.metaPageId) return { ok: false, skipped: 'not_meta_lead' }

  // Recupera o metaLeadId do log mais recente (status='processed' tem prioridade)
  const log = await prisma.metaLeadLog.findFirst({
    where: { metaPageId: lead.metaPageId, leadId },
    orderBy: { createdAt: 'desc' },
    select: { metaLeadId: true },
  })
  if (!log?.metaLeadId) return { ok: false, skipped: 'no_log' }

  const integ = await prisma.metaIntegration.findUnique({
    where: { pageId: lead.metaPageId },
    select: { id: true, pageAccessToken: true, active: true },
  })
  if (!integ?.pageAccessToken || !integ.active) return { ok: false, skipped: 'no_token' }

  const url = `https://graph.facebook.com/${FB_GRAPH_VERSION}/${log.metaLeadId}?access_token=${encodeURIComponent(integ.pageAccessToken)}`
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ leadgen_lead_quality: quality }),
    })
    const data = await resp.json().catch(() => ({})) as any
    if (!resp.ok || data?.error) {
      const fbErr = data?.error
      const msg = fbErr
        ? `${fbErr.message || 'erro'}${fbErr.code ? ` (code ${fbErr.code}` + (fbErr.error_subcode ? `/${fbErr.error_subcode}` : '') + ')' : ''}`
        : `HTTP ${resp.status}`
      console.error(`[LeadQualityFeedback] lead ${leadId} → ${quality}: ${msg}`)
      // Registra falha no log pra audit trail
      await prisma.metaLeadLog.create({
        data: {
          leadId,
          metaLeadId: log.metaLeadId,
          metaFormId: lead.metaFormId || '',
          metaPageId: lead.metaPageId,
          status: 'quality_feedback_failed',
          errorMessage: `${quality}: ${msg}`,
        },
      }).catch(() => {})
      return { ok: false, error: msg, metaLeadId: log.metaLeadId }
    }

    console.log(`[LeadQualityFeedback] lead ${leadId} → ${quality} ✓`)
    await prisma.metaLeadLog.create({
      data: {
        leadId,
        metaLeadId: log.metaLeadId,
        metaFormId: lead.metaFormId || '',
        metaPageId: lead.metaPageId,
        status: 'quality_feedback_sent',
        errorMessage: quality,
      },
    }).catch(() => {})
    return { ok: true, metaLeadId: log.metaLeadId }
  } catch (err: any) {
    console.error(`[LeadQualityFeedback] exceção lead ${leadId}:`, err)
    return { ok: false, error: err.message || 'erro de rede' }
  }
}

/**
 * Detecta se um motivo de perda corresponde a spam/lead inválido (INVALID)
 * ou genuíno-mas-não-interessado (NOT_INTERESTED). Olha palavras-chave no
 * nome do motivo. Pode ser ajustado pra usar uma flag `LossReason.invalid`
 * no futuro.
 */
export function classifyLossAsQuality(lossReasonName: string | null | undefined): 'INVALID' | 'NOT_INTERESTED' {
  if (!lossReasonName) return 'NOT_INTERESTED'
  const n = lossReasonName.toLowerCase()
  const invalidHints = ['spam', 'fake', 'falso', 'inválido', 'invalido', 'duplicado', 'não é', 'nao e', 'bot', 'teste', 'número inválido', 'numero invalido', 'lead errado', 'não existe', 'nao existe']
  return invalidHints.some((k) => n.includes(k)) ? 'INVALID' : 'NOT_INTERESTED'
}
