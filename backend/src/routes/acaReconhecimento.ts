// src/routes/acaReconhecimento.ts
//
// PPCP e processos de reconhecimento de saberes (fase T4).

import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { authMiddleware } from '../lib/auth.js'
import {
  abrirProcesso, avaliarComponente, resumoProcesso, decidirProcesso, assegurarPpcpVigente, comVigencia,
} from '../services/acaReconhecimento.js'
import { logUserAudit, auditActor } from '../services/userAudit.js'

const num = (v: unknown): number | null => {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : null
}
const STATUS_PPCP = ['RASCUNHO', 'AUTORIZADO', 'SUSPENSO', 'ENCERRADO']

export async function acaReconhecimentoRoutes(app: FastifyInstance) {
  // ─────────── PPCP ───────────

  app.get('/api/admin/aca/ppcp', { preHandler: authMiddleware }, async (req) => {
    const courseId = num((req.query as any)?.courseId)
    const lista = await prisma.acaPpcp.findMany({
      where: { ...(courseId ? { courseId } : {}) },
      orderBy: { id: 'desc' },
      include: { _count: { select: { processos: true } } },
    })
    // Mesma regra do detalhe — vem do serviço para não divergir.
    return { ppcps: lista.map(comVigencia) }
  })

  app.post('/api/admin/aca/ppcp', { preHandler: authMiddleware }, async (req, reply) => {
    const b = (req.body as any) || {}
    const courseId = num(b.courseId)
    if (!courseId) return reply.code(400).send({ error: 'Selecione o curso do PPC de referência.' })
    if (!b.nome?.trim()) return reply.code(400).send({ error: 'Nome do projeto é obrigatório.' })
    const ppcp = await prisma.acaPpcp.create({
      data: {
        courseId, nome: String(b.nome).substring(0, 191),
        metodologia: b.metodologia ?? null,
        observacao: b.observacao ?? null,
        status: 'RASCUNHO',
      },
    })
    return reply.code(201).send({ ppcp })
  })

  /**
   * Autoriza o PPCP. Exige o ato do sistema de ensino: é ele que a norma pede, e
   * sem número/órgão não há como demonstrar a autorização depois.
   */
  app.post('/api/admin/aca/ppcp/:id/status', { preHandler: authMiddleware }, async (req, reply) => {
    const id = num((req.params as any).id)
    const b = (req.body as any) || {}
    const status = String(b.status || '').toUpperCase()
    if (!id) return reply.code(400).send({ error: 'id inválido' })
    if (!STATUS_PPCP.includes(status)) return reply.code(400).send({ error: `status deve ser um de: ${STATUS_PPCP.join(', ')}` })

    const atual = await prisma.acaPpcp.findUnique({ where: { id }, select: { nome: true, status: true } })
    if (!atual) return reply.code(404).send({ error: 'PPCP não encontrado' })

    if (status === 'AUTORIZADO') {
      if (!b.atoAutorizacao?.trim() || !b.orgaoAutorizador?.trim()) {
        return reply.code(400).send({
          error: 'Para autorizar, informe o ato e o órgão que autorizou '
            + '(Res. CNE/CP 1/2021, art. 47, §2º — o processo exige autorização do sistema de ensino).',
        })
      }
    }

    const ppcp = await prisma.acaPpcp.update({
      where: { id },
      data: {
        status: status as any,
        ...(status === 'AUTORIZADO'
          ? {
              atoAutorizacao: String(b.atoAutorizacao).substring(0, 191),
              orgaoAutorizador: String(b.orgaoAutorizador).substring(0, 191),
              autorizadoEm: b.autorizadoEm ? new Date(b.autorizadoEm) : new Date(),
              vigenciaAte: b.vigenciaAte ? new Date(b.vigenciaAte) : null,
            }
          : {}),
      },
    })
    const actor = auditActor(req)
    // Autorizar delega o poder de dispensar disciplina — precisa de trilha.
    void logUserAudit({
      action: 'aca.ppcp.status', targetType: 'aca_ppcp', targetUserId: null,
      targetLabel: `PPCP "${atual.nome}" → ${status}`,
      changes: { de: atual.status, para: status, ato: b.atoAutorizacao ?? null }, ...actor,
    })
    return { ppcp }
  })

  // ─────────── Processos ───────────

  app.get('/api/admin/aca/reconhecimento/processos', { preHandler: authMiddleware }, async (req) => {
    const q = req.query as any
    const where: any = {}
    if (q?.status) where.status = String(q.status).toUpperCase()
    if (num(q?.alunoId)) where.alunoId = Number(q.alunoId)
    const processos = await prisma.acaCertificacaoProcesso.findMany({
      where,
      orderBy: { id: 'desc' },
      take: 200,
      include: { ppcp: { select: { nome: true, status: true } }, _count: { select: { avaliacoes: true } } },
    })
    const alunoIds = [...new Set(processos.map((p) => p.alunoId))]
    const alunos = alunoIds.length
      ? await prisma.aluno.findMany({ where: { id: { in: alunoIds } }, select: { id: true, ra: true, lead: { select: { nome: true } } } })
      : []
    const mapa = new Map(alunos.map((a) => [a.id, a]))
    return {
      processos: processos.map((p) => ({
        ...p,
        aluno: { nome: mapa.get(p.alunoId)?.lead?.nome ?? `Aluno #${p.alunoId}`, ra: mapa.get(p.alunoId)?.ra ?? null },
      })),
    }
  })

  app.get('/api/admin/aca/reconhecimento/processos/:id', { preHandler: authMiddleware }, async (req, reply) => {
    const id = num((req.params as any).id)
    if (!id) return reply.code(400).send({ error: 'id inválido' })
    const r = await resumoProcesso(id)
    if (!r) return reply.code(404).send({ error: 'Processo não encontrado' })
    // Componentes do curso do PPCP ainda não avaliados — é o que a banca pode avaliar.
    const avaliados = new Set(r.avaliacoes.map((a) => a.componenteId))
    const matrizes = await prisma.acaMatriz.findMany({
      where: { courseId: r.ppcp.courseId, status: { in: ['ATIVA', 'SUSPENSA'] } },
      select: { id: true },
    })
    const disponiveis = matrizes.length
      ? (await prisma.acaComponente.findMany({
          where: { matrizId: { in: matrizes.map((m) => m.id) } },
          select: { id: true, chTotal: true, disciplina: { select: { nome: true, cargaHoraria: true } } },
        })).filter((c) => !avaliados.has(c.id)).map((c) => ({
          id: c.id,
          nome: c.disciplina?.nome ?? `Componente #${c.id}`,
          cargaHoraria: c.chTotal ?? c.disciplina?.cargaHoraria ?? 0,
        }))
      : []
    return { ...r, componentesDisponiveis: disponiveis }
  })

  app.post('/api/admin/aca/reconhecimento/processos', { preHandler: authMiddleware }, async (req, reply) => {
    const b = (req.body as any) || {}
    const ppcpId = num(b.ppcpId)
    const alunoId = num(b.alunoId)
    if (!ppcpId || !alunoId) return reply.code(400).send({ error: 'ppcpId e alunoId são obrigatórios' })
    try {
      const processo = await abrirProcesso({
        ppcpId, alunoId,
        matriculaId: num(b.matriculaId),
        itinerario: b.itinerario ?? null,
        banca: b.banca ?? null,
      })
      const actor = auditActor(req)
      void logUserAudit({
        action: 'aca.reconhecimento.aberto', targetType: 'aca_certificacao', targetUserId: null,
        targetLabel: `Processo ${processo.protocolo}`, changes: { ppcpId, alunoId }, ...actor,
      })
      return reply.code(201).send({ processo })
    } catch (e: any) {
      return reply.code(400).send({ error: e?.message })
    }
  })

  app.post('/api/admin/aca/reconhecimento/avaliar', { preHandler: authMiddleware }, async (req, reply) => {
    const b = (req.body as any) || {}
    const processoId = num(b.processoId)
    const componenteId = num(b.componenteId)
    const resultado = String(b.resultado || '').toUpperCase()
    if (!processoId || !componenteId) return reply.code(400).send({ error: 'processoId e componenteId são obrigatórios' })
    if (resultado !== 'RECONHECIDO' && resultado !== 'NAO_RECONHECIDO') {
      return reply.code(400).send({ error: 'resultado deve ser RECONHECIDO ou NAO_RECONHECIDO' })
    }
    const actor = auditActor(req)
    try {
      const a = await avaliarComponente({
        processoId, componenteId,
        instrumento: String(b.instrumento || ''),
        resultado: resultado as any,
        parecer: b.parecer ?? null,
        avaliadorNome: b.avaliadorNome ?? actor.actorName,
        decididoPor: actor.actorId ?? null,
      })
      // Dispensar disciplina por reconhecimento é ato de efeito no histórico.
      void logUserAudit({
        action: 'aca.reconhecimento.avaliado', targetType: 'aca_certificacao', targetUserId: null,
        targetLabel: `Processo ${processoId} · componente ${componenteId} → ${resultado}`,
        changes: { instrumento: b.instrumento ?? null, aproveitamentoId: a.aproveitamentoId }, ...actor,
      })
      return reply.code(201).send({ avaliacao: a })
    } catch (e: any) {
      return reply.code(400).send({ error: e?.message })
    }
  })

  app.post('/api/admin/aca/reconhecimento/processos/:id/decidir', { preHandler: authMiddleware }, async (req, reply) => {
    const id = num((req.params as any).id)
    const b = (req.body as any) || {}
    const status = String(b.status || '').toUpperCase()
    if (!id) return reply.code(400).send({ error: 'id inválido' })
    if (!['DEFERIDO', 'INDEFERIDO', 'CANCELADO'].includes(status)) {
      return reply.code(400).send({ error: 'status deve ser DEFERIDO, INDEFERIDO ou CANCELADO' })
    }
    const actor = auditActor(req)
    try {
      const processo = await decidirProcesso({
        processoId: id, status: status as any,
        parecerFinal: b.parecerFinal ?? null,
        decididoPor: actor.actorId ?? null,
      })
      void logUserAudit({
        action: 'aca.reconhecimento.decidido', targetType: 'aca_certificacao', targetUserId: null,
        targetLabel: `Processo ${processo.protocolo} → ${status}`, ...actor,
      })
      return { processo }
    } catch (e: any) {
      return reply.code(400).send({ error: e?.message })
    }
  })

  /** Checagem rápida usada pela tela antes de oferecer o botão de abrir processo. */
  app.get('/api/admin/aca/ppcp/:id/vigencia', { preHandler: authMiddleware }, async (req, reply) => {
    const id = num((req.params as any).id)
    if (!id) return reply.code(400).send({ error: 'id inválido' })
    try {
      const ppcp = await assegurarPpcpVigente(id)
      return { ok: true, ppcp }
    } catch (e: any) {
      return { ok: false, motivo: e?.message }
    }
  })
}
