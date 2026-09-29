// src/services/tabelaDePrecos.ts
//
// Tabela de preços da oferta por meio de pagamento — o que o site da
// instituição anuncia: "R$ 2.508,00 à vista no Pix ou boleto, 12x R$ 229,90 no
// cartão, 12x R$ 249,90 no boleto".
//
// Sem ela, o portal que cobra o curso cobra a 1ª mensalidade pelo mesmo valor
// em qualquer meio, e o desconto à vista é um percentual do PORTAL — que não
// representa cursos do mesmo nível com descontos diferentes, nem boleto
// parcelado com parcela própria. Com ela, cada meio cobra o curso inteiro pela
// condição da tabela, e o contrato do ERP nasce com essa mesma condição
// (acaFinanceiro.gerarContratoEParcelas).

import type { RegrasDePagamento } from './portalPagamento.js'

export interface CondicaoParcelada {
  parcelas: number
  valorParcela: number
}

export interface TabelaDePrecos {
  /** Pix e boleto à vista: o curso inteiro, pago agora. */
  aVista: number
  /** Cartão em até N vezes sem juros, cada uma de `valorParcela`. */
  cartao: CondicaoParcelada | null
  /** Boleto parcelado: a 1ª agora, as demais viram parcela do contrato. */
  boleto: CondicaoParcelada | null
}

const centavos = (v: number) => Math.round(v * 100) / 100

function lerCondicao(bruto: unknown): CondicaoParcelada | null {
  if (!bruto || typeof bruto !== 'object') return null
  const c = bruto as Record<string, unknown>
  const parcelas = Math.round(Number(c.parcelas))
  const valorParcela = centavos(Number(c.valorParcela))
  // 21 é o teto do Asaas no cartão; no boleto, 48 é o do portal.
  if (!Number.isFinite(parcelas) || parcelas < 1 || parcelas > 48) return null
  if (!Number.isFinite(valorParcela) || valorParcela <= 0) return null
  return { parcelas, valorParcela }
}

/**
 * Lê o JSON guardado na oferta. Devolve null quando não há preço à vista —
 * sem ele a tabela não diz quanto custa o curso, e vale o comportamento antigo.
 */
export function lerTabelaDePrecos(bruto: unknown): TabelaDePrecos | null {
  if (!bruto || typeof bruto !== 'object' || Array.isArray(bruto)) return null
  const t = bruto as Record<string, unknown>
  const aVista = centavos(Number(t.aVista))
  if (!Number.isFinite(aVista) || aVista <= 0) return null
  const cartao = lerCondicao(t.cartao)
  return {
    aVista,
    cartao: cartao && cartao.parcelas <= 21 ? cartao : null,
    boleto: lerCondicao(t.boleto),
  }
}

/** Total do cartão pela tabela: N parcelas sem juros. */
export function totalDoCartao(t: TabelaDePrecos): number {
  return t.cartao ? centavos(t.cartao.parcelas * t.cartao.valorParcela) : t.aVista
}

/** Total do boleto parcelado pela tabela. */
export function totalDoBoletoParcelado(t: TabelaDePrecos): number | null {
  return t.boleto && t.boleto.parcelas > 1 ? centavos(t.boleto.parcelas * t.boleto.valorParcela) : null
}

/**
 * Regras do portal ajustadas à tabela: o que é do meio (ligado ou não, prazo do
 * Pix, dia de vencimento) continua do portal; preço, parcelas e juros passam a
 * ser os da tabela.
 */
export function regrasComTabela(regras: RegrasDePagamento, t: TabelaDePrecos): RegrasDePagamento {
  return {
    // O à vista já é o preço com desconto: o percentual do portal não soma.
    pix: { ...regras.pix, descontoPct: 0 },
    boleto: t.boleto && t.boleto.parcelas > 1
      ? { ...regras.boleto, parcelado: true, parcelasMax: t.boleto.parcelas, jurosMesPct: 0, taxaPorParcela: 0 }
      : { ...regras.boleto, parcelado: false, parcelasMax: 1 },
    cartao: {
      ...regras.cartao,
      parcelasMax: t.cartao?.parcelas ?? 1,
      semJurosAte: t.cartao?.parcelas ?? 1,
      jurosMesPct: 0,
      // A parcela é a da tabela; o piso do portal cortaria as vezes anunciadas.
      parcelaMinima: 0,
    },
  }
}

/**
 * Valor de referência de cada meio pela tabela — é sobre ele que cupom e
 * parcelamento são calculados. Boleto parcelado tem base própria: a opção
 * "N x" é sobre o total do boleto parcelado, e a "1x" é o à vista.
 */
export function valorBaseDoMeio(
  t: TabelaDePrecos,
  meio: 'pix' | 'boleto' | 'credit_card',
  parcelasBoleto = 1,
): number {
  if (meio === 'credit_card') return totalDoCartao(t)
  if (meio === 'boleto' && parcelasBoleto > 1) return totalDoBoletoParcelado(t) ?? t.aVista
  return t.aVista
}

/** Frase curta da tabela, para listas e resumos. */
export function resumoDaTabela(t: TabelaDePrecos): string {
  const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
  const partes = [`${brl(t.aVista)} à vista (Pix ou boleto)`]
  if (t.cartao) partes.push(`${t.cartao.parcelas}x ${brl(t.cartao.valorParcela)} no cartão`)
  if (t.boleto && t.boleto.parcelas > 1) partes.push(`${t.boleto.parcelas}x ${brl(t.boleto.valorParcela)} no boleto`)
  return partes.join(' · ')
}
