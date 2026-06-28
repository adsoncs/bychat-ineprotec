// src/routes/acaCobrancaFiscal.ts
// Módulo Acadêmico · F10 — Cobrança Judicial/Dívida Ativa + Contábil + NFS-e
// (rotas /api/admin/aca/cobranca-fiscal).

import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { authMiddleware } from '../lib/auth.js'
import { inscreverDividaAtiva, contabilizar, gerarLoteNfse } from '../services/acaCobrancaFiscal.js'

export async function acaCobrancaFiscalRoutes(app: FastifyInstance) {
  // ───────── Dívida Ativa (CDA) ─────────
  app.get('/api/admin/aca/cobranca-fiscal/cda', { preHandler: authMiddleware }, async (req) => {
    const q = req.query as any
    const where: any = {}
    if (q.status) where.status = String(q.status)
    const rows = await prisma.acaCDA.findMany({ where, orderBy: { id: 'desc' }, take: 300 })
    const alunoIds = [...new Set(rows.map((r) => r.alunoId))]
    const alunos = alunoIds.length ? await prisma.aluno.findMany({ where: { id: { in: alunoIds } }, select: { id: true, ra: true, lead: { select: { nome: true } } } }) : []
    const aMap = new Map(alunos.map((a) => [a.id, a]))
    const counts: Record<string, number> = {}
    for (const c of await prisma.acaCDA.groupBy({ by: ['status'], _count: { _all: true } })) counts[c.status] = c._count._all
    const totais = await prisma.acaCDA.aggregate({ where, _sum: { valorCentavos: true } })
    return { cdas: rows.map((r) => ({ ...r, alunoNome: aMap.get(r.alunoId)?.lead.nome ?? '—', ra: aMap.get(r.alunoId)?.ra ?? null })), counts, totalCentavos: totais._sum.valorCentavos ?? 0 }
  })
  app.post('/api/admin/aca/cobranca-fiscal/cda/inscrever', { preHandler: authMiddleware }, async (req) => {
    const b = (req.body as any) || {}
    return inscreverDividaAtiva({ diasMin: Math.max(1, Number(b.diasMin) || 90), dryRun: b.dryRun !== false })
  })
  app.put('/api/admin/aca/cobranca-fiscal/cda/:id', { preHandler: authMiddleware }, async (req, reply) => {
    const id = Number((req.params as any).id); const b = (req.body as any) || {}
    const cda = await prisma.acaCDA.findUnique({ where: { id } })
    if (!cda) return reply.code(404).send({ error: 'CDA não encontrada' })
    const data: any = {}
    if ('observacao' in b) data.observacao = b.observacao || null
    if ('bloqueioJudicial' in b) data.bloqueioJudicial = !!b.bloqueioJudicial
    if ('acordoId' in b) data.acordoId = b.acordoId ? Number(b.acordoId) : null
    if (b.status && ['INSCRITA', 'AJUIZADA', 'QUITADA', 'CANCELADA'].includes(b.status)) {
      data.status = b.status
      if (b.status === 'AJUIZADA') data.ajuizadaEm = new Date()
      if (b.status === 'QUITADA') data.quitadaEm = new Date()
      // ao quitar/cancelar, solta as parcelas da CDA (cdaId null)
      if (['QUITADA', 'CANCELADA'].includes(b.status)) await prisma.acaParcela.updateMany({ where: { cdaId: id }, data: { cdaId: null } })
    }
    return { cda: await prisma.acaCDA.update({ where: { id }, data }) }
  })

  // ───────── Contábil ─────────
  app.get('/api/admin/aca/cobranca-fiscal/regras', { preHandler: authMiddleware }, async () => ({ regras: await prisma.acaRegraContabil.findMany({ orderBy: { id: 'desc' } }) }))
  app.post('/api/admin/aca/cobranca-fiscal/regras', { preHandler: authMiddleware }, async (req, reply) => {
    const b = (req.body as any) || {}
    if (!b.evento || !b.historico) return reply.code(400).send({ error: 'evento e historico obrigatórios' })
    return reply.code(201).send({ regra: await prisma.acaRegraContabil.create({ data: {
      evento: String(b.evento).slice(0, 40), historico: String(b.historico).slice(0, 191),
      contaDebitoId: b.contaDebitoId ? Number(b.contaDebitoId) : null, contaCreditoId: b.contaCreditoId ? Number(b.contaCreditoId) : null,
    } }) })
  })
  app.put('/api/admin/aca/cobranca-fiscal/regras/:id', { preHandler: authMiddleware }, async (req) => {
    const id = Number((req.params as any).id); const b = (req.body as any) || {}
    const data: any = {}
    if ('historico' in b) data.historico = String(b.historico).slice(0, 191)
    if ('contaDebitoId' in b) data.contaDebitoId = b.contaDebitoId ? Number(b.contaDebitoId) : null
    if ('contaCreditoId' in b) data.contaCreditoId = b.contaCreditoId ? Number(b.contaCreditoId) : null
    if ('ativo' in b) data.ativo = !!b.ativo
    return { regra: await prisma.acaRegraContabil.update({ where: { id }, data }) }
  })
  app.post('/api/admin/aca/cobranca-fiscal/contabilizar', { preHandler: authMiddleware }, async (req) => {
    const b = (req.body as any) || {}
    return contabilizar({ dryRun: b.dryRun !== false })
  })
  app.get('/api/admin/aca/cobranca-fiscal/lancamentos', { preHandler: authMiddleware }, async (req) => {
    const q = req.query as any
    const where: any = { desfeito: false }
    if (q.incluirDesfeitos === '1') delete where.desfeito
    const rows = await prisma.acaLancamentoContabil.findMany({ where, orderBy: { id: 'desc' }, take: 500 })
    const soma = await prisma.acaLancamentoContabil.aggregate({ where, _sum: { valorCentavos: true } })
    return { lancamentos: rows, totalCentavos: soma._sum.valorCentavos ?? 0 }
  })
  app.post('/api/admin/aca/cobranca-fiscal/lancamentos/:id/desfazer', { preHandler: authMiddleware }, async (req) => {
    const id = Number((req.params as any).id)
    return { lancamento: await prisma.acaLancamentoContabil.update({ where: { id }, data: { desfeito: true } }) }
  })
  app.get('/api/admin/aca/cobranca-fiscal/lancamentos/export.csv', { preHandler: authMiddleware }, async (_req, reply) => {
    const rows = await prisma.acaLancamentoContabil.findMany({ where: { desfeito: false }, orderBy: { id: 'asc' } })
    const linhas = [['Data', 'Histórico', 'Débito', 'Crédito', 'Valor'].join(';')]
    for (const r of rows) linhas.push([new Date(r.data).toLocaleDateString('pt-BR'), `"${(r.historico || '').replace(/"/g, '""')}"`, r.contaDebitoId ?? '', r.contaCreditoId ?? '', (r.valorCentavos / 100).toFixed(2)].join(';'))
    reply.header('Content-Type', 'text/csv; charset=utf-8').header('Content-Disposition', 'attachment; filename="lancamentos.csv"').send('﻿' + linhas.join('\r\n'))
  })

  // ───────── NFS-e ─────────
  app.get('/api/admin/aca/cobranca-fiscal/nfse-config', { preHandler: authMiddleware }, async () => ({ config: await prisma.acaNfseConfig.findFirst() }))
  app.put('/api/admin/aca/cobranca-fiscal/nfse-config', { preHandler: authMiddleware }, async (req) => {
    const b = (req.body as any) || {}
    const data: any = {}
    for (const k of ['provedor', 'ambiente', 'cnpjPrestador', 'inscricaoMunicipal', 'codigoServico']) if (k in b) data[k] = b[k] || null
    if ('aliquotaPct' in b) data.aliquotaPct = Number(b.aliquotaPct) || 0
    if ('ativo' in b) data.ativo = !!b.ativo
    const existing = await prisma.acaNfseConfig.findFirst()
    const config = existing ? await prisma.acaNfseConfig.update({ where: { id: existing.id }, data }) : await prisma.acaNfseConfig.create({ data })
    return { config }
  })
  app.post('/api/admin/aca/cobranca-fiscal/nfse/gerar-lote', { preHandler: authMiddleware }, async (req) => {
    const b = (req.body as any) || {}
    return gerarLoteNfse({ dryRun: b.dryRun !== false })
  })
}
