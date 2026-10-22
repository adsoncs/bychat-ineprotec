// tests/plano-pontualidade.test.ts
//
// Desconto de pontualidade do plano de pagamento: "pagando até o vencimento"
// e a parcela com desconto arredondada para terminar em ,90 (tabela da
// ineprotec de 22/10/2026: boleto 12x de R$ 274,90 → R$ 219,90 em dia).
//
// Erro aqui aparece na fatura do aluno: desconto que some antes do vencimento,
// centavos a mais ou a menos, ou desconto em fatura já vencida.
//
// NÃO toca o banco: só as funções puras de planoFinanceiro.
//
//   cd backend && node --import tsx --test tests/plano-pontualidade.test.ts

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { lerRegrasDoPlano, pontualidadeDaFatura, valorEmDia } from '../src/services/planoFinanceiro.js'

const TABELA = { ativo: true, descontoPct: 20, diaLimite: 5, ateVencimento: true, terminaEm90: true }
const VENC = new Date(2026, 10, 10)

describe('valorEmDia — 20% arredondado para terminar em ,90', () => {
  for (const [curso, cheia, emDia] of [['Agrimensura', 274.9, 219.9], ['Eletrotécnica', 216.9, 173.9], ['Administração', 180.9, 144.9]] as const) {
    test(`${curso}: ${cheia} → ${emDia}`, () => assert.equal(valorEmDia(cheia, TABELA), emDia))
  }
  test('sem arredondar, é o percentual puro', () => assert.equal(valorEmDia(274.9, { ...TABELA, terminaEm90: false }), 219.92))
  test('pontualidade desligada não mexe no valor', () => assert.equal(valorEmDia(274.9, { ...TABELA, ativo: false }), 274.9))
  test('nunca passa do valor cheio', () => assert.ok(valorEmDia(0.95, TABELA) <= 0.95))
})

describe('pontualidadeDaFatura — até o vencimento', () => {
  const regras = lerRegrasDoPlano({ pontualidade: TABELA })!
  test('fatura em aberto: vale até o próprio vencimento, desconto em reais', () => {
    const r = pontualidadeDaFatura(regras, VENC, new Date(2026, 9, 22), 274.9)
    assert.equal(r?.dias, 0)
    assert.equal(r?.fixo, 55)
  })
  test('gerada no dia do vencimento: ainda vale', () => assert.ok(pontualidadeDaFatura(regras, VENC, new Date(2026, 10, 10), 274.9)))
  test('vencida: sem desconto', () => assert.equal(pontualidadeDaFatura(regras, VENC, new Date(2026, 10, 11), 274.9), null))
})

describe('pontualidadeDaFatura — regra antiga (dia-limite, %) continua igual', () => {
  const regras = lerRegrasDoPlano({ pontualidade: { ativo: true, descontoPct: 10, diaLimite: 5 } })!
  test('5 dias antes do vencimento, em %, sem valor fixo', () => {
    const r = pontualidadeDaFatura(regras, VENC, new Date(2026, 9, 22), 274.9)
    assert.equal(r?.dias, 5)
    assert.equal(r?.pct, 10)
    assert.equal(r?.fixo, undefined)
  })
  test('regras gravadas antes não ganham as opções novas', () => {
    assert.equal(regras.pontualidade.ateVencimento, false)
    assert.equal(regras.pontualidade.terminaEm90, false)
  })
})
