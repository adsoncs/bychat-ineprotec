import { FastifyRequest, FastifyReply } from 'fastify'
import jwt from 'jsonwebtoken'
import crypto from 'crypto'
import { isTokenBlacklisted } from '../services/security.js'

if (!process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET env var is required. Server cannot start without it.')
}
const JWT_SECRET = process.env.JWT_SECRET
// Access token curto (15min). Renovação é por refresh token rotativo
// em cookie httpOnly via POST /api/admin/refresh — ver lib/refreshToken.ts.
const JWT_EXPIRES = process.env.JWT_EXPIRES || '15m'

export interface JwtPayload {
  userId: number
  email: string
  name: string
  role: string
  jti?: string
}

export function signToken(payload: JwtPayload): string {
  return jwt.sign(
    { ...payload, jti: crypto.randomUUID() },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES } as jwt.SignOptions
  )
}

export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, JWT_SECRET) as JwtPayload
}

export async function authMiddleware(req: FastifyRequest, reply: FastifyReply) {
  const token = req.headers.authorization?.replace('Bearer ', '')
  if (!token) {
    return reply.code(401).send({ error: 'Token não fornecido' })
  }
  let payload: JwtPayload
  try {
    payload = verifyToken(token)
  } catch {
    return reply.code(401).send({ error: 'Token inválido ou expirado' })
  }
  // Verificar blacklist (fail-closed: se Redis falhar, rejeita o token por segurança)
  if (payload.jti) {
    try {
      if (await isTokenBlacklisted(payload.jti)) {
        return reply.code(401).send({ error: 'Token revogado' })
      }
    } catch (err) {
      console.error('[Auth] Redis blacklist check failed — rejecting token for safety:', (err as Error).message)
      return reply.code(503).send({ error: 'Serviço temporariamente indisponível' })
    }
  }
  ;(req as any).user = payload
}

export async function adminOnly(req: FastifyRequest, reply: FastifyReply) {
  await authMiddleware(req, reply)
  if (reply.sent) return
  const user = (req as any).user as JwtPayload
  if (user.role !== 'SUPERADMIN' && user.role !== 'ADMIN' && user.role !== 'MANAGER') {
    return reply.code(403).send({ error: 'Acesso restrito a administradores' })
  }
}

export async function superadminOnly(req: FastifyRequest, reply: FastifyReply) {
  await authMiddleware(req, reply)
  if (reply.sent) return
  const user = (req as any).user as JwtPayload
  if (user.role !== 'SUPERADMIN') {
    return reply.code(403).send({ error: 'Acesso restrito a superadmin' })
  }
}
