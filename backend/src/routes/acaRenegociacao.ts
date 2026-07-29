// src/routes/acaRenegociacao.ts
// Módulo Acadêmico · Fin-3 — Renegociação / Acordos (secretaria).
//
// A regra vive em services/acaAcordo.ts, compartilhada com o portal. Manter
// duas implementações da mesma matemática garantiria que um dia elas
// divergissem — e um acordo calculado diferente conforme o canal é exatamente
// o tipo de erro que ninguém percebe até o aluno reclamar.

import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { authMiddleware } from '../lib/auth.js'
import { simular, efetivar } from '../services/acaAcordo.js'

export async function acaRenegociacaoRoutes(app: FastifyInstance) {
  // ── Simular: total das parcelas escolhidas já com encargos ──
  app.post('/api/admin/aca/financeiro/renegociar/simular', { preHandler: authMiddleware }, async (req, reply) => {
    const b = (req.body as any) || {}
    const ids = (b.parcelaIds || []).map(Number).filter(Boolean)
    if (!ids.length) return reply.code(400).send({ error: 'Selecione ao menos uma parcela.' })
    try {
      const s = await simular({
        parcelaIds: ids,
        numParcelas: Number(b.numParcelas) || 1,
        entradaCentavos: Number(b.entrada) || 0,
        canalPortal: false, // secretaria negocia sem as travas do portal
      })
      // Formato antigo preservado para não quebrar a tela em uso.
      return {
        qtd: s.qtd,
        valorOriginal: s.valorOriginalCentavos,
        encargos: s.encargosCentavos,
        total: s.totalCentavos,
        simulacao: s,
      }
    } catch (e: any) {
      return reply.code(400).send({ error: e?.message || 'Não foi possível simular' })
    }
  })

  // ── Renegociar: cria o acordo e as novas parcelas ──
  app.post('/api/admin/aca/financeiro/renegociar', { preHandler: authMiddleware }, async (req, reply) => {
    const b = (req.body as any) || {}
    const ids = (b.parcelaIds || []).map(Number).filter(Boolean)
    if (!ids.length) return reply.code(400).send({ error: 'Selecione ao menos uma parcela.' })
    try {
      const r = await efetivar({
        parcelaIds: ids,
        numParcelas: Number(b.numParcelas) || 1,
        entradaCentavos: Number(b.entrada) || 0,
        ...(b.primeiroVencimento ? { primeiroVencimento: new Date(b.primeiroVencimento) } : {}),
        observacao: b.observacao ?? null,
        origem: 'SECRETARIA',
        canalPortal: false,
      })
      return reply.code(201).send(r)
    } catch (e: any) {
      return reply.code(400).send({ error: e?.message || 'Não foi possível renegociar' })
    }
  })

  // ── Lista de acordos do aluno ──
  app.get('/api/admin/aca/financeiro/acordos', { preHandler: authMiddleware }, async (req) => {
    const q = req.query as any
    const where: any = {}
    if (q.alunoId) where.alunoId = Number(q.alunoId)
    const acordos = await prisma.acaAcordo.findMany({ where, orderBy: { createdAt: 'desc' }, take: 100 })
    return { acordos }
  })
}
