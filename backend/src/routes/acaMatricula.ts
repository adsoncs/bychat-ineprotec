// src/routes/acaMatricula.ts
// Módulo Acadêmico · P4 — Matrícula: efetivação e ciclo de vida com trilha
// (AcaMatriculaEvento). Status: INSCRITO → PRE_MATRICULA → MATRICULADO →
// TRANCADO/TRANSFERIDO/CONCLUIDO/EVADIDO/CANCELADO. A geração de contrato +
// parcelas (Asaas) ao efetivar é o P5 — ponto de extensão marcado abaixo.

import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { authMiddleware } from '../lib/auth.js'
import { getOperator } from '../services/leadHistory.js'
import { gerarContratoEParcelas } from '../services/acaFinanceiro.js'

/** Gera contrato + parcelas ao efetivar; best-effort (não bloqueia a matrícula). */
async function gerarFinanceiro(matriculaId: number): Promise<string | null> {
  try { await gerarContratoEParcelas(matriculaId); return null }
  catch (e: any) { return e?.message || 'falha ao gerar financeiro' }
}

const TRANSICOES: Record<string, string[]> = {
  INSCRITO:      ['PRE_MATRICULA', 'MATRICULADO', 'CANCELADO'],
  PRE_MATRICULA: ['MATRICULADO', 'CANCELADO'],
  MATRICULADO:   ['TRANCADO', 'TRANSFERIDO', 'CONCLUIDO', 'EVADIDO', 'CANCELADO'],
  TRANCADO:      ['MATRICULADO', 'CANCELADO', 'EVADIDO'],
  TRANSFERIDO:   [],
  CONCLUIDO:     [],
  EVADIDO:       [],
  CANCELADO:     [],
}
const SAIDA = ['CANCELADO', 'EVADIDO', 'TRANSFERIDO']

export async function acaMatriculaRoutes(app: FastifyInstance) {
  // ── GET /matriculas — lista (filtros status, turmaId) ──
  app.get('/api/admin/aca/matriculas', { preHandler: authMiddleware }, async (req) => {
    const q = req.query as any
    const where: any = {}
    if (q.status) where.status = q.status
    if (q.turmaId) where.turmaId = Number(q.turmaId)
    const matriculas = await prisma.acaMatricula.findMany({
      where, orderBy: { dataMatricula: 'desc' }, take: 200,
      select: {
        id: true, status: true, listaEspera: true, dataMatricula: true, origem: true,
        aluno: { select: { id: true, ra: true, lead: { select: { nome: true } } } },
        turma: { select: { id: true, nome: true, periodoLetivo: { select: { codigo: true } } } },
        contrato: { select: { id: true, status: true } },
      },
    })
    const counts = await prisma.acaMatricula.groupBy({ by: ['status'], _count: { _all: true } })
    const counters: Record<string, number> = {}
    for (const c of counts) counters[c.status] = c._count._all
    return { matriculas, counters }
  })

  // ── GET /matriculas/:id — detalhe + trilha de eventos ──
  app.get('/api/admin/aca/matriculas/:id', { preHandler: authMiddleware }, async (req, reply) => {
    const id = Number((req.params as any).id)
    const matricula = await prisma.acaMatricula.findUnique({
      where: { id },
      include: {
        aluno: { select: { id: true, ra: true, cpf: true, lead: { select: { nome: true, email: true, whatsapp: true } } } },
        turma: { select: { id: true, nome: true, turno: true, periodoLetivo: { select: { codigo: true } } } },
        eventos: { orderBy: { createdAt: 'asc' } },
        contrato: { include: { parcelas: { select: { id: true, situacao: true, valorBrutoCentavos: true, dataVencimento: true } } } },
      },
    })
    if (!matricula) return reply.code(404).send({ error: 'Matrícula não encontrada' })
    return { matricula, transicoes: TRANSICOES[matricula.status] ?? [] }
  })

  // ── POST /matriculas/:id/status — transição validada (com trilha) ──
  app.post('/api/admin/aca/matriculas/:id/status', { preHandler: authMiddleware }, async (req, reply) => {
    const id = Number((req.params as any).id)
    const b = (req.body as any) || {}
    const para = String(b.para || '')
    const m = await prisma.acaMatricula.findUnique({ where: { id }, select: { id: true, status: true, listaEspera: true, turmaId: true } })
    if (!m) return reply.code(404).send({ error: 'Matrícula não encontrada' })
    if (!(TRANSICOES[m.status] || []).includes(para)) {
      return reply.code(409).send({ error: `Transição inválida: ${m.status} → ${para}` })
    }
    // Efetivar exige estar em vaga (não na lista de espera).
    if (para === 'MATRICULADO' && m.listaEspera) {
      return reply.code(409).send({ error: 'Aluno está na lista de espera — promova para vaga antes de matricular.' })
    }
    const op = getOperator(req)
    const data: any = { status: para }
    if (para === 'CONCLUIDO') data.dataConclusao = new Date()
    if (SAIDA.includes(para)) data.motivoSaida = b.obs || null

    await prisma.acaMatricula.update({ where: { id }, data })
    await prisma.acaMatriculaEvento.create({ data: { matriculaId: id, de: m.status, para, obs: b.obs || null, userId: op.userId ?? null } })

    // P5 — ao efetivar (→ MATRICULADO), gera contrato + parcelas (financeiro nativo).
    let financeiroAviso: string | null = null
    if (para === 'MATRICULADO') financeiroAviso = await gerarFinanceiro(id)

    const matricula = await prisma.acaMatricula.findUnique({ where: { id }, select: { id: true, status: true } })
    return { matricula, transicoes: TRANSICOES[para] ?? [], financeiroAviso }
  })

  // ── POST /matriculas/:id/efetivar — atalho INSCRITO/PRE_MATRICULA → MATRICULADO ──
  app.post('/api/admin/aca/matriculas/:id/efetivar', { preHandler: authMiddleware }, async (req, reply) => {
    const id = Number((req.params as any).id)
    const m = await prisma.acaMatricula.findUnique({ where: { id }, select: { status: true, listaEspera: true } })
    if (!m) return reply.code(404).send({ error: 'Matrícula não encontrada' })
    if (!['INSCRITO', 'PRE_MATRICULA', 'TRANCADO'].includes(m.status)) return reply.code(409).send({ error: `Não é possível efetivar a partir de ${m.status}` })
    if (m.listaEspera) return reply.code(409).send({ error: 'Aluno na lista de espera — promova para vaga antes.' })
    const op = getOperator(req)
    await prisma.acaMatricula.update({ where: { id }, data: { status: 'MATRICULADO' } })
    await prisma.acaMatriculaEvento.create({ data: { matriculaId: id, de: m.status, para: 'MATRICULADO', obs: 'Matrícula efetivada', userId: op.userId ?? null } })
    const financeiroAviso = await gerarFinanceiro(id)
    // gatilho de contrato (fire-and-forget; não bloqueia a efetivação)
    prisma.acaMatricula.findUnique({ where: { id }, select: { alunoId: true } })
      .then((mm) => mm && import('../services/acaAssinatura.js').then((s) => s.dispararEvento('MATRICULA_CRIADA', { alunoId: mm.alunoId, matriculaId: id })).catch(() => {}))
      .catch(() => {})
    return { ok: true, status: 'MATRICULADO', financeiroAviso }
  })
}
