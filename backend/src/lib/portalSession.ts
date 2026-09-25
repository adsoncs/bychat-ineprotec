// src/lib/portalSession.ts
//
// Sessão do portal público (candidato/aluno), no mesmo desenho do refresh token
// dos operadores (lib/refreshToken.ts): token opaco de 32 bytes, guardado só
// como SHA-256, rotativo por família com detecção de reuso, entregue em cookie
// httpOnly.
//
// Substitui o token HMAC que viajava na barra de endereço (`?t=...`). Aquele
// token era stateless e valia 30 dias: vazava em print, em encaminhamento de
// WhatsApp e no histórico do navegador do laboratório, e não havia como revogar
// nem saber que tinha vazado. Aqui, sair do portal encerra a sessão de verdade,
// e a secretaria pode derrubar todas as sessões de uma pessoa.

import crypto from 'crypto'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { prisma } from './prisma.js'

const TTL_DIAS = Number(process.env.PORTAL_SESSION_TTL_DAYS || 14)
const TTL_MS = TTL_DIAS * 24 * 60 * 60 * 1000
export const PORTAL_COOKIE = 'bh_portal'

// Cookie de raiz: o portal do aluno vive em /portal/aca/*, o do candidato em
// /candidato/*, e as chamadas em /api/public/*. Restringir o path faria a
// sessão sumir ao trocar de área.
const COOKIE_PATH = '/'

function hash(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex')
}

/** Cookie só com Secure quando a instalação roda em https (dev usa http). */
function cookieSeguro(): boolean {
  return String(process.env.APP_URL || '').startsWith('https://')
}

export interface SessaoEmitida { raw: string; expiresAt: Date; id: number }

export async function emitirSessao(opts: {
  accountId: number
  family?: string
  replacedById?: number
  userAgent?: string | null
  ip?: string | null
}): Promise<SessaoEmitida> {
  const raw = crypto.randomBytes(32).toString('base64url')
  const expiresAt = new Date(Date.now() + TTL_MS)
  const row = await prisma.portalSession.create({
    data: {
      accountId: opts.accountId,
      tokenHash: hash(raw),
      family: opts.family ?? crypto.randomUUID(),
      expiresAt,
      replacedById: opts.replacedById ?? null,
      userAgent: (opts.userAgent ?? null)?.slice(0, 255) ?? null,
      ip: opts.ip ?? null,
    },
    select: { id: true },
  })
  return { raw, expiresAt, id: row.id }
}

export type ResultadoSessao =
  | { ok: true; accountId: number; sessionId: number }
  | { ok: false; motivo: 'ausente' | 'invalida' | 'expirada' | 'revogada' }

/**
 * Valida a sessão do cookie. Um token já revogado que volta indica cópia em
 * circulação: derruba a família inteira, como no refresh dos operadores.
 */
export async function validarSessao(raw: string | undefined | null): Promise<ResultadoSessao> {
  if (!raw) return { ok: false, motivo: 'ausente' }
  const s = await prisma.portalSession.findUnique({
    where: { tokenHash: hash(raw) },
    select: { id: true, accountId: true, family: true, expiresAt: true, revokedAt: true },
  })
  if (!s) return { ok: false, motivo: 'invalida' }
  if (s.revokedAt) {
    await prisma.portalSession.updateMany({
      where: { family: s.family, revokedAt: null },
      data: { revokedAt: new Date() },
    })
    return { ok: false, motivo: 'revogada' }
  }
  if (s.expiresAt.getTime() < Date.now()) return { ok: false, motivo: 'expirada' }

  // lastUsedAt serve à tela "seus acessos" e à limpeza; não é caminho crítico.
  prisma.portalSession.update({ where: { id: s.id }, data: { lastUsedAt: new Date() } }).catch(() => {})
  return { ok: true, accountId: s.accountId, sessionId: s.id }
}

export async function revogarSessao(raw: string | undefined | null): Promise<void> {
  if (!raw) return
  await prisma.portalSession.updateMany({
    where: { tokenHash: hash(raw), revokedAt: null },
    data: { revokedAt: new Date() },
  })
}

/** Derruba todas as sessões da conta (troca de senha, pedido da secretaria). */
export async function revogarTudo(accountId: number): Promise<number> {
  const r = await prisma.portalSession.updateMany({
    where: { accountId, revokedAt: null },
    data: { revokedAt: new Date() },
  })
  return r.count
}

export function gravarCookie(reply: FastifyReply, raw: string, expiresAt: Date): void {
  reply.header(
    'set-cookie',
    [
      `${PORTAL_COOKIE}=${raw}`,
      `Path=${COOKIE_PATH}`,
      `Expires=${expiresAt.toUTCString()}`,
      'HttpOnly',
      'SameSite=Lax',
      ...(cookieSeguro() ? ['Secure'] : []),
    ].join('; '),
  )
}

export function limparCookie(reply: FastifyReply): void {
  reply.header(
    'set-cookie',
    `${PORTAL_COOKIE}=; Path=${COOKIE_PATH}; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Lax${cookieSeguro() ? '; Secure' : ''}`,
  )
}

/** Lê o cookie da sessão sem depender de plugin de cookie registrado. */
export function cookieDaRequisicao(req: FastifyRequest): string | null {
  const header = req.headers.cookie
  if (!header) return null
  for (const parte of header.split(';')) {
    const [k, ...resto] = parte.trim().split('=')
    if (k === PORTAL_COOKIE) return decodeURIComponent(resto.join('='))
  }
  return null
}

export const ipDaRequisicao = (req: FastifyRequest): string | null =>
  (req.headers['x-forwarded-for'] as string || '').split(',')[0].trim() || req.ip || null

/** Conta do portal por trás da requisição (cookie de sessão), ou null. */
export async function contaDaRequisicao(req: FastifyRequest): Promise<{ accountId: number; leadId: number } | null> {
  const r = await validarSessao(cookieDaRequisicao(req))
  if (!r.ok) return null
  const c = await prisma.portalAccount.findUnique({ where: { id: r.accountId }, select: { id: true, leadId: true } })
  return c ? { accountId: c.id, leadId: c.leadId } : null
}
