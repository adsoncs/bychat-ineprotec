// src/routes/acaCadastros.ts
// Módulo Acadêmico · F20 — Cadastros Auxiliares (rotas /api/admin/aca/cadastros).
// Listas de apoio (áreas de conhecimento, formações, atendimentos especiais,
// tipos de documento) numa tabela flexível por `tipo`.

import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { authMiddleware } from '../lib/auth.js'

const TIPOS = ['AREA_CONHECIMENTO', 'FORMACAO', 'ATENDIMENTO_ESPECIAL', 'TIPO_DOCUMENTO']

export async function acaCadastrosRoutes(app: FastifyInstance) {
  app.get('/api/admin/aca/cadastros', { preHandler: authMiddleware }, async (req) => {
    const tipo = String((req.query as any)?.tipo || '')
    const where: any = {}
    if (tipo) where.tipo = tipo
    return { itens: await prisma.acaCadastroAux.findMany({ where, orderBy: [{ tipo: 'asc' }, { nome: 'asc' }] }) }
  })
  app.post('/api/admin/aca/cadastros', { preHandler: authMiddleware }, async (req, reply) => {
    const b = (req.body as any) || {}
    if (!b.tipo || !TIPOS.includes(b.tipo) || !b.nome) return reply.code(400).send({ error: 'tipo válido e nome obrigatórios' })
    return reply.code(201).send({ item: await prisma.acaCadastroAux.create({ data: { tipo: b.tipo, nome: String(b.nome).slice(0, 191), descricao: b.descricao || null } }) })
  })
  app.put('/api/admin/aca/cadastros/:id', { preHandler: authMiddleware }, async (req) => {
    const id = Number((req.params as any).id); const b = (req.body as any) || {}
    const data: any = {}
    if ('nome' in b) data.nome = String(b.nome).slice(0, 191)
    if ('descricao' in b) data.descricao = b.descricao || null
    if ('ativo' in b) data.ativo = !!b.ativo
    return { item: await prisma.acaCadastroAux.update({ where: { id }, data }) }
  })
  app.delete('/api/admin/aca/cadastros/:id', { preHandler: authMiddleware }, async (req) => {
    await prisma.acaCadastroAux.delete({ where: { id: Number((req.params as any).id) } }); return { ok: true }
  })
}
