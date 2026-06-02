import crypto from 'crypto'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { prisma } from './prisma.js'

/**
 * Refresh token rotativo com detecção de reuse.
 *
 * - Token bruto: 32 bytes random URL-safe (~256 bits de entropia).
 * - Persistido como SHA-256 hash. O token nunca volta para o servidor em
 *   claro depois da emissão; comparamos sempre por hash.
 * - Cada uso de um refresh **consome-o** (revokedAt setado) e gera um novo
 *   na mesma `family` (UUID). Se um refresh já consumido voltar, presumimos
 *   roubo e revogamos a família inteira.
 * - TTL: 30 dias (REFRESH_TTL_MS) — pode ser sobreposto via env REFRESH_TTL_DAYS.
 */

const REFRESH_TTL_DAYS = Number(process.env.REFRESH_TTL_DAYS || 30)
const REFRESH_TTL_MS = REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000
const COOKIE_NAME = 'bh_refresh'
const COOKIE_PATH = '/api/admin'

export interface IssuedRefresh {
  raw: string
  family: string
  expiresAt: Date
  id: number
}

function hashToken(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex')
}

export async function issueRefreshToken(opts: {
  userId: number
  family?: string
  replacedById?: number
  userAgent?: string | null
  ip?: string | null
}): Promise<IssuedRefresh> {
  const raw = crypto.randomBytes(32).toString('base64url')
  const family = opts.family ?? crypto.randomUUID()
  const expiresAt = new Date(Date.now() + REFRESH_TTL_MS)
  const row = await prisma.refreshToken.create({
    data: {
      userId: opts.userId,
      tokenHash: hashToken(raw),
      family,
      expiresAt,
      replacedById: opts.replacedById ?? null,
      userAgent: opts.userAgent ?? null,
      ip: opts.ip ?? null,
    },
  })
  return { raw, family, expiresAt, id: row.id }
}

export type RotateResult =
  | { kind: 'ok'; userId: number; raw: string; family: string; expiresAt: Date }
  | { kind: 'reuse'; family: string }
  | { kind: 'invalid' }
  | { kind: 'expired' }

export async function rotateRefreshToken(opts: {
  raw: string
  userAgent?: string | null
  ip?: string | null
}): Promise<RotateResult> {
  const tokenHash = hashToken(opts.raw)
  const existing = await prisma.refreshToken.findUnique({ where: { tokenHash } })
  if (!existing) return { kind: 'invalid' }

  if (existing.revokedAt) {
    // Reuse de token já consumido = sinal de roubo. Mata a família.
    await prisma.refreshToken.updateMany({
      where: { family: existing.family, revokedAt: null },
      data: { revokedAt: new Date() },
    })
    return { kind: 'reuse', family: existing.family }
  }

  if (existing.expiresAt.getTime() <= Date.now()) {
    return { kind: 'expired' }
  }

  // Revoga o atual e emite o próximo na mesma família.
  const next = await issueRefreshToken({
    userId: existing.userId,
    family: existing.family,
    userAgent: opts.userAgent ?? null,
    ip: opts.ip ?? null,
  })
  await prisma.refreshToken.update({
    where: { id: existing.id },
    data: { revokedAt: new Date(), replacedById: next.id },
  })
  return { kind: 'ok', userId: existing.userId, raw: next.raw, family: next.family, expiresAt: next.expiresAt }
}

export async function revokeFamily(family: string): Promise<void> {
  await prisma.refreshToken.updateMany({
    where: { family, revokedAt: null },
    data: { revokedAt: new Date() },
  })
}

export async function revokeAllForUser(userId: number): Promise<void> {
  await prisma.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  })
}

export async function revokeByRaw(raw: string): Promise<void> {
  const tokenHash = hashToken(raw)
  await prisma.refreshToken.updateMany({
    where: { tokenHash, revokedAt: null },
    data: { revokedAt: new Date() },
  })
}

// ── Cookie helpers (parse/set/clear sem @fastify/cookie) ──

export function readRefreshCookie(req: FastifyRequest): string | null {
  const header = req.headers['cookie']
  if (!header) return null
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq < 0) continue
    const name = part.slice(0, eq).trim()
    if (name === COOKIE_NAME) {
      const value = part.slice(eq + 1).trim()
      try {
        return decodeURIComponent(value)
      } catch {
        return value
      }
    }
  }
  return null
}

function buildCookie(value: string, expiresAt: Date | null, secure: boolean): string {
  const parts = [
    `${COOKIE_NAME}=${encodeURIComponent(value)}`,
    `Path=${COOKIE_PATH}`,
    'HttpOnly',
    'SameSite=Lax',
  ]
  if (secure) parts.push('Secure')
  if (expiresAt) parts.push(`Expires=${expiresAt.toUTCString()}`)
  else parts.push('Max-Age=0')
  return parts.join('; ')
}

function isSecureRequest(req: FastifyRequest): boolean {
  if (process.env.COOKIE_SECURE === '1') return true
  if (process.env.COOKIE_SECURE === '0') return false
  // trustProxy=true faz req.protocol respeitar X-Forwarded-Proto
  return req.protocol === 'https'
}

export function setRefreshCookie(req: FastifyRequest, reply: FastifyReply, raw: string, expiresAt: Date): void {
  reply.header('set-cookie', buildCookie(raw, expiresAt, isSecureRequest(req)))
}

export function clearRefreshCookie(req: FastifyRequest, reply: FastifyReply): void {
  reply.header('set-cookie', buildCookie('', null, isSecureRequest(req)))
}

export const REFRESH_COOKIE_NAME = COOKIE_NAME
