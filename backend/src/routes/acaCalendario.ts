// src/routes/acaCalendario.ts
// Módulo Acadêmico · O2.5 — Calendário acadêmico (datas letivas, provas, eventos).
// Eventos por período (ou globais / por turma). Admin CRUD + helper p/ o portal.

import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { authMiddleware } from '../lib/auth.js'

/** Próximos eventos relevantes para um aluno (período da matrícula + globais + turma). */
export async function proximosEventosDoAluno(alunoId: number, dias = 90) {
  const mats = await prisma.acaMatricula.findMany({ where: { alunoId, status: 'MATRICULADO' }, select: { turmaId: true, turma: { select: { periodoLetivoId: true } } } })
  const periodoIds = [...new Set(mats.map((m) => m.turma.periodoLetivoId))]
  const turmaIds = mats.map((m) => m.turmaId)
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0)
  const limite = new Date(hoje.getTime() + dias * 86400_000)
  return prisma.acaEvento.findMany({
    where: {
      dataInicio: { gte: hoje, lte: limite },
      OR: [{ periodoLetivoId: null, turmaId: null }, { periodoLetivoId: { in: periodoIds }, turmaId: null }, { turmaId: { in: turmaIds } }],
    },
    orderBy: { dataInicio: 'asc' }, take: 30,
  })
}

export async function acaCalendarioRoutes(app: FastifyInstance) {
  // ── Listar eventos (filtros: período, intervalo) ──
  app.get('/api/admin/aca/eventos', { preHandler: authMiddleware }, async (req) => {
    const q = req.query as any
    const where: any = {}
    if (q.periodoLetivoId) where.periodoLetivoId = Number(q.periodoLetivoId)
    if (q.de || q.ate) where.dataInicio = { ...(q.de ? { gte: new Date(q.de) } : {}), ...(q.ate ? { lte: new Date(q.ate) } : {}) }
    const eventos = await prisma.acaEvento.findMany({ where, orderBy: { dataInicio: 'asc' }, take: 500 })
    return { eventos }
  })

  app.post('/api/admin/aca/eventos', { preHandler: authMiddleware }, async (req, reply) => {
    const b = (req.body as any) || {}
    if (!b.titulo || !b.dataInicio) return reply.code(400).send({ error: 'titulo e dataInicio são obrigatórios' })
    const evento = await prisma.acaEvento.create({ data: {
      titulo: String(b.titulo).slice(0, 191), descricao: b.descricao || null, tipo: String(b.tipo || 'EVENTO').slice(0, 20),
      periodoLetivoId: b.periodoLetivoId ? Number(b.periodoLetivoId) : null, turmaId: b.turmaId ? Number(b.turmaId) : null,
      dataInicio: new Date(b.dataInicio), dataFim: b.dataFim ? new Date(b.dataFim) : null, diaInteiro: b.diaInteiro !== false, cor: b.cor || null,
    } })
    return reply.code(201).send({ evento })
  })

  app.put('/api/admin/aca/eventos/:id', { preHandler: authMiddleware }, async (req) => {
    const id = Number((req.params as any).id); const b = (req.body as any) || {}
    const data: any = {}
    if ('titulo' in b) data.titulo = String(b.titulo).slice(0, 191)
    if ('descricao' in b) data.descricao = b.descricao || null
    if ('tipo' in b) data.tipo = String(b.tipo).slice(0, 20)
    if ('periodoLetivoId' in b) data.periodoLetivoId = b.periodoLetivoId ? Number(b.periodoLetivoId) : null
    if ('turmaId' in b) data.turmaId = b.turmaId ? Number(b.turmaId) : null
    if ('dataInicio' in b) data.dataInicio = new Date(b.dataInicio)
    if ('dataFim' in b) data.dataFim = b.dataFim ? new Date(b.dataFim) : null
    if ('diaInteiro' in b) data.diaInteiro = !!b.diaInteiro
    if ('cor' in b) data.cor = b.cor || null
    return { evento: await prisma.acaEvento.update({ where: { id }, data }) }
  })

  app.delete('/api/admin/aca/eventos/:id', { preHandler: authMiddleware }, async (req) => {
    await prisma.acaEvento.delete({ where: { id: Number((req.params as any).id) } }).catch(() => {})
    return { ok: true }
  })
}
