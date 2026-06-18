// src/routes/acaFiscal.ts
// Módulo Acadêmico · Fin-5 — Fiscal. Recibo de pagamento (PDF numerado via
// AcaDocumento tipo RECIBO) e CONTROLE de NFS-e (registro/rastreio por
// pagamento). A emissão automática de NFS-e depende do provedor municipal
// (webservice da prefeitura) — aqui fica o controle + ponto de integração.

import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { authMiddleware } from '../lib/auth.js'

async function proximoNumero(): Promise<string> {
  const ano = new Date().getFullYear()
  const count = await prisma.acaDocumento.count({ where: { numero: { startsWith: `${ano}/` } } })
  return `${ano}/${String(count + 1).padStart(4, '0')}`
}

export async function acaFiscalRoutes(app: FastifyInstance) {
  // ── Emitir recibo de pagamento (parcela PAGA) ──
  app.post('/api/admin/aca/financeiro/parcelas/:id/recibo', { preHandler: authMiddleware }, async (req, reply) => {
    const parcelaId = Number((req.params as any).id)
    const p = await prisma.acaParcela.findUnique({
      where: { id: parcelaId },
      select: { nroParcela: true, tipo: true, valorPagoCentavos: true, valorBrutoCentavos: true, situacao: true, pagoEm: true, asaasChargeId: true, contrato: { select: { matricula: { select: { aluno: { select: { id: true, ra: true, cpf: true, lead: { select: { nome: true } } } } } } } } },
    })
    if (!p) return reply.code(404).send({ error: 'Parcela não encontrada' })
    if (p.situacao !== 'PAGA') return reply.code(400).send({ error: 'Recibo só para parcela paga.' })
    const aluno = p.contrato.matricula.aluno
    const valor = p.valorPagoCentavos || p.valorBrutoCentavos
    const dados = {
      aluno: { nome: aluno.lead.nome, ra: aluno.ra, cpf: aluno.cpf },
      descricao: `${p.tipo.toLowerCase()} (parcela ${p.nroParcela})`,
      valorCentavos: valor,
      formaPagamento: p.asaasChargeId ? 'Asaas (boleto/PIX)' : 'baixa manual',
      dataPagamento: p.pagoEm ? new Date(p.pagoEm).toLocaleDateString('pt-BR') : new Date().toLocaleDateString('pt-BR'),
    }
    const numero = await proximoNumero()
    const doc = await prisma.acaDocumento.create({ data: { numero, tipo: 'RECIBO', alunoId: aluno.id, titulo: `Recibo — ${aluno.lead.nome} — parcela ${p.nroParcela}`, dadosJson: dados as any, emitidoPorUserId: (req as any).user?.userId ?? null } })
    return reply.code(201).send({ documento: doc })
  })

  // ── NFS-e: listar ──
  app.get('/api/admin/aca/financeiro/nfse', { preHandler: authMiddleware }, async (req) => {
    const q = req.query as any
    const where: any = {}
    if (q.alunoId) where.alunoId = Number(q.alunoId)
    if (q.parcelaId) where.parcelaId = Number(q.parcelaId)
    if (q.status) where.status = String(q.status)
    const itens = await prisma.acaNotaFiscal.findMany({ where, orderBy: { createdAt: 'desc' }, take: 200 })
    return { itens }
  })

  // ── NFS-e: criar registro (PENDENTE) p/ um pagamento ──
  app.post('/api/admin/aca/financeiro/nfse', { preHandler: authMiddleware }, async (req, reply) => {
    const b = (req.body as any) || {}
    const parcelaId = b.parcelaId ? Number(b.parcelaId) : null
    let alunoId = b.alunoId ? Number(b.alunoId) : null
    let valor = b.valorCentavos ? Number(b.valorCentavos) : null
    if (parcelaId) {
      const p = await prisma.acaParcela.findUnique({ where: { id: parcelaId }, select: { valorPagoCentavos: true, valorBrutoCentavos: true, contrato: { select: { matricula: { select: { alunoId: true } } } } } })
      if (!p) return reply.code(404).send({ error: 'Parcela não encontrada' })
      alunoId = p.contrato.matricula.alunoId
      valor = valor ?? (p.valorPagoCentavos || p.valorBrutoCentavos)
    }
    if (!alunoId || valor == null) return reply.code(400).send({ error: 'Informe parcelaId ou alunoId+valorCentavos.' })
    const nf = await prisma.acaNotaFiscal.create({ data: { alunoId, parcelaId, valorCentavos: valor, status: 'PENDENTE', observacao: b.observacao || null } })
    return reply.code(201).send({ nota: nf })
  })

  // ── NFS-e: atualizar (registrar emitida / cancelar) ──
  app.put('/api/admin/aca/financeiro/nfse/:id', { preHandler: authMiddleware }, async (req) => {
    const id = Number((req.params as any).id); const b = (req.body as any) || {}
    const data: any = {}
    if ('status' in b) { data.status = String(b.status); if (b.status === 'EMITIDA' && !b.emitidaEm) data.emitidaEm = new Date() }
    if ('numero' in b) data.numero = b.numero ? String(b.numero).slice(0, 40) : null
    if ('serie' in b) data.serie = b.serie ? String(b.serie).slice(0, 20) : null
    if ('link' in b) data.link = b.link ? String(b.link) : null
    if ('observacao' in b) data.observacao = b.observacao ? String(b.observacao) : null
    const nota = await prisma.acaNotaFiscal.update({ where: { id }, data })
    return { nota }
  })

  app.delete('/api/admin/aca/financeiro/nfse/:id', { preHandler: authMiddleware }, async (req) => {
    await prisma.acaNotaFiscal.delete({ where: { id: Number((req.params as any).id) } }).catch(() => {})
    return { ok: true }
  })
}
