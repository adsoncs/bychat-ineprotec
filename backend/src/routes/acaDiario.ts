// src/routes/acaDiario.ts
// Módulo Acadêmico · P6.1 — Diário eletrônico + Frequência.
// Diário por turma×disciplina; registra aulas (data/conteúdo/qtd) e marca
// presença por aluno matriculado. Rotas /api/admin/aca/*.

import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { authMiddleware } from '../lib/auth.js'

/** Matriculados ativos de uma turma (status MATRICULADO, em vaga). */
async function matriculadosDaTurma(turmaId: number) {
  return prisma.acaMatricula.findMany({
    where: { turmaId, status: 'MATRICULADO', listaEspera: false },
    select: { id: true, aluno: { select: { ra: true, lead: { select: { nome: true } } } } },
    orderBy: { aluno: { lead: { nome: 'asc' } } },
  })
}

export async function acaDiarioRoutes(app: FastifyInstance) {
  // ── GET /turmas/:id/diarios — disciplinas da matriz + diário (se existir) ──
  app.get('/api/admin/aca/turmas/:id/diarios', { preHandler: authMiddleware }, async (req, reply) => {
    const turmaId = Number((req.params as any).id)
    const turma = await prisma.acaTurma.findUnique({ where: { id: turmaId }, select: { id: true, nome: true, matrizId: true } })
    if (!turma) return reply.code(404).send({ error: 'Turma não encontrada' })
    const componentes = turma.matrizId
      ? await prisma.acaComponente.findMany({ where: { matrizId: turma.matrizId }, include: { disciplina: { select: { id: true, nome: true, cargaHoraria: true } } }, orderBy: [{ fase: 'asc' }] })
      : []
    const diarios = await prisma.acaDiario.findMany({ where: { turmaId }, select: { id: true, disciplinaId: true, professorUserId: true } })
    const dByDisc = new Map(diarios.map((d) => [d.disciplinaId, d]))
    const itens = componentes.map((c) => ({ disciplinaId: c.disciplina.id, nome: c.disciplina.nome, fase: c.fase, cargaHoraria: c.disciplina.cargaHoraria, diario: dByDisc.get(c.disciplina.id) ?? null }))
    const matriculados = await prisma.acaMatricula.count({ where: { turmaId, status: 'MATRICULADO', listaEspera: false } })
    return { turma, itens, matriculados }
  })

  // ── POST /diarios — obtém ou cria o diário de turma×disciplina ──
  app.post('/api/admin/aca/diarios', { preHandler: authMiddleware }, async (req, reply) => {
    const b = (req.body as any) || {}
    const turmaId = Number(b.turmaId); const disciplinaId = Number(b.disciplinaId)
    if (!turmaId || !disciplinaId) return reply.code(400).send({ error: 'turmaId e disciplinaId obrigatórios' })
    const diario = await prisma.acaDiario.upsert({
      where: { turmaId_disciplinaId: { turmaId, disciplinaId } },
      update: { professorUserId: b.professorUserId ? Number(b.professorUserId) : undefined },
      create: { turmaId, disciplinaId, professorUserId: b.professorUserId ? Number(b.professorUserId) : null },
    })
    return reply.code(201).send({ diario })
  })

  // ── GET /diarios/:id — diário + aulas + matriculados + resumo de frequência ──
  app.get('/api/admin/aca/diarios/:id', { preHandler: authMiddleware }, async (req, reply) => {
    const id = Number((req.params as any).id)
    const diario = await prisma.acaDiario.findUnique({ where: { id }, include: { aulas: { orderBy: { data: 'asc' }, include: { _count: { select: { frequencias: true } } } } } })
    if (!diario) return reply.code(404).send({ error: 'Diário não encontrado' })
    const [disciplina, turma, matriculados] = await Promise.all([
      prisma.acaDisciplina.findUnique({ where: { id: diario.disciplinaId }, select: { nome: true, cargaHoraria: true } }),
      prisma.acaTurma.findUnique({ where: { id: diario.turmaId }, select: { nome: true } }),
      matriculadosDaTurma(diario.turmaId),
    ])
    // resumo de frequência por matrícula (total de aulas ministradas vs faltas)
    const aulaIds = diario.aulas.map((a) => a.id)
    const totalAulas = diario.aulas.reduce((s, a) => s + a.quantidadeAulas, 0)
    const freqs = aulaIds.length ? await prisma.acaFrequencia.findMany({ where: { aulaId: { in: aulaIds } }, select: { matriculaId: true, presente: true, aulaId: true } }) : []
    const qtdByAula = new Map(diario.aulas.map((a) => [a.id, a.quantidadeAulas]))
    const faltasByMat = new Map<number, number>()
    for (const f of freqs) if (!f.presente) faltasByMat.set(f.matriculaId, (faltasByMat.get(f.matriculaId) || 0) + (qtdByAula.get(f.aulaId) || 1))
    const resumo = matriculados.map((m) => {
      const faltas = faltasByMat.get(m.id) || 0
      const presenca = totalAulas > 0 ? Math.round(((totalAulas - faltas) / totalAulas) * 100) : 100
      return { matriculaId: m.id, ra: m.aluno.ra, nome: m.aluno.lead.nome, faltas, presencaPct: presenca }
    })
    return { diario: { id: diario.id, turmaId: diario.turmaId, disciplinaId: diario.disciplinaId, professorUserId: diario.professorUserId, aulas: diario.aulas }, disciplina, turma, totalAulas, matriculados: matriculados.length, resumo }
  })

  // ── POST /diarios/:id/aulas — registra aula + inicializa frequência (presença=true) ──
  app.post('/api/admin/aca/diarios/:id/aulas', { preHandler: authMiddleware }, async (req, reply) => {
    const diarioId = Number((req.params as any).id)
    const b = (req.body as any) || {}
    if (!b.data || !b.conteudo) return reply.code(400).send({ error: 'data e conteudo obrigatórios' })
    const diario = await prisma.acaDiario.findUnique({ where: { id: diarioId }, select: { turmaId: true } })
    if (!diario) return reply.code(404).send({ error: 'Diário não encontrado' })
    const aula = await prisma.acaAula.create({ data: { diarioId, data: new Date(b.data), conteudo: String(b.conteudo), quantidadeAulas: Number(b.quantidadeAulas) || 1 } })
    const mats = await matriculadosDaTurma(diario.turmaId)
    for (const m of mats) await prisma.acaFrequencia.create({ data: { aulaId: aula.id, matriculaId: m.id, presente: true } })
    return reply.code(201).send({ aula, frequenciasIniciadas: mats.length })
  })

  // ── DELETE /aulas/:id ──
  app.delete('/api/admin/aca/aulas/:id', { preHandler: authMiddleware }, async (req) => {
    await prisma.acaAula.delete({ where: { id: Number((req.params as any).id) } }).catch(() => {})
    return { ok: true }
  })

  // ── GET /aulas/:id/frequencia — chamada da aula (alunos + presença) ──
  app.get('/api/admin/aca/aulas/:id/frequencia', { preHandler: authMiddleware }, async (req, reply) => {
    const aulaId = Number((req.params as any).id)
    const aula = await prisma.acaAula.findUnique({ where: { id: aulaId }, include: { diario: { select: { turmaId: true } } } })
    if (!aula) return reply.code(404).send({ error: 'Aula não encontrada' })
    const mats = await matriculadosDaTurma(aula.diario.turmaId)
    const freqs = await prisma.acaFrequencia.findMany({ where: { aulaId } })
    const fByMat = new Map(freqs.map((f) => [f.matriculaId, f]))
    const lista = mats.map((m) => {
      const f = fByMat.get(m.id)
      return { matriculaId: m.id, ra: m.aluno.ra, nome: m.aluno.lead.nome, presente: f ? f.presente : true, justificada: f ? f.justificada : false }
    })
    return { aula: { id: aula.id, data: aula.data, conteudo: aula.conteudo, quantidadeAulas: aula.quantidadeAulas }, lista }
  })

  // ── POST /aulas/:id/frequencia — salva a chamada (bulk) ──
  app.post('/api/admin/aca/aulas/:id/frequencia', { preHandler: authMiddleware }, async (req, reply) => {
    const aulaId = Number((req.params as any).id)
    const registros = ((req.body as any)?.registros || []) as Array<{ matriculaId: number; presente: boolean; justificada?: boolean }>
    for (const r of registros) {
      await prisma.acaFrequencia.upsert({
        where: { aulaId_matriculaId: { aulaId, matriculaId: Number(r.matriculaId) } },
        update: { presente: !!r.presente, justificada: !!r.justificada },
        create: { aulaId, matriculaId: Number(r.matriculaId), presente: !!r.presente, justificada: !!r.justificada },
      })
    }
    return { ok: true, salvos: registros.length }
  })
}
