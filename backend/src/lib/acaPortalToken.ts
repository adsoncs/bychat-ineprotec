// src/lib/acaPortalToken.ts
// Token STATELESS (HMAC) dos portais acadêmicos (aluno/professor). Compartilhado
// entre as rotas do portal e o serviço de comunicação (gera o link nos avisos).

import crypto from 'crypto'

const SECRET = process.env.JWT_SECRET || 'dev-secret'
export type PortalKind = 'aca-aluno' | 'aca-prof'
export interface PortalToken { kind: PortalKind; id: number; exp: number }

export function mintPortalToken(kind: PortalKind, id: number, dias = 30): string {
  const body = Buffer.from(JSON.stringify({ kind, id, exp: Date.now() + dias * 86400_000 })).toString('base64url')
  const sig = crypto.createHmac('sha256', SECRET).update(body).digest('base64url')
  return `${body}~${sig}`
}

export function verifyPortalToken(token: string | undefined, kind: PortalKind): PortalToken | null {
  if (!token || !token.includes('~')) return null
  const [body, sig] = token.split('~')
  const expected = crypto.createHmac('sha256', SECRET).update(body).digest('base64url')
  if (sig.length !== expected.length) return null
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null
  try {
    const p: PortalToken = JSON.parse(Buffer.from(body, 'base64url').toString())
    if (!p || p.kind !== kind || typeof p.exp !== 'number' || p.exp < Date.now() || typeof p.id !== 'number') return null
    return p
  } catch { return null }
}

/** Link público do portal do aluno (usado nos avisos). */
export function alunoPortalLink(alunoId: number, dias = 30): string {
  const base = (process.env.APP_URL || '').replace(/\/$/, '')
  return `${base}/portal/aca/aluno?t=${encodeURIComponent(mintPortalToken('aca-aluno', alunoId, dias))}`
}
