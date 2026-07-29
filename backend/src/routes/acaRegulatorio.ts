// src/routes/acaRegulatorio.ts
//
// Fase 4 — acervo acadêmico com temporalidade (Port. 315/2018) e regularidade
// no ENADE com trava na colação (RN-1104).

import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { authMiddleware } from '../lib/auth.js'
import {
  classificarArquivo, classificarPorTipo, verificarIntegridade,
  elegiveisEliminacao, eliminar, TEMPORALIDADE_PADRAO,
} from '../services/acaAcervo.js'
import { verificarRegularidade, registrar as registrarEnade, painelRegularidade } from '../services/acaEnade.js'
import { logUserAudit, auditActor } from '../services/userAudit.js'

const num = (v: unknown): number | null => {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : null
}

export async function acaRegulatorioRoutes(app: FastifyInstance) {
  // ─────────── Acervo ───────────

  app.get('/api/admin/aca/acervo/tabela-temporalidade', { preHandler: authMiddleware }, async () => ({
    tabela: Object.entries(TEMPORALIDADE_PADRAO).map(([tipo, r]) => ({
      tipo, classificacao: r.classificacao,
      temporalidade: r.anos == null ? 'PERMANENTE' : 'TEMPORARIO',
      prazoGuardaAnos: r.anos,
    })),
  }))

  /** Panorama: quanto do acervo está classificado, com hash, e o que vence. */
  app.get('/api/admin/aca/acervo/panorama', { preHandler: authMiddleware }, async () => {
    const [total, classificados, comHash, permanentes, eliminados, vencidos] = await Promise.all([
      prisma.acaGedArquivo.count(),
      prisma.acaGedArquivo.count({ where: { classificacao: { not: null } } }),
      prisma.acaGedArquivo.count({ where: { hashSha256: { not: null } } }),
      prisma.acaGedArquivo.count({ where: { temporalidade: 'PERMANENTE' } }),
      prisma.acaGedArquivo.count({ where: { eliminadoEm: { not: null } } }),
      prisma.acaGedArquivo.count({ where: { temporalidade: 'TEMPORARIO', guardaAte: { not: null, lte: new Date() }, eliminadoEm: null } }),
    ])
    return {
      total, classificados, semClassificacao: total - classificados,
      comHash, semHash: total - comHash,
      permanentes, eliminados, vencidos,
    }
  })

  /** Classifica em lote — o acervo legado chega sem nenhuma dessas informações. */
  app.post('/api/admin/aca/acervo/classificar', { preHandler: authMiddleware }, async (req, reply) => {
    const b = (req.body as any) || {}
    const ids: number[] = Array.isArray(b.arquivoIds) ? b.arquivoIds.map(Number).filter(Boolean) : []
    const alvo = ids.length > 0
      ? ids
      : (await prisma.acaGedArquivo.findMany({ where: { classificacao: null }, select: { id: true }, take: 500 })).map((a) => a.id)
    if (alvo.length === 0) return { classificados: 0, mensagem: 'Nada a classificar.' }

    let ok = 0
    const erros: string[] = []
    for (const id of alvo) {
      try { await classificarArquivo(id, b.override); ok++ } catch (e: any) { erros.push(`#${id}: ${e?.message}`) }
    }
    return reply.send({ classificados: ok, erros })
  })

  app.get('/api/admin/aca/acervo/:id/integridade', { preHandler: authMiddleware }, async (req, reply) => {
    const id = num((req.params as any).id)
    if (!id) return reply.code(400).send({ error: 'id inválido' })
    return verificarIntegridade(id)
  })

  app.get('/api/admin/aca/acervo/elegiveis-eliminacao', { preHandler: authMiddleware }, async () => {
    const arquivos = await elegiveisEliminacao()
    return { arquivos, total: arquivos.length }
  })

  app.post('/api/admin/aca/acervo/eliminar', { preHandler: authMiddleware }, async (req, reply) => {
    const b = (req.body as any) || {}
    const ids: number[] = Array.isArray(b.arquivoIds) ? b.arquivoIds.map(Number).filter(Boolean) : []
    if (ids.length === 0) return reply.code(400).send({ error: 'Selecione os documentos a eliminar.' })
    if (!b.comissao?.trim()) return reply.code(400).send({ error: 'Informe a comissão responsável pela eliminação.' })
    const actor = auditActor(req)
    try {
      const r = await eliminar({
        arquivoIds: ids, comissao: String(b.comissao),
        responsavel: b.responsavel ?? actor.actorName, observacao: b.observacao ?? null,
        criadoPor: actor.actorId ?? null,
      })
      void logUserAudit({
        action: 'aca.acervo.eliminacao', targetType: 'acervo', targetUserId: null,
        targetLabel: `Termo ${r.termo.numero} — ${r.eliminados} documento(s)`,
        changes: { termoId: r.termo.id, qtd: r.eliminados }, ...actor,
      })
      return reply.code(201).send(r)
    } catch (e: any) {
      return reply.code(400).send({ error: e?.message })
    }
  })

  app.get('/api/admin/aca/acervo/termos', { preHandler: authMiddleware }, async () => ({
    termos: await prisma.acaEliminacaoTermo.findMany({ orderBy: { id: 'desc' }, take: 100 }),
  }))

  // ─────────── ENADE ───────────

  app.get('/api/admin/aca/enade/painel', { preHandler: authMiddleware }, async () => {
    const linhas = await painelRegularidade()
    return { linhas, irregulares: linhas.filter((l) => !l.regular).length, total: linhas.length }
  })

  app.get('/api/admin/aca/enade/aluno/:alunoId', { preHandler: authMiddleware }, async (req, reply) => {
    const alunoId = num((req.params as any).alunoId)
    if (!alunoId) return reply.code(400).send({ error: 'alunoId inválido' })
    return verificarRegularidade(alunoId)
  })

  app.post('/api/admin/aca/enade/registrar', { preHandler: authMiddleware }, async (req, reply) => {
    const b = (req.body as any) || {}
    const alunoId = num(b.alunoId)
    const ano = num(b.ano)
    const condicao = String(b.condicao || '').toUpperCase()
    const situacao = String(b.situacao || '').toUpperCase()
    if (!alunoId || !ano) return reply.code(400).send({ error: 'alunoId e ano são obrigatórios' })
    if (!['INGRESSANTE', 'CONCLUINTE'].includes(condicao)) return reply.code(400).send({ error: 'condicao deve ser INGRESSANTE ou CONCLUINTE' })
    if (!['PENDENTE', 'INSCRITO', 'PARTICIPOU', 'DISPENSADO', 'IRREGULAR'].includes(situacao)) {
      return reply.code(400).send({ error: 'situacao inválida' })
    }
    const actor = auditActor(req)
    try {
      const registro = await registrarEnade({
        alunoId, ano, condicao: condicao as any, situacao: situacao as any,
        dispensaMotivo: b.dispensaMotivo ?? null, documentoUrl: b.documentoUrl ?? null,
        observacao: b.observacao ?? null, registradoPor: actor.actorId ?? null,
      })
      return reply.code(201).send({ registro })
    } catch (e: any) {
      return reply.code(400).send({ error: e?.message })
    }
  })
}
