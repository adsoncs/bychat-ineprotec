// src/services/acaFinBanco.ts
// Módulo Acadêmico · F9 — Financeiro Bancário. Helpers de dia útil, geração de
// remessa CNAB-400 (layout-base FEBRABAN, calibrável por banco) e o motor de
// cobranças recorrentes (gera AcaParcela periodicamente).

import { prisma } from '../lib/prisma.js'

// ───────── util ─────────
const padR = (s: any, n: number) => String(s ?? '').slice(0, n).padEnd(n, ' ')
const padL0 = (s: any, n: number) => String(s ?? '').replace(/\D/g, '').slice(0, n).padStart(n, '0')
const numL0 = (n: number, len: number) => String(Math.max(0, Math.round(n))).slice(-len).padStart(len, '0')
const ddmmyy = (d: Date) => `${String(d.getUTCDate()).padStart(2, '0')}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCFullYear()).slice(-2)}`

/** Próximo dia útil (pula fim de semana e feriados). Recebe Set de 'AAAA-MM-DD'. */
export function ajustarDiaUtil(date: Date, feriados: Set<string>): Date {
  const d = new Date(date)
  for (let i = 0; i < 30; i++) {
    const dow = d.getUTCDay()
    const iso = d.toISOString().slice(0, 10)
    if (dow !== 0 && dow !== 6 && !feriados.has(iso)) return d
    d.setUTCDate(d.getUTCDate() + 1)
  }
  return d
}

export async function feriadosSet(): Promise<Set<string>> {
  const fs = await prisma.acaFeriado.findMany({ select: { data: true } })
  return new Set(fs.map((f) => f.data.toISOString().slice(0, 10)))
}

export interface TituloRemessa {
  parcelaId: number
  nossoNumero: string
  valorCentavos: number
  vencimento: Date
  numeroDocumento: string
  sacadoNome: string
  sacadoDoc: string
}

/**
 * Gera o conteúdo de uma remessa CNAB-400 (layout-base, registro 0/1/9).
 * É um esqueleto estruturalmente válido — os campos específicos de cada banco
 * (posições de carteira/convênio/nosso número) devem ser calibrados na homologação.
 */
export function gerarRemessaCNAB400(conta: {
  bancoCodigo: string; agencia?: string | null; conta?: string | null; carteira?: string | null
  convenio?: string | null; cedente?: string | null; documentoCedente?: string | null; sequencial: number
}, titulos: TituloRemessa[]): string {
  const hoje = new Date()
  const linhas: string[] = []

  // Registro Header (tipo 0)
  let h = ''
  h += '0' + '1' + 'REMESSA' + '01' + padR('COBRANCA', 15)
  h += padL0(conta.convenio || conta.agencia, 20)
  h += padR(conta.cedente || 'CEDENTE', 30)
  h += padL0(conta.bancoCodigo, 3) + padR('BANCO', 15)
  h += ddmmyy(hoje)
  h = padR(h, 394) + numL0(1, 6)
  linhas.push(padR(h, 400))

  // Registros de detalhe (tipo 1)
  let seq = 1
  let totalCentavos = 0
  for (const t of titulos) {
    seq++
    totalCentavos += t.valorCentavos
    let d = ''
    d += '1'
    d += padL0(conta.documentoCedente, 14)            // CNPJ cedente
    d += padL0(conta.agencia, 5) + padL0(conta.conta, 12)
    d += padR(conta.carteira || '', 4)
    d += padR(String(t.parcelaId), 25)                 // uso da empresa
    d += padL0(t.nossoNumero, 12)                      // nosso número
    d += ddmmyy(t.vencimento)
    d += numL0(t.valorCentavos, 13)
    d += padL0(conta.bancoCodigo, 3)
    d += padR(t.numeroDocumento, 10)
    d += padR(t.sacadoNome, 40)
    d += padL0(t.sacadoDoc, 14)
    d = padR(d, 394) + numL0(seq, 6)
    linhas.push(padR(d, 400))
  }

  // Registro Trailer (tipo 9)
  let tr = '9'
  tr += numL0(titulos.length, 6)
  tr += numL0(totalCentavos, 13)
  tr = padR(tr, 394) + numL0(seq + 1, 6)
  linhas.push(padR(tr, 400))

  return linhas.join('\r\n') + '\r\n'
}

const PERIODO_MESES: Record<string, number> = { MENSAL: 1, BIMESTRAL: 2, TRIMESTRAL: 3, SEMESTRAL: 6, ANUAL: 12 }

/** Avança uma data por N meses mantendo o dia de vencimento. */
export function avancarPeriodo(from: Date, periodo: string, diaVencimento: number): Date {
  const meses = PERIODO_MESES[periodo] ?? 1
  const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + meses, 1))
  const ultimoDia = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()
  d.setUTCDate(Math.min(diaVencimento, ultimoDia))
  return d
}

/**
 * Gera parcelas das cobranças recorrentes vencidas (proximaGeracao <= hoje).
 * dryRun=true só lista; senão cria AcaParcela e avança proximaGeracao.
 */
export async function gerarRecorrencias(opts: { dryRun: boolean }) {
  const hoje = new Date()
  const recs = await prisma.acaCobrancaRecorrente.findMany({ where: { ativo: true, proximaGeracao: { lte: hoje } } })
  if (opts.dryRun) return { dryRun: true, total: recs.length, recorrencias: recs }
  const fers = await feriadosSet()
  let geradas = 0
  for (const r of recs) {
    try {
      const ultima = await prisma.acaParcela.findFirst({ where: { contratoId: r.contratoId }, orderBy: { nroParcela: 'desc' }, select: { nroParcela: true } })
      const venc = ajustarDiaUtil(r.proximaGeracao, fers)
      await prisma.acaParcela.create({
        data: {
          contratoId: r.contratoId, nroParcela: (ultima?.nroParcela ?? 0) + 1, tipo: 'MENSALIDADE',
          valorBrutoCentavos: r.valorCentavos, dataVencimento: venc, situacao: 'ABERTA',
          contaFinanceiraId: r.contaFinanceiraId ?? null,
        },
      })
      await prisma.acaCobrancaRecorrente.update({ where: { id: r.id }, data: { proximaGeracao: avancarPeriodo(r.proximaGeracao, r.periodo, r.diaVencimento) } })
      geradas++
    } catch { /* pula recorrência com problema */ }
  }
  return { dryRun: false, total: recs.length, geradas }
}

/**
 * Processa um arquivo de RETORNO CNAB-400 (tolerante): para cada registro de
 * detalhe (tipo 1) com ocorrência de liquidação, baixa a parcela correspondente
 * pelo nosso número. Retorna a contagem de baixas.
 */
export async function processarRetornoCNAB400(conteudo: string): Promise<{ baixadas: number; naoEncontradas: number }> {
  const linhas = conteudo.split(/\r?\n/).filter((l) => l.length >= 100 && l[0] === '1')
  let baixadas = 0, naoEncontradas = 0
  for (const l of linhas) {
    // ocorrência (cód. 06 = liquidação) e nosso número são posições típicas do CNAB400;
    // tolerante: tenta achar a parcela pelo nossoNumero gravado na remessa.
    const ocorrencia = l.slice(108, 110)
    const nossoNumero = l.slice(62, 74).replace(/\D/g, '').replace(/^0+/, '')
    if (!['06', '17'].includes(ocorrencia)) continue
    if (!nossoNumero) { naoEncontradas++; continue }
    const parcela = await prisma.acaParcela.findFirst({ where: { nossoNumero: { endsWith: nossoNumero }, situacao: { not: 'PAGA' } }, select: { id: true, valorBrutoCentavos: true } })
    if (!parcela) { naoEncontradas++; continue }
    await prisma.acaParcela.update({ where: { id: parcela.id }, data: { situacao: 'PAGA', pagoEm: new Date(), valorPagoCentavos: parcela.valorBrutoCentavos } })
    baixadas++
  }
  return { baixadas, naoEncontradas }
}
