// src/services/acaCobrancaFiscal.ts
// Módulo Acadêmico · F10 — Cobrança Judicial/Dívida Ativa + Contábil + NFS-e.
//   Dívida ativa: consolida parcelas muito vencidas em CDA (por aluno).
//   Contábil: gera lançamentos (partida dobrada) a partir de regras + parcelas pagas.
//   NFS-e: gera lote de notas (registro) a partir de parcelas pagas — transmissão
//          real depende do webservice da prefeitura (ponto de integração).

import { prisma } from '../lib/prisma.js'

const money = (c: number) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

export async function proximoNumeroCDA(): Promise<string> {
  const ano = new Date().getFullYear()
  const n = await prisma.acaCDA.count({ where: { numero: { startsWith: `CDA-${ano}-` } } })
  return `CDA-${ano}-${String(n + 1).padStart(4, '0')}`
}

/**
 * Inscreve em dívida ativa as parcelas VENCIDAS há mais de `diasMin` dias, ainda
 * não inscritas (cdaId null), agrupando por aluno em uma CDA. dryRun só lista.
 */
export async function inscreverDividaAtiva(opts: { diasMin: number; dryRun: boolean }) {
  const limite = new Date(); limite.setDate(limite.getDate() - opts.diasMin)
  const parcelas = await prisma.acaParcela.findMany({
    where: { situacao: 'VENCIDA', cdaId: null, dataVencimento: { lt: limite } },
    select: { id: true, valorBrutoCentavos: true, contrato: { select: { matricula: { select: { alunoId: true, aluno: { select: { ra: true, lead: { select: { nome: true } } } } } } } } },
  })
  // agrupa por aluno
  const porAluno = new Map<number, { nome: string; ra: string | null; parcelaIds: number[]; total: number }>()
  for (const p of parcelas) {
    const alunoId = p.contrato.matricula.alunoId
    const g = porAluno.get(alunoId) ?? { nome: p.contrato.matricula.aluno.lead.nome, ra: p.contrato.matricula.aluno.ra, parcelaIds: [], total: 0 }
    g.parcelaIds.push(p.id); g.total += p.valorBrutoCentavos
    porAluno.set(alunoId, g)
  }
  const grupos = [...porAluno.entries()].map(([alunoId, g]) => ({ alunoId, ...g }))
  if (opts.dryRun) return { dryRun: true, total: grupos.length, parcelas: parcelas.length, grupos }
  const cdas: any[] = []
  for (const g of grupos) {
    const numero = await proximoNumeroCDA()
    const cda = await prisma.acaCDA.create({ data: { numero, alunoId: g.alunoId, valorCentavos: g.total, qtdParcelas: g.parcelaIds.length, status: 'INSCRITA' } })
    await prisma.acaParcela.updateMany({ where: { id: { in: g.parcelaIds } }, data: { cdaId: cda.id } })
    cdas.push(cda)
  }
  return { dryRun: false, total: cdas.length, parcelas: parcelas.length }
}

function renderHistorico(tpl: string, ctx: { aluno: string; parcela: string | number; valor: number; data: Date }): string {
  return tpl
    .replace(/\{aluno\}/g, ctx.aluno)
    .replace(/\{parcela\}/g, String(ctx.parcela))
    .replace(/\{valor\}/g, money(ctx.valor))
    .replace(/\{data\}/g, ctx.data.toLocaleDateString('pt-BR'))
    .slice(0, 255)
}

/**
 * Contabiliza as parcelas PAGAS que ainda não têm lançamento (evento PARCELA_PAGA),
 * usando a primeira regra ativa desse evento. dryRun só conta.
 */
export async function contabilizar(opts: { dryRun: boolean }) {
  const regra = await prisma.acaRegraContabil.findFirst({ where: { evento: 'PARCELA_PAGA', ativo: true } })
  if (!regra) return { erro: 'Nenhuma regra contábil ativa para PARCELA_PAGA', total: 0 }
  // parcelas pagas sem lançamento (não desfeito)
  const lancadas = await prisma.acaLancamentoContabil.findMany({ where: { origem: 'PARCELA_PAGA', desfeito: false }, select: { parcelaId: true } })
  const jaLancadas = new Set(lancadas.map((l) => l.parcelaId).filter(Boolean) as number[])
  const pagas = await prisma.acaParcela.findMany({
    where: { situacao: 'PAGA' },
    select: { id: true, valorPagoCentavos: true, valorBrutoCentavos: true, pagoEm: true, nroParcela: true, contrato: { select: { matricula: { select: { aluno: { select: { lead: { select: { nome: true } } } } } } } } },
  })
  const alvo = pagas.filter((p) => !jaLancadas.has(p.id))
  if (opts.dryRun) return { dryRun: true, total: alvo.length }
  let lancados = 0
  for (const p of alvo) {
    const valor = p.valorPagoCentavos || p.valorBrutoCentavos
    const hist = renderHistorico(regra.historico, { aluno: p.contrato.matricula.aluno.lead.nome, parcela: p.nroParcela, valor, data: p.pagoEm || new Date() })
    await prisma.acaLancamentoContabil.create({ data: { historico: hist, contaDebitoId: regra.contaDebitoId, contaCreditoId: regra.contaCreditoId, valorCentavos: valor, origem: 'PARCELA_PAGA', parcelaId: p.id, regraId: regra.id, data: p.pagoEm || new Date() } })
    lancados++
  }
  return { dryRun: false, total: alvo.length, lancados }
}

/** Gera o lote de NFS-e (registros PENDENTE) das parcelas pagas ainda sem nota. */
export async function gerarLoteNfse(opts: { dryRun: boolean }) {
  const config = await prisma.acaNfseConfig.findFirst()
  const comNota = await prisma.acaNotaFiscal.findMany({ where: { parcelaId: { not: null } }, select: { parcelaId: true } })
  const jaTem = new Set(comNota.map((n) => n.parcelaId).filter(Boolean) as number[])
  const pagas = await prisma.acaParcela.findMany({
    where: { situacao: 'PAGA' },
    select: { id: true, valorPagoCentavos: true, valorBrutoCentavos: true, contrato: { select: { matricula: { select: { alunoId: true } } } } },
  })
  const alvo = pagas.filter((p) => !jaTem.has(p.id))
  if (opts.dryRun) return { dryRun: true, total: alvo.length, configurado: !!config?.ativo }
  let gerados = 0
  for (const p of alvo) {
    await prisma.acaNotaFiscal.create({ data: { alunoId: p.contrato.matricula.alunoId, parcelaId: p.id, valorCentavos: p.valorPagoCentavos || p.valorBrutoCentavos, status: 'PENDENTE', observacao: 'Gerada em lote (F10) — aguardando transmissão ao provedor' } })
    gerados++
  }
  // NOTA: a transmissão real ao webservice municipal é o ponto de integração pendente.
  return { dryRun: false, total: alvo.length, gerados, transmissao: 'pendente-integracao-prefeitura' }
}
