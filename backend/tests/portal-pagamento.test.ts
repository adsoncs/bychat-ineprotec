// tests/portal-pagamento.test.ts
//
// Regras de pagamento do portal: leitura da configuração, tabela de parcelas do
// cartão e divisão do boleto parcelado.
//
// Roda no test runner nativo do Node (node:test) via tsx, como a suíte de
// alertas. NÃO toca o banco: são funções puras — que é justamente por que vale
// testá-las, porque erram em silêncio (um centavo a menos por parcela só
// aparece na conciliação, meses depois).
//
//   cd backend && npm run test:pagamento

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { lerRegras, tabelaDeParcelas, planoDeBoleto, PAGAMENTO_PADRAO } from '../src/services/portalPagamento.js'

describe('leitura da configuração', () => {
  test('portal nunca configurado usa o padrão', () => {
    const r = lerRegras(null)
    assert.deepEqual(r, PAGAMENTO_PADRAO)
  })

  test('o que falta vem do padrão, o que veio é respeitado', () => {
    const r = lerRegras({ cartao: { ativo: true, parcelasMax: 10 } })
    assert.equal(r.cartao.ativo, true)
    assert.equal(r.cartao.parcelasMax, 10)
    assert.equal(r.cartao.semJurosAte, PAGAMENTO_PADRAO.cartao.semJurosAte)
    assert.equal(r.pix.ativo, PAGAMENTO_PADRAO.pix.ativo)
  })

  test('valor fora da faixa é preso no limite, não aceito nem descartado', () => {
    // 30x no cartão seria recusado pelo Asaas (teto 21); 0 parcela não existe.
    assert.equal(lerRegras({ cartao: { parcelasMax: 30 } }).cartao.parcelasMax, 21)
    assert.equal(lerRegras({ boleto: { parcelasMax: 0 } }).boleto.parcelasMax, 1)
    assert.equal(lerRegras({ boleto: { diaVencimento: 31 } }).boleto.diaVencimento, 28)
    assert.equal(lerRegras({ pix: { descontoPct: 99 } }).pix.descontoPct, 50)
  })

  test('lixo no lugar da configuração não derruba o portal', () => {
    assert.deepEqual(lerRegras('nada disso'), PAGAMENTO_PADRAO)
    assert.deepEqual(lerRegras([1, 2, 3]), PAGAMENTO_PADRAO)
    assert.equal(lerRegras({ cartao: { jurosMesPct: 'muito' } }).cartao.jurosMesPct, PAGAMENTO_PADRAO.cartao.jurosMesPct)
  })
})

describe('tabela de parcelas do cartão', () => {
  const regras = { ativo: true, parcelasMax: 12, semJurosAte: 6, jurosMesPct: 1.99, parcelaMinima: 0 }

  test('dentro do sem juros, o candidato paga o valor cheio', () => {
    const t = tabelaDeParcelas(1200, regras)
    for (const o of t.filter((x) => x.parcelas <= 6)) {
      assert.equal(o.valorTotal, 1200, `${o.parcelas}x deveria somar o valor cheio`)
      assert.equal(o.acrescimo, 0)
      assert.equal(o.semJuros, true)
    }
    assert.equal(t.find((o) => o.parcelas === 6)?.valorParcela, 200)
  })

  test('acima do limite, o total cresce e o acréscimo é declarado', () => {
    const t = tabelaDeParcelas(1200, regras)
    const dez = t.find((o) => o.parcelas === 10)!
    assert.equal(dez.semJuros, false)
    assert.ok(dez.valorTotal > 1200, 'com juros o total tem de ser maior')
    assert.equal(dez.acrescimo, Math.round((dez.valorTotal - 1200) * 100) / 100)
    // Price a 1,99% em 10x fica perto de 10% de acréscimo — não é o dobro.
    assert.ok(dez.acrescimo > 100 && dez.acrescimo < 160, `acréscimo fora do esperado: ${dez.acrescimo}`)
  })

  test('juros zerado desliga o acréscimo em qualquer parcela', () => {
    const t = tabelaDeParcelas(1000, { ...regras, jurosMesPct: 0 })
    assert.ok(t.every((o) => o.acrescimo === 0 && o.semJuros))
  })

  test('parcela mínima corta a cauda em vez de oferecer troco', () => {
    const t = tabelaDeParcelas(120, { ...regras, parcelaMinima: 30 })
    assert.ok(t.every((o) => o.parcelas === 1 || o.valorParcela >= 30))
    assert.ok(t.length <= 4, 'R$ 120 com piso de R$ 30 não deveria passar de 4x')
  })

  test('valor zero ou negativo não gera opção', () => {
    assert.equal(tabelaDeParcelas(0, regras).length, 0)
    assert.equal(tabelaDeParcelas(-50, regras).length, 0)
  })

  test('a descrição diz o que a pessoa vai pagar', () => {
    const t = tabelaDeParcelas(600, regras)
    assert.match(t.find((o) => o.parcelas === 1)!.descricao, /à vista/)
    assert.match(t.find((o) => o.parcelas === 3)!.descricao, /3x de R\$\s?200,00 sem juros/)
    assert.match(t.find((o) => o.parcelas === 12)!.descricao, /total/)
  })
})

describe('boleto parcelado', () => {
  const regras = { ativo: true, parcelado: true, parcelasMax: 12, diaVencimento: 10, jurosMesPct: 0, taxaPorParcela: 0 }

  test('entrada mais parcelas somam exatamente o valor', () => {
    for (const valor of [1000, 999.99, 2508, 100.01]) {
      for (const n of [2, 3, 7, 12]) {
        const p = planoDeBoleto(valor, regras, n)
        const soma = Math.round((p.valorEntrada + p.valorParcela * (p.parcelas - 1)) * 100) / 100
        assert.equal(soma, valor, `${valor} em ${n}x somou ${soma}`)
      }
    }
  })

  test('a sobra de centavos fica na entrada, não some', () => {
    // 100,01 em 3x: 33,34 + 33,335… — as parcelas arredondam e a entrada acerta.
    const p = planoDeBoleto(100.01, regras, 3)
    assert.equal(p.valorEntrada + p.valorParcela * 2, 100.01)
  })

  test('gera um vencimento a menos que o número de parcelas', () => {
    const p = planoDeBoleto(1200, regras, 12)
    // A entrada é paga agora: só as 11 seguintes têm vencimento futuro.
    assert.equal(p.vencimentos.length, 11)
    assert.ok(p.vencimentos.every((d) => d.getDate() === 10))
    assert.ok(p.vencimentos[0] < p.vencimentos[10], 'vencimentos em ordem')
  })

  test('pedido acima do máximo é preso no máximo', () => {
    assert.equal(planoDeBoleto(1200, regras, 99).parcelas, 12)
    assert.equal(planoDeBoleto(1200, regras, 0).parcelas, 1)
  })

  test('à vista não gera vencimento futuro', () => {
    const p = planoDeBoleto(500, regras, 1)
    assert.equal(p.valorEntrada, 500)
    assert.equal(p.vencimentos.length, 0)
  })
})

describe('boleto parcelado com acréscimo', () => {
  const base = { ativo: true, parcelado: true, parcelasMax: 12, diaVencimento: 10, jurosMesPct: 0, taxaPorParcela: 0 }

  test('sem juros e sem taxa, parcelar custa o preço do à vista', () => {
    const p = planoDeBoleto(1200, base, 6)
    assert.equal(p.valorTotal, 1200)
    assert.equal(p.acrescimo, 0)
    assert.equal(p.semAcrescimo, true)
  })

  test('taxa fixa entra uma vez por parcela — não uma por venda', () => {
    // É o custo real: o banco cobra a emissão por documento.
    const p = planoDeBoleto(1200, { ...base, taxaPorParcela: 2 }, 6)
    assert.equal(p.valorTotal, 1212, 'seis parcelas, seis tarifas')
    assert.equal(p.acrescimo, 12)
    assert.equal(p.semAcrescimo, false)
  })

  test('juros ao mês encarecem conforme se estica', () => {
    const tres = planoDeBoleto(1000, { ...base, jurosMesPct: 2 }, 3)
    const doze = planoDeBoleto(1000, { ...base, jurosMesPct: 2 }, 12)
    assert.ok(tres.acrescimo > 0)
    assert.ok(doze.acrescimo > tres.acrescimo, 'parcelar mais tem de custar mais')
  })

  test('juros e taxa fixa somam', () => {
    const so_juros = planoDeBoleto(1000, { ...base, jurosMesPct: 2 }, 6)
    const ambos = planoDeBoleto(1000, { ...base, jurosMesPct: 2, taxaPorParcela: 3 }, 6)
    assert.equal(ambos.valorTotal, Math.round((so_juros.valorTotal + 18) * 100) / 100)
  })

  test('à vista nunca leva acréscimo, mesmo com juros e taxa ligados', () => {
    // Quem paga de uma vez não está parcelando: não há tarifa extra nem juros.
    const p = planoDeBoleto(1000, { ...base, jurosMesPct: 5, taxaPorParcela: 10 }, 1)
    assert.equal(p.valorTotal, 1000)
    assert.equal(p.acrescimo, 0)
    assert.equal(p.valorEntrada, 1000)
    assert.equal(p.vencimentos.length, 0)
  })

  test('entrada mais parcelas somam o total, com acréscimo ou sem', () => {
    for (const cfg of [base, { ...base, taxaPorParcela: 1.99 }, { ...base, jurosMesPct: 1.5 }, { ...base, jurosMesPct: 2, taxaPorParcela: 2.5 }]) {
      for (const n of [2, 5, 12]) {
        const p = planoDeBoleto(999.99, cfg, n)
        const soma = Math.round((p.valorEntrada + p.valorParcela * (p.parcelas - 1)) * 100) / 100
        assert.equal(soma, p.valorTotal, `${n}x com ${JSON.stringify(cfg)} somou ${soma} de ${p.valorTotal}`)
      }
    }
  })

  test('a descrição diz a entrada, as parcelas e o total quando encarece', () => {
    const sem = planoDeBoleto(600, base, 3)
    assert.match(sem.descricao, /entrada de .* \+ 2x de /)
    assert.doesNotMatch(sem.descricao, /total/, 'sem acréscimo não precisa anunciar total')
    const com = planoDeBoleto(600, { ...base, taxaPorParcela: 2 }, 3)
    assert.match(com.descricao, /total/)
  })
})
