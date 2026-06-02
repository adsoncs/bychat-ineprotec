import { FastifyInstance } from 'fastify'
import crypto from 'crypto'
import { prisma } from '../lib/prisma.js'
import { adminOnly } from '../lib/auth.js'
import { blockIp, refreshBlockedIpsCache, logSecurityEvent } from '../services/security.js'
import { redis } from '../lib/redis.js'
import { rotateRefreshToken, readRefreshCookie, setRefreshCookie } from '../lib/refreshToken.js'

function timingSafeEqStr(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ab.length !== bb.length) return false
  return crypto.timingSafeEqual(ab, bb)
}

export async function securityRoutes(app: FastifyInstance) {

  // ── GET /api/admin/security/events — Listar eventos de segurança ──
  app.get('/api/admin/security/events', { preHandler: adminOnly }, async (req) => {
    const { type, severity, ip, limit = '50', offset = '0', from, to } = req.query as any

    const where: any = {}
    if (type) where.type = type
    if (severity) where.severity = severity
    if (ip) where.ip = { contains: ip }
    if (from || to) {
      where.createdAt = {}
      if (from) where.createdAt.gte = new Date(from)
      if (to) where.createdAt.lte = new Date(to)
    }

    const [events, total] = await Promise.all([
      prisma.securityEvent.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: Math.min(parseInt(limit), 200),
        skip: parseInt(offset)
      }),
      prisma.securityEvent.count({ where })
    ])

    return { events, total }
  })

  // ── GET /api/admin/security/stats — Estatísticas de segurança ──
  app.get('/api/admin/security/stats', { preHandler: adminOnly }, async () => {
    const now = new Date()
    const h24 = new Date(now.getTime() - 24 * 60 * 60_000)
    const h1 = new Date(now.getTime() - 60 * 60_000)

    const [
      totalEvents24h,
      criticalEvents24h,
      loginFails24h,
      loginSuccess24h,
      activeBlocks,
      totalBlocks,
      eventsByType,
      eventsBySeverity,
      topIps
    ] = await Promise.all([
      prisma.securityEvent.count({ where: { createdAt: { gte: h24 } } }),
      prisma.securityEvent.count({ where: { createdAt: { gte: h24 }, severity: 'critical' } }),
      prisma.securityEvent.count({ where: { createdAt: { gte: h24 }, type: 'login_fail' } }),
      prisma.securityEvent.count({ where: { createdAt: { gte: h24 }, type: 'login_success' } }),
      prisma.ipBlock.count({ where: { active: true, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] } }),
      prisma.ipBlock.count(),
      prisma.securityEvent.groupBy({ by: ['type'], _count: true, where: { createdAt: { gte: h24 } }, orderBy: { _count: { type: 'desc' } } }),
      prisma.securityEvent.groupBy({ by: ['severity'], _count: true, where: { createdAt: { gte: h24 } } }),
      prisma.securityEvent.groupBy({ by: ['ip'], _count: true, where: { createdAt: { gte: h24 } }, orderBy: { _count: { ip: 'desc' } }, take: 10 })
    ])

    return {
      totalEvents24h,
      criticalEvents24h,
      loginFails24h,
      loginSuccess24h,
      activeBlocks,
      totalBlocks,
      eventsByType: eventsByType.map(e => ({ type: e.type, count: e._count })),
      eventsBySeverity: eventsBySeverity.map(e => ({ severity: e.severity, count: e._count })),
      topIps: topIps.map(e => ({ ip: e.ip, count: e._count }))
    }
  })

  // ── GET /api/admin/security/blocks — Listar IPs bloqueados ──
  app.get('/api/admin/security/blocks', { preHandler: adminOnly }, async (req) => {
    const { active, limit = '50', offset = '0' } = req.query as any

    const where: any = {}
    if (active === 'true') {
      where.active = true
      where.OR = [{ expiresAt: null }, { expiresAt: { gt: new Date() } }]
    } else if (active === 'false') {
      where.OR = [{ active: false }, { expiresAt: { lte: new Date() } }]
    }

    const [blocks, total] = await Promise.all([
      prisma.ipBlock.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: Math.min(parseInt(limit), 200),
        skip: parseInt(offset)
      }),
      prisma.ipBlock.count({ where })
    ])

    return { blocks, total }
  })

  // ── POST /api/admin/security/blocks — Bloquear IP manualmente ──
  app.post('/api/admin/security/blocks', { preHandler: adminOnly }, async (req, reply) => {
    const { ip, reason, details, duration } = req.body as any
    const user = (req as any).user

    if (!ip) return reply.code(400).send({ error: 'IP é obrigatório' })

    // Validate IP format (IPv4 or IPv6)
    const ipv4 = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/
    const ipv6 = /^[0-9a-fA-F:]+$/
    if (!ipv4.test(ip) && !ipv6.test(ip)) {
      return reply.code(400).send({ error: 'Formato de IP inválido' })
    }

    if (ip === req.ip) {
      return reply.code(400).send({ error: 'Você não pode bloquear o próprio IP de onde está requisitando.' })
    }

    await blockIp(ip, reason || 'manual', duration || undefined, details || 'Bloqueio manual via painel', user.email)
    await logSecurityEvent({
      ip, type: 'manual_block', severity: 'medium',
      email: user.email,
      details: `IP bloqueado manualmente por ${user.name} (${user.email}). Motivo: ${reason || 'manual'}${duration ? `. Duração: ${duration}min` : '. Permanente'}`
    })

    return { ok: true }
  })

  // ── PUT /api/admin/security/blocks/:id/unblock — Desbloquear IP ──
  app.put('/api/admin/security/blocks/:id/unblock', { preHandler: adminOnly }, async (req, reply) => {
    const { id } = req.params as any
    const user = (req as any).user

    const block = await prisma.ipBlock.findUnique({ where: { id: parseInt(id) } })
    if (!block) return reply.code(404).send({ error: 'Bloqueio não encontrado' })

    await prisma.ipBlock.update({ where: { id: block.id }, data: { active: false } })
    await refreshBlockedIpsCache()

    await logSecurityEvent({
      ip: block.ip, type: 'manual_unblock', severity: 'low',
      email: user.email,
      details: `IP desbloqueado por ${user.name} (${user.email})`
    })

    return { ok: true }
  })

  // ── DELETE /api/admin/security/events — Limpar eventos antigos ──
  app.delete('/api/admin/security/events', { preHandler: adminOnly }, async (req) => {
    const { days = '30' } = req.query as any
    const cutoff = new Date(Date.now() - parseInt(days) * 24 * 60 * 60_000)

    const result = await prisma.securityEvent.deleteMany({
      where: { createdAt: { lt: cutoff } }
    })

    return { deleted: result.count }
  })

  // ── GET /api/admin/security/ip/:ip — Histórico de um IP ──
  app.get('/api/admin/security/ip/:ip', { preHandler: adminOnly }, async (req) => {
    const { ip } = req.params as any

    const [events, blocks] = await Promise.all([
      prisma.securityEvent.findMany({
        where: { ip },
        orderBy: { createdAt: 'desc' },
        take: 100
      }),
      prisma.ipBlock.findMany({
        where: { ip },
        orderBy: { createdAt: 'desc' }
      })
    ])

    return { ip, events, blocks }
  })

  // ── GET /api/admin/security/me — Identidade + IP do solicitante ──
  // Usado pelo painel para destacar o próprio IP do admin nas listas e
  // desabilitar a ação de "Bloquear" sobre ele.
  app.get('/api/admin/security/me', { preHandler: adminOnly }, async (req) => {
    const user = (req as any).user
    return { ip: req.ip, email: user.email, role: user.role }
  })

  // ── POST /api/admin/security/self-unblock — Auto-desbloqueio de SUPERADMIN ──
  // Diferente de /api/emergency-unblock (que exige EMERGENCY_UNBLOCK_KEY no .env),
  // esta rota usa o cookie de refresh httpOnly. Se o solicitante já está logado
  // como SUPERADMIN com cookie válido, desbloqueia req.ip sem exigir o segredo.
  // Tem que estar na mesma allowlist do hook global de IP-block (server.ts).
  app.post('/api/admin/security/self-unblock', async (req, reply) => {
    const clientIp = req.ip
    const ua = (req.headers['user-agent'] as string) || ''

    // Rate limit por IP (5 tentativas/h) — espelha emergency-unblock
    const rlKey = `self_unblock_attempts:${clientIp}`
    const attempts = await redis.incr(rlKey)
    if (attempts === 1) await redis.expire(rlKey, 3600)
    if (attempts > 5) {
      await logSecurityEvent({
        ip: clientIp, type: 'self_unblock_rate_limited', severity: 'high',
        userAgent: ua, details: `Rate limit excedido em self-unblock (${attempts} tentativas)`
      })
      return reply.code(429).send({ error: 'Muitas tentativas. Tente em 1 hora.' })
    }

    // Valida o refresh cookie httpOnly. Se válido, faz a rotação (consome e
    // emite o próximo) e descobre o userId.
    const raw = readRefreshCookie(req)
    if (!raw) {
      await logSecurityEvent({
        ip: clientIp, type: 'self_unblock_no_cookie', severity: 'medium',
        userAgent: ua, details: 'Tentativa sem cookie de refresh'
      })
      return reply.code(401).send({ error: 'Sessão necessária. Faça login primeiro.' })
    }

    const result = await rotateRefreshToken({ raw, userAgent: ua, ip: clientIp })
    if (result.kind !== 'ok') {
      await logSecurityEvent({
        ip: clientIp, type: 'self_unblock_invalid_cookie', severity: 'high',
        userAgent: ua, details: `Cookie inválido em self-unblock: ${result.kind}`
      })
      return reply.code(401).send({ error: 'Sessão inválida ou expirada.' })
    }

    const user = await prisma.user.findUnique({ where: { id: result.userId } })
    if (!user || user.role !== 'SUPERADMIN' || !user.active || user.lockedAt) {
      await logSecurityEvent({
        ip: clientIp, type: 'self_unblock_forbidden', severity: 'high',
        email: user?.email, userAgent: ua,
        details: `User ${result.userId} sem permissão para self-unblock (role=${user?.role}, active=${user?.active}, locked=${!!user?.lockedAt})`
      })
      return reply.code(403).send({ error: 'Apenas SUPERADMIN ativo pode usar self-unblock.' })
    }

    // Persiste o novo cookie rotacionado
    setRefreshCookie(req, reply, result.raw, result.expiresAt)

    const updated = await prisma.ipBlock.updateMany({
      where: { ip: clientIp, active: true },
      data: { active: false }
    })
    await refreshBlockedIpsCache()

    await logSecurityEvent({
      ip: clientIp, type: 'self_unblock', severity: 'medium',
      email: user.email, userAgent: ua,
      details: `SUPERADMIN ${user.email} fez self-unblock do próprio IP (${updated.count} bloqueios desativados)`
    })

    return { ok: true, ip: clientIp, unblocked: updated.count }
  })

  // ── POST /api/emergency-unblock — Desbloqueio de emergencia SEM auth ──
  // Protegido por token secreto definido no .env (EMERGENCY_UNBLOCK_KEY)
  app.post('/api/emergency-unblock', async (req, reply) => {
    const clientIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim()
      || req.headers['x-real-ip'] as string
      || req.ip

    const rlKey = `emergency_unblock_attempts:${clientIp}`
    const attempts = await redis.incr(rlKey)
    if (attempts === 1) await redis.expire(rlKey, 3600)
    if (attempts > 5) {
      await logSecurityEvent({
        ip: clientIp, type: 'emergency_unblock_blocked', severity: 'high',
        details: `Rate limit excedido em emergency-unblock (${attempts} tentativas)`
      })
      return reply.code(429).send({ error: 'Muitas tentativas. Tente em 1 hora.' })
    }

    const { key } = (req.body || {}) as any
    const secret = process.env.EMERGENCY_UNBLOCK_KEY
    if (!secret) return reply.code(404).send({ error: 'Rota não encontrada' })
    if (!key || typeof key !== 'string' || !timingSafeEqStr(key, secret)) {
      await logSecurityEvent({
        ip: clientIp, type: 'emergency_unblock_invalid_key', severity: 'high',
        details: 'Tentativa com chave inválida em emergency-unblock'
      })
      return reply.code(403).send({ error: 'Chave invalida' })
    }

    const updated = await prisma.ipBlock.updateMany({
      where: { ip: clientIp, active: true },
      data: { active: false }
    })

    await refreshBlockedIpsCache()

    await logSecurityEvent({
      ip: clientIp, type: 'emergency_unblock', severity: 'medium',
      details: `Auto-desbloqueio de emergencia via API`
    })

    return { ok: true, ip: clientIp, unblocked: updated.count }
  })

  // ── GET /api/admin/security/users — Listar usuarios com status de bloqueio ──
  app.get('/api/admin/security/users', { preHandler: adminOnly }, async () => {
    const users = await prisma.user.findMany({
      select: { id: true, email: true, name: true, role: true, active: true, lockedAt: true, lockReason: true, loginAttempts: true, lastLoginAt: true, createdAt: true },
      orderBy: { createdAt: 'asc' }
    })
    return { users }
  })

  // ── PUT /api/admin/security/users/:id/lock — Bloquear usuario ──
  app.put('/api/admin/security/users/:id/lock', { preHandler: adminOnly }, async (req, reply) => {
    const { id } = req.params as any
    const { reason } = (req.body || {}) as any
    const actor = (req as any).user as any

    const user = await prisma.user.findUnique({ where: { id: parseInt(id) } })
    if (!user) return reply.code(404).send({ error: 'Usuario nao encontrado' })
    if (user.id === actor.userId) return reply.code(400).send({ error: 'Voce nao pode bloquear sua propria conta' })

    await prisma.user.update({
      where: { id: user.id },
      data: { active: false, lockedAt: new Date(), lockReason: reason || `Bloqueado manualmente por ${actor.name}`, loginAttempts: 0 }
    })

    await logSecurityEvent({
      ip: req.ip, type: 'user_manual_lock', severity: 'high',
      email: user.email, details: `Usuario ${user.email} bloqueado por ${actor.name}. Motivo: ${reason || 'Nao informado'}`
    })

    return { ok: true }
  })

  // ── PUT /api/admin/security/users/:id/unlock — Desbloquear usuario ──
  app.put('/api/admin/security/users/:id/unlock', { preHandler: adminOnly }, async (req, reply) => {
    const { id } = req.params as any
    const actor = (req as any).user as any

    const user = await prisma.user.findUnique({ where: { id: parseInt(id) } })
    if (!user) return reply.code(404).send({ error: 'Usuario nao encontrado' })

    await prisma.user.update({
      where: { id: user.id },
      data: { active: true, lockedAt: null, lockReason: null, loginAttempts: 0 }
    })

    await logSecurityEvent({
      ip: req.ip, type: 'user_manual_unlock', severity: 'medium',
      email: user.email, details: `Usuario ${user.email} desbloqueado por ${actor.name}`
    })

    return { ok: true }
  })

  // ── PUT /api/admin/security/users/:id/reset-attempts — Zerar tentativas sem desbloquear ──
  app.put('/api/admin/security/users/:id/reset-attempts', { preHandler: adminOnly }, async (req, reply) => {
    const { id } = req.params as any
    await prisma.user.update({ where: { id: parseInt(id) }, data: { loginAttempts: 0 } })
    return { ok: true }
  })
}
