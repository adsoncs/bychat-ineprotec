// src/routes/acaAcesso.ts
// Módulo Acadêmico · F16 — Controle de Acesso Físico (rotas /api/admin/aca/acesso).
// Pontos, credenciais (QR), logs e o endpoint de decisão (chamado pela catraca).

import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { authMiddleware } from '../lib/auth.js'
import { gerarCredencial, registrarAcesso } from '../services/acaAcesso.js'

export async function acaAcessoRoutes(app: FastifyInstance) {
  // ── Pontos de acesso ──
  app.get('/api/admin/aca/acesso/pontos', { preHandler: authMiddleware }, async () => ({ pontos: await prisma.acaPontoAcesso.findMany({ orderBy: { id: 'asc' } }) }))
  app.post('/api/admin/aca/acesso/pontos', { preHandler: authMiddleware }, async (req, reply) => {
    const b = (req.body as any) || {}; if (!b.nome) return reply.code(400).send({ error: 'nome obrigatório' })
    return reply.code(201).send({ ponto: await prisma.acaPontoAcesso.create({ data: { nome: String(b.nome).slice(0, 120), local: b.local || null } }) })
  })
  app.put('/api/admin/aca/acesso/pontos/:id', { preHandler: authMiddleware }, async (req) => {
    const id = Number((req.params as any).id); const b = (req.body as any) || {}
    const data: any = {}
    if ('nome' in b) data.nome = String(b.nome).slice(0, 120)
    if ('local' in b) data.local = b.local || null
    if ('ativo' in b) data.ativo = !!b.ativo
    return { ponto: await prisma.acaPontoAcesso.update({ where: { id }, data }) }
  })

  // ── Credenciais (QR por aluno) ──
  app.get('/api/admin/aca/acesso/credenciais', { preHandler: authMiddleware }, async () => {
    const rows = await prisma.acaCredencial.findMany({ orderBy: { id: 'desc' }, take: 500 })
    const alunoIds = rows.map((r) => r.alunoId)
    const alunos = alunoIds.length ? await prisma.aluno.findMany({ where: { id: { in: alunoIds } }, select: { id: true, ra: true, lead: { select: { nome: true } } } }) : []
    const aMap = new Map(alunos.map((a) => [a.id, a]))
    return { credenciais: rows.map((r) => ({ ...r, alunoNome: aMap.get(r.alunoId)?.lead.nome ?? '—', ra: aMap.get(r.alunoId)?.ra ?? null })) }
  })
  app.post('/api/admin/aca/acesso/credenciais', { preHandler: authMiddleware }, async (req, reply) => {
    const b = (req.body as any) || {}
    if (!b.alunoId) return reply.code(400).send({ error: 'alunoId obrigatório' })
    try { return reply.code(201).send({ credencial: await gerarCredencial(Number(b.alunoId)) }) }
    catch (e: any) { return reply.code(400).send({ error: e?.message || 'erro' }) }
  })
  app.put('/api/admin/aca/acesso/credenciais/:id', { preHandler: authMiddleware }, async (req) => {
    const id = Number((req.params as any).id); const b = (req.body as any) || {}
    return { credencial: await prisma.acaCredencial.update({ where: { id }, data: { ativo: !!b.ativo } }) }
  })

  // ── Logs ──
  app.get('/api/admin/aca/acesso/logs', { preHandler: authMiddleware }, async (req) => {
    const q = req.query as any
    const where: any = {}
    if (q.alunoId) where.alunoId = Number(q.alunoId)
    if (q.pontoId) where.pontoId = Number(q.pontoId)
    const rows = await prisma.acaAcessoLog.findMany({ where, orderBy: { id: 'desc' }, take: 200 })
    const alunoIds = [...new Set(rows.map((r) => r.alunoId).filter(Boolean) as number[])]
    const pontoIds = [...new Set(rows.map((r) => r.pontoId).filter(Boolean) as number[])]
    const [alunos, pontos] = await Promise.all([
      alunoIds.length ? prisma.aluno.findMany({ where: { id: { in: alunoIds } }, select: { id: true, lead: { select: { nome: true } } } }) : [],
      pontoIds.length ? prisma.acaPontoAcesso.findMany({ where: { id: { in: pontoIds } }, select: { id: true, nome: true } }) : [],
    ])
    const aMap = new Map(alunos.map((a) => [a.id, a.lead.nome])); const pMap = new Map(pontos.map((p) => [p.id, p.nome]))
    return { logs: rows.map((r) => ({ ...r, alunoNome: r.alunoId ? aMap.get(r.alunoId) ?? '—' : '—', pontoNome: r.pontoId ? pMap.get(r.pontoId) ?? null : null })) }
  })

  // ── Decisão de acesso (PONTO DE INTEGRAÇÃO — chamado pela catraca/leitor) ──
  app.post('/api/admin/aca/acesso/registrar', { preHandler: authMiddleware }, async (req) => {
    const b = (req.body as any) || {}
    return registrarAcesso({ token: String(b.token || ''), pontoId: b.pontoId ? Number(b.pontoId) : undefined, tipo: b.tipo })
  })
}
