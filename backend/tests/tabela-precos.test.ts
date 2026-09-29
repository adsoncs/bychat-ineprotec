// tests/tabela-precos.test.ts
//
// Tabela de preços da oferta por meio de pagamento — a do site da instituição.
//
// O que se prova aqui é a promessa inteira, da tela ao ERP: o candidato vê o
// preço do site em cada meio, é cobrado por ele, e o contrato nasce com a
// mesma condição (quitado no à vista e no cartão; N parcelas no boleto).
//
// NÃO toca o banco: exercita as funções puras com os números reais do site do
// ineprotec (Técnico em Agrimensura e Administração, Ajustador Mecânico).
//
//   cd backend && node --import tsx --test --test-force-exit tests/tabela-precos.test.ts

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  lerTabelaDePrecos, regrasComTabela, valorBaseDoMeio, totalDoCartao, totalDoBoletoParcelado,
} from '../src/services/tabelaDePrecos.js'
import { lerRegras, tabelaDeParcelas, planoDeBoleto } from '../src/services/portalPagamento.js'
import { precoPorMeio } from '../src/services/portalCupom.js'
import { parcelasDaTabela, aplicarPagamentoDoCheckout, type EscolhaDoCheckout } from '../src/services/acaFinanceiro.js'

const AGRIMENSURA = { aVista: 2508, cartao: { parcelas: 12, valorParcela: 229.9 }, boleto: { parcelas: 12, valorParcela: 249.9 } }
const ADMINISTRACAO = { aVista: 1849.9, cartao: { parcelas: 12, valorParcela: 169.9 }, boleto: { parcelas: 12, valorParcela: 184.99 } }
const AJUSTADOR = { aVista: 1530, cartao: { parcelas: 6, valorParcela: 255 }, boleto: null }

// Portal como o ineprotec está hoje: tudo 1x, sem desconto, cartão com piso.
const PORTAL = lerRegras({
  pix: { ativo: true, descontoPct: 0 },
  boleto: { ativo: true, parcelado: false, parcelasMax: 1 },
  cartao: { ativo: true, parcelasMax: 1, semJurosAte: 1, jurosMesPct: 0, parcelaMinima: 5 },
})

describe('leitura da tabela', () => {
  test('sem preço à vista não há tabela — vale o comportamento antigo', () => {
    assert.equal(lerTabelaDePrecos(null), null)
    assert.equal(lerTabelaDePrecos({ cartao: { parcelas: 12, valorParcela: 100 } }), null)
    assert.equal(lerTabelaDePrecos({ aVista: 0 }), null)
  })

  test('condição inválida some, o resto fica', () => {
    const t = lerTabelaDePrecos({ aVista: 100, cartao: { parcelas: 30, valorParcela: 10 }, boleto: { parcelas: 0, valorParcela: 5 } })
    assert.deepEqual(t, { aVista: 100, cartao: null, boleto: null })
  })

  test('arredonda em centavos', () => {
    const t = lerTabelaDePrecos({ aVista: '1849.899', cartao: { parcelas: '12', valorParcela: 169.901 } })
    assert.equal(t?.aVista, 1849.9)
    assert.deepEqual(t?.cartao, { parcelas: 12, valorParcela: 169.9 })
  })
})

describe('checkout: cada meio com o preço do site', () => {
  const t = lerTabelaDePrecos(AGRIMENSURA)!
  const regras = regrasComTabela(PORTAL, t)

  test('Pix = à vista, sem o desconto percentual do portal por cima', () => {
    const comDesconto = regrasComTabela(lerRegras({ pix: { descontoPct: 10 } }), t)
    const pix = precoPorMeio({ valor: valorBaseDoMeio(t, 'pix'), meio: 'pix', descontoAVistaPct: comDesconto.pix.descontoPct, cupom: null })
    assert.equal(pix.valor, 2508)
  })

  test('cartão: 12x R$ 229,90 sem juros, mesmo com o portal em 1x', () => {
    const opcoes = tabelaDeParcelas(valorBaseDoMeio(t, 'credit_card'), regras.cartao)
    assert.equal(opcoes.length, 12)
    const doze = opcoes[11]
    assert.equal(doze.parcelas, 12)
    assert.equal(doze.valorParcela, 229.9)
    assert.equal(doze.valorTotal, 2758.8)
    assert.ok(opcoes.every((o) => o.semJuros && o.valorTotal === 2758.8))
  })

  test('boleto: à vista R$ 2.508,00 ou 12x R$ 249,90', () => {
    assert.equal(regras.boleto.parcelado, true)
    assert.equal(regras.boleto.parcelasMax, 12)
    const aVista = planoDeBoleto(valorBaseDoMeio(t, 'boleto', 1), regras.boleto, 1)
    assert.equal(aVista.valorEntrada, 2508)
    const doze = planoDeBoleto(valorBaseDoMeio(t, 'boleto', 12), regras.boleto, 12)
    assert.equal(doze.valorEntrada, 249.9)
    assert.equal(doze.valorParcela, 249.9)
    assert.equal(doze.valorTotal, 2998.8)
  })

  test('parcela que não fecha em centavos: a entrada absorve a sobra', () => {
    const adm = lerTabelaDePrecos(ADMINISTRACAO)!
    const doze = planoDeBoleto(valorBaseDoMeio(adm, 'boleto', 12), regrasComTabela(PORTAL, adm).boleto, 12)
    assert.equal(doze.valorParcela, 184.99)
    assert.equal(Math.round((doze.valorEntrada + doze.valorParcela * 11) * 100), Math.round(184.99 * 12 * 100))
  })

  test('sem boleto parcelado na tabela, o boleto é só à vista', () => {
    const aj = lerTabelaDePrecos(AJUSTADOR)!
    const r = regrasComTabela(PORTAL, aj)
    assert.equal(r.boleto.parcelado, false)
    assert.equal(totalDoBoletoParcelado(aj), null)
    // Profissionalizante: o à vista é o próprio total do cartão.
    assert.equal(totalDoCartao(aj), 1530)
    const seis = tabelaDeParcelas(totalDoCartao(aj), r.cartao)[5]
    assert.equal(seis.valorParcela, 255)
  })
})

describe('ERP: o contrato nasce com a condição paga', () => {
  const PAGO_EM = new Date('2026-09-29T12:00:00Z')
  const escolha = (tabela: NonNullable<EscolhaDoCheckout['tabela']>, pago: number, meio: EscolhaDoCheckout['meio']): EscolhaDoCheckout => ({
    escopo: 'curso', meio, parcelas: tabela.parcelas, valorPagoCentavos: pago, pagoEm: PAGO_EM, tabela,
  })

  test('Pix à vista: uma parcela, quitada — nada de saldo em aberto', () => {
    const tab = { condicao: 'a_vista' as const, parcelas: 1, valorParcelaCentavos: 250800, valorTotalCentavos: 250800 }
    const p: any[] = parcelasDaTabela(tab, 10)
    assert.equal(p.length, 1)
    assert.equal(p[0].valorBrutoCentavos, 250800)
    assert.equal(aplicarPagamentoDoCheckout(p, escolha(tab, 250800, 'pix')), 1)
    assert.equal(p[0].situacao, 'PAGA')
  })

  test('cartão 12x: o total entrou, contrato quitado', () => {
    const tab = { condicao: 'cartao' as const, parcelas: 12, valorParcelaCentavos: 22990, valorTotalCentavos: 275880 }
    const p: any[] = parcelasDaTabela(tab, 10)
    assert.equal(p.length, 1)
    assert.equal(aplicarPagamentoDoCheckout(p, escolha(tab, 275880, 'credit_card')), 1)
  })

  test('boleto 12x: 12 parcelas de R$ 249,90, só a primeira paga', () => {
    const tab = { condicao: 'boleto_parcelado' as const, parcelas: 12, valorParcelaCentavos: 24990, valorTotalCentavos: 299880 }
    const p: any[] = parcelasDaTabela(tab, 10)
    assert.equal(p.length, 12)
    assert.ok(p.every((x) => x.valorBrutoCentavos === 24990))
    assert.equal(p.reduce((s, x) => s + x.valorBrutoCentavos, 0), 299880)
    assert.equal(aplicarPagamentoDoCheckout(p, escolha(tab, 24990, 'boleto')), 1)
    assert.equal(p.filter((x) => x.situacao === 'PAGA').length, 1)
  })

  test('boleto com sobra de centavos: a primeira leva a sobra e a soma fecha', () => {
    const tab = { condicao: 'boleto_parcelado' as const, parcelas: 3, valorParcelaCentavos: 3333, valorTotalCentavos: 10000 }
    const p = parcelasDaTabela(tab, 10)
    assert.deepEqual(p.map((x) => x.valorBrutoCentavos), [3334, 3333, 3333])
  })
})
