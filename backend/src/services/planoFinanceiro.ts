// src/services/planoFinanceiro.ts
//
// Planos de pagamento da oferta, cadastrados pela instituição (Educacional ›
// Ofertas › Planos de pagamento). Cada plano diz:
//
//   · quantas parcelas o curso tem e de quanto — a 1ª é a matrícula (ou a 1ª
//     mensalidade) e é a que o portal cobra;
//   · quem cuida das parcelas que ficam: o SEI (vão na integração), a própria
//     plataforma (fatura mês a mês no gateway) ou ninguém (pagamento integral);
//   · o que o candidato pode pagar agora — só a entrada, ou o curso inteiro —
//     e por quais formas: Pix e boleto à vista com desconto, cartão e boleto
//     parcelado até N vezes com juros por faixa ("1x e 2x sem juros, 3x a 6x
//     com 1,99% a.m."); o candidato só vê de 1x até o teto liberado;
//   · desconto de pontualidade: quem paga a parcela até o dia X do mês ganha
//     um desconto a mais; depois disso a fatura vale sem ele.
//
// Os números do plano ficam nas colunas de AcaPlanoPagamento (taxa de
// matrícula + N mensalidades, como o ERP sempre leu); o resto fica em `regras`.
// Plano sem `regras` é o plano antigo do ERP e não muda nada no portal.

import { prisma } from '../lib/prisma.js'
import { planoDeBoleto, tabelaDeParcelas, type OpcaoDeParcela, type PlanoDeBoleto } from './portalPagamento.js'

export type DestinoParcelas = 'sei' | 'attrae' | 'nenhum'
export type OpcaoDePagamento = 'entrada' | 'integral'

/** Juros ao mês (Price) para parcelamentos de até `ate` vezes. */
export interface FaixaDeJuros { ate: number; jurosMesPct: number }

export interface FormasDePagamento {
  pix: { ativo: boolean; descontoPct: number }
  /** Boleto à vista. */
  boleto: { ativo: boolean; descontoPct: number }
  cartao: { ativo: boolean; parcelasMax: number; faixas: FaixaDeJuros[] }
  /** Boleto parcelado: a 1ª agora, as demais viram parcelas do contrato. */
  boletoParcelado: { ativo: boolean; parcelasMax: number; faixas: FaixaDeJuros[] }
}

export interface RegrasDoPlano {
  /** Quem cuida das parcelas que ficam em aberto depois da entrada. */
  destino: DestinoParcelas
  /** Curso completo no boleto parcelado: quem cuida das parcelas do boleto. */
  destinoBoletoIntegral: 'sei' | 'attrae'
  /** O que pagar agora: só a entrada (matrícula/1ª parcela) ou o curso inteiro. */
  entrada: { ativo: boolean } & FormasDePagamento
  integral: { ativo: boolean } & FormasDePagamento
  /** Desconto extra para quem paga a parcela até o dia `diaLimite` do mês. */
  pontualidade: { ativo: boolean; descontoPct: number; diaLimite: number }
  /** Código da condição de pagamento no SEI (entrada + parcelas / pagamento integral). */
  codigoSei: string
  codigoSeiIntegral: string
}

export interface PlanoDaOferta {
  id: number
  nome: string
  /** Matrícula separada (centavos); 0 = a 1ª mensalidade é a entrada. */
  taxaMatriculaCentavos: number
  /** Mensalidades depois da matrícula (ou todas, quando não há matrícula). */
  numParcelas: number
  valorParcelaCentavos: number
  diaVencimento: number
  regras: RegrasDoPlano
}

const num = (v: unknown, padrao: number, min: number, max: number): number => {
  const n = Number(v)
  if (!Number.isFinite(n)) return padrao
  return Math.min(max, Math.max(min, n))
}
const centavos = (v: number) => Math.round(v * 100) / 100
const texto = (v: unknown) => (typeof v === 'string' ? v.trim().slice(0, 40) : '')

function lerFaixas(bruto: unknown, max: number): FaixaDeJuros[] {
  const lista = Array.isArray(bruto) ? bruto : []
  const faixas = lista
    .map((f: any) => ({ ate: Math.round(num(f?.ate, 0, 0, 48)), jurosMesPct: num(f?.jurosMesPct, 0, 0, 20) }))
    .filter((f) => f.ate >= 1 && f.ate <= max)
    .sort((a, b) => a.ate - b.ate)
  // Uma faixa por teto: duas linhas "até 6x" valeriam a primeira.
  return faixas.filter((f, i) => i === 0 || f.ate !== faixas[i - 1]!.ate)
}

function lerFormas(bruto: unknown): FormasDePagamento {
  const c = (bruto && typeof bruto === 'object' ? bruto : {}) as any
  const parcelado = (x: any, teto: number) => {
    const parcelasMax = Math.round(num(x?.parcelasMax, 1, 1, teto))
    return { ativo: !!x?.ativo, parcelasMax, faixas: lerFaixas(x?.faixas, parcelasMax) }
  }
  return {
    pix: { ativo: !!c.pix?.ativo, descontoPct: num(c.pix?.descontoPct, 0, 0, 90) },
    boleto: { ativo: !!c.boleto?.ativo, descontoPct: num(c.boleto?.descontoPct, 0, 0, 90) },
    // 12 é o teto da iugu no cartão; 21, o do Asaas. Fica o menor dos dois.
    cartao: parcelado(c.cartao, 12),
    boletoParcelado: parcelado(c.boletoParcelado, 48),
  }
}

/** Lê o JSON do plano. null = plano antigo do ERP (sem regras de portal). */
export function lerRegrasDoPlano(bruto: unknown): RegrasDoPlano | null {
  if (!bruto || typeof bruto !== 'object' || Array.isArray(bruto)) return null
  const r = bruto as any
  const destino: DestinoParcelas = ['sei', 'attrae', 'nenhum'].includes(r.destino) ? r.destino : 'attrae'
  return {
    destino,
    destinoBoletoIntegral: r.destinoBoletoIntegral === 'sei' || r.destinoBoletoIntegral === 'attrae'
      ? r.destinoBoletoIntegral
      : destino === 'sei' ? 'sei' : 'attrae',
    entrada: { ativo: r.entrada?.ativo !== false, ...lerFormas(r.entrada) },
    integral: { ativo: !!r.integral?.ativo, ...lerFormas(r.integral) },
    pontualidade: {
      ativo: !!r.pontualidade?.ativo,
      descontoPct: num(r.pontualidade?.descontoPct, 0, 0, 90),
      diaLimite: Math.round(num(r.pontualidade?.diaLimite, 5, 1, 28)),
    },
    codigoSei: texto(r.codigoSei),
    codigoSeiIntegral: texto(r.codigoSeiIntegral),
  }
}

type LinhaDoPlano = {
  id: number; nome: string; taxaMatriculaCentavos: number; numParcelas: number
  valorParcelaCentavos: number; diaVencimento: number; regras: unknown
}

export function paraPlano(p: LinhaDoPlano): PlanoDaOferta | null {
  const regras = lerRegrasDoPlano(p.regras)
  if (!regras) return null
  return {
    id: p.id, nome: p.nome, taxaMatriculaCentavos: p.taxaMatriculaCentavos, numParcelas: p.numParcelas,
    valorParcelaCentavos: p.valorParcelaCentavos, diaVencimento: p.diaVencimento, regras,
  }
}

/** Planos com regras de portal, ativos, da oferta — na ordem de cadastro. */
export async function planosDaOferta(offeringId: number | null | undefined): Promise<PlanoDaOferta[]> {
  if (!offeringId) return []
  const linhas = await prisma.acaPlanoPagamento.findMany({
    where: { courseOfferingId: offeringId, ativo: true }, orderBy: { id: 'asc' },
  }).catch(() => [])
  return linhas.map((l) => paraPlano(l as LinhaDoPlano)).filter((p): p is PlanoDaOferta => !!p)
}

export async function planoPorId(id: number | null | undefined): Promise<PlanoDaOferta | null> {
  if (!id) return null
  const l = await prisma.acaPlanoPagamento.findUnique({ where: { id } }).catch(() => null)
  return l ? paraPlano(l as LinhaDoPlano) : null
}

// ─── Valores ───────────────────────────────────────────────────────────────

/** Total de parcelas do plano (a matrícula conta como a 1ª). */
export const totalDeParcelas = (p: PlanoDaOferta) => p.numParcelas + (p.taxaMatriculaCentavos > 0 ? 1 : 0)
/** Valor da entrada, em reais: a matrícula, ou a 1ª mensalidade. */
export const valorDaEntrada = (p: PlanoDaOferta) =>
  (p.taxaMatriculaCentavos > 0 ? p.taxaMatriculaCentavos : p.valorParcelaCentavos) / 100
/** Valor do curso inteiro pelo plano, em reais. */
export const valorIntegral = (p: PlanoDaOferta) =>
  (p.taxaMatriculaCentavos + p.valorParcelaCentavos * p.numParcelas) / 100
export const rotuloDaEntrada = (p: PlanoDaOferta) => (p.taxaMatriculaCentavos > 0 ? 'Matrícula' : '1ª parcela')

/** Opções liberadas no plano, na ordem em que aparecem. */
export function opcoesDoPlano(p: PlanoDaOferta): OpcaoDePagamento[] {
  const out: OpcaoDePagamento[] = []
  if (p.regras.entrada.ativo) out.push('entrada')
  // Plano de uma parcela só: "entrada" e "integral" são a mesma coisa.
  if (p.regras.integral.ativo && totalDeParcelas(p) > 1) out.push('integral')
  if (!out.length && p.regras.integral.ativo) out.push('integral')
  return out
}

export const valorDaOpcao = (p: PlanoDaOferta, o: OpcaoDePagamento) => (o === 'integral' ? valorIntegral(p) : valorDaEntrada(p))
export const formasDaOpcao = (p: PlanoDaOferta, o: OpcaoDePagamento): FormasDePagamento =>
  (o === 'integral' ? p.regras.integral : p.regras.entrada)

/** Juros da faixa que cobre `n` vezes (a menor faixa com teto ≥ n; acima da última, a última). */
export function jurosDaFaixa(faixas: FaixaDeJuros[], n: number): number {
  if (n <= 1 || !faixas.length) return 0
  return (faixas.find((f) => f.ate >= n) ?? faixas[faixas.length - 1]!).jurosMesPct
}

/** Valor com desconto à vista, em reais. */
export const comDesconto = (valor: number, pct: number) => centavos(valor * (1 - pct / 100))

/** Cartão: 1x até o teto, cada vez com o juro da sua faixa. */
export function opcoesDoCartao(valor: number, f: FormasDePagamento['cartao']): OpcaoDeParcela[] {
  if (!f.ativo || valor <= 0) return []
  const out: OpcaoDeParcela[] = []
  for (let n = 1; n <= f.parcelasMax; n++) {
    const juros = jurosDaFaixa(f.faixas, n)
    const linha = tabelaDeParcelas(valor, { ativo: true, parcelasMax: n, semJurosAte: juros > 0 ? 0 : n, jurosMesPct: juros, parcelaMinima: 0 })
    const o = linha.find((x) => x.parcelas === n)
    if (o) out.push(o)
  }
  return out
}

/** Boleto parcelado: 2x até o teto (a 1x é o boleto à vista), juro por faixa. */
export function opcoesDoBoletoParcelado(valor: number, f: FormasDePagamento['boletoParcelado'], diaVencimento: number): PlanoDeBoleto[] {
  if (!f.ativo || valor <= 0) return []
  const out: PlanoDeBoleto[] = []
  for (let n = 2; n <= f.parcelasMax; n++) {
    out.push(planoDeBoleto(valor, {
      ativo: true, parcelado: true, parcelasMax: n, diaVencimento,
      jurosMesPct: jurosDaFaixa(f.faixas, n), taxaPorParcela: 0,
    }, n))
  }
  return out
}

/** Frase do plano para listas: "6 parcelas de R$ 599,90 (matrícula + 5)". */
export function resumoDoPlano(p: PlanoDaOferta): string {
  const brl = (c: number) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
  const n = totalDeParcelas(p)
  if (p.taxaMatriculaCentavos > 0 && p.taxaMatriculaCentavos !== p.valorParcelaCentavos) {
    return `Matrícula de ${brl(p.taxaMatriculaCentavos)} + ${p.numParcelas}x de ${brl(p.valorParcelaCentavos)}`
  }
  return `${n} parcela${n > 1 ? 's' : ''} de ${brl(p.valorParcelaCentavos)}`
}

// ─── Parcelas do contrato ──────────────────────────────────────────────────

/** Vencimento da parcela N (1 = próximo mês) no dia do plano. */
export function vencimentoDoPlano(n: number, dia: number, base = new Date()): Date {
  return new Date(base.getFullYear(), base.getMonth() + n, Math.min(dia, 28))
}

export interface ParcelaGerada {
  tipo: 'MATRICULA' | 'MENSALIDADE'
  valorBrutoCentavos: number
  dataVencimento: Date
  situacao?: 'PAGA'
  valorPagoCentavos?: number
  pagoEm?: Date
}

/**
 * Parcelas do contrato pelo plano e pela escolha do checkout.
 *
 *  · entrada: as parcelas do plano; a 1ª nasce paga com o que entrou (com
 *    desconto do Pix, o pago é menor que o bruto e a parcela está quitada
 *    mesmo assim — foi o preço oferecido);
 *  · integral à vista ou no cartão: uma parcela do total, paga;
 *  · integral no boleto parcelado: as N parcelas do boleto; a 1ª paga.
 */
export function parcelasDoPlano(p: PlanoDaOferta, escolha: {
  opcao: OpcaoDePagamento; meio: string; parcelas: number; valorPagoCentavos: number; pagoEm: Date
  valorParcelaCentavos?: number; valorTotalCentavos?: number
}): ParcelaGerada[] {
  const paga = { situacao: 'PAGA' as const, valorPagoCentavos: escolha.valorPagoCentavos, pagoEm: escolha.pagoEm }
  if (escolha.opcao === 'integral') {
    if (escolha.meio === 'boleto' && escolha.parcelas > 1 && escolha.valorParcelaCentavos && escolha.valorTotalCentavos) {
      const n = escolha.parcelas
      const primeira = escolha.valorTotalCentavos - escolha.valorParcelaCentavos * (n - 1)
      return Array.from({ length: n }, (_, i) => ({
        tipo: 'MENSALIDADE' as const,
        valorBrutoCentavos: i === 0 ? primeira : escolha.valorParcelaCentavos!,
        dataVencimento: vencimentoDoPlano(i, p.diaVencimento),
        ...(i === 0 ? paga : {}),
      }))
    }
    const total = escolha.valorTotalCentavos || escolha.valorPagoCentavos
    return [{ tipo: 'MENSALIDADE', valorBrutoCentavos: total, dataVencimento: vencimentoDoPlano(0, p.diaVencimento), ...paga, valorPagoCentavos: escolha.valorPagoCentavos }]
  }
  const out: ParcelaGerada[] = []
  if (p.taxaMatriculaCentavos > 0) {
    out.push({ tipo: 'MATRICULA', valorBrutoCentavos: p.taxaMatriculaCentavos, dataVencimento: vencimentoDoPlano(0, p.diaVencimento) })
  }
  for (let i = 1; i <= p.numParcelas; i++) {
    out.push({ tipo: 'MENSALIDADE', valorBrutoCentavos: p.valorParcelaCentavos, dataVencimento: vencimentoDoPlano(p.taxaMatriculaCentavos > 0 ? i : i - 1, p.diaVencimento) })
  }
  if (out[0]) Object.assign(out[0], paga)
  return out
}

// ─── Pontualidade ──────────────────────────────────────────────────────────

/**
 * Desconto de pontualidade para uma fatura que vence em `vencimento`: quantos
 * dias antes do vencimento ele vale (até o dia-limite do mesmo mês). null =
 * não se aplica (plano sem desconto, dia-limite já passou, ou o dia-limite
 * não fica antes do vencimento).
 */
export function pontualidadeDaFatura(
  regras: RegrasDoPlano | null,
  vencimento: Date,
  hoje = new Date(),
): { dias: number; pct: number; ate: Date } | null {
  const pt = regras?.pontualidade
  if (!pt?.ativo || pt.descontoPct <= 0) return null
  const ate = new Date(vencimento.getFullYear(), vencimento.getMonth(), pt.diaLimite)
  const dia = (d: Date) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())
  const dias = Math.round((dia(vencimento) - dia(ate)) / 86_400_000)
  if (dias < 1) return null
  if (dia(ate) < dia(hoje)) return null
  return { dias, pct: pt.descontoPct, ate }
}

// ─── Escolha guardada no checkout ──────────────────────────────────────────

/** Parte do paymentPlan da inscrição gravada quando o checkout cobrou por um plano. */
export interface EscolhaDoPlano {
  planoId: number
  planoNome: string
  opcao: OpcaoDePagamento
  destino: DestinoParcelas
}

export function lerEscolhaDoPlano(paymentPlan: unknown): EscolhaDoPlano | null {
  const pp = (paymentPlan ?? {}) as any
  const id = Number(pp?.planoFinanceiro?.planoId)
  if (!Number.isInteger(id) || id <= 0) return null
  const f = pp.planoFinanceiro
  return {
    planoId: id,
    planoNome: String(f.planoNome ?? ''),
    opcao: f.opcao === 'integral' ? 'integral' : 'entrada',
    destino: ['sei', 'attrae', 'nenhum'].includes(f.destino) ? f.destino : 'attrae',
  }
}

// ─── Escolha na tela de pagamento ──────────────────────────────────────────

/**
 * Plano e opção escolhidos na tela (ou os primeiros liberados). null = a
 * oferta não tem plano com regras de portal, e vale o checkout de antes.
 */
export async function planoEscolhido(
  offeringId: number | null | undefined,
  planoId: unknown,
  opcao: unknown,
): Promise<{ planos: PlanoDaOferta[]; plano: PlanoDaOferta; opcao: OpcaoDePagamento } | null> {
  const planos = (await planosDaOferta(offeringId)).filter((p) => opcoesDoPlano(p).length > 0)
  if (!planos.length) return null
  const plano = planos.find((p) => p.id === Number(planoId)) ?? planos[0]!
  const liberadas = opcoesDoPlano(plano)
  const o = liberadas.includes(opcao as OpcaoDePagamento) ? (opcao as OpcaoDePagamento) : liberadas[0]!
  return { planos, plano, opcao: o }
}

/** Como a opção aparece para o candidato. */
export function descreverOpcao(p: PlanoDaOferta, o: OpcaoDePagamento): { rotulo: string; detalhe: string } {
  const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
  if (o === 'integral') {
    return { rotulo: 'Curso completo', detalhe: `${brl(valorIntegral(p))} — pagamento integral, sem parcelas depois` }
  }
  const resto = totalDeParcelas(p) - 1
  return {
    rotulo: rotuloDaEntrada(p),
    detalhe: resto > 0
      ? `${brl(valorDaEntrada(p))} agora e mais ${resto}x de ${brl(p.valorParcelaCentavos / 100)} (vencimento todo dia ${p.diaVencimento})`
      : `${brl(valorDaEntrada(p))}`,
  }
}

/** O que gravar no paymentPlan da inscrição sobre o plano escolhido. */
export function escolhaParaGravar(p: PlanoDaOferta, o: OpcaoDePagamento, ficamParcelas: boolean) {
  return {
    planoId: p.id,
    planoNome: p.nome,
    opcao: o,
    // Integral à vista ou no cartão não deixa nada em aberto. No boleto
    // parcelado ficam as parcelas do boleto, com o destino escolhido no plano.
    destino: o === 'integral' ? (ficamParcelas ? p.regras.destinoBoletoIntegral : 'nenhum') : p.regras.destino,
    codigoSei: o === 'integral' ? (p.regras.codigoSeiIntegral || p.regras.codigoSei) : p.regras.codigoSei,
    totalParcelas: totalDeParcelas(p),
    valorIntegral: valorIntegral(p),
    valorEntrada: valorDaEntrada(p),
  }
}

// ─── Condição do contrato ──────────────────────────────────────────────────

export interface CondicaoDoContrato {
  plano: PlanoDaOferta
  opcao: OpcaoDePagamento
  /** Parcelas do contrato, contando a entrada. */
  numParcelas: number
  valorParcelaCentavos: number
  valorTotalCentavos: number
  /** Frase para o contrato: "Matrícula + 5 parcelas de R$ 599,90, todo dia 10". */
  descricao: string
}

/**
 * A condição que vai para o contrato: a do plano escolhido no checkout (com o
 * que foi pago), ou — antes do pagamento — a do primeiro plano liberado.
 * null = a oferta não tem plano com regras de portal.
 */
export async function condicaoDoContrato(offeringId: number, paymentPlan: unknown): Promise<CondicaoDoContrato | null> {
  const pp = (paymentPlan ?? null) as Record<string, any> | null
  const escolha = lerEscolhaDoPlano(pp)
  const plano = escolha ? await planoPorId(escolha.planoId) : (await planosDaOferta(offeringId))[0] ?? null
  if (!plano) return null
  const brl = (c: number) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
  const MEIO: Record<string, string> = { pix: 'Pix', boleto: 'boleto', credit_card: 'cartão de crédito' }
  const opcao: OpcaoDePagamento = escolha?.opcao ?? opcoesDoPlano(plano)[0] ?? 'entrada'

  if (opcao === 'integral' && pp) {
    const total = Math.round(Number(pp.valorTotal ?? pp.valorCobrado ?? 0) * 100)
    const n = Math.max(1, Number(pp.parcelas) || 1)
    const parcela = Math.round(Number(pp.valorParcela ?? 0) * 100) || total
    const meio = MEIO[String(pp.meio)] ?? String(pp.meio ?? '')
    return {
      plano, opcao, numParcelas: n, valorParcelaCentavos: parcela, valorTotalCentavos: total,
      descricao: n > 1 ? `Pagamento integral em ${n}x de ${brl(parcela)} no ${meio} (total ${brl(total)})` : `Pagamento integral à vista no ${meio}: ${brl(total)}`,
    }
  }
  const n = totalDeParcelas(plano)
  const iguais = plano.taxaMatriculaCentavos === 0 || plano.taxaMatriculaCentavos === plano.valorParcelaCentavos
  const entrada = plano.taxaMatriculaCentavos > 0 ? 'matrícula' : '1ª parcela'
  const descricao = iguais
    ? `${n} parcela${n > 1 ? 's' : ''} de ${brl(plano.valorParcelaCentavos)} (a ${entrada} paga na inscrição e as demais todo dia ${plano.diaVencimento})`
    : `Matrícula de ${brl(plano.taxaMatriculaCentavos)} + ${plano.numParcelas}x de ${brl(plano.valorParcelaCentavos)}, todo dia ${plano.diaVencimento}`
  return {
    plano, opcao, numParcelas: n, valorParcelaCentavos: plano.valorParcelaCentavos,
    valorTotalCentavos: Math.round(valorIntegral(plano) * 100), descricao,
  }
}
