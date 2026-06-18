// src/routes/acaMaterial.ts
// Módulo Acadêmico · O2.7 — Plano de ensino + Materiais (LMS-lite).
// Plano de ensino por diário (ementa/objetivos/conteúdo/bibliografia/critérios)
// e materiais (links/vídeos) por disciplina, acessíveis ao aluno no portal.

import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { authMiddleware } from '../lib/auth.js'

export async function acaMaterialRoutes(app: FastifyInstance) {
  // ── Plano de ensino + materiais de um diário ──
  app.get('/api/admin/aca/diarios/:id/plano', { preHandler: authMiddleware }, async (req) => {
    const diarioId = Number((req.params as any).id)
    const [plano, materiais] = await Promise.all([
      prisma.acaPlanoEnsino.findUnique({ where: { diarioId } }),
      prisma.acaMaterial.findMany({ where: { diarioId }, orderBy: { createdAt: 'desc' } }),
    ])
    return { plano, materiais }
  })

  // ── Salvar plano de ensino (upsert) ──
  app.put('/api/admin/aca/diarios/:id/plano', { preHandler: authMiddleware }, async (req) => {
    const diarioId = Number((req.params as any).id); const b = (req.body as any) || {}
    const data: any = {}
    for (const k of ['ementa', 'objetivos', 'conteudo', 'metodologia', 'bibliografia', 'criterios']) data[k] = b[k] ? String(b[k]) : null
    const plano = await prisma.acaPlanoEnsino.upsert({ where: { diarioId }, update: data, create: { diarioId, ...data } })
    return { plano }
  })

  // ── Adicionar material ──
  app.post('/api/admin/aca/diarios/:id/materiais', { preHandler: authMiddleware }, async (req, reply) => {
    const diarioId = Number((req.params as any).id); const b = (req.body as any) || {}
    if (!b.titulo || !b.url) return reply.code(400).send({ error: 'titulo e url são obrigatórios' })
    const material = await prisma.acaMaterial.create({ data: { diarioId, titulo: String(b.titulo).slice(0, 191), url: String(b.url), tipo: ['LINK', 'ARQUIVO', 'VIDEO'].includes(b.tipo) ? b.tipo : 'LINK', descricao: b.descricao || null, aulaId: b.aulaId ? Number(b.aulaId) : null } })
    return reply.code(201).send({ material })
  })

  app.delete('/api/admin/aca/materiais/:id', { preHandler: authMiddleware }, async (req) => {
    await prisma.acaMaterial.delete({ where: { id: Number((req.params as any).id) } }).catch(() => {})
    return { ok: true }
  })
}

/** Materiais das disciplinas do aluno, agrupados por disciplina (portal). */
export async function materiaisDoAluno(alunoId: number) {
  const mats = await prisma.acaMatricula.findMany({ where: { alunoId, status: 'MATRICULADO' }, select: { turmaId: true } })
  const turmaIds = mats.map((m) => m.turmaId)
  if (!turmaIds.length) return []
  const diarios = await prisma.acaDiario.findMany({ where: { turmaId: { in: turmaIds } }, select: { id: true, disciplinaId: true } })
  if (!diarios.length) return []
  const materiais = await prisma.acaMaterial.findMany({ where: { diarioId: { in: diarios.map((d) => d.id) } }, orderBy: { createdAt: 'desc' } })
  if (!materiais.length) return []
  const discById = new Map(diarios.map((d) => [d.id, d.disciplinaId]))
  const discs = await prisma.acaDisciplina.findMany({ where: { id: { in: [...new Set(diarios.map((d) => d.disciplinaId))] } }, select: { id: true, nome: true } })
  const dNome = new Map(discs.map((d) => [d.id, d.nome]))
  const grupos = new Map<string, any[]>()
  for (const m of materiais) {
    const nome = dNome.get(discById.get(m.diarioId)!) || '—'
    ;(grupos.get(nome) ?? grupos.set(nome, []).get(nome)!).push(m)
  }
  return [...grupos.entries()].map(([disciplina, itens]) => ({ disciplina, itens }))
}
