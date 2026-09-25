// src/services/portalPagamento.ts
//
// Regras de pagamento do portal público: quais meios o portal aceita, em quantas
// vezes, com ou sem juros, e quanto fica cada parcela.
//
// A conta paga o gateway de qualquer jeito (no Asaas da INEPROTEC: 3,49% até 6x,
// 3,99% até 12x, R$ 1,99 por boleto). O que se decide aqui é outra coisa: quanto
// disso a instituição absorve e quanto repassa ao candidato. Por isso "sem juros
// até N parcelas" é configuração, não constante.

export type MeioDePagamento = 'pix' | 'boleto' | 'cartao'

export interface RegrasPix {
  ativo: boolean
  /** Desconto à vista, em %, sobre o valor cheio. */
  descontoPct: number
  /** Quanto tempo o código continua válido. */
  expiraHoras: number
}

export interface RegrasBoleto {
  ativo: boolean
  /** Boleto parcelado: a primeira é cobrada agora, as demais viram parcelas. */
  parcelado: boolean
  parcelasMax: number
  /** Dia do mês em que as parcelas seguintes vencem. */
  diaVencimento: number
  /**
   * Juros ao mês do parcelado (Price). 0 = a instituição absorve, e parcelar
   * sai pelo mesmo preço do à vista.
   */
  jurosMesPct: number
  /**
   * Valor fixo somado a CADA parcela. Serve para repassar a tarifa de emissão
   * do boleto, que o banco cobra por documento e não por venda: parcelar em
   * doze custa doze tarifas à instituição, não uma.
   */
  taxaPorParcela: number
}

export interface RegrasCartao {
  ativo: boolean
  parcelasMax: number
  /** Até aqui, a instituição absorve a taxa: o candidato paga o valor cheio. */
  semJurosAte: number
  /** Juros ao mês repassado acima do limite sem juros. */
  jurosMesPct: number
  /** Piso da parcela: evita "12x de R$ 8,30", que só multiplica tarifa. */
  parcelaMinima: number
}

export interface RegrasDePagamento {
  pix: RegrasPix
  boleto: RegrasBoleto
  cartao: RegrasCartao
}

/** O que vale quando o portal nunca foi configurado. */
export const PAGAMENTO_PADRAO: RegrasDePagamento = {
  pix: { ativo: true, descontoPct: 0, expiraHoras: 24 },
  boleto: { ativo: true, parcelado: false, parcelasMax: 12, diaVencimento: 10, jurosMesPct: 0, taxaPorParcela: 0 },
  // Cartão nasce desligado: só faz sentido com uma conexão que aceite cartão, e
  // ligar sozinho colocaria um botão que falha na cara do candidato.
  cartao: { ativo: false, parcelasMax: 12, semJurosAte: 6, jurosMesPct: 1.99, parcelaMinima: 30 },
}

const num = (v: unknown, padrao: number, min: number, max: number): number => {
  const n = Number(v)
  if (!Number.isFinite(n)) return padrao
  return Math.min(max, Math.max(min, n))
}

/** Lê a configuração guardada, completando com o padrão o que faltar. */
export function lerRegras(bruto: unknown): RegrasDePagamento {
  const c = (bruto && typeof bruto === 'object' && !Array.isArray(bruto) ? bruto : {}) as any
  const p = c.pix ?? {}, b = c.boleto ?? {}, k = c.cartao ?? {}
  return {
    pix: {
      ativo: p.ativo === undefined ? PAGAMENTO_PADRAO.pix.ativo : !!p.ativo,
      descontoPct: num(p.descontoPct, PAGAMENTO_PADRAO.pix.descontoPct, 0, 50),
      expiraHoras: num(p.expiraHoras, PAGAMENTO_PADRAO.pix.expiraHoras, 1, 720),
    },
    boleto: {
      ativo: b.ativo === undefined ? PAGAMENTO_PADRAO.boleto.ativo : !!b.ativo,
      parcelado: !!b.parcelado,
      parcelasMax: Math.round(num(b.parcelasMax, PAGAMENTO_PADRAO.boleto.parcelasMax, 1, 48)),
      diaVencimento: Math.round(num(b.diaVencimento, PAGAMENTO_PADRAO.boleto.diaVencimento, 1, 28)),
      jurosMesPct: num(b.jurosMesPct, PAGAMENTO_PADRAO.boleto.jurosMesPct, 0, 20),
      taxaPorParcela: num(b.taxaPorParcela, PAGAMENTO_PADRAO.boleto.taxaPorParcela, 0, 1000),
    },
    cartao: {
      ativo: k.ativo === undefined ? PAGAMENTO_PADRAO.cartao.ativo : !!k.ativo,
      // 21 é o teto do Asaas; acima disso a cobrança é recusada.
      parcelasMax: Math.round(num(k.parcelasMax, PAGAMENTO_PADRAO.cartao.parcelasMax, 1, 21)),
      semJurosAte: Math.round(num(k.semJurosAte, PAGAMENTO_PADRAO.cartao.semJurosAte, 1, 21)),
      jurosMesPct: num(k.jurosMesPct, PAGAMENTO_PADRAO.cartao.jurosMesPct, 0, 20),
      parcelaMinima: num(k.parcelaMinima, PAGAMENTO_PADRAO.cartao.parcelaMinima, 0, 10000),
    },
  }
}

export interface OpcaoDeParcela {
  parcelas: number
  valorParcela: number
  valorTotal: number
  /** Quanto de juros entrou no total (0 quando a instituição absorve). */
  acrescimo: number
  semJuros: boolean
  /** Frase pronta, para a tela não repetir a regra de arredondamento. */
  descricao: string
}

const centavos = (v: number) => Math.round(v * 100) / 100

const emReais = (v: number) =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

/**
 * Tabela de parcelamento do cartão.
 *
 * Até `semJurosAte` o candidato paga o valor cheio dividido — a instituição
 * absorve a taxa do gateway. Acima disso entra juros composto ao mês (Price),
 * que é como o mercado apresenta e como o candidato espera comparar.
 *
 * A última parcela recebe a sobra dos centavos: N parcelas iguais quase nunca
 * somam o total exato, e a diferença tem que aparecer em algum lugar.
 */
export function tabelaDeParcelas(valor: number, regras: RegrasCartao): OpcaoDeParcela[] {
  const opcoes: OpcaoDeParcela[] = []
  if (valor <= 0) return opcoes

  for (let n = 1; n <= regras.parcelasMax; n++) {
    const semJuros = n <= regras.semJurosAte || regras.jurosMesPct <= 0
    let total: number
    if (semJuros) {
      total = valor
    } else {
      const i = regras.jurosMesPct / 100
      // Price: parcela = PV · i / (1 − (1+i)^−n)
      const parcela = (valor * i) / (1 - Math.pow(1 + i, -n))
      total = centavos(parcela * n)
    }
    const parcela = centavos(total / n)
    // Parcela abaixo do piso não entra: 12x de R$ 8 só multiplica tarifa.
    if (n > 1 && parcela < regras.parcelaMinima) break

    opcoes.push({
      parcelas: n,
      valorParcela: parcela,
      valorTotal: total,
      acrescimo: centavos(total - valor),
      semJuros,
      descricao: n === 1
        ? `à vista ${emReais(valor)}`
        : `${n}x de ${emReais(parcela)}${semJuros ? ' sem juros' : ` (total ${emReais(total)})`}`,
    })
  }
  return opcoes
}

export interface PlanoDeBoleto {
  parcelas: number
  /** Cobrada agora, no ato da inscrição. */
  valorEntrada: number
  /** Cada uma das seguintes. */
  valorParcela: number
  valorTotal: number
  /** Quanto o parcelamento acrescentou sobre o preço à vista. */
  acrescimo: number
  semAcrescimo: boolean
  vencimentos: Date[]
  descricao: string
}

/**
 * Parcelas do boleto: a primeira é cobrada agora e as demais viram título do
 * financeiro.
 *
 * Duas formas de acréscimo, que somam e podem ser usadas juntas ou nenhuma:
 *
 *  · **juros ao mês** (Price), quando parcelar tem custo de capital para a
 *    instituição;
 *  · **taxa fixa por parcela**, que existe porque o banco cobra a emissão por
 *    documento, e não por venda: parcelar em doze custa doze tarifas. Sem
 *    repassar, quanto mais o candidato parcela, menos a instituição recebe.
 *
 * Com as duas zeradas, parcelar sai pelo preço do à vista — que é o padrão e o
 * comportamento de antes. Isto aqui é sobre o preço no ato da compra; multa e
 * juros por ATRASO são outra coisa, e vivem nos encargos do ERP.
 */
export function planoDeBoleto(valor: number, regras: RegrasBoleto, parcelas: number): PlanoDeBoleto {
  const n = Math.min(Math.max(1, Math.round(parcelas)), regras.parcelasMax)

  // À vista não parcela nada, então não carrega juros nem tarifa de parcela.
  if (n === 1) {
    return {
      parcelas: 1,
      valorEntrada: centavos(valor),
      valorParcela: 0,
      valorTotal: centavos(valor),
      acrescimo: 0,
      semAcrescimo: true,
      vencimentos: [],
      descricao: `à vista ${emReais(valor)}`,
    }
  }

  const juros = regras.jurosMesPct / 100
  const comJuros = juros > 0
    ? centavos(((valor * juros) / (1 - Math.pow(1 + juros, -n))) * n)
    : centavos(valor)
  const total = centavos(comJuros + regras.taxaPorParcela * n)

  const parcela = centavos(total / n)
  // A entrada absorve a sobra dos centavos: quem paga agora não pode ficar
  // devendo um centavo que nenhuma parcela seguinte cobra.
  const entrada = centavos(total - parcela * (n - 1))

  const vencimentos: Date[] = []
  const hoje = new Date()
  for (let i = 1; i < n; i++) {
    const d = new Date(hoje.getFullYear(), hoje.getMonth() + i, Math.min(regras.diaVencimento, 28))
    vencimentos.push(d)
  }

  const acrescimo = centavos(total - valor)
  return {
    parcelas: n,
    valorEntrada: entrada,
    valorParcela: parcela,
    valorTotal: total,
    acrescimo,
    semAcrescimo: acrescimo <= 0,
    vencimentos,
    descricao: `entrada de ${emReais(entrada)} + ${n - 1}x de ${emReais(parcela)}`
      + (acrescimo > 0 ? ` (total ${emReais(total)})` : ''),
  }
}
