import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { adminOnly } from '../lib/auth.js'
import { generateApiKey, hashApiKey, ALL_PERMISSIONS, ApiPermission } from '../lib/apiKey.js'

export async function apiKeysRoutes(app: FastifyInstance) {

  // GET /api/admin/api-keys — Listar API keys
  app.get('/api/admin/api-keys', {
    preHandler: adminOnly,
  }, async () => {
    const keys = await prisma.apiKey.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        prefix: true,
        permissions: true,
        rateLimit: true,
        active: true,
        expiresAt: true,
        lastUsedAt: true,
        totalCalls: true,
        createdBy: true,
        createdAt: true,
      },
    })
    return { data: keys }
  })

  // GET /api/admin/api-keys/permissions — Listar permissoes disponiveis
  // (must be before :id routes to avoid param conflict)
  app.get('/api/admin/api-keys/permissions', {
    preHandler: adminOnly,
  }, async () => {
    return { data: ALL_PERMISSIONS }
  })

  // POST /api/admin/api-keys — Criar nova API key
  app.post('/api/admin/api-keys', {
    preHandler: adminOnly,
  }, async (req, reply) => {
    const body = req.body as any
    if (!body.name) {
      return reply.code(400).send({ error: 'Field name is required' })
    }

    const permissions: ApiPermission[] = body.permissions || ALL_PERMISSIONS
    // Validar permissoes
    for (const p of permissions) {
      if (!ALL_PERMISSIONS.includes(p)) {
        return reply.code(400).send({ error: `Invalid permission: ${p}`, valid: ALL_PERMISSIONS })
      }
    }

    const { key, prefix } = generateApiKey()
    const hashedKey = hashApiKey(key)
    const user = (req as any).user

    const record = await prisma.apiKey.create({
      data: {
        name: body.name,
        key: hashedKey,
        prefix,
        permissions: permissions as any,
        rateLimit: body.rateLimit || 60,
        expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
        createdBy: user?.userId || null,
      },
    })

    // Retornar a key em texto claro APENAS na criacao
    return reply.code(201).send({
      data: {
        id: record.id,
        name: record.name,
        key, // plain text — only shown once
        prefix: record.prefix,
        permissions: record.permissions,
        rateLimit: record.rateLimit,
        expiresAt: record.expiresAt,
        createdAt: record.createdAt,
      },
      warning: 'Store this API key securely. It will not be shown again.',
    })
  })

  // PUT /api/admin/api-keys/:id — Atualizar API key
  app.put('/api/admin/api-keys/:id', {
    preHandler: adminOnly,
  }, async (req, reply) => {
    const { id } = req.params as any
    const body = req.body as any

    const existing = await prisma.apiKey.findUnique({ where: { id: parseInt(id) } })
    if (!existing) return reply.code(404).send({ error: 'API key not found' })

    const data: any = {}
    if (body.name !== undefined) data.name = body.name
    if (body.active !== undefined) data.active = body.active
    if (body.rateLimit !== undefined) data.rateLimit = body.rateLimit
    if (body.expiresAt !== undefined) data.expiresAt = body.expiresAt ? new Date(body.expiresAt) : null

    if (body.permissions) {
      for (const p of body.permissions) {
        if (!ALL_PERMISSIONS.includes(p)) {
          return reply.code(400).send({ error: `Invalid permission: ${p}` })
        }
      }
      data.permissions = body.permissions
    }

    const updated = await prisma.apiKey.update({
      where: { id: parseInt(id) },
      data,
      select: {
        id: true,
        name: true,
        prefix: true,
        permissions: true,
        rateLimit: true,
        active: true,
        expiresAt: true,
        lastUsedAt: true,
        totalCalls: true,
        createdAt: true,
        updatedAt: true,
      },
    })

    return { data: updated }
  })

  // DELETE /api/admin/api-keys/:id — Revogar API key
  app.delete('/api/admin/api-keys/:id', {
    preHandler: adminOnly,
  }, async (req, reply) => {
    const { id } = req.params as any
    const existing = await prisma.apiKey.findUnique({ where: { id: parseInt(id) } })
    if (!existing) return reply.code(404).send({ error: 'API key not found' })

    await prisma.apiKey.delete({ where: { id: parseInt(id) } })
    return { ok: true, message: 'API key revoked' }
  })

  // GET /api/admin/api-keys/:id/logs — Logs de uso
  app.get('/api/admin/api-keys/:id/logs', {
    preHandler: adminOnly,
  }, async (req, reply) => {
    const { id } = req.params as any
    const q = req.query as any
    const limit = Math.min(parseInt(q.limit) || 50, 200)
    const offset = parseInt(q.offset) || 0

    const existing = await prisma.apiKey.findUnique({ where: { id: parseInt(id) } })
    if (!existing) return reply.code(404).send({ error: 'API key not found' })

    const [data, total] = await Promise.all([
      prisma.apiKeyLog.findMany({
        where: { apiKeyId: parseInt(id) },
        orderBy: { createdAt: 'desc' },
        skip: offset,
        take: limit,
      }),
      prisma.apiKeyLog.count({ where: { apiKeyId: parseInt(id) } }),
    ])

    return { data, total, limit, offset }
  })

}
