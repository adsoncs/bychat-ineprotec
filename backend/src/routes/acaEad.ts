// src/routes/acaEad.ts
// Módulo Acadêmico · F19 — EAD / LMS (rotas /api/admin/aca/ead). Turmas EAD,
// sincronização, recebimento de médias e registro de acesso a aulas externas.

import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { authMiddleware } from '../lib/auth.js'
import { eadConfig, sincronizarTurmaEad, receberNotasEad } from '../services/acaEad.js'

export async function acaEadRoutes(app: FastifyInstance) {
  // ── Config ──
  app.get('/api/admin/aca/ead/config', { preHandler: authMiddleware }, async () => ({ config: await eadConfig() }))
  app.put('/api/admin/aca/ead/config', { preHandler: authMiddleware }, async (req) => {
    const b = (req.body as any) || {}
    const data: any = {}
    for (const k of ['lmsNome', 'lmsBaseUrl']) if (k in b) data[k] = b[k] || null
    if ('modo' in b) data.modo = b.modo === 'AO_VIVO' ? 'AO_VIVO' : 'SIMULADO'
    if ('ativo' in b) data.ativo = !!b.ativo
    const ex = await prisma.acaEadConfig.findFirst()
    return { config: ex ? await prisma.acaEadConfig.update({ where: { id: ex.id }, data }) : await prisma.acaEadConfig.create({ data }) }
  })

  // ── Turmas EAD ──
  app.get('/api/admin/aca/ead/turmas', { preHandler: authMiddleware }, async () => {
    const eadTurmas = await prisma.acaEadTurma.findMany({ orderBy: { id: 'desc' } })
    const turmaIds = eadTurmas.map((t) => t.turmaId)
    const turmas = turmaIds.length ? await prisma.acaTurma.findMany({ where: { id: { in: turmaIds } }, select: { id: true, nome: true } }) : []
    const tMap = new Map(turmas.map((t) => [t.id, t.nome]))
    const counts = await prisma.acaEadMatricula.groupBy({ by: ['eadTurmaId'], _count: { _all: true } })
    const cMap = new Map(counts.map((c) => [c.eadTurmaId, c._count._all]))
    return { turmas: eadTurmas.map((t) => ({ ...t, turmaNome: tMap.get(t.turmaId) ?? '—', sincronizadas: cMap.get(t.id) ?? 0 })) }
  })
  app.get('/api/admin/aca/ead/turmas-disponiveis', { preHandler: authMiddleware }, async () => {
    const jaEad = new Set((await prisma.acaEadTurma.findMany({ select: { turmaId: true } })).map((t) => t.turmaId))
    const turmas = await prisma.acaTurma.findMany({ where: { ativo: true }, select: { id: true, nome: true }, orderBy: { id: 'desc' }, take: 200 })
    return { turmas: turmas.filter((t) => !jaEad.has(t.id)) }
  })
  app.post('/api/admin/aca/ead/turmas', { preHandler: authMiddleware }, async (req, reply) => {
    const b = (req.body as any) || {}
    if (!b.turmaId) return reply.code(400).send({ error: 'turmaId obrigatório' })
    if (await prisma.acaEadTurma.findUnique({ where: { turmaId: Number(b.turmaId) }, select: { id: true } })) return reply.code(409).send({ error: 'Turma já é EAD' })
    return reply.code(201).send({ turma: await prisma.acaEadTurma.create({ data: { turmaId: Number(b.turmaId), chEad: Math.max(0, Number(b.chEad) || 0), lmsRef: b.lmsRef || null } }) })
  })
  app.put('/api/admin/aca/ead/turmas/:id', { preHandler: authMiddleware }, async (req) => {
    const id = Number((req.params as any).id); const b = (req.body as any) || {}
    const data: any = {}
    if ('chEad' in b) data.chEad = Math.max(0, Number(b.chEad) || 0)
    if ('lmsRef' in b) data.lmsRef = b.lmsRef || null
    if ('ativo' in b) data.ativo = !!b.ativo
    return { turma: await prisma.acaEadTurma.update({ where: { id }, data }) }
  })
  app.post('/api/admin/aca/ead/turmas/:id/sincronizar', { preHandler: authMiddleware }, async (req, reply) => {
    try { return await sincronizarTurmaEad(Number((req.params as any).id)) }
    catch (e: any) { return reply.code(400).send({ error: e?.message || 'erro' }) }
  })
  app.get('/api/admin/aca/ead/matriculas', { preHandler: authMiddleware }, async (req) => {
    const eadTurmaId = Number((req.query as any)?.eadTurmaId)
    if (!eadTurmaId) return { matriculas: [] }
    const rows = await prisma.acaEadMatricula.findMany({ where: { eadTurmaId }, orderBy: { id: 'asc' } })
    const matIds = rows.map((r) => r.matriculaId)
    const mats = matIds.length ? await prisma.acaMatricula.findMany({ where: { id: { in: matIds } }, select: { id: true, aluno: { select: { ra: true, lead: { select: { nome: true } } } } } }) : []
    const mMap = new Map(mats.map((m) => [m.id, m]))
    return { matriculas: rows.map((r) => ({ ...r, alunoNome: mMap.get(r.matriculaId)?.aluno.lead.nome ?? '—', ra: mMap.get(r.matriculaId)?.aluno.ra ?? null })) }
  })

  // ── Notas recebidas do LMS ──
  app.get('/api/admin/aca/ead/notas', { preHandler: authMiddleware }, async (req) => {
    const q = req.query as any
    const where: any = {}
    if (q.matriculaId) where.matriculaId = Number(q.matriculaId)
    return { notas: await prisma.acaEadNota.findMany({ where, orderBy: { id: 'desc' }, take: 300 }) }
  })
  app.post('/api/admin/aca/ead/notas/receber', { preHandler: authMiddleware }, async (req, reply) => {
    const b = (req.body as any) || {}
    const notas = Array.isArray(b.notas) ? b.notas : []
    if (!notas.length) return reply.code(400).send({ error: 'notas[] obrigatório' })
    return receberNotasEad(notas, b.origem)
  })

  // ── Registro de acesso a aulas externas ──
  app.get('/api/admin/aca/ead/acessos', { preHandler: authMiddleware }, async (req) => {
    const q = req.query as any
    const where: any = {}
    if (q.matriculaId) where.matriculaId = Number(q.matriculaId)
    return { acessos: await prisma.acaEadAcesso.findMany({ where, orderBy: { id: 'desc' }, take: 200 }) }
  })
  app.post('/api/admin/aca/ead/acessos', { preHandler: authMiddleware }, async (req, reply) => {
    const b = (req.body as any) || {}
    if (!b.matriculaId || !b.recurso) return reply.code(400).send({ error: 'matriculaId e recurso obrigatórios' })
    return reply.code(201).send({ acesso: await prisma.acaEadAcesso.create({ data: { matriculaId: Number(b.matriculaId), recurso: String(b.recurso).slice(0, 191) } }) })
  })
}
