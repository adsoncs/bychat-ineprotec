// src/routes/acaNota.ts
// Módulo Acadêmico · P6.2 — Avaliações + Notas. Instrumentos por diário, notas
// por aluno e MÉDIA PONDERADA (sum(nota*peso)/sum(peso)). Rotas /api/admin/aca/*.

import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { authMiddleware } from '../lib/auth.js'

async function matriculadosDaTurma(turmaId: number) {
  return prisma.acaMatricula.findMany({
    where: { turmaId, status: 'MATRICULADO', listaEspera: false },
    select: { id: true, aluno: { select: { ra: true, lead: { select: { nome: true } } } } },
    orderBy: { aluno: { lead: { nome: 'asc' } } },
  })
}

export async function acaNotaRoutes(app: FastifyInstance) {
  // ── GET /diarios/:id/notas — avaliações + matriz de notas + médias ──
  app.get('/api/admin/aca/diarios/:id/notas', { preHandler: authMiddleware }, async (req, reply) => {
    const diarioId = Number((req.params as any).id)
    const diario = await prisma.acaDiario.findUnique({ where: { id: diarioId }, select: { turmaId: true } })
    if (!diario) return reply.code(404).send({ error: 'Diário não encontrado' })
    const [avaliacoes, mats] = await Promise.all([
      prisma.acaAvaliacao.findMany({ where: { diarioId }, orderBy: [{ ordem: 'asc' }, { id: 'asc' }] }),
      matriculadosDaTurma(diario.turmaId),
    ])
    const avalIds = avaliacoes.map((a) => a.id)
    const notas = avalIds.length ? await prisma.acaNota.findMany({ where: { avaliacaoId: { in: avalIds } } }) : []
    // mapa nota[matriculaId][avaliacaoId] = valor
    const map: Record<number, Record<number, number | null>> = {}
    for (const n of notas) { (map[n.matriculaId] ??= {})[n.avaliacaoId] = n.valor }
    const pesoTotal = avaliacoes.reduce((s, a) => s + a.peso, 0)
    const linhas = mats.map((m) => {
      const row = map[m.id] || {}
      let somaPeso = 0, soma = 0
      for (const a of avaliacoes) { const v = row[a.id]; if (v != null) { soma += v * a.peso; somaPeso += a.peso } }
      const media = somaPeso > 0 ? Math.round((soma / somaPeso) * 10) / 10 : null
      const completo = somaPeso === pesoTotal && pesoTotal > 0
      return { matriculaId: m.id, ra: m.aluno.ra, nome: m.aluno.lead.nome, notas: row, media, completo }
    })
    return { avaliacoes, linhas, matriculados: mats.length }
  })

  // ── POST /diarios/:id/avaliacoes — cria instrumento ──
  app.post('/api/admin/aca/diarios/:id/avaliacoes', { preHandler: authMiddleware }, async (req, reply) => {
    const diarioId = Number((req.params as any).id)
    const b = (req.body as any) || {}
    if (!b.nome) return reply.code(400).send({ error: 'nome obrigatório' })
    const avaliacao = await prisma.acaAvaliacao.create({ data: {
      diarioId, nome: String(b.nome).slice(0, 120), peso: Number(b.peso) || 1,
      valorMaximo: b.valorMaximo != null ? Number(b.valorMaximo) : 10, data: b.data ? new Date(b.data) : null, ordem: Number(b.ordem) || 0,
    } })
    return reply.code(201).send({ avaliacao })
  })

  // ── PATCH /avaliacoes/:id ──
  app.patch('/api/admin/aca/avaliacoes/:id', { preHandler: authMiddleware }, async (req) => {
    const id = Number((req.params as any).id); const b = (req.body as any) || {}
    const data: any = {}
    if ('nome' in b) data.nome = String(b.nome).slice(0, 120)
    if ('peso' in b) data.peso = Number(b.peso) || 1
    if ('valorMaximo' in b) data.valorMaximo = Number(b.valorMaximo) || 10
    if ('ordem' in b) data.ordem = Number(b.ordem) || 0
    if ('data' in b) data.data = b.data ? new Date(b.data) : null
    const avaliacao = await prisma.acaAvaliacao.update({ where: { id }, data })
    return { avaliacao }
  })

  // ── DELETE /avaliacoes/:id ──
  app.delete('/api/admin/aca/avaliacoes/:id', { preHandler: authMiddleware }, async (req) => {
    await prisma.acaAvaliacao.delete({ where: { id: Number((req.params as any).id) } }).catch(() => {})
    return { ok: true }
  })

  // ── POST /avaliacoes/:id/notas — lança notas (bulk; valor null limpa) ──
  app.post('/api/admin/aca/avaliacoes/:id/notas', { preHandler: authMiddleware }, async (req, reply) => {
    const avaliacaoId = Number((req.params as any).id)
    const aval = await prisma.acaAvaliacao.findUnique({ where: { id: avaliacaoId }, select: { valorMaximo: true } })
    if (!aval) return reply.code(404).send({ error: 'Avaliação não encontrada' })
    const registros = ((req.body as any)?.registros || []) as Array<{ matriculaId: number; valor: number | null }>
    let salvos = 0
    for (const r of registros) {
      let valor: number | null = r.valor === null || r.valor === undefined || (r.valor as any) === '' ? null : Number(r.valor)
      if (valor != null) { if (Number.isNaN(valor)) continue; valor = Math.max(0, Math.min(valor, aval.valorMaximo)) }
      await prisma.acaNota.upsert({
        where: { avaliacaoId_matriculaId: { avaliacaoId, matriculaId: Number(r.matriculaId) } },
        update: { valor }, create: { avaliacaoId, matriculaId: Number(r.matriculaId), valor },
      })
      salvos++
    }
    return { ok: true, salvos }
  })
}
