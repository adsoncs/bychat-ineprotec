// src/lib/leadOrigin.ts
//
// Helper central pra derivar `Lead.originType` em qualquer ponto de criação.
// O originType é o "como esse lead chegou" — mais granular que `source` (que
// é legado/canal genérico). É usado em /tracking?tab=origins, no card "Leads
// recentes" e em qualquer agregação de atribuição.
//
// REGRA: nenhum lead pode ser criado com originType=NULL. Todo ponto de
// criação chama `deriveLeadOrigin()` passando o contexto disponível e usa o
// retorno. Se nada conhecido bate, cai em 'direct' (fallback explícito).

export const ORIGIN_TYPES = [
  'trackable_link',   // clicou em link encurtado bychat e foi p/ canal
  'meta_ctwa',        // Click-to-WhatsApp Ad (Meta Ads → WhatsApp)
  'google_ads',       // veio com gclid ou utm_source=google/google_ads
  'meta_lead_ads',    // formulário interno do Facebook (Lead Ads)
  'web_form',         // formulário do site/landing page/portal
  'web_chat',         // chat embed no site (chatbot web)
  'whatsapp',         // mensagem direta no WhatsApp (sem CTWA / sem link)
  'instagram',        // mensagem direta no Instagram
  'telegram',         // mensagem direta no Telegram
  'enrollment_portal',// portal público de matrículas
  'chat',             // chat genérico (legado)
  'api',              // POST /api/public/leads
  'make',             // automação via Make.com
  'import',           // CSV/bulk import
  'manual',           // criado pelo operador no painel
  'organic',          // tem utm/referrer mas não casa com canal pago conhecido
  'direct',           // fallback — sem nenhuma pista de origem
] as const

export type OriginType = (typeof ORIGIN_TYPES)[number]

export interface DeriveOriginInput {
  /** Foreign key pro link rastreável encurtado, se houver. */
  trackableLinkId?: number | null
  /** Click-to-WhatsApp Ad — vem do payload da Cloud API/Evolution. */
  ctwaClid?: string | null
  /** Click ID do Google Ads (forte sinal de ad pago). */
  gclid?: string | null
  /** UTM source do landing/QR/form. */
  utmSource?: string | null
  /** Campo legado `Lead.source` (whatsapp, landing_page, instagram, etc). */
  source?: string | null
  /** Campo `Lead.qualificationSource` quando o lead foi qualificado. */
  qualificationSource?: string | null
  /** Canal de mensagem se já conhecido (whatsapp/instagram/telegram/web_chat). */
  channel?: string | null
  /** Provider explícito quando origem do código é claro (manual/api/make/import). */
  explicit?: OriginType | null
}

const GOOGLE_UTM = new Set(['google', 'google_ads', 'googleads', 'adwords', 'cpc'])
const META_UTM = new Set(['facebook', 'meta', 'instagram_ads', 'fb_ads', 'meta_ads'])

/**
 * Deriva originType a partir de qualquer combinação de pistas. Sempre
 * retorna um valor de `ORIGIN_TYPES` — nunca null. Ordem de precedência:
 *
 *  1. `explicit` (chamador conhece de antemão — manual, api, make, import)
 *  2. trackable_link (sinal mais específico — operador criou o link)
 *  3. meta_ctwa (ctwaClid do payload)
 *  4. google_ads (gclid > utm google)
 *  5. canal de mensagem (whatsapp/instagram/telegram/web_chat)
 *  6. qualificationSource / source com regras específicas
 *  7. organic (tem utm mas não casa)
 *  8. direct (fallback final)
 */
export function deriveLeadOrigin(input: DeriveOriginInput): OriginType {
  const {
    trackableLinkId, ctwaClid, gclid, utmSource, source, qualificationSource, channel, explicit,
  } = input

  // 1. Origem explícita (chamador sabe — manual/api/make/import)
  if (explicit && ORIGIN_TYPES.includes(explicit)) return explicit

  // 2. Trackable link (mais específico)
  if (trackableLinkId) return 'trackable_link'

  // 3. CTWA (Click to WhatsApp)
  if (ctwaClid) return 'meta_ctwa'

  // 4. Google Ads
  const utmLower = (utmSource ?? '').toLowerCase().trim()
  if (gclid) return 'google_ads'
  if (utmLower && GOOGLE_UTM.has(utmLower)) return 'google_ads'

  // 5. Meta Lead Ads (form interno do Facebook — checa antes do source=whatsapp)
  if (qualificationSource === 'meta_lead_ads' || source === 'meta_lead_ads') return 'meta_lead_ads'

  // 6. Portal de matrículas
  if (qualificationSource === 'enrollment_portal' || source === 'enrollment_portal') return 'enrollment_portal'

  // 7. Canal de mensagem (priorizar quando explícito — independe de utm)
  const ch = (channel ?? '').toLowerCase()
  const src = (source ?? '').toLowerCase()
  if (ch === 'whatsapp' || src === 'whatsapp') {
    // Caso especial: chegou via WhatsApp mas com utm de meta/facebook → meta_ctwa
    // (cobre cenários onde o ctwaClid não foi capturado mas o utm sobreviveu).
    if (META_UTM.has(utmLower)) return 'meta_ctwa'
    return 'whatsapp'
  }
  if (ch === 'instagram' || src === 'instagram') return 'instagram'
  if (ch === 'telegram' || src === 'telegram') return 'telegram'
  if (ch === 'web_chat' || src === 'web_chat' || qualificationSource === 'web_chat_completed') return 'web_chat'

  // 8. Form web (site, landing, formulário público)
  if (
    qualificationSource === 'form'
    || src === 'web_form' || src === 'landing_page' || src === 'form'
    || src === 'site' || src === 'landing'
  ) return 'web_form'

  // 9. Chatbot completed (sem canal explícito) → web_chat (default)
  if (qualificationSource === 'chatbot_completed') return 'web_chat'

  // 10. Outros canais legacy
  if (qualificationSource === 'make' || src === 'make') return 'make'
  if (qualificationSource === 'api' || src === 'api') return 'api'
  if (qualificationSource === 'manual' || src === 'manual') return 'manual'
  if (src === 'import' || src === 'bulk' || src === 'csv') return 'import'
  if (src === 'chat') return 'chat'

  // 11. Tem utm mas não casa com nenhum canal conhecido → orgânico classificado
  if (utmLower) return 'organic'

  // 12. Fallback final
  return 'direct'
}
