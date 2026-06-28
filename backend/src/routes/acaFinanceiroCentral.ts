// src/routes/acaFinanceiroCentral.ts
// Módulo Acadêmico · Central Financeira — visão consolidada de contas a receber
// (todas as parcelas de todos os alunos), aging, inadimplência, extrato do aluno,
// ações em lote e exportação. Reusa acaFinanceiro (baixa/cobrança Asaas).

import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { authMiddleware } from '../lib/auth.js'
import { darBaixaManual, criarCobrancaAsaas } from '../services/acaFinanceiro.js'
import { getEncargosConfig, setEncargosConfig, calcularEncargos, type EncargosConfig } from '../services/acaEncargos.js'
import { getBloqueioConfig, setBloqueioConfig, statusBloqueio } from '../services/acaBloqueio.js'
import { getTermoTemplate, setTermoTemplate, dadosContrato } from '../services/acaContrato.js'

const ABERTAS = ['ABERTA', 'VENCIDA'] as const
const inicioDoDia = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d }
const diasAtraso = (venc: Date) => Math.max(0, Math.floor((inicioDoDia().getTime() - new Date(venc).setHours(0, 0, 0, 0)) / 86400_000))

/** Monta o `where` de parcelas a partir dos filtros de query. */
function buildWhere(q: any): any {
  const where: any = {}
  if (q.situacao) where.situacao = String(q.situacao)
  if (q.tipo) where.tipo = String(q.tipo)
  if (q.vencDe || q.vencAte) where.dataVencimento = { ...(q.vencDe ? { gte: new Date(q.vencDe) } : {}), ...(q.vencAte ? { lte: new Date(q.vencAte) } : {}) }
  if (q.vencidas === 'true' || q.vencidas === '1') { where.situacao = { in: ABERTAS as unknown as string[] }; where.dataVencimento = { ...(where.dataVencimento || {}), lt: inicioDoDia() } }
  const mat: any = {}
  if (q.turmaId) mat.turmaId = Number(q.turmaId)
  if (q.periodoLetivoId) mat.turma = { periodoLetivoId: Number(q.periodoLetivoId) }
  if (q.alunoId) mat.alunoId = Number(q.alunoId)
  if (q.q) {
    const term = String(q.q)
    mat.aluno = { OR: [{ lead: { nome: { contains: term } } }, { ra: { contains: term } }] }
  }
  if (Object.keys(mat).length) where.contrato = { matricula: mat }
  return where
}

const SEL_PARCELA = {
  id: true, nroParcela: true, tipo: true, valorBrutoCentavos: true, valorPagoCentavos: true,
  dataVencimento: true, situacao: true, pagoEm: true, asaasChargeId: true,
  contrato: { select: { id: true, matricula: { select: { id: true, aluno: { select: { id: true, ra: true, lead: { select: { nome: true } } } }, turma: { select: { id: true, nome: true } } } } } },
} as const

function linha(p: any, cfg: EncargosConfig) {
  const atraso = (p.situacao === 'ABERTA' || p.situacao === 'VENCIDA') ? diasAtraso(p.dataVencimento) : 0
  const mat = p.contrato.matricula
  const enc = calcularEncargos(p, cfg)
  return {
    id: p.id, nroParcela: p.nroParcela, tipo: p.tipo,
    valor: p.valorBrutoCentavos, valorPago: p.valorPagoCentavos,
    multa: enc.multa, juros: enc.juros, desconto: enc.desconto, valorAtual: enc.valorAtual,
    vencimento: p.dataVencimento, pagoEm: p.pagoEm, situacao: p.situacao,
    atrasada: atraso > 0 && p.situacao !== 'PAGA', diasAtraso: atraso, temCobranca: !!p.asaasChargeId,
    alunoId: mat.aluno.id, ra: mat.aluno.ra, alunoNome: mat.aluno.lead.nome,
    matriculaId: mat.id, turmaId: mat.turma.id, turmaNome: mat.turma.nome,
  }
}

export async function acaFinanceiroCentralRoutes(app: FastifyInstance) {
  // ── Config de encargos (Fin-2) ──
  app.get('/api/admin/aca/financeiro/config', { preHandler: authMiddleware }, async () => ({ config: await getEncargosConfig(), bloqueio: await getBloqueioConfig() }))
  app.put('/api/admin/aca/financeiro/config', { preHandler: authMiddleware }, async (req) => ({ config: await setEncargosConfig((req.body as any) || {}) }))

  // ── Termo do contrato + preview (O2.3) ──
  app.get('/api/admin/aca/financeiro/contrato-termo', { preHandler: authMiddleware }, async () => ({ termo: await getTermoTemplate() }))
  app.put('/api/admin/aca/financeiro/contrato-termo', { preHandler: authMiddleware }, async (req) => ({ termo: await setTermoTemplate((req.body as any)?.termo || '') }))
  app.get('/api/admin/aca/financeiro/contrato/:id', { preHandler: authMiddleware }, async (req, reply) => {
    const d = await dadosContrato(Number((req.params as any).id))
    if (!d) return reply.code(404).send({ error: 'Contrato não encontrado' })
    return { contrato: d }
  })

  // ── Config + status de bloqueio acadêmico (Fin-4) ──
  app.put('/api/admin/aca/financeiro/bloqueio-config', { preHandler: authMiddleware }, async (req) => ({ bloqueio: await setBloqueioConfig((req.body as any) || {}) }))
  app.get('/api/admin/aca/financeiro/bloqueio/:alunoId', { preHandler: authMiddleware }, async (req) => ({ status: await statusBloqueio(Number((req.params as any).alunoId)) }))

  // ── Resumo + aging ──
  app.get('/api/admin/aca/financeiro/resumo', { preHandler: authMiddleware }, async (req) => {
    const q = req.query as any
    const baseWhere = buildWhere({ ...q, vencidas: undefined, situacao: undefined })
    const hoje = inicioDoDia()
    const [pagas, abertas] = await Promise.all([
      prisma.acaParcela.aggregate({ where: { ...baseWhere, situacao: 'PAGA' }, _sum: { valorPagoCentavos: true }, _count: { _all: true } }),
      prisma.acaParcela.findMany({ where: { ...baseWhere, situacao: { in: ABERTAS as unknown as string[] } }, select: { valorBrutoCentavos: true, dataVencimento: true, contrato: { select: { matricula: { select: { alunoId: true } } } } } }),
    ])
    const cfg = await getEncargosConfig()
    const aging = { d0_30: 0, d31_60: 0, d61_90: 0, d90: 0, aVencer: 0, vencidoTotal: 0, aReceberTotal: 0 }
    let encargosTotal = 0
    const inadimplentes = new Set<number>()
    for (const p of abertas) {
      aging.aReceberTotal += p.valorBrutoCentavos
      const venc = new Date(p.dataVencimento); venc.setHours(0, 0, 0, 0)
      if (venc >= hoje) { aging.aVencer += p.valorBrutoCentavos; continue }
      const dias = diasAtraso(p.dataVencimento)
      aging.vencidoTotal += p.valorBrutoCentavos
      const enc = calcularEncargos({ valorBrutoCentavos: p.valorBrutoCentavos, dataVencimento: p.dataVencimento, situacao: 'VENCIDA' }, cfg)
      encargosTotal += enc.multa + enc.juros
      inadimplentes.add(p.contrato.matricula.alunoId)
      if (dias <= 30) aging.d0_30 += p.valorBrutoCentavos
      else if (dias <= 60) aging.d31_60 += p.valorBrutoCentavos
      else if (dias <= 90) aging.d61_90 += p.valorBrutoCentavos
      else aging.d90 += p.valorBrutoCentavos
    }
    return {
      recebido: pagas._sum.valorPagoCentavos || 0, parcelasPagas: pagas._count._all,
      aReceberTotal: aging.aReceberTotal, aVencer: aging.aVencer, vencidoTotal: aging.vencidoTotal,
      encargosTotal, vencidoAtualizado: aging.vencidoTotal + encargosTotal,
      inadimplentes: inadimplentes.size,
      aging: { d0_30: aging.d0_30, d31_60: aging.d31_60, d61_90: aging.d61_90, d90: aging.d90 },
    }
  })

  // ── Lista de parcelas (paginada) ──
  app.get('/api/admin/aca/financeiro/parcelas', { preHandler: authMiddleware }, async (req) => {
    const q = req.query as any
    const where = buildWhere(q)
    const page = Math.max(1, Number(q.page) || 1)
    const limit = Math.min(200, Math.max(10, Number(q.limit) || 50))
    const [total, parcelas, cfg] = await Promise.all([
      prisma.acaParcela.count({ where }),
      prisma.acaParcela.findMany({ where, select: SEL_PARCELA, orderBy: [{ dataVencimento: 'asc' }], skip: (page - 1) * limit, take: limit }),
      getEncargosConfig(),
    ])
    return { total, page, limit, itens: parcelas.map((p) => linha(p, cfg)) }
  })

  // ── Extrato/demonstrativo do aluno ──
  app.get('/api/admin/aca/financeiro/aluno/:alunoId/extrato', { preHandler: authMiddleware }, async (req, reply) => {
    const alunoId = Number((req.params as any).alunoId)
    const aluno = await prisma.aluno.findUnique({ where: { id: alunoId }, select: { ra: true, lead: { select: { nome: true } } } })
    if (!aluno) return reply.code(404).send({ error: 'Aluno não encontrado' })
    const mats = await prisma.acaMatricula.findMany({ where: { alunoId }, select: { id: true } })
    const contratos = await prisma.acaContrato.findMany({ where: { matriculaId: { in: mats.map((m) => m.id) } }, select: { id: true, valorTotalCentavos: true, descontoCentavos: true, status: true, aceiteEm: true, aceiteNome: true } })
    const cfg = await getEncargosConfig()
    const parcelas = contratos.length ? await prisma.acaParcela.findMany({ where: { contratoId: { in: contratos.map((c) => c.id) } }, select: SEL_PARCELA, orderBy: [{ nroParcela: 'asc' }] }) : []
    const linhas = parcelas.map((p) => linha(p, cfg))
    const totais = {
      total: contratos.reduce((s, c) => s + c.valorTotalCentavos, 0),
      pago: linhas.filter((l) => l.situacao === 'PAGA').reduce((s, l) => s + (l.valorPago || 0), 0),
      aberto: linhas.filter((l) => l.situacao === 'ABERTA' || l.situacao === 'VENCIDA').reduce((s, l) => s + l.valor, 0),
      vencido: linhas.filter((l) => l.atrasada).reduce((s, l) => s + l.valor, 0),
      encargos: linhas.reduce((s, l) => s + (l.multa || 0) + (l.juros || 0), 0),
    }
    return { aluno: { nome: aluno.lead.nome, ra: aluno.ra }, contratos, parcelas: linhas, totais }
  })

  // ── Ações em lote ──
  app.post('/api/admin/aca/financeiro/baixa-lote', { preHandler: authMiddleware }, async (req) => {
    const ids = ((req.body as any)?.parcelaIds || []) as number[]
    let ok = 0
    for (const id of ids) { try { await darBaixaManual(Number(id)); ok++ } catch { /* ignora individual */ } }
    return { ok, total: ids.length }
  })
  app.post('/api/admin/aca/financeiro/cobranca-lote', { preHandler: authMiddleware }, async (req) => {
    const ids = ((req.body as any)?.parcelaIds || []) as number[]
    let ok = 0; const erros: string[] = []
    for (const id of ids) { const r = await criarCobrancaAsaas(Number(id)); if (r.ok) ok++; else erros.push(`${id}: ${r.error}`) }
    return { ok, total: ids.length, erros: erros.slice(0, 10) }
  })

  // ── Export CSV (respeita filtros) ──
  app.get('/api/admin/aca/financeiro/export.csv', { preHandler: authMiddleware }, async (req, reply) => {
    const where = buildWhere(req.query as any)
    const cfg = await getEncargosConfig()
    const parcelas = await prisma.acaParcela.findMany({ where, select: SEL_PARCELA, orderBy: [{ dataVencimento: 'asc' }], take: 5000 })
    const esc = (s: any) => `"${String(s ?? '').replace(/"/g, '""')}"`
    const head = ['RA', 'Aluno', 'Turma', 'Parcela', 'Tipo', 'Vencimento', 'Valor', 'Multa', 'Juros', 'Atualizado', 'Situacao', 'DiasAtraso', 'PagoEm']
    const rows = parcelas.map((p) => linha(p, cfg)).map((l) => [l.ra, l.alunoNome, l.turmaNome, l.nroParcela, l.tipo, new Date(l.vencimento).toLocaleDateString('pt-BR'), (l.valor / 100).toFixed(2), (l.multa / 100).toFixed(2), (l.juros / 100).toFixed(2), (l.valorAtual / 100).toFixed(2), l.atrasada ? 'ATRASADA' : l.situacao, l.diasAtraso, l.pagoEm ? new Date(l.pagoEm).toLocaleDateString('pt-BR') : ''].map(esc).join(';'))
    reply.header('Content-Type', 'text/csv; charset=utf-8').header('Content-Disposition', 'attachment; filename="financeiro.csv"')
    return reply.send('﻿' + [head.map(esc).join(';'), ...rows].join('\n'))
  })
}
