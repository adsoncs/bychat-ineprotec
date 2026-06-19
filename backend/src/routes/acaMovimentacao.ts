// src/routes/acaMovimentacao.ts
// Módulo Acadêmico · F5 — Movimentações Acadêmicas (rotas /api/admin/aca/movimentacoes).
// Trancamento / reingresso / afastamento / transferência (interna|externa) /
// remanejamento / cancelamento / evasão + "alunos sem rematrícula" e o processo
// "atualiza situações" em lote. Regras no service acaMovimentacao.ts.

import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { authMiddleware } from '../lib/auth.js'
import { getOperator } from '../services/leadHistory.js'
import * as mov from '../services/acaMovimentacao.js'

const TIPO_LABEL: Record<string, string> = {
  TRANCAMENTO: 'Trancamento', REINGRESSO: 'Reingresso', AFASTAMENTO: 'Afastamento',
  TRANSFERENCIA_INTERNA: 'Transferência interna', TRANSFERENCIA_EXTERNA: 'Transferência externa',
  REMANEJAMENTO: 'Remanejamento', RECLASSIFICACAO: 'Reclassificação',
  CANCELAMENTO: 'Cancelamento', EVASAO: 'Evasão',
}

function handleErr(reply: any, e: any) {
  if (e instanceof mov.MovimentacaoError) return reply.code(e.code).send({ error: e.message })
  reply.log?.error?.(e)
  return reply.code(500).send({ error: e?.message || 'Erro ao processar movimentação' })
}

export async function acaMovimentacaoRoutes(app: FastifyInstance) {
  // ── GET /movimentacoes — histórico (filtros tipo, alunoId, matriculaId) ──
  app.get('/api/admin/aca/movimentacoes', { preHandler: authMiddleware }, async (req) => {
    const q = req.query as any
    const where: any = {}
    if (q.tipo) where.tipo = q.tipo
    if (q.alunoId) where.alunoId = Number(q.alunoId)
    if (q.matriculaId) where.matriculaId = Number(q.matriculaId)
    const rows = await prisma.acaMovimentacao.findMany({ where, orderBy: { createdAt: 'desc' }, take: 300 })

    // enriquecimento (sem @relation): busca alunos + turmas de destino em lote
    const alunoIds = [...new Set(rows.map((r) => r.alunoId))]
    const turmaIds = [...new Set(rows.map((r) => r.turmaDestinoId).filter(Boolean) as number[])]
    const [alunos, turmas] = await Promise.all([
      alunoIds.length ? prisma.aluno.findMany({ where: { id: { in: alunoIds } }, select: { id: true, ra: true, lead: { select: { nome: true } } } }) : [],
      turmaIds.length ? prisma.acaTurma.findMany({ where: { id: { in: turmaIds } }, select: { id: true, nome: true } }) : [],
    ])
    const aMap = new Map(alunos.map((a) => [a.id, a]))
    const tMap = new Map(turmas.map((t) => [t.id, t]))
    const counts = await prisma.acaMovimentacao.groupBy({ by: ['tipo'], _count: { _all: true } })
    const counters: Record<string, number> = {}
    for (const c of counts) counters[c.tipo] = c._count._all

    return {
      movimentacoes: rows.map((r) => ({
        ...r,
        tipoLabel: TIPO_LABEL[r.tipo] || r.tipo,
        aluno: aMap.get(r.alunoId) || null,
        turmaDestino: r.turmaDestinoId ? tMap.get(r.turmaDestinoId) || null : null,
      })),
      counters,
    }
  })

  // Ações pontuais ────────────────────────────────────────────────
  app.post('/api/admin/aca/movimentacoes/trancamento', { preHandler: authMiddleware }, async (req, reply) => {
    const b = (req.body as any) || {}
    const op = getOperator(req)
    try {
      const r = await mov.trancar(Number(b.matriculaId), b.motivo || null, b.dataRetornoPrevista ? new Date(b.dataRetornoPrevista) : null, { userId: op.userId })
      return { ok: true, movimentacao: r }
    } catch (e) { return handleErr(reply, e) }
  })

  app.post('/api/admin/aca/movimentacoes/reingresso', { preHandler: authMiddleware }, async (req, reply) => {
    const b = (req.body as any) || {}
    const op = getOperator(req)
    try { return { ok: true, movimentacao: await mov.reingressar(Number(b.matriculaId), b.motivo || null, { userId: op.userId }) } }
    catch (e) { return handleErr(reply, e) }
  })

  app.post('/api/admin/aca/movimentacoes/afastamento', { preHandler: authMiddleware }, async (req, reply) => {
    const b = (req.body as any) || {}
    const op = getOperator(req)
    try { return { ok: true, movimentacao: await mov.afastar(Number(b.matriculaId), b.motivo || null, b.dataRetornoPrevista ? new Date(b.dataRetornoPrevista) : null, { userId: op.userId }) } }
    catch (e) { return handleErr(reply, e) }
  })

  app.post('/api/admin/aca/movimentacoes/cancelamento', { preHandler: authMiddleware }, async (req, reply) => {
    const b = (req.body as any) || {}
    const op = getOperator(req)
    try { return { ok: true, movimentacao: await mov.cancelar(Number(b.matriculaId), b.motivo || null, { userId: op.userId }) } }
    catch (e) { return handleErr(reply, e) }
  })

  app.post('/api/admin/aca/movimentacoes/evasao', { preHandler: authMiddleware }, async (req, reply) => {
    const b = (req.body as any) || {}
    const op = getOperator(req)
    try { return { ok: true, movimentacao: await mov.evadir(Number(b.matriculaId), b.motivo || null, { userId: op.userId }) } }
    catch (e) { return handleErr(reply, e) }
  })

  app.post('/api/admin/aca/movimentacoes/transferencia-externa', { preHandler: authMiddleware }, async (req, reply) => {
    const b = (req.body as any) || {}
    const op = getOperator(req)
    try { return { ok: true, movimentacao: await mov.transferenciaExterna(Number(b.matriculaId), String(b.instituicaoDestino || ''), b.motivo || null, { userId: op.userId }) } }
    catch (e) { return handleErr(reply, e) }
  })

  app.post('/api/admin/aca/movimentacoes/transferencia-interna', { preHandler: authMiddleware }, async (req, reply) => {
    const b = (req.body as any) || {}
    const op = getOperator(req)
    try {
      const r = await mov.transferenciaInterna(Number(b.matriculaId), Number(b.turmaDestinoId), b.motivo || null, { userId: op.userId }, !!b.remanejamento)
      return { ok: true, ...r }
    } catch (e) { return handleErr(reply, e) }
  })

  // Processos em lote ──────────────────────────────────────────────
  app.get('/api/admin/aca/movimentacoes/sem-rematricula', { preHandler: authMiddleware }, async () => {
    const lista = await mov.alunosSemRematricula()
    return { total: lista.length, alunos: lista }
  })

  app.post('/api/admin/aca/movimentacoes/atualiza-situacoes', { preHandler: authMiddleware }, async (req) => {
    const b = (req.body as any) || {}
    const op = getOperator(req)
    return mov.atualizaSituacoes({ dryRun: b.dryRun !== false, matriculaIds: b.matriculaIds, ctx: { userId: op.userId } })
  })

  // Apoio: turmas de destino (ativas) para os modais de transferência/remanejamento
  app.get('/api/admin/aca/movimentacoes/turmas-destino', { preHandler: authMiddleware }, async () => {
    const turmas = await prisma.acaTurma.findMany({
      where: { ativo: true },
      orderBy: { id: 'desc' }, take: 200,
      select: { id: true, nome: true, periodoLetivo: { select: { codigo: true } } },
    })
    return { turmas }
  })
}
