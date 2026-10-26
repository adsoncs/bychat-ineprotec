// src/routes/emailSupressoes.ts
//
// Endereços que não recebem mais e-mail (Configurações › E-mail): os que a
// Resend devolveu (bounce) ou que marcaram como spam, mais os bloqueados à mão.
// Desbloquear é decisão de gente — o sistema só bloqueia sozinho.

import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { adminOnly, type JwtPayload } from '../lib/auth.js'

export async function emailSupressoesRoutes(app: FastifyInstance) {
  app.get('/api/admin/email-supressoes', { preHandler: adminOnly }, async (req) => {
    const q = String((req.query as { q?: string }).q ?? '').trim().toLowerCase()
    const itens = await prisma.emailSupressao.findMany({
      where: q ? { email: { contains: q } } : {},
      orderBy: { criadoEm: 'desc' }, take: 500,
    })
    const porMotivo = await prisma.emailSupressao.groupBy({ by: ['motivo'], _count: { _all: true } })
    return { itens, total: porMotivo.reduce((s, m) => s + m._count._all, 0), porMotivo: Object.fromEntries(porMotivo.map((m) => [m.motivo, m._count._all])) }
  })

  app.post('/api/admin/email-supressoes', { preHandler: adminOnly }, async (req, reply) => {
    const u = (req as any).user as JwtPayload
    const email = String((req.body as { email?: string })?.email ?? '').trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return reply.code(400).send({ error: 'E-mail inválido' })
    const s = await prisma.emailSupressao.upsert({ where: { email }, update: {}, create: { email, motivo: 'manual', criadoPor: u?.email ?? null } })
    return s
  })

  app.delete('/api/admin/email-supressoes/:id', { preHandler: adminOnly }, async (req, reply) => {
    const id = Number((req.params as { id: string }).id)
    const s = await prisma.emailSupressao.findUnique({ where: { id } })
    if (!s) return reply.code(404).send({ error: 'Não encontrado' })
    await prisma.emailSupressao.delete({ where: { id } })
    return { ok: true }
  })
}
