// src/routes/coupons.ts
// CRUD admin de cupons + endpoint público de validação (apenas calcula desconto,
// NÃO aplica no checkout ainda — integração futura).

import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { authMiddleware, adminOnly, type JwtPayload } from '../lib/auth.js'

const COUPON_TYPES = ['percent', 'fixed'] as const
type CouponType = typeof COUPON_TYPES[number]

function normalizeCode(s: string): string {
  return String(s || '').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 50)
}

function summarize(c: any) {
  return {
    id: c.id,
    code: c.code,
    description: c.description,
    type: c.type,
    value: Number(c.value),
    minAmount: c.minAmount !== null && c.minAmount !== undefined ? Number(c.minAmount) : null,
    maxDiscount: c.maxDiscount !== null && c.maxDiscount !== undefined ? Number(c.maxDiscount) : null,
    usageLimit: c.usageLimit,
    usageCount: c.usageCount,
    perUserLimit: c.perUserLimit,
    portalIds: c.portalIds,
    validFrom: c.validFrom,
    validUntil: c.validUntil,
    active: c.active,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  }
}

function calcDiscount(coupon: any, amount: number): number {
  if (coupon.type === 'percent') {
    let d = (amount * Number(coupon.value)) / 100
    if (coupon.maxDiscount !== null && coupon.maxDiscount !== undefined) {
      d = Math.min(d, Number(coupon.maxDiscount))
    }
    return Math.min(d, amount)   // não pode passar do total
  }
  // fixed
  return Math.min(Number(coupon.value), amount)
}

export async function couponsRoutes(app: FastifyInstance) {
  // GET /api/admin/coupons
  app.get('/api/admin/coupons', { preHandler: authMiddleware }, async (req) => {
    const q = req.query as any
    const where: any = {}
    if (q.active === 'true') where.active = true
    if (q.active === 'false') where.active = false
    if (q.search) {
      where.OR = [
        { code: { contains: String(q.search) } },
        { description: { contains: String(q.search) } },
      ]
    }
    const limit = Math.max(1, Math.min(parseInt(q.limit) || 50, 200))
    const offset = parseInt(q.offset) || 0
    const [items, total] = await Promise.all([
      prisma.coupon.findMany({ where, orderBy: { createdAt: 'desc' }, take: limit, skip: offset }),
      prisma.coupon.count({ where }),
    ])
    return { items: items.map(summarize), total, limit, offset }
  })

  // GET /api/admin/coupons/:id (com redemptions recentes)
  app.get('/api/admin/coupons/:id', { preHandler: authMiddleware }, async (req, reply) => {
    const { id } = req.params as any
    const c = await prisma.coupon.findUnique({
      where: { id: parseInt(id) },
      include: {
        redemptions: { orderBy: { redeemedAt: 'desc' }, take: 50 },
      },
    })
    if (!c) return reply.code(404).send({ error: 'Cupom não encontrado' })
    return {
      coupon: summarize(c),
      redemptions: c.redemptions.map(r => ({
        id: r.id,
        registrationId: r.registrationId,
        amountBefore: Number(r.amountBefore),
        discountValue: Number(r.discountValue),
        amountAfter: Number(r.amountAfter),
        redeemedAt: r.redeemedAt,
      })),
    }
  })

  // POST /api/admin/coupons
  app.post('/api/admin/coupons', { preHandler: adminOnly }, async (req, reply) => {
    const body = (req.body as any) || {}
    const user = (req as any).user as JwtPayload

    const code = normalizeCode(body.code)
    if (code.length < 3) return reply.code(400).send({ error: 'Código inválido (mín 3 caracteres)' })
    if (!COUPON_TYPES.includes(body.type)) return reply.code(400).send({ error: 'Tipo inválido (use percent|fixed)' })
    const value = Number(body.value)
    if (!Number.isFinite(value) || value <= 0) return reply.code(400).send({ error: 'Valor inválido' })
    if (body.type === 'percent' && value > 100) return reply.code(400).send({ error: 'Percentual máx 100%' })

    const exists = await prisma.coupon.findUnique({ where: { code } })
    if (exists) return reply.code(409).send({ error: `Código '${code}' já cadastrado` })

    const c = await prisma.coupon.create({
      data: {
        code,
        description: body.description ? String(body.description).substring(0, 255) : null,
        type: body.type as CouponType,
        value,
        minAmount: body.minAmount ? Number(body.minAmount) : null,
        maxDiscount: body.maxDiscount ? Number(body.maxDiscount) : null,
        usageLimit: body.usageLimit ? parseInt(body.usageLimit) : null,
        perUserLimit: body.perUserLimit ? parseInt(body.perUserLimit) : 1,
        portalIds: Array.isArray(body.portalIds) && body.portalIds.length > 0 ? body.portalIds.map((x: any) => parseInt(x)) : null,
        validFrom: body.validFrom ? new Date(body.validFrom) : null,
        validUntil: body.validUntil ? new Date(body.validUntil) : null,
        active: body.active !== false,
        createdBy: user.userId,
      },
    })
    return reply.code(201).send({ ok: true, coupon: summarize(c) })
  })

  // PUT /api/admin/coupons/:id
  app.put('/api/admin/coupons/:id', { preHandler: adminOnly }, async (req, reply) => {
    const { id } = req.params as any
    const body = (req.body as any) || {}
    const data: any = {}

    if (body.code !== undefined) {
      const code = normalizeCode(body.code)
      if (code.length < 3) return reply.code(400).send({ error: 'Código inválido' })
      const dup = await prisma.coupon.findFirst({ where: { code, NOT: { id: parseInt(id) } } })
      if (dup) return reply.code(409).send({ error: `Código '${code}' já cadastrado` })
      data.code = code
    }
    if (body.description !== undefined) data.description = body.description ? String(body.description).substring(0, 255) : null
    if (body.type !== undefined) {
      if (!COUPON_TYPES.includes(body.type)) return reply.code(400).send({ error: 'Tipo inválido' })
      data.type = body.type
    }
    if (body.value !== undefined) {
      const v = Number(body.value)
      if (!Number.isFinite(v) || v <= 0) return reply.code(400).send({ error: 'Valor inválido' })
      data.value = v
    }
    if (body.minAmount !== undefined) data.minAmount = body.minAmount ? Number(body.minAmount) : null
    if (body.maxDiscount !== undefined) data.maxDiscount = body.maxDiscount ? Number(body.maxDiscount) : null
    if (body.usageLimit !== undefined) data.usageLimit = body.usageLimit ? parseInt(body.usageLimit) : null
    if (body.perUserLimit !== undefined) data.perUserLimit = parseInt(body.perUserLimit) || 1
    if (body.portalIds !== undefined) {
      data.portalIds = Array.isArray(body.portalIds) && body.portalIds.length > 0
        ? body.portalIds.map((x: any) => parseInt(x))
        : null
    }
    if (body.validFrom !== undefined) data.validFrom = body.validFrom ? new Date(body.validFrom) : null
    if (body.validUntil !== undefined) data.validUntil = body.validUntil ? new Date(body.validUntil) : null
    if (body.active !== undefined) data.active = !!body.active

    try {
      const c = await prisma.coupon.update({ where: { id: parseInt(id) }, data })
      return { ok: true, coupon: summarize(c) }
    } catch (e: any) {
      return reply.code(404).send({ error: e.message })
    }
  })

  // DELETE /api/admin/coupons/:id
  app.delete('/api/admin/coupons/:id', { preHandler: adminOnly }, async (req, reply) => {
    const { id } = req.params as any
    const usedBy = await prisma.couponRedemption.count({ where: { couponId: parseInt(id) } })
    if (usedBy > 0) {
      // Não permite excluir — desativa em vez.
      return reply.code(400).send({
        error: `Cupom já foi usado ${usedBy} vez(es). Desative em vez de excluir para preservar histórico.`,
      })
    }
    try {
      await prisma.coupon.delete({ where: { id: parseInt(id) } })
      return { ok: true }
    } catch (e: any) {
      return reply.code(404).send({ error: e.message })
    }
  })

  // GET /api/public/coupons/validate?code=&amount=&portalId=
  // Endpoint público que retorna o desconto calculado SEM consumir o cupom.
  // Usado pelo portal de inscrição quando o candidato digitar um código.
  // Aplicação efetiva (incremento de usageCount + criação de redemption) só
  // acontecerá no /payment-init quando integrarmos com checkout.
  app.get('/api/public/coupons/validate', async (req, reply) => {
    const q = req.query as any
    const code = normalizeCode(q.code || '')
    const amount = Number(q.amount)
    const portalId = q.portalId ? parseInt(q.portalId) : null
    if (code.length < 3) return reply.code(400).send({ error: 'Código inválido' })
    if (!Number.isFinite(amount) || amount <= 0) return reply.code(400).send({ error: 'Valor inválido' })

    const c = await prisma.coupon.findUnique({ where: { code } })
    if (!c) return reply.code(404).send({ valid: false, reason: 'Cupom não encontrado' })
    if (!c.active) return reply.send({ valid: false, reason: 'Cupom inativo' })
    const now = new Date()
    if (c.validFrom && c.validFrom > now) return reply.send({ valid: false, reason: 'Cupom ainda não está disponível' })
    if (c.validUntil && c.validUntil < now) return reply.send({ valid: false, reason: 'Cupom expirado' })
    if (c.usageLimit && c.usageCount >= c.usageLimit) {
      return reply.send({ valid: false, reason: 'Cupom esgotado' })
    }
    if (c.minAmount && amount < Number(c.minAmount)) {
      return reply.send({
        valid: false,
        reason: `Valor mínimo para o cupom: R$ ${Number(c.minAmount).toFixed(2)}`,
      })
    }
    if (Array.isArray(c.portalIds) && c.portalIds.length > 0 && portalId) {
      const allowed = (c.portalIds as any[]).map(Number).includes(portalId)
      if (!allowed) return reply.send({ valid: false, reason: 'Cupom não aplicável a este portal' })
    }

    const discount = calcDiscount(c, amount)
    return {
      valid: true,
      code: c.code,
      type: c.type,
      description: c.description,
      amountBefore: amount,
      discountValue: discount,
      amountAfter: Math.max(0, amount - discount),
    }
  })
}
