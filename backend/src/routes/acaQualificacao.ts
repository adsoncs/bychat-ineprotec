// src/routes/acaQualificacao.ts
//
// Módulos com terminalidade e certificação intermediária (fase T2).

import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { authMiddleware } from '../lib/auth.js'
import { garantirEditavel } from '../services/acaMatriz.js'
import {
  progressoModulos, emitirCertificadoQualificacao, qualificacoesAEmitir,
} from '../services/acaQualificacao.js'
import { logUserAudit, auditActor } from '../services/userAudit.js'

const num = (v: unknown): number | null => {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : null
}

export async function acaQualificacaoRoutes(app: FastifyInstance) {
  // ─────────── Módulos da matriz ───────────

  app.get('/api/admin/aca/matrizes/:id/modulos', { preHandler: authMiddleware }, async (req, reply) => {
    const matrizId = num((req.params as any).id)
    if (!matrizId) return reply.code(400).send({ error: 'id inválido' })
    const modulos = await prisma.acaMatrizModulo.findMany({
      where: { matrizId },
      orderBy: { numero: 'asc' },
      include: { _count: { select: { componentes: true } } },
    })
    // Componentes ainda sem módulo: a tela precisa mostrar o que falta agrupar.
    const semModulo = await prisma.acaComponente.count({ where: { matrizId, moduloId: null } })
    return { modulos, componentesSemModulo: semModulo }
  })

  app.post('/api/admin/aca/matrizes/:id/modulos', { preHandler: authMiddleware }, async (req, reply) => {
    const matrizId = num((req.params as any).id)
    const b = (req.body as any) || {}
    if (!matrizId) return reply.code(400).send({ error: 'id inválido' })
    if (!b.nome?.trim()) return reply.code(400).send({ error: 'Nome do módulo é obrigatório' })
    try {
      // Módulo faz parte da grade: matriz ativa é imutável, como os componentes.
      await garantirEditavel(matrizId)
      const ultimo = await prisma.acaMatrizModulo.findFirst({
        where: { matrizId }, orderBy: { numero: 'desc' }, select: { numero: true },
      })
      const modulo = await prisma.acaMatrizModulo.create({
        data: {
          matrizId,
          numero: num(b.numero) ?? (ultimo ? ultimo.numero + 1 : 1),
          nome: String(b.nome).substring(0, 191),
          tituloQualificacao: b.tituloQualificacao?.trim() ? String(b.tituloQualificacao).substring(0, 191) : null,
          codigoCbo: b.codigoCbo ?? null,
          cargaHoraria: num(b.cargaHoraria),
          descricao: b.descricao ?? null,
        },
      })
      return reply.code(201).send({ modulo })
    } catch (e: any) {
      return reply.code(400).send({ error: e?.message })
    }
  })

  app.put('/api/admin/aca/modulos/:id', { preHandler: authMiddleware }, async (req, reply) => {
    const id = num((req.params as any).id)
    if (!id) return reply.code(400).send({ error: 'id inválido' })
    const atual = await prisma.acaMatrizModulo.findUnique({ where: { id }, select: { matrizId: true } })
    if (!atual) return reply.code(404).send({ error: 'Módulo não encontrado' })
    const b = (req.body as any) || {}
    try {
      await garantirEditavel(atual.matrizId)
      const dados: any = {}
      if (b.nome !== undefined) dados.nome = String(b.nome).substring(0, 191)
      if (b.tituloQualificacao !== undefined) dados.tituloQualificacao = b.tituloQualificacao?.trim() ? String(b.tituloQualificacao).substring(0, 191) : null
      if (b.codigoCbo !== undefined) dados.codigoCbo = b.codigoCbo || null
      if (b.cargaHoraria !== undefined) dados.cargaHoraria = num(b.cargaHoraria)
      if (b.descricao !== undefined) dados.descricao = b.descricao || null
      if (b.numero !== undefined) dados.numero = num(b.numero) ?? 1
      const modulo = await prisma.acaMatrizModulo.update({ where: { id }, data: dados })
      return { modulo }
    } catch (e: any) {
      return reply.code(400).send({ error: e?.message })
    }
  })

  app.delete('/api/admin/aca/modulos/:id', { preHandler: authMiddleware }, async (req, reply) => {
    const id = num((req.params as any).id)
    if (!id) return reply.code(400).send({ error: 'id inválido' })
    const atual = await prisma.acaMatrizModulo.findUnique({ where: { id }, select: { matrizId: true } })
    if (!atual) return reply.code(404).send({ error: 'Módulo não encontrado' })
    try {
      await garantirEditavel(atual.matrizId)
      // Os componentes não são apagados: perdem o vínculo com o módulo (SetNull).
      await prisma.acaMatrizModulo.delete({ where: { id } })
      return { ok: true }
    } catch (e: any) {
      return reply.code(400).send({ error: e?.message })
    }
  })

  /** Agrupa componentes num módulo (ou solta, com moduloId nulo). */
  app.post('/api/admin/aca/modulos/vincular-componentes', { preHandler: authMiddleware }, async (req, reply) => {
    const b = (req.body as any) || {}
    const ids: number[] = Array.isArray(b.componenteIds) ? b.componenteIds.map(Number).filter(Boolean) : []
    const moduloId = b.moduloId === null ? null : num(b.moduloId)
    if (ids.length === 0) return reply.code(400).send({ error: 'Selecione os componentes.' })

    const comps = await prisma.acaComponente.findMany({ where: { id: { in: ids } }, select: { matrizId: true } })
    const matrizes = [...new Set(comps.map((c) => c.matrizId))]
    if (matrizes.length !== 1) return reply.code(400).send({ error: 'Os componentes precisam ser da mesma matriz.' })
    if (moduloId) {
      const m = await prisma.acaMatrizModulo.findUnique({ where: { id: moduloId }, select: { matrizId: true } })
      // Sem esta checagem, um componente iria para o módulo de outra matriz.
      if (!m || m.matrizId !== matrizes[0]) return reply.code(400).send({ error: 'O módulo é de outra matriz.' })
    }
    try {
      await garantirEditavel(matrizes[0]!)
      const r = await prisma.acaComponente.updateMany({ where: { id: { in: ids } }, data: { moduloId } })
      return { atualizados: r.count }
    } catch (e: any) {
      return reply.code(400).send({ error: e?.message })
    }
  })

  // ─────────── Progresso e certificação ───────────

  app.get('/api/admin/aca/vinculos/:id/modulos', { preHandler: authMiddleware }, async (req, reply) => {
    const id = num((req.params as any).id)
    if (!id) return reply.code(400).send({ error: 'id inválido' })
    const modulos = await progressoModulos(id)
    return { modulos, semModulos: modulos.length === 0 }
  })

  /**
   * Fila de certificados a emitir. O direito nasce quando o módulo fecha, não
   * quando o aluno pede — e a maioria não sabe que tem direito.
   */
  app.get('/api/admin/aca/qualificacoes/a-emitir', { preHandler: authMiddleware }, async (req) => {
    const courseId = num((req.query as any)?.courseId)
    const lista = await qualificacoesAEmitir(courseId ?? undefined)
    return { lista, total: lista.length }
  })

  app.post('/api/admin/aca/qualificacoes/emitir', { preHandler: authMiddleware }, async (req, reply) => {
    const b = (req.body as any) || {}
    const vinculoId = num(b.vinculoId)
    const moduloId = num(b.moduloId)
    if (!vinculoId || !moduloId) return reply.code(400).send({ error: 'vinculoId e moduloId são obrigatórios' })
    const actor = auditActor(req)
    try {
      const doc = await emitirCertificadoQualificacao(vinculoId, moduloId, actor.actorId ?? null)
      void logUserAudit({
        action: 'aca.qualificacao.emitida', targetType: 'aca_documento', targetUserId: null,
        targetLabel: `${doc.numero} — ${doc.titulo}`,
        changes: { vinculoId, moduloId }, ...actor,
      })
      return reply.code(201).send({ documento: doc })
    } catch (e: any) {
      return reply.code(400).send({ error: e?.message })
    }
  })

  /** Emissão em lote — fim de módulo gera uma turma inteira de certificados. */
  app.post('/api/admin/aca/qualificacoes/emitir-lote', { preHandler: authMiddleware }, async (req, reply) => {
    const b = (req.body as any) || {}
    const itens: Array<{ vinculoId: number; moduloId: number }> = Array.isArray(b.itens) ? b.itens : []
    if (itens.length === 0) return reply.code(400).send({ error: 'Nada selecionado.' })
    const actor = auditActor(req)
    let ok = 0
    const erros: string[] = []
    for (const it of itens) {
      try {
        await emitirCertificadoQualificacao(Number(it.vinculoId), Number(it.moduloId), actor.actorId ?? null)
        ok++
      } catch (e: any) {
        erros.push(`vínculo ${it.vinculoId}: ${e?.message}`)
      }
    }
    void logUserAudit({
      action: 'aca.qualificacao.emitida_lote', targetType: 'aca_documento', targetUserId: null,
      targetLabel: `${ok} certificado(s) de qualificação`, ...actor,
    })
    return reply.send({ emitidos: ok, erros })
  })
}
