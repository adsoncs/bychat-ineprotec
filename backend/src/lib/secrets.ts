// src/lib/secrets.ts
// Fonte ÚNICA dos segredos de assinatura. Falha no boot se JWT_SECRET estiver
// ausente — nunca há fallback para literal previsível (um literal público no
// repo permitiria forjar tokens de sessão/portal/formulário num deploy mal
// configurado). Todo módulo que assina/verifica HMAC deve importar daqui.

if (!process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET env var is required. Server cannot start without it.')
}

/** Segredo principal — JWT do painel e HMACs gerais (forms, etc). */
export const JWT_SECRET: string = process.env.JWT_SECRET

/**
 * Segredo dos tokens de candidato/titular/preferências/links de inscrição.
 * Usa CANDIDATE_SECRET dedicado quando definido; senão recai em JWT_SECRET
 * (ambos garantidos não-vazios pelo check de boot acima).
 */
export const CANDIDATE_SECRET: string = process.env.CANDIDATE_SECRET || process.env.JWT_SECRET

/**
 * Segredo dos tokens do Portal de Suporte (Helpdesk) — magic link do solicitante.
 * Dedicado quando definido; senão recai em CANDIDATE_SECRET/JWT_SECRET.
 */
export const HELPDESK_PORTAL_SECRET: string = process.env.HELPDESK_PORTAL_SECRET || process.env.CANDIDATE_SECRET || process.env.JWT_SECRET
