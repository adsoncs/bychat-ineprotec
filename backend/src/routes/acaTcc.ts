// src/routes/acaTcc.ts
// Módulo Acadêmico · F22 — TCC (rotas /api/admin/aca/tcc, sob aca_secretaria).
// Registro de Trabalho de Conclusão de Curso por matrícula.

import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { authMiddleware } from '../lib/auth.js'

const STATUS = ['REGISTRADO', 'EM_ANDAMENTO', 'ENTREGUE', 'APROVADO', 'REPROVADO']

export async function acaTccRoutes(app: FastifyInstance) {
  app.get('/api/admin/aca/tcc', { preHandler: authMiddleware }, async (req) => {
    const q = req.query as any
    const where: any = {}
    if (q.status) where.status = String(q.status)
    if (q.alunoId) where.alunoId = Number(q.alunoId)
    const rows = await prisma.acaTcc.findMany({ where, orderBy: { id: 'desc' }, take: 300 })
    const alunoIds = [...new Set(rows.map((r) => r.alunoId))]
    const alunos = alunoIds.length ? await prisma.aluno.findMany({ where: { id: { in: alunoIds } }, select: { id: true, ra: true, lead: { select: { nome: true } } } }) : []
    const aMap = new Map(alunos.map((a) => [a.id, a]))
    const counts: Record<string, number> = {}
    for (const r of rows) counts[r.status] = (counts[r.status] ?? 0) + 1
    return { tccs: rows.map((r) => ({ ...r, alunoNome: aMap.get(r.alunoId)?.lead.nome ?? '—', ra: aMap.get(r.alunoId)?.ra ?? null })), counts }
  })
  app.post('/api/admin/aca/tcc', { preHandler: authMiddleware }, async (req, reply) => {
    const b = (req.body as any) || {}
    const matriculaId = Number(b.matriculaId)
    if (!matriculaId || !b.titulo) return reply.code(400).send({ error: 'matriculaId e titulo obrigatórios' })
    const mat = await prisma.acaMatricula.findUnique({ where: { id: matriculaId }, select: { alunoId: true } })
    if (!mat) return reply.code(404).send({ error: 'Matrícula não encontrada' })
    return reply.code(201).send({ tcc: await prisma.acaTcc.create({ data: {
      matriculaId, alunoId: mat.alunoId, titulo: String(b.titulo).slice(0, 255), orientador: b.orientador || null,
      resumo: b.resumo || null, status: 'REGISTRADO',
    } }) })
  })
  app.put('/api/admin/aca/tcc/:id', { preHandler: authMiddleware }, async (req) => {
    const id = Number((req.params as any).id); const b = (req.body as any) || {}
    const data: any = {}
    if ('titulo' in b) data.titulo = String(b.titulo).slice(0, 255)
    if ('orientador' in b) data.orientador = b.orientador || null
    if ('resumo' in b) data.resumo = b.resumo || null
    if (b.status && STATUS.includes(b.status)) data.status = b.status
    if ('nota' in b) data.nota = b.nota != null && b.nota !== '' ? Number(b.nota) : null
    if ('dataDefesa' in b) data.dataDefesa = b.dataDefesa ? new Date(b.dataDefesa) : null
    return { tcc: await prisma.acaTcc.update({ where: { id }, data }) }
  })
  app.delete('/api/admin/aca/tcc/:id', { preHandler: authMiddleware }, async (req) => {
    await prisma.acaTcc.delete({ where: { id: Number((req.params as any).id) } }); return { ok: true }
  })
}
