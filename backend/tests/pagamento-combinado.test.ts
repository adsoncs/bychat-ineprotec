// tests/pagamento-combinado.test.ts
//
// Regras do pagamento combinado e a conta do acordo. Não toca o banco nem o gateway.
//
//   cd backend && node --import tsx --test tests/pagamento-combinado.test.ts

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { descreverCombinado, situacaoDoParcelamento, situacaoDoTitulo, validarCombinado } from '../src/services/pagamentoCombinado.js'
import { avisosDeCriacaoLigados } from '../src/services/paymentAsaas.js'
import { prazoDaTroca, tituloElegivel } from '../src/services/trocaPagamento.js'
import { calcularAcordo, parcelasEmAbertoDoBoleto } from '../src/services/inadimplencia.js'

const HOJE = '2026-11-06'
const base = { total: 2000, motivo: 'negociado', linhas: [{ meio: 'boleto', valor: 1000, vencimento: HOJE }, { meio: 'credit_card', valor: 1000, vencimento: '2026-12-06', parcelas: 5 }] }
const erro = (o: object) => (validarCombinado({ ...base, ...o }, HOJE) as any).erro

describe('validarCombinado', () => {
  test('boleto hoje + cartão no mês seguinte', () => {
    const v: any = validarCombinado(base, HOJE)
    assert.equal(v.erro, undefined); assert.equal(v.totalCentavos, 200000); assert.equal(v.linhas[1].parcelasCartao, 5)
  })
  test('três formas', () => assert.equal(erro({ total: 900, linhas: [{ meio: 'pix', valor: 300, vencimento: HOJE }, { meio: 'boleto', valor: 300, vencimento: '2026-12-06' }, { meio: 'credit_card', valor: 300, vencimento: '2027-01-06' }] }), undefined))
  test('soma precisa fechar', () => assert.match(erro({ total: 1999 }), /fechar/))
  test('centavos fecham sem erro de arredondamento', () => assert.equal(erro({ total: 100.3, linhas: [{ meio: 'pix', valor: 50.1, vencimento: HOJE }, { meio: 'pix', valor: 50.2, vencimento: HOJE }] }), undefined))
  test('mínimo de 2 e máximo de 6', () => {
    assert.ok(erro({ linhas: [base.linhas[0]] }))
    assert.ok(erro({ total: 70, linhas: Array.from({ length: 7 }, () => ({ meio: 'pix', valor: 10, vencimento: HOJE })) }))
  })
  test('valor mínimo', () => assert.match(erro({ total: 8, linhas: [{ meio: 'pix', valor: 4, vencimento: HOJE }, { meio: 'pix', valor: 4, vencimento: HOJE }] }), /mínimo/))
  test('1º pagamento é o mais próximo', () => assert.match(erro({ linhas: [{ meio: 'pix', valor: 1000, vencimento: '2026-12-06' }, { meio: 'pix', valor: 1000, vencimento: HOJE }] }), /mais próxima/))
  test('pontualidade é escolha do agente', () => {
    assert.equal((validarCombinado(base, HOJE) as any).descontoPct, null)
    assert.equal((validarCombinado({ ...base, pontualidade: { ativo: true, pct: 10 } }, HOJE) as any).descontoPct, 10)
    assert.equal((validarCombinado({ ...base, pontualidade: { ativo: false, pct: 10 } }, HOJE) as any).descontoPct, null)
  })
})

test('descrição para o contrato', () => {
  const d = descreverCombinado([{ meio: 'pix', valorCentavos: 50000, vencimento: HOJE, parcelasCartao: 1 }, { meio: 'credit_card', valorCentavos: 150000, vencimento: '2026-12-06', parcelasCartao: 5 }], 200000)
  assert.match(d, /Pix: R\$\s500,00 em 06\/11\/2026/); assert.match(d, /Cartão em 5x/)
})

test('situação do título', () => {
  assert.equal(situacaoDoTitulo({ status: 'aberta', vencimento: '2026-11-05' }, HOJE), 'vencida')
  assert.equal(situacaoDoTitulo({ status: 'aberta', vencimento: HOJE }, HOJE), 'aberta')
  assert.equal(situacaoDoTitulo({ status: 'renegociada', vencimento: '2026-11-05' }, HOJE), 'cancelada')
})

describe('calcularAcordo', () => {
  const c = (o: object): any => calcularAcordo({ original: 100000, encargos: 5000, desconto: 0, entrada: 0, numParcelas: 3, ...o })
  test('os centavos que sobram vão na última', () => {
    const r = c({ original: 100000, encargos: 0 })
    assert.deepEqual(r.parcelas, [33333, 33333, 33334])
  })
  test('entrada + parcelas fecham com o total', () => {
    const r = c({ desconto: 10000, entrada: 20000 })
    assert.equal(r.total, 95000); assert.equal(r.entrada + r.parcelas.reduce((a: number, x: number) => a + x, 0), 95000)
  })
  test('recusa o que não fecha', () => {
    assert.ok(c({ desconto: 105000 }).erro); assert.ok(c({ entrada: 105000 }).erro); assert.ok(c({ numParcelas: 0 }).erro); assert.ok(c({ numParcelas: 49 }).erro); assert.ok(c({ entrada: 100 }).erro)
  })
})

describe('parcelasEmAbertoDoBoleto', () => {
  const pp = { meio: 'boleto', parcelas: 4, valorParcela: 100, parcelasPortal: { 2: { id: 'a', vencimento: '2026-10-10', valor: 100, situacao: 'paga' }, 3: { id: 'b', vencimento: '2026-11-01', valor: 90, situacao: 'aberta' } } }
  test('tira a paga e usa valor e data da gerada', () => {
    const r = parcelasEmAbertoDoBoleto(pp, new Date('2026-09-01T12:00:00Z'), 10)
    assert.deepEqual(r.map((x) => x.numero), [3, 4])
    assert.equal(r[0]!.vencimento, '2026-11-01'); assert.equal(r[0]!.valorCentavos, 9000); assert.equal(r[1]!.vencimento, '2026-12-10')
  })
  test('renegociada não conta', () => assert.deepEqual(parcelasEmAbertoDoBoleto({ ...pp, parcelasPortal: { ...pp.parcelasPortal, 3: { situacao: 'renegociada' }, 4: { situacao: 'renegociada' } } }, new Date(), 10), []))
  test('cancelada volta a prevista', () => assert.equal(parcelasEmAbertoDoBoleto({ ...pp, parcelasPortal: { 2: { id: 'x', situacao: 'cancelada', vencimento: '2020-01-01' } } }, new Date('2026-09-01T12:00:00Z'), 10)[0]!.vencimento, '2026-10-10'))
})

describe('parcelamento do cartão', () => {
  test('uma parcela paga não fecha o título', () => {
    assert.deepEqual(situacaoDoParcelamento([{ status: 'CONFIRMED', value: 10 }, { status: 'PENDING', value: 10 }]), { quitado: false, pagoCentavos: 1000 })
  })
  test('todas pagas fecham', () => {
    assert.deepEqual(situacaoDoParcelamento([{ status: 'CONFIRMED', value: 10 }, { status: 'RECEIVED', value: 10 }]), { quitado: true, pagoCentavos: 2000 })
  })
  test('parcela excluída não conta', () => {
    assert.equal(situacaoDoParcelamento([{ status: 'CONFIRMED', value: 10 }, { status: 'PENDING', value: 10, deleted: true }]).quitado, true)
  })
  test('lista vazia não fecha', () => assert.equal(situacaoDoParcelamento([]).quitado, false))
})

describe('avisos do Asaas', () => {
  const lista = [
    { id: 'a', event: 'PAYMENT_CREATED', emailEnabledForCustomer: true, smsEnabledForCustomer: true },
    { id: 'b', event: 'PAYMENT_UPDATED', emailEnabledForCustomer: false, smsEnabledForCustomer: true },
    { id: 'c', event: 'PAYMENT_DUEDATE_WARNING', emailEnabledForCustomer: true, smsEnabledForCustomer: true },
    { id: 'd', event: 'PAYMENT_OVERDUE', emailEnabledForCustomer: true, smsEnabledForCustomer: true },
    { id: 'e', event: 'PAYMENT_CREATED', emailEnabledForCustomer: false, smsEnabledForCustomer: false },
  ]
  test('só criação e alteração ainda ligadas', () => assert.deepEqual(avisosDeCriacaoLigados(lista), ['a', 'b']))
})

describe('boleto parcelado na combinação', () => {
  const parc = (o: object = {}): any => validarCombinado({ total: 1000, motivo: 'abc', linhas: [{ meio: 'pix', valor: 100, vencimento: HOJE }, { meio: 'boleto', valor: 900, vencimento: '2027-01-31', parcelas: 3 }, ...[]], ...o }, HOJE)
  test('vira um título por parcela', () => {
    const v = parc()
    assert.equal(v.titulos.length, 4)
    assert.deepEqual(v.titulos.slice(1).map((t: any) => [t.parcelaDoGrupo, t.totalDoGrupo, t.valorCentavos]), [[1, 3, 30000], [2, 3, 30000], [3, 3, 30000]])
  })
  test('mês curto usa o último dia', () => assert.deepEqual(parc().titulos.slice(1).map((t: any) => t.vencimento), ['2027-01-31', '2027-02-28', '2027-03-31']))
  test('centavos vão na última e o total fecha', () => {
    const v = parc({ total: 1100, linhas: [{ meio: 'pix', valor: 100, vencimento: HOJE }, { meio: 'boleto', valor: 1000, vencimento: '2026-12-10', parcelas: 3 }] })
    assert.deepEqual(v.titulos.slice(1).map((t: any) => t.valorCentavos), [33333, 33333, 33334])
    assert.equal(v.titulos.reduce((s: number, t: any) => s + t.valorCentavos, 0), 110000)
  })
  test('à vista continua um título só', () => assert.equal(parc({ linhas: [{ meio: 'pix', valor: 100, vencimento: HOJE }, { meio: 'boleto', valor: 900, vencimento: '2026-12-10' }] }).titulos[1].totalDoGrupo, null))
  test('limites', () => {
    assert.match(parc({ linhas: [{ meio: 'pix', valor: 100, vencimento: HOJE }, { meio: 'boleto', valor: 900, vencimento: '2026-12-10', parcelas: 25 }] }).erro, /1 a 24/)
    assert.match(parc({ total: 110, linhas: [{ meio: 'pix', valor: 100, vencimento: HOJE }, { meio: 'boleto', valor: 10, vencimento: '2026-12-10', parcelas: 3 }] }).erro, /pelo menos/)
  })
  test('contrato descreve o parcelado', () => assert.match(descreverCombinado([{ meio: 'boleto', valorCentavos: 90000, vencimento: '2026-12-10', parcelasCartao: 1, parcelasBoleto: 3 }], 90000), /Boleto em 3x de R\$\s300,00, total de R\$\s900,00, a partir de 10\/12\/2026/))
})

describe('prazo da troca para cartão', () => {
  test('7 dias quando o próximo vencimento está longe', () => assert.equal(prazoDaTroca(['2026-12-06'], HOJE), '2026-11-13'))
  test('véspera quando o vencimento vem antes', () => assert.equal(prazoDaTroca(['2026-11-10', '2026-12-10'], HOJE), '2026-11-09'))
  test('vencimento amanhã: só hoje', () => assert.equal(prazoDaTroca(['2026-11-07'], HOJE), HOJE))
  test('vencimento hoje: só hoje', () => assert.equal(prazoDaTroca([HOJE], HOJE), HOJE))
  test('já vencidos não limitam', () => assert.equal(prazoDaTroca(['2026-10-01'], HOJE), '2026-11-13'))
  test('sem elegibilidade em pago ou parcial', () => {
    assert.equal(tituloElegivel({ status: 'paga', valorPagoCentavos: 100 }), false)
    assert.equal(tituloElegivel({ status: 'aberta', valorPagoCentavos: 100 }), false)
    assert.equal(tituloElegivel({ status: 'aberta', valorPagoCentavos: 0 }), true)
    assert.equal(tituloElegivel({ status: 'aguardando', valorPagoCentavos: 0 }), false)
  })
  test('uma linha só é aceita na troca', () => assert.equal((validarCombinado({ total: 100, motivo: 'abc', linhas: [{ meio: 'credit_card', valor: 100, vencimento: HOJE, parcelas: 5 }] }, HOJE, { minLinhas: 1 }) as any).erro, undefined))
})
