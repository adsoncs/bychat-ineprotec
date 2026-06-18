// src/routes/acaRequerimento.ts
// Módulo Acadêmico · O2.2 — Secretaria Virtual / Requerimentos (admin).
// Fila de solicitações do aluno com protocolo, SLA e workflow. Ao DEFERIR um
// tipo que gera documento, emite o documento automaticamente.

import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { authMiddleware } from '../lib/auth.js'
import { emitirDocumentoAluno, type DocTipo } from '../services/acaDocumentos.js'

export async function proximoProtocolo(): Promise<string> {
  const ano = new Date().getFullYear()
  const count = await prisma.acaRequerimento.count({ where: { protocolo: { startsWith: `REQ-${ano}-` } } })
  return `REQ-${ano}-${String(count + 1).padStart(4, '0')}`
}

export async function acaRequerimentoRoutes(app: FastifyInstance) {
  // ── Tipos de requerimento (config) ──
  app.get('/api/admin/aca/requerimento-tipos', { preHandler: authMiddleware }, async () => ({ tipos: await prisma.acaRequerimentoTipo.findMany({ orderBy: [{ ordem: 'asc' }, { id: 'asc' }] }) }))
  app.post('/api/admin/aca/requerimento-tipos', { preHandler: authMiddleware }, async (req, reply) => {
    const b = (req.body as any) || {}
    if (!b.nome) return reply.code(400).send({ error: 'nome obrigatório' })
    const tipo = await prisma.acaRequerimentoTipo.create({ data: { nome: String(b.nome).slice(0, 120), descricao: b.descricao || null, slaDias: Number(b.slaDias) || 5, geraDocumento: b.geraDocumento || null, ordem: Number(b.ordem) || 0 } })
    return reply.code(201).send({ tipo })
  })
  app.put('/api/admin/aca/requerimento-tipos/:id', { preHandler: authMiddleware }, async (req) => {
    const id = Number((req.params as any).id); const b = (req.body as any) || {}
    const data: any = {}
    for (const k of ['nome', 'descricao', 'geraDocumento']) if (k in b) data[k] = b[k] || null
    if ('slaDias' in b) data.slaDias = Number(b.slaDias) || 5
    if ('ordem' in b) data.ordem = Number(b.ordem) || 0
    if ('ativo' in b) data.ativo = !!b.ativo
    return { tipo: await prisma.acaRequerimentoTipo.update({ where: { id }, data }) }
  })

  // ── Fila de requerimentos ──
  app.get('/api/admin/aca/requerimentos', { preHandler: authMiddleware }, async (req) => {
    const q = req.query as any
    const where: any = {}
    if (q.status) where.status = String(q.status)
    if (q.alunoId) where.alunoId = Number(q.alunoId)
    const reqs = await prisma.acaRequerimento.findMany({ where, orderBy: [{ createdAt: 'desc' }], take: 300 })
    const alunoIds = [...new Set(reqs.map((r) => r.alunoId))]
    const alunos = alunoIds.length ? await prisma.aluno.findMany({ where: { id: { in: alunoIds } }, select: { id: true, ra: true, lead: { select: { nome: true } } } }) : []
    const aMap = new Map(alunos.map((a) => [a.id, a]))
    const itens = reqs.map((r) => ({ ...r, ra: aMap.get(r.alunoId)?.ra ?? null, alunoNome: aMap.get(r.alunoId)?.lead.nome ?? '—' }))
    const contagem = await prisma.acaRequerimento.groupBy({ by: ['status'], _count: { _all: true } })
    const counts: Record<string, number> = {}
    for (const c of contagem) counts[c.status] = c._count._all
    return { itens, counts }
  })

  app.get('/api/admin/aca/requerimentos/:id', { preHandler: authMiddleware }, async (req, reply) => {
    const r = await prisma.acaRequerimento.findUnique({ where: { id: Number((req.params as any).id) } })
    if (!r) return reply.code(404).send({ error: 'Requerimento não encontrado' })
    const aluno = await prisma.aluno.findUnique({ where: { id: r.alunoId }, select: { ra: true, lead: { select: { nome: true, email: true, whatsapp: true } } } })
    return { requerimento: { ...r, ra: aluno?.ra ?? null, alunoNome: aluno?.lead.nome ?? '—', email: aluno?.lead.email, whatsapp: aluno?.lead.whatsapp } }
  })

  // ── Atualizar (workflow + resposta; defere → emite documento se aplicável) ──
  app.put('/api/admin/aca/requerimentos/:id', { preHandler: authMiddleware }, async (req, reply) => {
    const id = Number((req.params as any).id); const b = (req.body as any) || {}
    const r = await prisma.acaRequerimento.findUnique({ where: { id } })
    if (!r) return reply.code(404).send({ error: 'Requerimento não encontrado' })
    const userId = (req as any).user?.userId ?? null
    const data: any = {}
    if ('status' in b) data.status = String(b.status)
    if ('resposta' in b) data.resposta = b.resposta ? String(b.resposta) : null
    // ao deferir, se o tipo gera documento e ainda não gerou, emite e vincula
    if (b.status === 'DEFERIDO' && !r.documentoId && r.tipoId) {
      const tipo = await prisma.acaRequerimentoTipo.findUnique({ where: { id: r.tipoId }, select: { geraDocumento: true } })
      if (tipo?.geraDocumento) {
        try { const doc = await emitirDocumentoAluno(tipo.geraDocumento as DocTipo, r.alunoId, userId); data.documentoId = doc.id } catch { /* segue sem doc */ }
      }
    }
    if (['DEFERIDO', 'INDEFERIDO', 'CONCLUIDO'].includes(b.status)) { data.respondidoPorUserId = userId; data.respondidoEm = new Date() }
    const requerimento = await prisma.acaRequerimento.update({ where: { id }, data })
    return { requerimento }
  })
}
