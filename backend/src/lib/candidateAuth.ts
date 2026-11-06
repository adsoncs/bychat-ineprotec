// src/lib/candidateAuth.ts
// Assinatura HMAC do token do candidato. Compartilhado entre:
//   - candidatePortal.ts (login com candidateCode + CPF gera token de sessão)
//   - enrollmentPortals.ts (submit do portal público devolve um token de upload
//     curto, para que o candidato possa anexar o boletim ENEM imediatamente
//     após criar a inscrição, sem ter que fazer login no /candidato/:code)
//
// Mesmo SECRET nos dois caminhos para que o token gerado pelo submit possa ser
// usado depois no portal do candidato sem renovação.

import crypto from 'crypto'
import { CANDIDATE_SECRET as SECRET } from './secrets.js'

const DEFAULT_TTL_MS = 60 * 60 * 1000  // 1h — basta para o candidato terminar a inscrição

export interface CandidateTokenPayload {
  enrollmentId: number
  candidateCode: string
  exp: number
  /** De onde a pessoa age: 'painel' = portal logado. Ausente = tela de
   *  inscrição. Vai assinado, então decide qual sequência de etapas (e travas)
   *  vale sem que o navegador possa escolher. */
  onde?: 'painel'
}

/** Sequência de etapas que vale para este token (services/portalJornada). */
export function ondeDoToken(p: { onde?: string } | null | undefined): 'inscricao' | 'painel' {
  return p?.onde === 'painel' ? 'painel' : 'inscricao'
}

export function signCandidateToken(
  enrollmentId: number,
  candidateCode: string,
  ttlMs: number = DEFAULT_TTL_MS,
  onde?: 'inscricao' | 'painel',
): string {
  const payload: CandidateTokenPayload = { enrollmentId, candidateCode, exp: Date.now() + ttlMs, ...(onde === 'painel' ? { onde } : {}) }
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const sig = crypto.createHmac('sha256', SECRET).update(body).digest('base64url')
  return `${body}.${sig}`
}

/**
 * `toleranciaMs`: aceita token vencido há até esse tempo (assinatura continua
 * obrigatória). Só para quem não pode perder trabalho por causa do relógio —
 * a redação: a pessoa escreve por mais de 1h e o envio não pode cair em 401.
 */
export function verifyCandidateToken(token: string | null | undefined, opts: { toleranciaMs?: number } = {}): CandidateTokenPayload | null {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null
  const [body, sig] = token.split('.')
  const expected = crypto.createHmac('sha256', SECRET).update(body).digest('base64url')
  // timingSafeEqual evita ataque de timing (Buffer.from para igualar tamanhos)
  if (sig.length !== expected.length) return null
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null
  try {
    const payload: CandidateTokenPayload = JSON.parse(Buffer.from(body, 'base64url').toString())
    if (!payload || typeof payload.exp !== 'number' || payload.exp + (opts.toleranciaMs ?? 0) < Date.now()) return null
    return payload
  } catch { return null }
}

// Magic link de continuação (portais 'interest' → continuationPortal 'full').
// Diferente do candidateToken: aponta para um Lead (que ainda nem tem
// EnrollmentRegistration), válido por dias (TTL configurável por portal).
// O candidato clica e o portal abre pré-preenchido pra completar a inscrição.

export interface MagicLinkPayload {
  leadId: number
  portalSlug: string  // slug do portal de continuação
  exp: number
  kind: 'continue'
}

export function signMagicLink(leadId: number, portalSlug: string, ttlDays: number = 30): string {
  const payload: MagicLinkPayload = {
    leadId,
    portalSlug,
    exp: Date.now() + ttlDays * 24 * 60 * 60 * 1000,
    kind: 'continue',
  }
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const sig = crypto.createHmac('sha256', SECRET).update(body).digest('base64url')
  return `${body}.${sig}`
}

export function verifyMagicLink(token: string | null | undefined): MagicLinkPayload | null {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null
  const [body, sig] = token.split('.')
  const expected = crypto.createHmac('sha256', SECRET).update(body).digest('base64url')
  if (sig.length !== expected.length) return null
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null
  try {
    const payload: MagicLinkPayload = JSON.parse(Buffer.from(body, 'base64url').toString())
    if (!payload || payload.kind !== 'continue') return null
    if (typeof payload.exp !== 'number' || payload.exp < Date.now()) return null
    if (typeof payload.leadId !== 'number' || typeof payload.portalSlug !== 'string') return null
    return payload
  } catch { return null }
}

// Continuação de FORMULÁRIO (form do site → portal). Mais estreito que o magic
// link: quem o recebe é só quem acabou de enviar o formulário público, então
// ele (1) dura horas, não dias; (2) traz o id do ENVIO — o prefill sai do que
// foi digitado nele, nunca do cadastro do lead; (3) não abre inscrição já
// existente (a rota /continue recusa e pede login). Um magic link de
// secretaria continua sendo o único caminho que retoma uma inscrição.
export interface FormContinuePayload {
  leadId: number
  portalSlug: string
  submissionId: number
  exp: number
  kind: 'form'
}

export function signFormContinue(leadId: number, portalSlug: string, submissionId: number, ttlHours: number = 6): string {
  const payload: FormContinuePayload = {
    leadId, portalSlug, submissionId,
    exp: Date.now() + ttlHours * 60 * 60 * 1000,
    kind: 'form',
  }
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const sig = crypto.createHmac('sha256', SECRET).update(body).digest('base64url')
  return `${body}.${sig}`
}

export function verifyFormContinue(token: string | null | undefined): FormContinuePayload | null {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null
  const [body, sig] = token.split('.')
  const expected = crypto.createHmac('sha256', SECRET).update(body).digest('base64url')
  if (!sig || sig.length !== expected.length) return null
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null
  try {
    const payload: FormContinuePayload = JSON.parse(Buffer.from(body, 'base64url').toString())
    if (!payload || payload.kind !== 'form') return null
    if (typeof payload.exp !== 'number' || payload.exp < Date.now()) return null
    if (typeof payload.leadId !== 'number' || typeof payload.portalSlug !== 'string' || typeof payload.submissionId !== 'number') return null
    return payload
  } catch { return null }
}

// Sessão de ATENDIMENTO (inscrição assistida): o atendente abre o portal pelo
// painel e faz a inscrição com o candidato. O token vai no cabeçalho
// X-Attrae-Atendente de cada pedido do portal — é ele que identifica quem da
// equipe fez cada passo (services/inscricaoAssistida.ts). Curto (2h) e preso a
// um portal; com leadId, também serve de link de continuação para aquele lead.
export interface AtendimentoPayload {
  userId: number
  /** Nome para a faixa do portal ("Atendimento por Fulano"). */
  nome: string
  portalSlug: string
  leadId: number | null
  /** Matrícula interna: a equipe trabalha fora da ordem das etapas. */
  interno?: boolean
  exp: number
  kind: 'atendimento'
}

export function signAtendimento(p: { userId: number; nome: string; portalSlug: string; leadId?: number | null; interno?: boolean }, ttlHours: number = 2): string {
  const payload: AtendimentoPayload = {
    userId: p.userId, nome: p.nome, portalSlug: p.portalSlug, leadId: p.leadId ?? null,
    ...(p.interno ? { interno: true } : {}),
    exp: Date.now() + ttlHours * 60 * 60 * 1000,
    kind: 'atendimento',
  }
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const sig = crypto.createHmac('sha256', SECRET).update(body).digest('base64url')
  return `${body}.${sig}`
}

export function verifyAtendimento(token: string | null | undefined): AtendimentoPayload | null {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null
  const [body, sig] = token.split('.')
  const expected = crypto.createHmac('sha256', SECRET).update(body).digest('base64url')
  if (!sig || sig.length !== expected.length) return null
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null
  try {
    const payload: AtendimentoPayload = JSON.parse(Buffer.from(body, 'base64url').toString())
    if (!payload || payload.kind !== 'atendimento') return null
    if (typeof payload.exp !== 'number' || payload.exp < Date.now()) return null
    if (typeof payload.userId !== 'number' || typeof payload.portalSlug !== 'string') return null
    if (payload.leadId != null && typeof payload.leadId !== 'number') return null
    return payload
  } catch { return null }
}
