// src/routes/acaDocente.ts
// Módulo Acadêmico · F14 — Docente / RH Acadêmico (rotas /api/admin/aca/docente).

import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { authMiddleware } from '../lib/auth.js'
import { calcValorAtividade, gerarAceitesPendentes, resumoCompetencia } from '../services/acaDocente.js'

export async function acaDocenteRoutes(app: FastifyInstance) {
  // ── Usuários (picker de professor) ──
  app.get('/api/admin/aca/docente/usuarios', { preHandler: authMiddleware }, async (req) => {
    const q = String((req.query as any)?.q || '').trim()
    const where: any = {}
    if (q) where.OR = [{ name: { contains: q } }, { email: { contains: q } }]
    const users = await prisma.user.findMany({ where, take: 100, orderBy: { name: 'asc' }, select: { id: true, name: true, email: true } })
    const docentes = await prisma.acaDocente.findMany({ select: { userId: true } })
    const jaDocente = new Set(docentes.map((d) => d.userId))
    return { usuarios: users.map((u) => ({ ...u, jaDocente: jaDocente.has(u.id) })) }
  })

  // ── Docentes ──
  app.get('/api/admin/aca/docente/docentes', { preHandler: authMiddleware }, async () => {
    const rows = await prisma.acaDocente.findMany({ orderBy: { id: 'desc' }, include: { _count: { select: { aceites: true } } } })
    const userIds = rows.map((r) => r.userId)
    const users = userIds.length ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, email: true } }) : []
    const uMap = new Map(users.map((u) => [u.id, u]))
    return { docentes: rows.map((r) => ({ ...r, nome: uMap.get(r.userId)?.name ?? `User #${r.userId}`, email: uMap.get(r.userId)?.email ?? null, aceites: r._count.aceites })) }
  })
  app.post('/api/admin/aca/docente/docentes', { preHandler: authMiddleware }, async (req, reply) => {
    const b = (req.body as any) || {}
    const userId = Number(b.userId)
    if (!userId) return reply.code(400).send({ error: 'userId obrigatório' })
    if (await prisma.acaDocente.findUnique({ where: { userId }, select: { id: true } })) return reply.code(409).send({ error: 'Usuário já é docente' })
    return reply.code(201).send({ docente: await prisma.acaDocente.create({ data: {
      userId, titulacao: b.titulacao || null, regime: ['HORISTA', 'PARCIAL', 'INTEGRAL'].includes(b.regime) ? b.regime : 'HORISTA',
      valorHoraCentavos: Math.max(0, Number(b.valorHoraCentavos) || 0), observacao: b.observacao || null,
    } }) })
  })
  app.put('/api/admin/aca/docente/docentes/:id', { preHandler: authMiddleware }, async (req) => {
    const id = Number((req.params as any).id); const b = (req.body as any) || {}
    const data: any = {}
    if ('titulacao' in b) data.titulacao = b.titulacao || null
    if ('regime' in b && ['HORISTA', 'PARCIAL', 'INTEGRAL'].includes(b.regime)) data.regime = b.regime
    if ('valorHoraCentavos' in b) data.valorHoraCentavos = Math.max(0, Number(b.valorHoraCentavos) || 0)
    if ('ativo' in b) data.ativo = !!b.ativo
    if ('observacao' in b) data.observacao = b.observacao || null
    return { docente: await prisma.acaDocente.update({ where: { id }, data }) }
  })

  // ── Tipos de atividade ──
  app.get('/api/admin/aca/docente/tipos', { preHandler: authMiddleware }, async () => ({ tipos: await prisma.acaTipoAtividadeDocente.findMany({ orderBy: { id: 'asc' } }) }))
  app.post('/api/admin/aca/docente/tipos', { preHandler: authMiddleware }, async (req, reply) => {
    const b = (req.body as any) || {}
    if (!b.nome) return reply.code(400).send({ error: 'nome obrigatório' })
    return reply.code(201).send({ tipo: await prisma.acaTipoAtividadeDocente.create({ data: { nome: String(b.nome).slice(0, 120), fatorHora: Number(b.fatorHora) || 1 } }) })
  })
  app.put('/api/admin/aca/docente/tipos/:id', { preHandler: authMiddleware }, async (req) => {
    const id = Number((req.params as any).id); const b = (req.body as any) || {}
    const data: any = {}
    if ('nome' in b) data.nome = String(b.nome).slice(0, 120)
    if ('fatorHora' in b) data.fatorHora = Number(b.fatorHora) || 1
    if ('ativo' in b) data.ativo = !!b.ativo
    return { tipo: await prisma.acaTipoAtividadeDocente.update({ where: { id }, data }) }
  })

  // ── Atividades docentes ──
  app.get('/api/admin/aca/docente/atividades', { preHandler: authMiddleware }, async (req) => {
    const q = req.query as any
    const where: any = {}
    if (q.docenteId) where.docenteId = Number(q.docenteId)
    if (q.competencia) where.competencia = String(q.competencia)
    const rows = await prisma.acaAtividadeDocente.findMany({ where, orderBy: { id: 'desc' }, take: 500 })
    const tipoIds = [...new Set(rows.map((r) => r.tipoId))]
    const tipos = tipoIds.length ? await prisma.acaTipoAtividadeDocente.findMany({ where: { id: { in: tipoIds } }, select: { id: true, nome: true } }) : []
    const tMap = new Map(tipos.map((t) => [t.id, t.nome]))
    return { atividades: rows.map((r) => ({ ...r, tipoNome: tMap.get(r.tipoId) ?? '—' })) }
  })
  app.post('/api/admin/aca/docente/atividades', { preHandler: authMiddleware }, async (req, reply) => {
    const b = (req.body as any) || {}
    const docenteId = Number(b.docenteId); const tipoId = Number(b.tipoId)
    if (!docenteId || !tipoId || !b.competencia) return reply.code(400).send({ error: 'docenteId, tipoId e competencia obrigatórios' })
    const docente = await prisma.acaDocente.findUnique({ where: { id: docenteId }, select: { valorHoraCentavos: true } })
    const tipo = await prisma.acaTipoAtividadeDocente.findUnique({ where: { id: tipoId }, select: { fatorHora: true } })
    if (!docente || !tipo) return reply.code(404).send({ error: 'Docente ou tipo não encontrado' })
    const horas = Number(b.horas) || 0
    const valorHora = b.valorHoraCentavos != null ? Math.max(0, Number(b.valorHoraCentavos)) : docente.valorHoraCentavos
    const fator = tipo.fatorHora
    return reply.code(201).send({ atividade: await prisma.acaAtividadeDocente.create({ data: {
      docenteId, tipoId, competencia: String(b.competencia).slice(0, 7), descricao: b.descricao || null,
      horas, valorHoraCentavos: valorHora, fatorHora: fator, valorCentavos: calcValorAtividade(horas, valorHora, fator),
    } }) })
  })
  app.put('/api/admin/aca/docente/atividades/:id', { preHandler: authMiddleware }, async (req) => {
    const id = Number((req.params as any).id); const b = (req.body as any) || {}
    const data: any = {}
    if (b.status && ['LANCADA', 'APROVADA', 'PAGA'].includes(b.status)) data.status = b.status
    return { atividade: await prisma.acaAtividadeDocente.update({ where: { id }, data }) }
  })
  app.delete('/api/admin/aca/docente/atividades/:id', { preHandler: authMiddleware }, async (req) => {
    await prisma.acaAtividadeDocente.delete({ where: { id: Number((req.params as any).id) } }); return { ok: true }
  })
  app.post('/api/admin/aca/docente/atividades/calcular', { preHandler: authMiddleware }, async (req, reply) => {
    const b = (req.body as any) || {}
    if (!b.competencia) return reply.code(400).send({ error: 'competencia obrigatória' })
    return resumoCompetencia(String(b.competencia).slice(0, 7))
  })

  // ── Aceites / disponibilidade ──
  app.get('/api/admin/aca/docente/aceites', { preHandler: authMiddleware }, async (req) => {
    const q = req.query as any
    const where: any = {}
    if (q.docenteId) where.docenteId = Number(q.docenteId)
    if (q.status) where.status = String(q.status)
    const rows = await prisma.acaDocenteAceite.findMany({ where, orderBy: { id: 'desc' }, take: 300 })
    const diarioIds = [...new Set(rows.map((r) => r.diarioId))]
    const diarios = diarioIds.length ? await prisma.acaDiario.findMany({ where: { id: { in: diarioIds } }, select: { id: true, disciplinaId: true, turmaId: true } }) : []
    const discIds = [...new Set(diarios.map((d) => d.disciplinaId))]
    const turmaIds = [...new Set(diarios.map((d) => d.turmaId))]
    const [discs, turmas] = await Promise.all([
      discIds.length ? prisma.acaDisciplina.findMany({ where: { id: { in: discIds } }, select: { id: true, nome: true } }) : [],
      turmaIds.length ? prisma.acaTurma.findMany({ where: { id: { in: turmaIds } }, select: { id: true, nome: true } }) : [],
    ])
    const dscMap = new Map(discs.map((d) => [d.id, d.nome]))
    const trmMap = new Map(turmas.map((t) => [t.id, t.nome]))
    const diMap = new Map(diarios.map((d) => [d.id, { turma: trmMap.get(d.turmaId) ?? '—', disciplina: dscMap.get(d.disciplinaId) ?? '—' }]))
    return { aceites: rows.map((r) => ({ ...r, diario: diMap.get(r.diarioId) ?? null })) }
  })
  app.post('/api/admin/aca/docente/aceites/gerar', { preHandler: authMiddleware }, async (req, reply) => {
    const b = (req.body as any) || {}
    if (!b.docenteId) return reply.code(400).send({ error: 'docenteId obrigatório' })
    try { return await gerarAceitesPendentes(Number(b.docenteId)) }
    catch (e: any) { return reply.code(400).send({ error: e?.message || 'falha' }) }
  })
  app.put('/api/admin/aca/docente/aceites/:id', { preHandler: authMiddleware }, async (req) => {
    const id = Number((req.params as any).id); const b = (req.body as any) || {}
    const data: any = {}
    if (b.status && ['PENDENTE', 'ACEITO', 'RECUSADO'].includes(b.status)) { data.status = b.status; if (b.status !== 'PENDENTE') data.decididoEm = new Date() }
    if ('observacao' in b) data.observacao = b.observacao || null
    return { aceite: await prisma.acaDocenteAceite.update({ where: { id }, data }) }
  })
}
