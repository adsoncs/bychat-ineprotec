// src/routes/acaCurriculo.ts
// Módulo Acadêmico · F6 — Currículo Avançado (rotas /api/admin/aca/curriculo).
// Equivalências, aproveitamento de estudos (dispensa), dependências (DP) e a
// grade do aluno (matriz × resultados × aproveitamentos × dependências).

import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { authMiddleware } from '../lib/auth.js'
import { montarGrade } from '../services/acaCurriculo.js'

export async function acaCurriculoRoutes(app: FastifyInstance) {
  // ── Componentes de uma matriz (picker p/ equivalência/aproveitamento) ──
  app.get('/api/admin/aca/curriculo/componentes', { preHandler: authMiddleware }, async (req) => {
    const q = req.query as any
    const where: any = {}
    if (q.matrizId) where.matrizId = Number(q.matrizId)
    const comps = await prisma.acaComponente.findMany({
      where, orderBy: [{ matrizId: 'asc' }, { fase: 'asc' }, { id: 'asc' }], take: 500,
      select: { id: true, matrizId: true, fase: true, disciplina: { select: { nome: true, codigo: true, cargaHoraria: true } } },
    })
    return { componentes: comps.map((c) => ({ id: c.id, matrizId: c.matrizId, fase: c.fase, nome: c.disciplina?.nome ?? '—', codigo: c.disciplina?.codigo ?? null, cargaHoraria: c.disciplina?.cargaHoraria ?? 0 })) }
  })

  // ── Equivalências ──
  app.get('/api/admin/aca/curriculo/equivalencias', { preHandler: authMiddleware }, async (req) => {
    const q = req.query as any
    const where: any = {}
    if (q.componenteId) where.componenteId = Number(q.componenteId)
    const eqs = await prisma.acaEquivalencia.findMany({ where, orderBy: { id: 'desc' }, take: 300 })
    const ids = [...new Set(eqs.flatMap((e) => [e.componenteId, e.componenteEquivalenteId]))]
    const comps = ids.length ? await prisma.acaComponente.findMany({ where: { id: { in: ids } }, select: { id: true, disciplina: { select: { nome: true } } } }) : []
    const nome = new Map(comps.map((c) => [c.id, c.disciplina?.nome ?? '—']))
    return { equivalencias: eqs.map((e) => ({ ...e, componenteNome: nome.get(e.componenteId) ?? '—', equivalenteNome: nome.get(e.componenteEquivalenteId) ?? '—' })) }
  })
  app.post('/api/admin/aca/curriculo/equivalencias', { preHandler: authMiddleware }, async (req, reply) => {
    const b = (req.body as any) || {}
    if (!b.componenteId || !b.componenteEquivalenteId) return reply.code(400).send({ error: 'componenteId e componenteEquivalenteId obrigatórios' })
    if (Number(b.componenteId) === Number(b.componenteEquivalenteId)) return reply.code(400).send({ error: 'Componentes devem ser diferentes' })
    const eq = await prisma.acaEquivalencia.create({ data: { componenteId: Number(b.componenteId), componenteEquivalenteId: Number(b.componenteEquivalenteId), bidirecional: b.bidirecional !== false, observacao: b.observacao || null } })
    return reply.code(201).send({ equivalencia: eq })
  })
  app.delete('/api/admin/aca/curriculo/equivalencias/:id', { preHandler: authMiddleware }, async (req) => {
    await prisma.acaEquivalencia.delete({ where: { id: Number((req.params as any).id) } })
    return { ok: true }
  })

  // ── Aproveitamento de estudos ──
  app.get('/api/admin/aca/curriculo/aproveitamentos', { preHandler: authMiddleware }, async (req) => {
    const q = req.query as any
    const where: any = {}
    if (q.status) where.status = String(q.status)
    if (q.matriculaId) where.matriculaId = Number(q.matriculaId)
    if (q.alunoId) where.alunoId = Number(q.alunoId)
    const rows = await prisma.acaAproveitamento.findMany({ where, orderBy: { createdAt: 'desc' }, take: 300 })
    const alunoIds = [...new Set(rows.map((r) => r.alunoId))]
    const compIds = [...new Set(rows.map((r) => r.componenteId))]
    const [alunos, comps] = await Promise.all([
      alunoIds.length ? prisma.aluno.findMany({ where: { id: { in: alunoIds } }, select: { id: true, ra: true, lead: { select: { nome: true } } } }) : [],
      compIds.length ? prisma.acaComponente.findMany({ where: { id: { in: compIds } }, select: { id: true, disciplina: { select: { nome: true } } } }) : [],
    ])
    const aMap = new Map(alunos.map((a) => [a.id, a]))
    const cMap = new Map(comps.map((c) => [c.id, c.disciplina?.nome ?? '—']))
    const counts: Record<string, number> = {}
    for (const c of await prisma.acaAproveitamento.groupBy({ by: ['status'], _count: { _all: true } })) counts[c.status] = c._count._all
    return {
      aproveitamentos: rows.map((r) => ({ ...r, alunoNome: aMap.get(r.alunoId)?.lead.nome ?? '—', ra: aMap.get(r.alunoId)?.ra ?? null, componenteNome: cMap.get(r.componenteId) ?? '—' })),
      counts,
    }
  })
  app.post('/api/admin/aca/curriculo/aproveitamentos', { preHandler: authMiddleware }, async (req, reply) => {
    const b = (req.body as any) || {}
    const matriculaId = Number(b.matriculaId)
    const componenteId = Number(b.componenteId)
    if (!matriculaId || !componenteId) return reply.code(400).send({ error: 'matriculaId e componenteId obrigatórios' })
    const mat = await prisma.acaMatricula.findUnique({ where: { id: matriculaId }, select: { alunoId: true } })
    if (!mat) return reply.code(404).send({ error: 'Matrícula não encontrada' })
    const ap = await prisma.acaAproveitamento.create({
      data: {
        matriculaId, alunoId: mat.alunoId, componenteId,
        origem: ['INTERNO', 'EXTERNO', 'SUFICIENCIA'].includes(b.origem) ? b.origem : 'EXTERNO',
        instituicaoOrigem: b.instituicaoOrigem || null, disciplinaOrigem: b.disciplinaOrigem || null,
        cargaHorariaAproveitada: Math.max(0, Number(b.cargaHorariaAproveitada) || 0),
        nota: b.nota != null && b.nota !== '' ? Number(b.nota) : null,
        status: 'SOLICITADO',
      },
    })
    return reply.code(201).send({ aproveitamento: ap })
  })
  app.put('/api/admin/aca/curriculo/aproveitamentos/:id', { preHandler: authMiddleware }, async (req, reply) => {
    const id = Number((req.params as any).id); const b = (req.body as any) || {}
    const ap = await prisma.acaAproveitamento.findUnique({ where: { id } })
    if (!ap) return reply.code(404).send({ error: 'Aproveitamento não encontrado' })
    const data: any = {}
    if ('parecer' in b) data.parecer = b.parecer || null
    if ('cargaHorariaAproveitada' in b) data.cargaHorariaAproveitada = Math.max(0, Number(b.cargaHorariaAproveitada) || 0)
    if (b.status && ['SOLICITADO', 'DEFERIDO', 'INDEFERIDO'].includes(b.status)) {
      data.status = b.status
      if (b.status !== 'SOLICITADO') { data.decididoPorUserId = (req as any).user?.userId ?? null; data.decididoEm = new Date() }
    }
    return { aproveitamento: await prisma.acaAproveitamento.update({ where: { id }, data }) }
  })

  // ── Dependências (DP) ──
  app.get('/api/admin/aca/curriculo/dependencias', { preHandler: authMiddleware }, async (req) => {
    const q = req.query as any
    const where: any = {}
    if (q.matriculaId) where.matriculaId = Number(q.matriculaId)
    const rows = await prisma.acaDependencia.findMany({ where, orderBy: { id: 'desc' }, take: 300 })
    const compIds = [...new Set(rows.map((r) => r.componenteId))]
    const comps = compIds.length ? await prisma.acaComponente.findMany({ where: { id: { in: compIds } }, select: { id: true, disciplina: { select: { nome: true } } } }) : []
    const cMap = new Map(comps.map((c) => [c.id, c.disciplina?.nome ?? '—']))
    return { dependencias: rows.map((r) => ({ ...r, componenteNome: cMap.get(r.componenteId) ?? '—' })) }
  })
  app.post('/api/admin/aca/curriculo/dependencias', { preHandler: authMiddleware }, async (req, reply) => {
    const b = (req.body as any) || {}
    const matriculaId = Number(b.matriculaId); const componenteId = Number(b.componenteId)
    if (!matriculaId || !componenteId) return reply.code(400).send({ error: 'matriculaId e componenteId obrigatórios' })
    const mat = await prisma.acaMatricula.findUnique({ where: { id: matriculaId }, select: { alunoId: true } })
    if (!mat) return reply.code(404).send({ error: 'Matrícula não encontrada' })
    const dep = await prisma.acaDependencia.create({
      data: { matriculaId, alunoId: mat.alunoId, componenteId, tipo: b.tipo === 'ADAPTACAO' ? 'ADAPTACAO' : 'DEPENDENCIA', turmaId: b.turmaId ? Number(b.turmaId) : null, observacao: b.observacao || null },
    })
    return reply.code(201).send({ dependencia: dep })
  })
  app.put('/api/admin/aca/curriculo/dependencias/:id', { preHandler: authMiddleware }, async (req) => {
    const id = Number((req.params as any).id); const b = (req.body as any) || {}
    const data: any = {}
    if (b.situacao && ['EM_CURSO', 'CUMPRIDA', 'PENDENTE'].includes(b.situacao)) data.situacao = b.situacao
    if ('observacao' in b) data.observacao = b.observacao || null
    return { dependencia: await prisma.acaDependencia.update({ where: { id }, data }) }
  })

  // ── Grade do aluno ──
  app.get('/api/admin/aca/curriculo/grade/:matriculaId', { preHandler: authMiddleware }, async (req, reply) => {
    try { return await montarGrade(Number((req.params as any).matriculaId)) }
    catch (e: any) { return reply.code(e.message?.includes('não encontrada') ? 404 : 500).send({ error: e?.message || 'Erro ao montar grade' }) }
  })
}
