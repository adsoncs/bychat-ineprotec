// src/services/checkoutDoPlano.ts
//
// Checkout do portal quando a oferta tem plano de pagamento com regras
// (services/planoFinanceiro): as opções da tela e a conta da cobrança saem do
// plano escolhido — e não das regras de pagamento do portal nem da tabela de
// preços. Oferta sem plano assim continua no checkout de antes.

import { avaliarCupom, precoPorMeio } from './portalCupom.js'
import { planoDeBoleto, type PlanoDeBoleto } from './portalPagamento.js'
import type { CobrancaDoPortal } from './portalCobranca.js'
import {
  baseDaForma, descreverOpcao, menorPrecoDaOpcao, escolhaParaGravar, formasDaOpcao, opcoesDoBoletoParcelado, opcoesDoCartao,
  opcoesDoPlano, planoEscolhido, resumoDoPlano, valorDaOpcao,
  type FormasDePagamento, type OpcaoDePagamento, type PlanoDaOferta,
} from './planoFinanceiro.js'

type Meio = 'pix' | 'boleto' | 'credit_card'
type Escolha = NonNullable<Awaited<ReturnType<typeof planoEscolhido>>>

export async function escolhaDoCheckoutPeloPlano(cob: CobrancaDoPortal | null, planoId: unknown, opcao: unknown): Promise<Escolha | null> {
  if (!cob || cob.escopo !== 'curso') return null
  return planoEscolhido(cob.contexto.offeringId, planoId, opcao)
}

const rotuloDaOpcao = (p: PlanoDaOferta, o: OpcaoDePagamento) => descreverOpcao(p, o).rotulo

/** O cupom, revalidado sobre o valor da opção (curso inteiro ≠ matrícula). */
async function cupomDaOpcao(input: { codigo: string; valor: number; portalId: number; cpf: string | undefined; cob: CobrancaDoPortal; metodo?: Meio }) {
  if (!input.codigo) return null
  return avaliarCupom({
    codigo: input.codigo, valor: input.valor, portalId: input.portalId, cpf: input.cpf,
    descontoAVistaPct: 0, contexto: input.cob.contexto, escopo: 'curso',
    ...(input.metodo ? { metodo: input.metodo } : {}),
  })
}

/** O que a tela de pagamento mostra: planos, opções e os meios da opção escolhida. */
export async function opcoesDaTelaPeloPlano(input: {
  cob: CobrancaDoPortal
  escolha: Escolha
  cupomCodigo: string
  portalId: number
  cpf: string | undefined
  pixExpiraHoras: number
  cartaoDisponivel: boolean
  tokenizacao: Record<string, unknown> | null
}) {
  const { plano, opcao, planos } = input.escolha
  const formas = formasDaOpcao(plano, opcao)
  const base = valorDaOpcao(plano, opcao)
  const cupom = await cupomDaOpcao({ codigo: input.cupomCodigo, valor: base, portalId: input.portalId, cpf: input.cpf, cob: input.cob })
  const cupomOk = cupom && !('valido' in cupom) ? cupom : null
  // Cada forma pode ter preço próprio: o cupom é recalculado sobre ele.
  const cupomNa = async (forma: keyof FormasDePagamento) => {
    const b = baseDaForma(plano, opcao, forma)
    if (!cupomOk || b === base) return cupomOk
    const r = await cupomDaOpcao({ codigo: input.cupomCodigo, valor: b, portalId: input.portalId, cpf: input.cpf, cob: input.cob })
    return r && !('valido' in r) ? r : null
  }

  const pix = precoPorMeio({ valor: baseDaForma(plano, opcao, 'pix'), meio: 'pix', descontoAVistaPct: formas.pix.descontoPct, cupom: await cupomNa('pix') })
  const boletoAVista = precoPorMeio({ valor: baseDaForma(plano, opcao, 'boleto'), meio: 'boleto', descontoAVistaPct: formas.boleto.descontoPct, cupom: await cupomNa('boleto'), aVistaNoMeio: true })
  const semDescontoCartao = precoPorMeio({ valor: baseDaForma(plano, opcao, 'cartao'), meio: 'credit_card', descontoAVistaPct: 0, cupom: await cupomNa('cartao') })
  const semDescontoBoleto = precoPorMeio({ valor: baseDaForma(plano, opcao, 'boletoParcelado'), meio: 'boleto', descontoAVistaPct: 0, cupom: await cupomNa('boletoParcelado') })
  const teto = cupomOk?.maxParcelas ?? 99

  const boletos: PlanoDeBoleto[] = [
    ...(formas.boleto.ativo ? [planoDeBoleto(boletoAVista.valor, { ativo: true, parcelado: false, parcelasMax: 1, diaVencimento: plano.diaVencimento, jurosMesPct: 0, taxaPorParcela: 0 }, 1)] : []),
    ...opcoesDoBoletoParcelado(semDescontoBoleto.valor, formas.boletoParcelado, plano.diaVencimento).filter((o) => o.parcelas <= teto),
  ]
  const cartao = input.cartaoDisponivel ? opcoesDoCartao(semDescontoCartao.valor, formas.cartao).filter((o) => o.parcelas <= teto) : []
  // Topo da tela: o menor preço da opção (com preço por forma, o total do
  // plano pode não ser o que a pessoa paga em nenhuma delas).
  const referencia = opcao === 'integral' ? menorPrecoDaOpcao(plano, opcao) : base
  const valor = cupomOk && !cupomOk.metodos ? cupomOk.valorComCupom : referencia

  return {
    escopo: 'curso' as const,
    rotulo: rotuloDaOpcao(plano, opcao),
    valor,
    valorTabela: referencia,
    planos: planos.map((p) => ({
      id: p.id,
      nome: p.nome,
      resumo: resumoDoPlano(p),
      opcoes: opcoesDoPlano(p).map((o) => ({ chave: o, valor: o === 'integral' ? menorPrecoDaOpcao(p, o) : valorDaOpcao(p, o), ...descreverOpcao(p, o) })),
    })),
    escolha: { planoId: plano.id, opcao },
    cupom: cupom
      ? ('valido' in cupom
          ? { aplicado: false, motivo: cupom.motivo }
          : {
              aplicado: true, code: cupom.code, descricao: cupom.descricao,
              desconto: Math.round((cupom.valorCheio - cupom.valorComCupom) * 100) / 100,
              origem: cupom.origem, metodos: cupom.metodos, maxParcelas: cupom.maxParcelas, acumulaAVista: cupom.acumulaAVista,
            })
      : null,
    meios: {
      pix: formas.pix.ativo
        ? { ativo: true, valor: pix.valor, descontoPct: pix.descontoAVista > 0 ? formas.pix.descontoPct : 0, expiraHoras: input.pixExpiraHoras }
        : { ativo: false },
      boleto: boletos.length
        ? {
            ativo: true,
            parcelado: formas.boletoParcelado.ativo,
            parcelasMax: Math.max(...boletos.map((b) => b.parcelas)),
            descontoPct: boletoAVista.descontoAVista > 0 ? formas.boleto.descontoPct : 0,
            opcoes: boletos.map((p) => ({
              parcelas: p.parcelas, valorEntrada: p.valorEntrada, valorParcela: p.valorParcela, valorTotal: p.valorTotal,
              acrescimo: p.acrescimo, semAcrescimo: p.semAcrescimo, descricao: p.descricao,
            })),
          }
        : { ativo: false },
      cartao: cartao.length
        ? { ativo: true, hospedado: false, opcoes: cartao, ...(input.tokenizacao ? { tokenizacao: input.tokenizacao } : {}) }
        : { ativo: false },
    },
  }
}

/**
 * A conta da cobrança pelo plano — mesmo contrato de montarCobrancaDoCheckout
 * (rotas/enrollmentPortals): quanto cobrar agora, em quantas vezes no cartão e
 * o que gravar em paymentPlan.
 */
export async function contaPeloPlano(input: {
  cob: CobrancaDoPortal
  escolha: Escolha
  method: Meio
  body: any
  portalId: number
  cpf: string | undefined
  parcelamosNos: boolean
}): Promise<{ erro: string } | {
  valorCobrado: number
  parcelasCartao: number
  plano: PlanoDeBoleto | null
  paymentPlan: (extra?: Record<string, unknown>) => Record<string, unknown>
}> {
  const { plano, opcao } = input.escolha
  const { method } = input
  const formas = formasDaOpcao(plano, opcao)
  const base = valorDaOpcao(plano, opcao)
  const vezes = Math.max(1, Math.round(Number(input.body?.parcelas ?? 1)) || 1)

  // Só o que a instituição liberou nesta opção.
  if (method === 'pix' && !formas.pix.ativo) return { erro: 'Pix não está disponível nesta opção de pagamento.' }
  if (method === 'boleto' && vezes === 1 && !formas.boleto.ativo) return { erro: 'Boleto à vista não está disponível nesta opção de pagamento.' }
  if (method === 'boleto' && vezes > 1 && (!formas.boletoParcelado.ativo || vezes > formas.boletoParcelado.parcelasMax)) {
    return { erro: `Boleto em ${vezes}x não está disponível nesta opção de pagamento.` }
  }
  if (method === 'credit_card' && (!formas.cartao.ativo || vezes > formas.cartao.parcelasMax)) {
    return { erro: vezes > 1 ? `Cartão em ${vezes}x não está disponível nesta opção de pagamento.` : 'Cartão não está disponível nesta opção de pagamento.' }
  }

  // Preço de referência da forma escolhida (o próprio dela, ou o do plano).
  const forma: keyof FormasDePagamento = method === 'pix' ? 'pix'
    : method === 'credit_card' ? 'cartao'
      : vezes > 1 ? 'boletoParcelado' : 'boleto'
  const baseForma = baseDaForma(plano, opcao, forma)
  const cupom = input.body?.cupom
    ? await cupomDaOpcao({ codigo: String(input.body.cupom), valor: baseForma, portalId: input.portalId, cpf: input.cpf, cob: input.cob, metodo: method })
    : null
  if (cupom && 'valido' in cupom) return { erro: cupom.motivo }
  if (cupom?.maxParcelas && vezes > cupom.maxParcelas) return { erro: `Com este cupom, o limite é ${cupom.maxParcelas}x.` }

  const aVista = (method === 'pix' || (method === 'boleto' && vezes === 1))
  const descontoPct = method === 'pix' ? formas.pix.descontoPct : method === 'boleto' && vezes === 1 ? formas.boleto.descontoPct : 0
  const preco = precoPorMeio({ valor: baseForma, meio: method, descontoAVistaPct: aVista ? descontoPct : 0, cupom: cupom ?? null, aVistaNoMeio: aVista })
  const cupomAplicado = preco.cupomAplicado ? cupom : null

  let valorCobrado = preco.valor
  let parcelasCartao = 1
  let valorTotal = preco.valor
  let valorParcela = preco.valor
  let acrescimo = 0
  let boleto: PlanoDeBoleto | null = null

  if (method === 'credit_card') {
    const o = opcoesDoCartao(preco.valor, formas.cartao).find((x) => x.parcelas === vezes)
    if (!o) return { erro: 'Parcelamento indisponível.' }
    parcelasCartao = input.parcelamosNos ? vezes : 1
    valorCobrado = o.valorTotal
    valorTotal = o.valorTotal
    valorParcela = o.valorParcela
    acrescimo = o.acrescimo
  } else if (method === 'boleto' && vezes > 1) {
    boleto = opcoesDoBoletoParcelado(preco.valor, formas.boletoParcelado, plano.diaVencimento).find((x) => x.parcelas === vezes) ?? null
    if (!boleto) return { erro: 'Parcelamento indisponível.' }
    valorCobrado = boleto.valorEntrada
    valorTotal = boleto.valorTotal
    valorParcela = boleto.valorParcela
    acrescimo = boleto.acrescimo
  }

  const paymentPlan = (extra: Record<string, unknown> = {}) => ({
    meio: method,
    parcelas: boleto?.parcelas ?? (method === 'credit_card' ? vezes : 1),
    valorCobrado,
    valorTabela: baseForma,
    acrescimo,
    ...(preco.descontoAVista > 0 ? { descontoAVista: preco.descontoAVista } : {}),
    ...(cupomAplicado ? {
      cupom: cupomAplicado.code,
      valorCheio: cupomAplicado.valorCheio,
      descontoCupom: Math.round((cupomAplicado.valorCheio - cupomAplicado.valorComCupom) * 100) / 100,
      descontoOrigem: preco.descontoAVista > 0 ? 'cupom+a_vista' : 'cupom',
    } : {}),
    valorParcela,
    valorTotal,
    escopo: 'curso',
    rotulo: rotuloDaOpcao(plano, opcao),
    // É por aqui que a efetivação monta o contrato (acaFinanceiro) e o SEI
    // escolhe a condição de pagamento (seiIntegracao).
    planoFinanceiro: escolhaParaGravar(plano, opcao, !!boleto),
    ...extra,
  })

  return { valorCobrado, parcelasCartao, plano: boleto, paymentPlan }
}
