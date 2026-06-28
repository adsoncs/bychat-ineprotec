// src/routes/acaInscricao.ts
// Módulo Acadêmico · P3 — Captação/Inscrição: vincula Aluno a Turma criando a
// AcaMatricula em status INSCRITO, com controle de VAGAS e LISTA DE ESPERA.
// A efetivação (INSCRITO→MATRICULADO + contrato) é o P4. Rotas /api/admin/aca/*.

import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { authMiddleware } from '../lib/auth.js'
import { statusBloqueio } from '../services/acaBloqueio.js'

const ATIVOS = ['INSCRITO', 'PRE_MATRICULA', 'MATRICULADO'] as const

/** Ocupação de vaga: inscritos ativos (fora da lista de espera) de uma turma. */
async function ocupacao(turmaId: number) {
  const turma = await prisma.acaTurma.findUnique({ where: { id: turmaId }, select: { capacidade: true } })
  const inscritos = await prisma.acaMatricula.count({ where: { turmaId, listaEspera: false, status: { in: ATIVOS as any } } })
  const emEspera = await prisma.acaMatricula.count({ where: { turmaId, listaEspera: true, status: { in: ATIVOS as any } } })
  const capacidade = turma?.capacidade ?? null
  const vagasLivres = capacidade != null ? Math.max(0, capacidade - inscritos) : null
  return { capacidade, inscritos, emEspera, vagasLivres, lotada: capacidade != null && inscritos >= capacidade }
}

export async function acaInscricaoRoutes(app: FastifyInstance) {
  // ── GET /turmas/:id/inscricoes — lista + ocupação ──
  app.get('/api/admin/aca/turmas/:id/inscricoes', { preHandler: authMiddleware }, async (req) => {
    const turmaId = Number((req.params as any).id)
    const inscricoes = await prisma.acaMatricula.findMany({
      where: { turmaId },
      orderBy: [{ listaEspera: 'asc' }, { dataMatricula: 'asc' }],
      select: {
        id: true, status: true, listaEspera: true, origem: true, dataMatricula: true,
        aluno: { select: { id: true, ra: true, lead: { select: { nome: true, email: true, whatsapp: true } } } },
      },
    })
    return { inscricoes, ocupacao: await ocupacao(turmaId) }
  })

  // ── POST /turmas/:id/inscricoes — inscreve um aluno (vaga ou lista de espera) ──
  app.post('/api/admin/aca/turmas/:id/inscricoes', { preHandler: authMiddleware }, async (req, reply) => {
    const turmaId = Number((req.params as any).id)
    const b = (req.body as any) || {}
    const alunoId = Number(b.alunoId)
    if (!alunoId) return reply.code(400).send({ error: 'alunoId é obrigatório' })
    const turma = await prisma.acaTurma.findUnique({ where: { id: turmaId }, select: { id: true } })
    if (!turma) return reply.code(404).send({ error: 'Turma não encontrada' })
    const aluno = await prisma.aluno.findUnique({ where: { id: alunoId }, select: { id: true } })
    if (!aluno) return reply.code(404).send({ error: 'Aluno não encontrado' })
    const dup = await prisma.acaMatricula.findUnique({ where: { alunoId_turmaId: { alunoId, turmaId } }, select: { id: true, status: true } })
    if (dup) return reply.code(409).send({ error: 'Aluno já inscrito nesta turma', matriculaId: dup.id })
    // Fin-4: bloqueio acadêmico por inadimplência (admin pode forçar com forcarBloqueio=true)
    if (b.forcarBloqueio !== true) {
      const bloq = await statusBloqueio(alunoId)
      if (bloq.bloqueado) return reply.code(409).send({ error: `Aluno bloqueado por inadimplência: ${bloq.motivo}. Regularize ou force a inscrição.`, bloqueio: bloq })
    }

    const occ = await ocupacao(turmaId)
    const listaEspera = b.forcarEspera === true || occ.lotada
    const insc = await prisma.acaMatricula.create({
      data: { alunoId, turmaId, status: 'INSCRITO', listaEspera, origem: b.origem || 'secretaria' },
      select: { id: true, status: true, listaEspera: true },
    })
    await prisma.acaMatriculaEvento.create({ data: { matriculaId: insc.id, para: 'INSCRITO', obs: listaEspera ? 'Inscrição em lista de espera (turma lotada)' : 'Inscrição em vaga' } })
    return reply.code(201).send({ inscricao: insc, listaEspera, ocupacao: await ocupacao(turmaId) })
  })

  // ── POST /inscricoes/:id/promover — tira da lista de espera para vaga ──
  app.post('/api/admin/aca/inscricoes/:id/promover', { preHandler: authMiddleware }, async (req, reply) => {
    const id = Number((req.params as any).id)
    const m = await prisma.acaMatricula.findUnique({ where: { id }, select: { id: true, turmaId: true, listaEspera: true } })
    if (!m) return reply.code(404).send({ error: 'Inscrição não encontrada' })
    if (!m.listaEspera) return { ok: true, jaEmVaga: true }
    const occ = await ocupacao(m.turmaId)
    if (occ.lotada) return reply.code(409).send({ error: 'Turma ainda está lotada — não há vaga livre.' })
    await prisma.acaMatricula.update({ where: { id }, data: { listaEspera: false } })
    await prisma.acaMatriculaEvento.create({ data: { matriculaId: id, para: 'INSCRITO', obs: 'Promovido da lista de espera para vaga' } })
    return { ok: true, ocupacao: await ocupacao(m.turmaId) }
  })

  // ── DELETE /inscricoes/:id — cancela inscrição (libera vaga) ──
  app.delete('/api/admin/aca/inscricoes/:id', { preHandler: authMiddleware }, async (req, reply) => {
    const id = Number((req.params as any).id)
    const m = await prisma.acaMatricula.findUnique({ where: { id }, select: { id: true, turmaId: true, status: true } })
    if (!m) return reply.code(404).send({ error: 'Inscrição não encontrada' })
    if (m.status === 'MATRICULADO') return reply.code(409).send({ error: 'Aluno já matriculado — cancele pela tela de matrícula (P4).' })
    await prisma.acaMatricula.update({ where: { id }, data: { status: 'CANCELADO', listaEspera: false } })
    await prisma.acaMatriculaEvento.create({ data: { matriculaId: id, de: m.status, para: 'CANCELADO', obs: 'Inscrição cancelada' } })
    return { ok: true, ocupacao: await ocupacao(m.turmaId) }
  })
}
