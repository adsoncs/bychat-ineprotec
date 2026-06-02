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

const SECRET = process.env.CANDIDATE_SECRET || process.env.JWT_SECRET || 'bychat-candidate-secret'
const DEFAULT_TTL_MS = 60 * 60 * 1000  // 1h — basta para o candidato terminar a inscrição

export interface CandidateTokenPayload {
  enrollmentId: number
  candidateCode: string
  exp: number
}

export function signCandidateToken(
  enrollmentId: number,
  candidateCode: string,
  ttlMs: number = DEFAULT_TTL_MS,
): string {
  const payload: CandidateTokenPayload = { enrollmentId, candidateCode, exp: Date.now() + ttlMs }
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const sig = crypto.createHmac('sha256', SECRET).update(body).digest('base64url')
  return `${body}.${sig}`
}

export function verifyCandidateToken(token: string | null | undefined): CandidateTokenPayload | null {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null
  const [body, sig] = token.split('.')
  const expected = crypto.createHmac('sha256', SECRET).update(body).digest('base64url')
  // timingSafeEqual evita ataque de timing (Buffer.from para igualar tamanhos)
  if (sig.length !== expected.length) return null
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null
  try {
    const payload: CandidateTokenPayload = JSON.parse(Buffer.from(body, 'base64url').toString())
    if (!payload || typeof payload.exp !== 'number' || payload.exp < Date.now()) return null
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
