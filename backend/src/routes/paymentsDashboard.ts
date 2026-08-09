// src/routes/paymentsDashboard.ts
// Endpoints admin do painel de pagamentos: KPIs, lista, gráficos, webhook audit.

import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { authMiddleware } from '../lib/auth.js'
import { resolvePeriod } from '../lib/period.js'

// `from`/`to` chegam como YYYY-MM-DD do seletor de período; o resolvedor
// compartilhado ancora o fim no último instante do dia — antes, `new Date(q.to)`
// virava meia-noite e o dia final ficava de fora da conta.
const parseDateRange = (q: any) => resolvePeriod(q, 30)

export async function paymentsDashboardRoutes(app: FastifyInstance) {
  // ── KPIs ──────────────────────────────────────────────
  // GET /api/admin/payments/overview?days=30
  // Retorna totais do período + comparação com período anterior.
  app.get('/api/admin/payments/overview', { preHandler: authMiddleware }, async (req) => {
    const q = req.query as any
    const { from, to, days } = parseDateRange(q)
    const prevFrom = new Date(from.getTime() - (to.getTime() - from.getTime()))

    // Agrega EnrollmentPaymentMethod por status no período.
    // Modo 'link' antigo não tem rows aqui, então também agregamos via EnrollmentRegistration.
    const [methodAgg, prevMethodAgg, regAgg, prevRegAgg, webhookCount] = await Promise.all([
      prisma.enrollmentPaymentMethod.groupBy({
        by: ['status'],
        where: { createdAt: { gte: from, lte: to } },
        _count: { _all: true },
        _sum: { amount: true },
      }),
      prisma.enrollmentPaymentMethod.groupBy({
        by: ['status'],
        where: { createdAt: { gte: prevFrom, lt: from } },
        _count: { _all: true },
        _sum: { amount: true },
      }),
      prisma.enrollmentRegistration.groupBy({
        by: ['paymentStatus'],
        where: {
          paymentStatus: { not: null },
          createdAt: { gte: from, lte: to },
          portal: { paymentMode: 'link' },
        },
        _count: { _all: true },
        _sum: { paymentAmount: true },
      }),
      prisma.enrollmentRegistration.groupBy({
        by: ['paymentStatus'],
        where: {
          paymentStatus: { not: null },
          createdAt: { gte: prevFrom, lt: from },
          portal: { paymentMode: 'link' },
        },
        _count: { _all: true },
        _sum: { paymentAmount: true },
      }),
      prisma.paymentWebhookHit.count({ where: { receivedAt: { gte: from, lte: to } } }),
    ])

    // Junta agregados de PaymentMethod (transparente) + EnrollmentRegistration (link).
    function summarize(methodRows: any[], regRows: any[]) {
      const byStatus: Record<string, { count: number; total: number }> = {}
      const accum = (st: string, count: number, total: number) => {
        if (!byStatus[st]) byStatus[st] = { count: 0, total: 0 }
        byStatus[st].count += count
        byStatus[st].total += total
      }
      for (const r of methodRows) accum(r.status, r._count._all, Number(r._sum.amount || 0))
      for (const r of regRows) {
        if (r.paymentStatus) accum(r.paymentStatus, r._count._all, Number(r._sum.paymentAmount || 0))
      }
      return byStatus
    }

    const cur = summarize(methodAgg, regAgg)
    const prev = summarize(prevMethodAgg, prevRegAgg)

    const totalCur = Object.values(cur).reduce((a, b) => a + b.count, 0)
    const totalPrev = Object.values(prev).reduce((a, b) => a + b.count, 0)
    const revenueCur = (cur.paid?.total || 0)
    const revenuePrev = (prev.paid?.total || 0)
    const paidCount = cur.paid?.count || 0
    const ticketMedio = paidCount > 0 ? revenueCur / paidCount : 0
    const conversionRate = totalCur > 0 ? paidCount / totalCur : 0

    return {
      period: { from, to, days },
      byStatus: cur,
      totals: {
        all: totalCur,
        paid: paidCount,
        pending: cur.pending?.count || 0,
        failed: (cur.failed?.count || 0) + (cur.overdue?.count || 0) + (cur.expired?.count || 0),
        refunded: cur.refunded?.count || 0,
      },
      revenue: {
        total: revenueCur,
        pending: cur.pending?.total || 0,
        prev: revenuePrev,
        growthPct: revenuePrev > 0 ? ((revenueCur - revenuePrev) / revenuePrev) * 100 : null,
      },
      ticketMedio,
      conversionRate,
      webhookCount,
    }
  })

  // ── Lista de cobranças ────────────────────────────────
  // GET /api/admin/payments/methods?status=&provider=&method=&portalId=&search=&limit=&offset=&days=
  app.get('/api/admin/payments/methods', { preHandler: authMiddleware }, async (req) => {
    const q = req.query as any
    const { from, to } = parseDateRange(q)
    const where: any = { createdAt: { gte: from, lte: to } }
    if (q.status) where.status = String(q.status)
    if (q.provider) where.provider = String(q.provider)
    if (q.method) where.method = String(q.method)
    if (q.portalId) where.registration = { portalId: parseInt(q.portalId) }
    if (q.search) {
      where.OR = [
        { externalId: { contains: String(q.search) } },
        { registration: { candidateCode: { contains: String(q.search) } } },
      ]
    }
    const limit = Math.max(1, Math.min(parseInt(q.limit) || 50, 200))
    const offset = parseInt(q.offset) || 0

    const [items, total] = await Promise.all([
      prisma.enrollmentPaymentMethod.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
        include: {
          registration: {
            select: {
              id: true, candidateCode: true, paymentStatus: true,
              lead: { select: { id: true, nome: true, email: true } },
              portal: { select: { id: true, nome: true } },
            },
          },
        },
      }),
      prisma.enrollmentPaymentMethod.count({ where }),
    ])

    return {
      items: items.map(m => ({
        id: m.id,
        method: m.method,
        provider: m.provider,
        status: m.status,
        amount: Number(m.amount),
        externalId: m.externalId,
        expiresAt: m.expiresAt,
        paidAt: m.paidAt,
        cardBrand: m.cardBrand,
        cardLastDigits: m.cardLastDigits,
        boletoLine: m.boletoLine,
        boletoPdfUrl: m.boletoPdfUrl,
        lastErrorMessage: m.lastErrorMessage,
        createdAt: m.createdAt,
        registration: m.registration ? {
          id: m.registration.id,
          candidateCode: m.registration.candidateCode,
          paymentStatus: m.registration.paymentStatus,
          lead: m.registration.lead,
          portal: m.registration.portal,
        } : null,
      })),
      total, limit, offset,
    }
  })

  // ── Timeline ──────────────────────────────────────────
  // GET /api/admin/payments/timeseries?days=30
  // Série diária paid/pending/failed (agrupa por dia em UTC).
  app.get('/api/admin/payments/timeseries', { preHandler: authMiddleware }, async (req) => {
    const q = req.query as any
    const { from, to, days } = parseDateRange(q)

    // Raw SQL pra agrupar por dia eficientemente.
    const rows = await prisma.$queryRawUnsafe<any[]>(`
      SELECT
        DATE(createdAt) as day,
        status,
        COUNT(*) as count,
        COALESCE(SUM(amount), 0) as total
      FROM bychat_enrollment_payment_methods
      WHERE createdAt >= ? AND createdAt <= ?
      GROUP BY day, status
      ORDER BY day ASC
    `, from, to)

    // Indexa por dia
    const byDay: Record<string, { day: string; paid: number; pending: number; failed: number; revenue: number }> = {}
    function key(d: Date): string { return d.toISOString().slice(0, 10) }

    // Preenche dias faltantes (gráfico sem buracos)
    for (let i = 0; i <= days; i++) {
      const d = new Date(from.getTime() + i * 86400 * 1000)
      byDay[key(d)] = { day: key(d), paid: 0, pending: 0, failed: 0, revenue: 0 }
    }

    for (const r of rows) {
      const k = (r.day instanceof Date ? r.day : new Date(r.day)).toISOString().slice(0, 10)
      if (!byDay[k]) byDay[k] = { day: k, paid: 0, pending: 0, failed: 0, revenue: 0 }
      const count = Number(r.count)
      const total = Number(r.total)
      if (r.status === 'paid') {
        byDay[k].paid += count
        byDay[k].revenue += total
      } else if (r.status === 'pending') {
        byDay[k].pending += count
      } else {
        byDay[k].failed += count
      }
    }

    return { days, series: Object.values(byDay).sort((a, b) => a.day.localeCompare(b.day)) }
  })

  // ── Breakdown por método e provider ───────────────────
  app.get('/api/admin/payments/breakdown', { preHandler: authMiddleware }, async (req) => {
    const q = req.query as any
    const { from, to } = parseDateRange(q)
    const where: any = { createdAt: { gte: from, lte: to } }

    const [byMethod, byProvider, byPortal] = await Promise.all([
      prisma.enrollmentPaymentMethod.groupBy({
        by: ['method', 'status'],
        where,
        _count: { _all: true },
        _sum: { amount: true },
      }),
      prisma.enrollmentPaymentMethod.groupBy({
        by: ['provider', 'status'],
        where,
        _count: { _all: true },
        _sum: { amount: true },
      }),
      // top portais
      prisma.$queryRawUnsafe<any[]>(`
        SELECT p.id, p.nome, COUNT(*) as count, SUM(m.amount) as total,
               SUM(CASE WHEN m.status='paid' THEN 1 ELSE 0 END) as paidCount,
               SUM(CASE WHEN m.status='paid' THEN m.amount ELSE 0 END) as paidTotal
        FROM bychat_enrollment_payment_methods m
        JOIN bychat_enrollment_registrations r ON r.id = m.registrationId
        JOIN bychat_enrollment_portals p ON p.id = r.portalId
        WHERE m.createdAt BETWEEN ? AND ?
        GROUP BY p.id, p.nome
        ORDER BY paidTotal DESC
        LIMIT 10
      `, from, to),
    ])

    function flatten(rows: any[], dim: string) {
      const out: Record<string, { name: string; paid: number; pending: number; failed: number; total: number }> = {}
      for (const r of rows) {
        const k = r[dim]
        if (!out[k]) out[k] = { name: k, paid: 0, pending: 0, failed: 0, total: 0 }
        const c = r._count._all
        if (r.status === 'paid') out[k].paid += c
        else if (r.status === 'pending') out[k].pending += c
        else out[k].failed += c
        out[k].total += c
      }
      return Object.values(out)
    }

    return {
      byMethod: flatten(byMethod, 'method'),
      byProvider: flatten(byProvider, 'provider'),
      byPortal: byPortal.map(p => ({
        id: p.id,
        name: p.nome,
        count: Number(p.count),
        paidCount: Number(p.paidCount),
        paidTotal: Number(p.paidTotal),
        total: Number(p.total),
      })),
    }
  })

  // ── Webhook hits (auditoria) ──────────────────────────
  // GET /api/admin/payments/webhook-hits?provider=&status=&days=&limit=&offset=
  app.get('/api/admin/payments/webhook-hits', { preHandler: authMiddleware }, async (req) => {
    const q = req.query as any
    const { from, to } = parseDateRange(q)
    const where: any = { receivedAt: { gte: from, lte: to } }
    if (q.provider) where.provider = String(q.provider)
    if (q.status) where.status = String(q.status)
    if (q.eventType) where.eventType = String(q.eventType)
    if (q.externalId) where.externalId = String(q.externalId)
    const limit = Math.max(1, Math.min(parseInt(q.limit) || 50, 200))
    const offset = parseInt(q.offset) || 0

    const [items, total, statusAgg] = await Promise.all([
      prisma.paymentWebhookHit.findMany({
        where,
        orderBy: { receivedAt: 'desc' },
        take: limit,
        skip: offset,
        include: {
          connection: { select: { id: true, name: true, provider: true } },
        },
      }),
      prisma.paymentWebhookHit.count({ where }),
      prisma.paymentWebhookHit.groupBy({
        by: ['status'],
        where: { receivedAt: { gte: from, lte: to } },
        _count: { _all: true },
      }),
    ])

    const statusCounts: Record<string, number> = {}
    for (const r of statusAgg) statusCounts[r.status] = r._count._all

    return {
      items: items.map(h => ({
        id: h.id,
        provider: h.provider,
        eventType: h.eventType,
        externalId: h.externalId,
        status: h.status,
        registrationId: h.registrationId,
        errorMessage: h.errorMessage,
        signatureValid: h.signatureValid,
        remoteIp: h.remoteIp,
        userAgent: h.userAgent,
        receivedAt: h.receivedAt,
        connection: h.connection,
        // Payload completo só quando solicitado (parametro ?withPayload=1) — pra reduzir tráfego
        ...(q.withPayload === '1' ? { payload: h.payload } : {}),
      })),
      total, limit, offset,
      statusCounts,
    }
  })

  // Detalhe completo de UM hit (com payload).
  app.get('/api/admin/payments/webhook-hits/:id', { preHandler: authMiddleware }, async (req, reply) => {
    const { id } = req.params as any
    const hit = await prisma.paymentWebhookHit.findUnique({
      where: { id: parseInt(id) },
      include: { connection: { select: { id: true, name: true, provider: true } } },
    })
    if (!hit) return reply.code(404).send({ error: 'Hit não encontrado' })
    return { hit }
  })
}
