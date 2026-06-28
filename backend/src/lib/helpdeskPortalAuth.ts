// src/lib/helpdeskPortalAuth.ts
// Token HMAC de sessão do solicitante no Portal de Suporte (Helpdesk).
// Emitido por magic link enviado ao e-mail; concede acesso aos chamados daquele
// e-mail. Segredo dedicado (ver secrets.ts) — separado do JWT do painel.

import crypto from 'crypto'
import { HELPDESK_PORTAL_SECRET as SECRET } from './secrets.js'

const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000 // 7 dias
const LINK_TTL_MS = 30 * 60 * 1000 // magic link: 30 min

export interface PortalTokenPayload { email: string; exp: number }

function sign(payload: PortalTokenPayload): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const sig = crypto.createHmac('sha256', SECRET).update(body).digest('base64url')
  return `${body}.${sig}`
}

/** Token de sessão (7 dias) usado nas chamadas do portal. */
export function signPortalSession(email: string, ttlMs: number = DEFAULT_TTL_MS): string {
  return sign({ email: email.toLowerCase().trim(), exp: Date.now() + ttlMs })
}

/** Token curto (30 min) embutido no magic link enviado por e-mail. */
export function signMagicLink(email: string): string {
  return sign({ email: email.toLowerCase().trim(), exp: Date.now() + LINK_TTL_MS })
}

export function verifyPortalToken(token: string | null | undefined): PortalTokenPayload | null {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null
  const [body, sig] = token.split('.')
  if (!body || !sig) return null
  const expected = crypto.createHmac('sha256', SECRET).update(body).digest('base64url')
  // timingSafeEqual exige buffers do mesmo tamanho
  const a = Buffer.from(sig), b = Buffer.from(expected)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString()) as PortalTokenPayload
    if (!payload.email || !payload.exp || Date.now() > payload.exp) return null
    return payload
  } catch {
    return null
  }
}

/** Extrai o e-mail do solicitante do request (header Authorization: Bearer ou ?t=). */
export function requesterFromReq(req: any): string | null {
  const header = (req.headers?.authorization as string) || ''
  const bearer = header.startsWith('Bearer ') ? header.slice(7) : null
  const token = bearer || (req.query?.t as string) || null
  return verifyPortalToken(token)?.email ?? null
}
