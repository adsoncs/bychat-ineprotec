// src/lib/meetingExtensionAuth.ts
// Auth da EXTENSÃO Chrome de captura local. A extensão não consegue usar o JWT
// curto (15min) + refresh em cookie httpOnly, então cada usuário gera um token
// longo e revogável (header X-Meeting-Token). Guardamos só o sha256.

import { FastifyRequest, FastifyReply } from 'fastify'
import crypto from 'node:crypto'
import { prisma } from './prisma.js'
import { authMiddleware, type JwtPayload } from './auth.js'

export function hashExtensionToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex')
}

/** Gera um token novo para o usuário, grava o hash e devolve o token EM CLARO
 *  (mostrado só uma vez). Prefixo `meetext_` para reconhecimento. */
export async function generateExtensionToken(userId: number, label?: string): Promise<string> {
  const token = `meetext_${crypto.randomBytes(24).toString('hex')}`
  await prisma.meetingExtensionToken.create({
    data: { userId, tokenHash: hashExtensionToken(token), label: label?.slice(0, 120) || null },
  })
  return token
}

/** Resolve o usuário de um token de extensão (não revogado). Atualiza lastUsedAt. */
export async function resolveExtensionToken(token: string): Promise<JwtPayload | null> {
  if (!token || !token.startsWith('meetext_')) return null
  const row = await prisma.meetingExtensionToken.findUnique({ where: { tokenHash: hashExtensionToken(token) } })
  if (!row || row.revokedAt) return null
  const user = await prisma.user.findUnique({ where: { id: row.userId }, select: { id: true, email: true, name: true, role: true } })
  if (!user) return null
  // lastUsedAt best-effort (não bloqueia)
  void prisma.meetingExtensionToken.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } }).catch(() => {})
  return { userId: user.id, email: user.email, name: user.name, role: user.role }
}

/** Middleware: aceita o token da extensão (X-Meeting-Token) OU cai no JWT normal.
 *  Popula req.user igual ao authMiddleware. */
export async function extensionOrJwtAuth(req: FastifyRequest, reply: FastifyReply) {
  const extToken = (req.headers['x-meeting-token'] as string | undefined)?.trim()
  if (extToken) {
    const payload = await resolveExtensionToken(extToken)
    if (!payload) return reply.code(401).send({ error: 'Token de extensão inválido ou revogado' })
    ;(req as any).user = payload
    return
  }
  return authMiddleware(req, reply)
}
