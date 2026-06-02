import { FastifyRequest, FastifyReply } from 'fastify'
import crypto from 'crypto'
import { prisma } from './prisma.js'

// ── Types ───────────────────────────────────────
export type ApiPermission =
  | 'leads:read' | 'leads:write'
  | 'tags:read' | 'tags:write'
  | 'funnels:read' | 'funnels:write'
  | 'stages:read' | 'stages:write'
  | 'activities:read' | 'activities:write'
  | 'contacts:read' | 'contacts:write'
  | 'webhooks:manage'

export const ALL_PERMISSIONS: ApiPermission[] = [
  'leads:read', 'leads:write',
  'tags:read', 'tags:write',
  'funnels:read', 'funnels:write',
  'stages:read', 'stages:write',
  'activities:read', 'activities:write',
  'contacts:read', 'contacts:write',
  'webhooks:manage',
]

export interface ApiKeyPayload {
  apiKeyId: number
  name: string
  permissions: ApiPermission[]
}

// ── Rate limiting in-memory ─────────────────────
const rateLimitMap = new Map<number, { count: number; resetAt: number }>()

function checkApiKeyRateLimit(apiKeyId: number, limit: number): boolean {
  const now = Date.now()
  const entry = rateLimitMap.get(apiKeyId)

  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(apiKeyId, { count: 1, resetAt: now + 60_000 })
    return false
  }

  entry.count++
  if (entry.count > limit) return true
  return false
}

// Limpa entradas expiradas a cada 5 min
setInterval(() => {
  const now = Date.now()
  for (const [id, entry] of rateLimitMap) {
    if (now > entry.resetAt) rateLimitMap.delete(id)
  }
}, 300_000)

// ── Key generation ──────────────────────────────
export function generateApiKey(): { key: string; prefix: string } {
  const raw = crypto.randomBytes(32).toString('base64url')
  const key = `byc_${raw}`
  const prefix = key.substring(0, 8)
  return { key, prefix }
}

export function hashApiKey(key: string): string {
  return crypto.createHash('sha256').update(key).digest('hex')
}

// ── Middleware factory ──────────────────────────
export function requireApiKey(...requiredPerms: ApiPermission[]) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const apiKey = req.headers['x-api-key'] as string | undefined

    if (!apiKey) {
      return reply.code(401).send({
        error: 'API key required',
        message: 'Provide your API key via the X-API-Key header',
      })
    }

    const hashedKey = hashApiKey(apiKey)
    const record = await prisma.apiKey.findUnique({ where: { key: hashedKey } })

    if (!record || !record.active) {
      return reply.code(401).send({ error: 'Invalid or inactive API key' })
    }

    if (record.expiresAt && record.expiresAt < new Date()) {
      return reply.code(401).send({ error: 'API key expired' })
    }

    const permissions = record.permissions as ApiPermission[]

    for (const perm of requiredPerms) {
      if (!permissions.includes(perm)) {
        return reply.code(403).send({
          error: 'Insufficient permissions',
          required: requiredPerms,
          granted: permissions,
        })
      }
    }

    // Rate limit
    if (checkApiKeyRateLimit(record.id, record.rateLimit)) {
      const entry = rateLimitMap.get(record.id)!
      reply.header('X-RateLimit-Limit', record.rateLimit)
      reply.header('X-RateLimit-Remaining', 0)
      reply.header('X-RateLimit-Reset', Math.ceil(entry.resetAt / 1000))
      return reply.code(429).send({
        error: 'Rate limit exceeded',
        retryAfter: Math.ceil((entry.resetAt - Date.now()) / 1000),
      })
    }

    // Set rate limit headers
    const entry = rateLimitMap.get(record.id)!
    reply.header('X-RateLimit-Limit', record.rateLimit)
    reply.header('X-RateLimit-Remaining', Math.max(0, record.rateLimit - entry.count))
    reply.header('X-RateLimit-Reset', Math.ceil(entry.resetAt / 1000))

    // Update last used (fire-and-forget)
    prisma.apiKey.update({
      where: { id: record.id },
      data: { lastUsedAt: new Date(), totalCalls: { increment: 1 } },
    }).catch(() => {})

    // Attach to request
    ;(req as any).apiKey = {
      apiKeyId: record.id,
      name: record.name,
      permissions,
    } as ApiKeyPayload
  }
}

// ── Logging helper ──────────────────────────────
export async function logApiCall(
  req: FastifyRequest,
  reply: FastifyReply,
  startTime: number,
) {
  const apiKeyPayload = (req as any).apiKey as ApiKeyPayload | undefined
  if (!apiKeyPayload) return

  prisma.apiKeyLog.create({
    data: {
      apiKeyId: apiKeyPayload.apiKeyId,
      method: req.method,
      path: req.url.split('?')[0],
      statusCode: reply.statusCode,
      duration: Date.now() - startTime,
      ip: req.ip,
      userAgent: (req.headers['user-agent'] || '').substring(0, 500),
    },
  }).catch(() => {})
}
