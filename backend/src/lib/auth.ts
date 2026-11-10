import { FastifyRequest, FastifyReply } from 'fastify'
import jwt from 'jsonwebtoken'
import crypto from 'crypto'
import { isTokenBlacklisted } from '../services/security.js'
import { prisma } from './prisma.js'

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

// ── Conta ainda ativa? ─────────────────────────────────────
// O token de acesso vale 15 min e não passa pelo banco; sem esta conferência,
// a conta desativada (ou bloqueada) seguia usando o sistema até o token vencer.
// Agora cada pedido confere a conta, com a resposta guardada por 30 s para não
// pesar no banco — e quem desativa/apaga a conta limpa a lembrança na hora
// (esquecerConta), então o corte é imediato.
const CONTA_TTL_MS = 30_000
const contaAtiva = new Map<number, { ok: boolean; ate: number }>()

export function esquecerConta(userId: number): void { contaAtiva.delete(Number(userId)) }

export async function contaLiberada(payload: JwtPayload): Promise<boolean> {
  // Tokens de serviço dos crons locais (scripts/*-cron.mjs) não são de pessoa.
  if (payload.email === 'cron@system') return true
  const id = Number(payload.userId)
  const lembrada = contaAtiva.get(id)
  if (lembrada && lembrada.ate > Date.now()) return lembrada.ok
  try {
    const u = await prisma.user.findUnique({ where: { id }, select: { active: true, lockedAt: true } })
    const ok = !!u && u.active && !u.lockedAt
    contaAtiva.set(id, { ok, ate: Date.now() + CONTA_TTL_MS })
    return ok
  } catch (err) {
    // Banco fora do ar: não derruba todo mundo por isso (o resto também falharia).
    console.error('[Auth] conferência da conta falhou:', (err as Error).message)
    return true
  }
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
  if (!(await contaLiberada(payload))) {
    return reply.code(401).send({ error: 'Conta desativada' })
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

// adminStrict — restringe a ADMIN/SUPERADMIN (exclui MANAGER). Use em rotas
// sensíveis onde MANAGER não deve operar: gestão de usuários, leitura/escrita de
// segredos (settings), API keys e conexões de pagamento. `adminOnly` (que inclui
// MANAGER) permanece para operação cotidiana.
export async function adminStrict(req: FastifyRequest, reply: FastifyReply) {
  await authMiddleware(req, reply)
  if (reply.sent) return
  const user = (req as any).user as JwtPayload
  if (user.role !== 'SUPERADMIN' && user.role !== 'ADMIN') {
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
