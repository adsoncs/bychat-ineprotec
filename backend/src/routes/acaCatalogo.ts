// src/routes/acaCatalogo.ts
// Módulo Acadêmico · P2 — Estrutura acadêmica (CRUD): Períodos Letivos,
// Disciplinas, Matriz Curricular (+ componentes) e Turmas. Reusa Course /
// CourseOffering existentes como referência. Rotas /api/admin/aca/*.

import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { authMiddleware } from '../lib/auth.js'

const TURNOS = ['MATUTINO', 'VESPERTINO', 'NOTURNO', 'INTEGRAL', 'EAD']

export async function acaCatalogoRoutes(app: FastifyInstance) {
  // ── Referências p/ selects da UI ──
  app.get('/api/admin/aca/refs', { preHandler: authMiddleware }, async () => {
    const [courses, offerings, periodos, matrizes] = await Promise.all([
      prisma.course.findMany({ where: { active: true }, select: { id: true, nome: true }, orderBy: { nome: 'asc' } }),
      prisma.courseOffering.findMany({ select: { id: true, nome: true, complemento: true, courseId: true }, orderBy: { id: 'desc' } }),
      prisma.acaPeriodoLetivo.findMany({ select: { id: true, codigo: true }, orderBy: { codigo: 'desc' } }),
      prisma.acaMatriz.findMany({ select: { id: true, courseId: true, versao: true }, orderBy: { id: 'desc' } }),
    ])
    return { courses, offerings, periodos, matrizes }
  })

  // ════════ PERÍODOS LETIVOS ════════
  app.get('/api/admin/aca/periodos', { preHandler: authMiddleware }, async () => {
    const periodos = await prisma.acaPeriodoLetivo.findMany({ orderBy: { codigo: 'desc' }, include: { _count: { select: { turmas: true } } } })
    return { periodos }
  })
  app.post('/api/admin/aca/periodos', { preHandler: authMiddleware }, async (req, reply) => {
    const b = (req.body as any) || {}
    if (!b.codigo || !b.descricao) return reply.code(400).send({ error: 'codigo e descricao são obrigatórios' })
    try {
      const periodo = await prisma.acaPeriodoLetivo.create({ data: {
        codigo: String(b.codigo).slice(0, 20), descricao: String(b.descricao).slice(0, 191),
        anoLetivo: b.anoLetivo ? Number(b.anoLetivo) : null,
        dataInicio: b.dataInicio ? new Date(b.dataInicio) : null, dataFim: b.dataFim ? new Date(b.dataFim) : null,
      } })
      return reply.code(201).send({ periodo })
    } catch { return reply.code(409).send({ error: 'Código de período já existe' }) }
  })
  app.patch('/api/admin/aca/periodos/:id', { preHandler: authMiddleware }, async (req) => {
    const id = Number((req.params as any).id); const b = (req.body as any) || {}
    const data: any = {}
    for (const k of ['descricao', 'anoLetivo', 'ativo']) if (k in b) data[k] = k === 'anoLetivo' ? Number(b[k]) : k === 'ativo' ? !!b[k] : b[k]
    if ('dataInicio' in b) data.dataInicio = b.dataInicio ? new Date(b.dataInicio) : null
    if ('dataFim' in b) data.dataFim = b.dataFim ? new Date(b.dataFim) : null
    const periodo = await prisma.acaPeriodoLetivo.update({ where: { id }, data })
    return { periodo }
  })
  app.delete('/api/admin/aca/periodos/:id', { preHandler: authMiddleware }, async (req, reply) => {
    const id = Number((req.params as any).id)
    const turmas = await prisma.acaTurma.count({ where: { periodoLetivoId: id } })
    if (turmas > 0) return reply.code(409).send({ error: `Período tem ${turmas} turma(s) — remova-as antes.` })
    await prisma.acaPeriodoLetivo.delete({ where: { id } })
    return { ok: true }
  })

  // ════════ DISCIPLINAS ════════
  app.get('/api/admin/aca/disciplinas', { preHandler: authMiddleware }, async (req) => {
    const courseId = (req.query as any).courseId ? Number((req.query as any).courseId) : undefined
    const disciplinas = await prisma.acaDisciplina.findMany({ where: courseId ? { courseId } : {}, orderBy: { nome: 'asc' } })
    return { disciplinas }
  })
  app.post('/api/admin/aca/disciplinas', { preHandler: authMiddleware }, async (req, reply) => {
    const b = (req.body as any) || {}
    if (!b.courseId || !b.nome) return reply.code(400).send({ error: 'courseId e nome são obrigatórios' })
    const disciplina = await prisma.acaDisciplina.create({ data: {
      courseId: Number(b.courseId), nome: String(b.nome).slice(0, 191), codigo: b.codigo ?? null,
      cargaHoraria: Number(b.cargaHoraria) || 0, ementa: b.ementa ?? null,
    } })
    return reply.code(201).send({ disciplina })
  })
  app.patch('/api/admin/aca/disciplinas/:id', { preHandler: authMiddleware }, async (req) => {
    const id = Number((req.params as any).id); const b = (req.body as any) || {}
    const data: any = {}
    for (const k of ['nome', 'codigo', 'ementa', 'ativo']) if (k in b) data[k] = k === 'ativo' ? !!b[k] : b[k]
    if ('cargaHoraria' in b) data.cargaHoraria = Number(b.cargaHoraria) || 0
    const disciplina = await prisma.acaDisciplina.update({ where: { id }, data })
    return { disciplina }
  })
  app.delete('/api/admin/aca/disciplinas/:id', { preHandler: authMiddleware }, async (req, reply) => {
    const id = Number((req.params as any).id)
    const inUse = await prisma.acaComponente.count({ where: { disciplinaId: id } })
    if (inUse > 0) return reply.code(409).send({ error: `Disciplina está em ${inUse} matriz(es) — remova dos componentes antes.` })
    await prisma.acaDisciplina.delete({ where: { id } })
    return { ok: true }
  })

  // ════════ MATRIZ CURRICULAR (+ componentes) ════════
  app.get('/api/admin/aca/matrizes', { preHandler: authMiddleware }, async (req) => {
    const courseId = (req.query as any).courseId ? Number((req.query as any).courseId) : undefined
    const matrizes = await prisma.acaMatriz.findMany({
      where: courseId ? { courseId } : {},
      orderBy: { id: 'desc' },
      include: {
        _count: { select: { componentes: true } },
        componentes: { include: { disciplina: { select: { nome: true, cargaHoraria: true, codigo: true } } }, orderBy: [{ fase: 'asc' }] },
      },
    })
    return { matrizes }
  })
  app.post('/api/admin/aca/matrizes', { preHandler: authMiddleware }, async (req, reply) => {
    const b = (req.body as any) || {}
    if (!b.courseId || !b.versao) return reply.code(400).send({ error: 'courseId e versao são obrigatórios' })
    const matriz = await prisma.acaMatriz.create({ data: { courseId: Number(b.courseId), versao: String(b.versao).slice(0, 40), vigenteDe: b.vigenteDe ? new Date(b.vigenteDe) : null } })
    return reply.code(201).send({ matriz })
  })
  app.post('/api/admin/aca/matrizes/:id/componentes', { preHandler: authMiddleware }, async (req, reply) => {
    const matrizId = Number((req.params as any).id); const b = (req.body as any) || {}
    if (!b.disciplinaId) return reply.code(400).send({ error: 'disciplinaId obrigatório' })
    try {
      const componente = await prisma.acaComponente.create({ data: { matrizId, disciplinaId: Number(b.disciplinaId), fase: Number(b.fase) || 1, obrigatoria: b.obrigatoria !== false } })
      return reply.code(201).send({ componente })
    } catch { return reply.code(409).send({ error: 'Disciplina já está nesta matriz' }) }
  })
  app.delete('/api/admin/aca/matrizes/:id/componentes/:compId', { preHandler: authMiddleware }, async (req) => {
    const compId = Number((req.params as any).compId)
    await prisma.acaComponente.deleteMany({ where: { id: compId } })
    return { ok: true }
  })
  app.delete('/api/admin/aca/matrizes/:id', { preHandler: authMiddleware }, async (req, reply) => {
    const id = Number((req.params as any).id)
    const turmas = await prisma.acaTurma.count({ where: { matrizId: id } })
    if (turmas > 0) return reply.code(409).send({ error: `Matriz está em ${turmas} turma(s).` })
    await prisma.acaComponente.deleteMany({ where: { matrizId: id } })
    await prisma.acaMatriz.delete({ where: { id } })
    return { ok: true }
  })

  // ════════ TURMAS ════════
  app.get('/api/admin/aca/turmas', { preHandler: authMiddleware }, async () => {
    const turmas = await prisma.acaTurma.findMany({
      orderBy: { id: 'desc' },
      include: { periodoLetivo: { select: { codigo: true } }, _count: { select: { matriculas: true } } },
    })
    return { turmas }
  })
  app.post('/api/admin/aca/turmas', { preHandler: authMiddleware }, async (req, reply) => {
    const b = (req.body as any) || {}
    if (!b.nome || !b.periodoLetivoId) return reply.code(400).send({ error: 'nome e periodoLetivoId são obrigatórios' })
    const turno = TURNOS.includes(b.turno) ? b.turno : null
    const turma = await prisma.acaTurma.create({ data: {
      nome: String(b.nome).slice(0, 191), periodoLetivoId: Number(b.periodoLetivoId),
      courseOfferingId: b.courseOfferingId ? Number(b.courseOfferingId) : null,
      matrizId: b.matrizId ? Number(b.matrizId) : null,
      faseAtual: b.faseAtual ? Number(b.faseAtual) : null, turno: turno as any, capacidade: b.capacidade ? Number(b.capacidade) : null,
    } })
    return reply.code(201).send({ turma })
  })
  app.patch('/api/admin/aca/turmas/:id', { preHandler: authMiddleware }, async (req) => {
    const id = Number((req.params as any).id); const b = (req.body as any) || {}
    const data: any = {}
    for (const k of ['nome', 'ativo', 'matriculaAberta']) if (k in b) data[k] = (k === 'ativo' || k === 'matriculaAberta') ? !!b[k] : b[k]
    if ('faseAtual' in b) data.faseAtual = b.faseAtual ? Number(b.faseAtual) : null
    if ('capacidade' in b) data.capacidade = b.capacidade ? Number(b.capacidade) : null
    if ('turno' in b) data.turno = TURNOS.includes(b.turno) ? b.turno : null
    if ('matrizId' in b) data.matrizId = b.matrizId ? Number(b.matrizId) : null
    if ('courseOfferingId' in b) data.courseOfferingId = b.courseOfferingId ? Number(b.courseOfferingId) : null
    const turma = await prisma.acaTurma.update({ where: { id }, data })
    return { turma }
  })
  app.delete('/api/admin/aca/turmas/:id', { preHandler: authMiddleware }, async (req, reply) => {
    const id = Number((req.params as any).id)
    const m = await prisma.acaMatricula.count({ where: { turmaId: id } })
    if (m > 0) return reply.code(409).send({ error: `Turma tem ${m} matrícula(s).` })
    await prisma.acaTurma.delete({ where: { id } })
    return { ok: true }
  })
}
