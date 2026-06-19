// src/routes/acaAlocacao.ts
// Módulo Acadêmico · F15 — Alocação de Recursos (rotas /api/admin/aca/alocacao).
// Tipos de ambiente, ambientes, tipos de equipamento, equipamentos e reservas.

import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { authMiddleware } from '../lib/auth.js'
import { conflitosReserva } from '../services/acaAlocacao.js'

export async function acaAlocacaoRoutes(app: FastifyInstance) {
  // ── Tipos de ambiente ──
  app.get('/api/admin/aca/alocacao/tipos-ambiente', { preHandler: authMiddleware }, async () => ({ tipos: await prisma.acaTipoAmbiente.findMany({ orderBy: { id: 'asc' } }) }))
  app.post('/api/admin/aca/alocacao/tipos-ambiente', { preHandler: authMiddleware }, async (req, reply) => {
    const b = (req.body as any) || {}; if (!b.nome) return reply.code(400).send({ error: 'nome obrigatório' })
    return reply.code(201).send({ tipo: await prisma.acaTipoAmbiente.create({ data: { nome: String(b.nome).slice(0, 120) } }) })
  })

  // ── Ambientes ──
  app.get('/api/admin/aca/alocacao/ambientes', { preHandler: authMiddleware }, async () => {
    const rows = await prisma.acaAmbiente.findMany({ orderBy: { id: 'desc' }, include: { _count: { select: { equipamentos: true } } } })
    const tipos = await prisma.acaTipoAmbiente.findMany({ select: { id: true, nome: true } })
    const tMap = new Map(tipos.map((t) => [t.id, t.nome]))
    return { ambientes: rows.map((a) => ({ ...a, tipoNome: a.tipoId ? tMap.get(a.tipoId) ?? null : null, equipamentos: a._count.equipamentos })) }
  })
  app.post('/api/admin/aca/alocacao/ambientes', { preHandler: authMiddleware }, async (req, reply) => {
    const b = (req.body as any) || {}; if (!b.nome) return reply.code(400).send({ error: 'nome obrigatório' })
    return reply.code(201).send({ ambiente: await prisma.acaAmbiente.create({ data: { nome: String(b.nome).slice(0, 120), tipoId: b.tipoId ? Number(b.tipoId) : null, capacidade: Math.max(0, Number(b.capacidade) || 0), localizacao: b.localizacao || null } }) })
  })
  app.put('/api/admin/aca/alocacao/ambientes/:id', { preHandler: authMiddleware }, async (req) => {
    const id = Number((req.params as any).id); const b = (req.body as any) || {}
    const data: any = {}
    if ('nome' in b) data.nome = String(b.nome).slice(0, 120)
    if ('tipoId' in b) data.tipoId = b.tipoId ? Number(b.tipoId) : null
    if ('capacidade' in b) data.capacidade = Math.max(0, Number(b.capacidade) || 0)
    if ('localizacao' in b) data.localizacao = b.localizacao || null
    if ('ativo' in b) data.ativo = !!b.ativo
    return { ambiente: await prisma.acaAmbiente.update({ where: { id }, data }) }
  })

  // ── Tipos de equipamento ──
  app.get('/api/admin/aca/alocacao/tipos-equipamento', { preHandler: authMiddleware }, async () => ({ tipos: await prisma.acaTipoEquipamento.findMany({ orderBy: { id: 'asc' } }) }))
  app.post('/api/admin/aca/alocacao/tipos-equipamento', { preHandler: authMiddleware }, async (req, reply) => {
    const b = (req.body as any) || {}; if (!b.nome) return reply.code(400).send({ error: 'nome obrigatório' })
    return reply.code(201).send({ tipo: await prisma.acaTipoEquipamento.create({ data: { nome: String(b.nome).slice(0, 120) } }) })
  })

  // ── Equipamentos ──
  app.get('/api/admin/aca/alocacao/equipamentos', { preHandler: authMiddleware }, async (req) => {
    const q = req.query as any
    const where: any = {}
    if (q.ambienteId) where.ambienteId = Number(q.ambienteId)
    const rows = await prisma.acaEquipamento.findMany({ where, orderBy: { id: 'desc' }, take: 500 })
    const [tipos, ambientes] = await Promise.all([prisma.acaTipoEquipamento.findMany({ select: { id: true, nome: true } }), prisma.acaAmbiente.findMany({ select: { id: true, nome: true } })])
    const tMap = new Map(tipos.map((t) => [t.id, t.nome])); const aMap = new Map(ambientes.map((a) => [a.id, a.nome]))
    return { equipamentos: rows.map((e) => ({ ...e, tipoNome: e.tipoId ? tMap.get(e.tipoId) ?? null : null, ambienteNome: e.ambienteId ? aMap.get(e.ambienteId) ?? null : null })) }
  })
  app.post('/api/admin/aca/alocacao/equipamentos', { preHandler: authMiddleware }, async (req, reply) => {
    const b = (req.body as any) || {}; if (!b.nome) return reply.code(400).send({ error: 'nome obrigatório' })
    return reply.code(201).send({ equipamento: await prisma.acaEquipamento.create({ data: { nome: String(b.nome).slice(0, 120), tipoId: b.tipoId ? Number(b.tipoId) : null, ambienteId: b.ambienteId ? Number(b.ambienteId) : null, patrimonio: b.patrimonio || null } }) })
  })
  app.put('/api/admin/aca/alocacao/equipamentos/:id', { preHandler: authMiddleware }, async (req) => {
    const id = Number((req.params as any).id); const b = (req.body as any) || {}
    const data: any = {}
    if ('nome' in b) data.nome = String(b.nome).slice(0, 120)
    if ('tipoId' in b) data.tipoId = b.tipoId ? Number(b.tipoId) : null
    if ('ambienteId' in b) data.ambienteId = b.ambienteId ? Number(b.ambienteId) : null
    if ('patrimonio' in b) data.patrimonio = b.patrimonio || null
    if ('ativo' in b) data.ativo = !!b.ativo
    return { equipamento: await prisma.acaEquipamento.update({ where: { id }, data }) }
  })

  // ── Reservas ──
  app.get('/api/admin/aca/alocacao/reservas', { preHandler: authMiddleware }, async (req) => {
    const q = req.query as any
    const where: any = { status: 'ATIVA' }
    if (q.ambienteId) where.ambienteId = Number(q.ambienteId)
    if (q.data) { const d = new Date(q.data); const dia = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); const prox = new Date(dia); prox.setUTCDate(prox.getUTCDate() + 1); where.data = { gte: dia, lt: prox } }
    const rows = await prisma.acaReserva.findMany({ where, orderBy: [{ data: 'asc' }, { horaInicio: 'asc' }], take: 500 })
    const ambIds = [...new Set(rows.map((r) => r.ambienteId))]
    const ambientes = ambIds.length ? await prisma.acaAmbiente.findMany({ where: { id: { in: ambIds } }, select: { id: true, nome: true } }) : []
    const aMap = new Map(ambientes.map((a) => [a.id, a.nome]))
    return { reservas: rows.map((r) => ({ ...r, ambienteNome: aMap.get(r.ambienteId) ?? '—' })) }
  })
  app.post('/api/admin/aca/alocacao/reservas', { preHandler: authMiddleware }, async (req, reply) => {
    const b = (req.body as any) || {}
    if (!b.ambienteId || !b.data || !b.horaInicio || !b.horaFim) return reply.code(400).send({ error: 'ambienteId, data, horaInicio e horaFim obrigatórios' })
    if (String(b.horaInicio) >= String(b.horaFim)) return reply.code(400).send({ error: 'horaInicio deve ser anterior a horaFim' })
    const data = new Date(b.data)
    if (!b.force) {
      const conf = await conflitosReserva(Number(b.ambienteId), data, String(b.horaInicio), String(b.horaFim))
      if (conf.length) return reply.code(409).send({ error: 'Conflito de reserva no horário', conflitos: conf })
    }
    return reply.code(201).send({ reserva: await prisma.acaReserva.create({ data: {
      ambienteId: Number(b.ambienteId), data, horaInicio: String(b.horaInicio).slice(0, 5), horaFim: String(b.horaFim).slice(0, 5),
      finalidade: b.finalidade || null, responsavel: b.responsavel || null, userId: (req as any).user?.userId ?? null,
    } }) })
  })
  app.delete('/api/admin/aca/alocacao/reservas/:id', { preHandler: authMiddleware }, async (req) => {
    await prisma.acaReserva.update({ where: { id: Number((req.params as any).id) }, data: { status: 'CANCELADA' } })
    return { ok: true }
  })
}
