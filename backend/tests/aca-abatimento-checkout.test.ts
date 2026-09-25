// tests/aca-abatimento-checkout.test.ts
//
// Abatimento do que já foi pago no checkout sobre as parcelas do contrato.
//
// É a regra que decide se um aluno vai receber cobrança de algo que já pagou —
// ou deixar de ser cobrado do que ainda deve. Erro aqui não quebra tela nenhuma:
// aparece meses depois, na inadimplência ou na reclamação de cobrança dupla.
//
// NÃO toca o banco: exercita a função pura de abatimento com as formas de
// parcela que o gerador monta.
//
//   cd backend && npm run test:abatimento

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { aplicarPagamentoDoCheckout, type EscolhaDoCheckout } from '../src/services/acaFinanceiro.js'

const PAGO_EM = new Date('2026-09-09T12:00:00Z')

/** Contrato típico: taxa de matrícula + N mensalidades, em centavos. */
function parcelasDe(taxa: number, mensalidade: number, quantas: number) {
  const p: any[] = []
  let nro = 1
  if (taxa > 0) p.push({ nroParcela: nro++, tipo: 'MATRICULA', valorBrutoCentavos: taxa })
  for (let i = 0; i < quantas; i++) {
    p.push({ nroParcela: nro++, tipo: 'MENSALIDADE', valorBrutoCentavos: mensalidade })
  }
  return p
}

const escolha = (over: Partial<EscolhaDoCheckout> = {}): EscolhaDoCheckout => ({
  escopo: 'curso',
  meio: 'credit_card',
  parcelas: 1,
  valorPagoCentavos: 0,
  pagoEm: PAGO_EM,
  ...over,
})

describe('sem checkout de curso, nada muda', () => {
  test('escolha nula deixa tudo em aberto', () => {
    const p = parcelasDe(20000, 74990, 12)
    assert.equal(aplicarPagamentoDoCheckout(p, null), 0)
    assert.ok(p.every((x) => x.situacao === undefined))
  })
})

describe('cartão: pagou o curso inteiro', () => {
  test('contrato nasce quitado — ninguém é cobrado do que já pagou', () => {
    const p = parcelasDe(0, 74990, 12)
    const total = 74990 * 12
    const quitadas = aplicarPagamentoDoCheckout(p, escolha({ valorPagoCentavos: total, parcelas: 10 }))
    assert.equal(quitadas, 12)
    assert.ok(p.every((x) => x.situacao === 'PAGA'))
    assert.ok(p.every((x) => x.valorPagoCentavos === 74990))
    assert.ok(p.every((x) => x.pagoEm === PAGO_EM))
  })

  test('juros do cartão não abatem mensalidade a mais', () => {
    // 12x com juros: o aluno paga mais ao banco, mas a instituição recebe o
    // preço do curso. O acréscimo não pode virar crédito no contrato.
    const p = parcelasDe(0, 100000, 6)
    const precoDoCurso = 100000 * 6
    const comJuros = Math.round(precoDoCurso * 1.13)
    const quitadas = aplicarPagamentoDoCheckout(p, escolha({ valorPagoCentavos: comJuros }))
    assert.equal(quitadas, 6, 'seis mensalidades, nem uma a mais')
    assert.equal(p.length, 6)
  })
})

describe('boleto parcelado: só a entrada foi paga', () => {
  test('primeira quitada, demais em aberto', () => {
    const p = parcelasDe(0, 50000, 12)
    const quitadas = aplicarPagamentoDoCheckout(p, escolha({ meio: 'boleto', parcelas: 12, valorPagoCentavos: 50000 }))
    assert.equal(quitadas, 1)
    assert.equal(p[0].situacao, 'PAGA')
    assert.ok(p.slice(1).every((x) => x.situacao === undefined), 'as onze seguintes continuam a cobrar')
  })

  test('a taxa de matrícula é abatida antes das mensalidades', () => {
    // Ela é a primeira da lista e vence primeiro: o dinheiro anda na ordem em
    // que se paga, não na ordem em que dá jeito.
    const p = parcelasDe(20000, 50000, 12)
    const quitadas = aplicarPagamentoDoCheckout(p, escolha({ meio: 'boleto', valorPagoCentavos: 20000 }))
    assert.equal(quitadas, 1)
    assert.equal(p[0].tipo, 'MATRICULA')
    assert.equal(p[0].situacao, 'PAGA')
    assert.equal(p[1].situacao, undefined)
  })
})

describe('pagamento parcial de uma parcela', () => {
  test('não quita, mas registra o que entrou', () => {
    // Cobrar o valor cheio de novo seria erro; dar por paga seria prejuízo.
    const p = parcelasDe(0, 50000, 3)
    const quitadas = aplicarPagamentoDoCheckout(p, escolha({ valorPagoCentavos: 70000 }))
    assert.equal(quitadas, 1)
    assert.equal(p[0].situacao, 'PAGA')
    assert.equal(p[1].situacao, undefined, 'segue em aberto')
    assert.equal(p[1].valorPagoCentavos, 20000, 'com o que já entrou registrado')
    assert.equal(p[2].valorPagoCentavos, undefined)
  })
})

describe('bordas', () => {
  test('pagou mais que o contrato inteiro não inventa parcela', () => {
    const p = parcelasDe(0, 10000, 2)
    const quitadas = aplicarPagamentoDoCheckout(p, escolha({ valorPagoCentavos: 999999 }))
    assert.equal(quitadas, 2)
    assert.equal(p.length, 2)
  })

  test('valor zero não quita nada', () => {
    const p = parcelasDe(0, 10000, 2)
    assert.equal(aplicarPagamentoDoCheckout(p, escolha({ valorPagoCentavos: 0 })), 0)
    assert.ok(p.every((x) => x.situacao === undefined))
  })

  test('contrato sem parcelas não quebra', () => {
    assert.equal(aplicarPagamentoDoCheckout([], escolha({ valorPagoCentavos: 50000 })), 0)
  })

  test('soma do abatido nunca passa do que foi pago', () => {
    for (const pago of [1, 49999, 50000, 50001, 123456]) {
      const p = parcelasDe(0, 50000, 5)
      aplicarPagamentoDoCheckout(p, escolha({ valorPagoCentavos: pago }))
      const abatido = p.reduce((s, x) => s + (x.valorPagoCentavos ?? 0), 0)
      assert.ok(abatido <= pago, `abateu ${abatido} tendo recebido ${pago}`)
    }
  })
})
