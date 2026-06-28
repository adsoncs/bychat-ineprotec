// src/routes/acaHorario.ts
// Módulo Acadêmico · O2.6 — Quadro de horários. Grade da turma (dia × hora ×
// disciplina/professor/sala) com DETECÇÃO DE CONFLITO: mesmo professor ou sala
// em horários sobrepostos (em qualquer turma).

import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { authMiddleware } from '../lib/auth.js'

export const DIAS = ['', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado', 'Domingo']
const overlap = (aI: string, aF: string, bI: string, bF: string) => aI < bF && bI < aF

/** Conflitos de professor/sala para um horário (exclui ele mesmo). */
async function detectarConflitos(h: { id?: number; diaSemana: number; horaInicio: string; horaFim: string; professorUserId: number | null; sala: string | null }) {
  const candidatos = await prisma.acaHorario.findMany({
    where: { diaSemana: h.diaSemana, id: h.id ? { not: h.id } : undefined, OR: [...(h.professorUserId ? [{ professorUserId: h.professorUserId }] : []), ...(h.sala ? [{ sala: h.sala }] : [])] },
    select: { id: true, horaInicio: true, horaFim: true, professorUserId: true, sala: true, turmaId: true, disciplinaId: true },
  })
  const conflitos = candidatos.filter((c) => overlap(h.horaInicio, h.horaFim, c.horaInicio, c.horaFim))
  return conflitos.map((c) => ({ id: c.id, turmaId: c.turmaId, motivo: c.professorUserId === h.professorUserId && h.professorUserId ? 'professor' : 'sala', horario: `${c.horaInicio}–${c.horaFim}` }))
}

async function comNomes(horarios: any[]) {
  const discIds = [...new Set(horarios.map((h) => h.disciplinaId))]
  const profIds = [...new Set(horarios.map((h) => h.professorUserId).filter(Boolean))] as number[]
  const [discs, profs] = await Promise.all([
    discIds.length ? prisma.acaDisciplina.findMany({ where: { id: { in: discIds } }, select: { id: true, nome: true } }) : [],
    profIds.length ? prisma.user.findMany({ where: { id: { in: profIds } }, select: { id: true, name: true } }) : [],
  ])
  const dMap = new Map(discs.map((d) => [d.id, d.nome])); const pMap = new Map(profs.map((p) => [p.id, p.name]))
  return horarios.map((h) => ({ ...h, disciplinaNome: dMap.get(h.disciplinaId) ?? '—', professorNome: h.professorUserId ? pMap.get(h.professorUserId) ?? '—' : null }))
}

export async function acaHorarioRoutes(app: FastifyInstance) {
  // ── Grade de uma turma ──
  app.get('/api/admin/aca/turmas/:id/horarios', { preHandler: authMiddleware }, async (req) => {
    const turmaId = Number((req.params as any).id)
    const horarios = await prisma.acaHorario.findMany({ where: { turmaId }, orderBy: [{ diaSemana: 'asc' }, { horaInicio: 'asc' }] })
    return { horarios: await comNomes(horarios) }
  })

  // ── Criar (checa conflito; force=true ignora) ──
  app.post('/api/admin/aca/horarios', { preHandler: authMiddleware }, async (req, reply) => {
    const b = (req.body as any) || {}
    if (!b.turmaId || !b.disciplinaId || !b.diaSemana || !b.horaInicio || !b.horaFim) return reply.code(400).send({ error: 'turmaId, disciplinaId, diaSemana, horaInicio e horaFim são obrigatórios' })
    if (b.horaFim <= b.horaInicio) return reply.code(400).send({ error: 'horaFim deve ser maior que horaInicio' })
    const novo = { diaSemana: Number(b.diaSemana), horaInicio: String(b.horaInicio), horaFim: String(b.horaFim), professorUserId: b.professorUserId ? Number(b.professorUserId) : null, sala: b.sala || null }
    const conflitos = await detectarConflitos(novo)
    if (conflitos.length && b.force !== true) return reply.code(409).send({ error: 'Conflito de horário', conflitos })
    const horario = await prisma.acaHorario.create({ data: { turmaId: Number(b.turmaId), disciplinaId: Number(b.disciplinaId), ...novo } })
    return reply.code(201).send({ horario, conflitos })
  })

  // ── Editar ──
  app.put('/api/admin/aca/horarios/:id', { preHandler: authMiddleware }, async (req, reply) => {
    const id = Number((req.params as any).id); const b = (req.body as any) || {}
    const atual = await prisma.acaHorario.findUnique({ where: { id } })
    if (!atual) return reply.code(404).send({ error: 'Horário não encontrado' })
    const novo = {
      id, diaSemana: b.diaSemana != null ? Number(b.diaSemana) : atual.diaSemana,
      horaInicio: b.horaInicio ?? atual.horaInicio, horaFim: b.horaFim ?? atual.horaFim,
      professorUserId: 'professorUserId' in b ? (b.professorUserId ? Number(b.professorUserId) : null) : atual.professorUserId,
      sala: 'sala' in b ? (b.sala || null) : atual.sala,
    }
    if (novo.horaFim <= novo.horaInicio) return reply.code(400).send({ error: 'horaFim deve ser maior que horaInicio' })
    const conflitos = await detectarConflitos(novo)
    if (conflitos.length && b.force !== true) return reply.code(409).send({ error: 'Conflito de horário', conflitos })
    const horario = await prisma.acaHorario.update({ where: { id }, data: { diaSemana: novo.diaSemana, horaInicio: novo.horaInicio, horaFim: novo.horaFim, professorUserId: novo.professorUserId, sala: novo.sala, ...(b.disciplinaId ? { disciplinaId: Number(b.disciplinaId) } : {}) } })
    return { horario, conflitos }
  })

  app.delete('/api/admin/aca/horarios/:id', { preHandler: authMiddleware }, async (req) => {
    await prisma.acaHorario.delete({ where: { id: Number((req.params as any).id) } }).catch(() => {})
    return { ok: true }
  })
}

/** Grade do aluno (horários da sua turma MATRICULADO). */
export async function gradeDoAluno(alunoId: number) {
  const mat = await prisma.acaMatricula.findFirst({ where: { alunoId, status: 'MATRICULADO' }, orderBy: { dataMatricula: 'desc' }, select: { turmaId: true } })
  if (!mat) return []
  const horarios = await prisma.acaHorario.findMany({ where: { turmaId: mat.turmaId }, orderBy: [{ diaSemana: 'asc' }, { horaInicio: 'asc' }] })
  return comNomes(horarios)
}
