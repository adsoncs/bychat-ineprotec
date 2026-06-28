// src/routes/acaGed.ts
// Módulo Acadêmico · F21 — GED (rotas /api/admin/aca/ged). Documentos do aluno
// anexados por link, classificados por tipo, com conferência.

import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { authMiddleware } from '../lib/auth.js'

export async function acaGedRoutes(app: FastifyInstance) {
  app.get('/api/admin/aca/ged', { preHandler: authMiddleware }, async (req) => {
    const alunoId = Number((req.query as any)?.alunoId)
    if (!alunoId) return { arquivos: [] }
    const arquivos = await prisma.acaGedArquivo.findMany({ where: { alunoId }, orderBy: { id: 'desc' } })
    const counts: Record<string, number> = {}
    for (const a of arquivos) counts[a.status] = (counts[a.status] ?? 0) + 1
    return { arquivos, counts }
  })
  app.post('/api/admin/aca/ged', { preHandler: authMiddleware }, async (req, reply) => {
    const b = (req.body as any) || {}
    if (!b.alunoId || !b.nome || !b.url) return reply.code(400).send({ error: 'alunoId, nome e url obrigatórios' })
    const aluno = await prisma.aluno.findUnique({ where: { id: Number(b.alunoId) }, select: { id: true } })
    if (!aluno) return reply.code(404).send({ error: 'Aluno não encontrado' })
    return reply.code(201).send({ arquivo: await prisma.acaGedArquivo.create({ data: {
      alunoId: Number(b.alunoId), tipo: String(b.tipo || 'Documento').slice(0, 60), nome: String(b.nome).slice(0, 191),
      url: String(b.url), observacao: b.observacao || null,
    } }) })
  })
  app.put('/api/admin/aca/ged/:id', { preHandler: authMiddleware }, async (req) => {
    const id = Number((req.params as any).id); const b = (req.body as any) || {}
    const data: any = {}
    if (b.status && ['RECEBIDO', 'CONFERIDO', 'PENDENTE'].includes(b.status)) data.status = b.status
    if ('observacao' in b) data.observacao = b.observacao || null
    return { arquivo: await prisma.acaGedArquivo.update({ where: { id }, data }) }
  })
  app.delete('/api/admin/aca/ged/:id', { preHandler: authMiddleware }, async (req) => {
    await prisma.acaGedArquivo.delete({ where: { id: Number((req.params as any).id) } }); return { ok: true }
  })
}
