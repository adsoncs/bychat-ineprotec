// tests/plano-pontualidade-primeira.test.ts
//
// "Aplicar também na 1ª parcela do boleto parcelado" (pontualidade.naPrimeira).
// Sem o campo, vale a regra antiga: curso completo com desconto, "só a 1ª
// parcela" sem. Não toca o banco nem gera cobrança.
//
//   cd backend && node --import tsx --test tests/plano-pontualidade-primeira.test.ts

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { contaPeloPlano, opcoesDaTelaPeloPlano } from '../src/services/checkoutDoPlano.js'
import { boletoUnicoDaEntrada, descreverOpcao, fraseDaPontualidade, lerRegrasDoPlano, parcelasDoPlano, valorAgoraDaOpcao, type OpcaoDePagamento, type PlanoDaOferta } from '../src/services/planoFinanceiro.js'

const forma = { pix: { ativo: false }, boleto: { ativo: false }, cartao: { ativo: false }, boletoParcelado: { ativo: true, parcelasMax: 12, valorBase: 2602.8 } }
function plano(naPrimeira?: boolean | null): PlanoDaOferta {
  return {
    id: 1, nome: 'Teste', taxaMatriculaCentavos: 0, numParcelas: 12, valorParcelaCentavos: 14990, diaVencimento: 10,
    regras: lerRegrasDoPlano({
      entrada: { ativo: true, ...forma }, integral: { ativo: true, ...forma },
      pontualidade: { ativo: true, descontoPct: 20, diaLimite: 5, ateVencimento: true, terminaEm90: true, ...(naPrimeira !== undefined ? { naPrimeira } : {}) },
    })!,
  }
}
const conta = async (p: PlanoDaOferta, opcao: OpcaoDePagamento) => {
  const r: any = await contaPeloPlano({
    cob: {} as any, escolha: { plano: p, planos: [p], opcao, negociada: null } as any,
    method: 'boleto', body: { parcelas: 12 }, portalId: 1, cpf: undefined, parcelamosNos: false,
  })
  assert.equal(r.erro, undefined)
  return r
}

describe('1ª parcela do boleto em 12x (R$ 216,90; em dia R$ 173,90)', () => {
  const casos: Array<[string, boolean | undefined, OpcaoDePagamento, number]> = [
    ['sem o campo, curso completo: com desconto', undefined, 'integral', 173.9],
    ['sem o campo, só a 1ª parcela: sem desconto', undefined, 'entrada', 216.9],
    ['marcado, curso completo: com desconto', true, 'integral', 173.9],
    ['marcado, só a 1ª parcela: com desconto', true, 'entrada', 173.9],
    ['desmarcado, curso completo: sem desconto', false, 'integral', 216.9],
    ['desmarcado, só a 1ª parcela: sem desconto', false, 'entrada', 216.9],
  ]
  for (const [nome, campo, opcao, esperado] of casos) {
    test(nome, async () => {
      const r = await conta(plano(campo), opcao)
      assert.equal(r.valorCobrado, esperado)
      const pp = r.paymentPlan()
      assert.equal(pp.valorParcela, 216.9)
      assert.equal(pp.descontoPontualidade, esperado < 216.9 ? 43 : undefined)
    })
  }
})

describe('a tela mostra o mesmo que a cobrança', () => {
  const tela = (p: PlanoDaOferta, opcao: OpcaoDePagamento) => opcoesDaTelaPeloPlano({
    cob: {} as any, escolha: { plano: p, planos: [p], opcao, negociada: null } as any, cupomCodigo: '',
    portalId: 1, cpf: undefined, pixExpiraHoras: 24, cartaoDisponivel: false, tokenizacao: null,
  })
  const em12 = (t: any) => t.meios.boleto.opcoes.find((o: any) => o.parcelas === 12)
  test('desmarcado: entrada cheia, seguintes com desconto', async () => {
    const o = em12(await tela(plano(false), 'integral'))
    assert.equal(o.valorEntrada, 216.9); assert.equal(o.valorEmDia, 173.9)
  })
  test('sem o campo, só a 1ª parcela: tela como antes', async () => {
    const o = em12(await tela(plano(), 'entrada'))
    assert.equal(o.valorEntrada, 216.9); assert.equal(o.valorEmDia, undefined)
  })
  test('marcado, só a 1ª parcela: entrada com desconto', async () => {
    const o = em12(await tela(plano(true), 'entrada'))
    assert.equal(o.valorEntrada, 173.9); assert.equal(o.valorEmDia, 173.9)
  })
})

describe('frase do contrato', () => {
  test('desmarcado avisa que vale a partir da 2ª', () => assert.match(fraseDaPontualidade(plano(false), 216.9), /a partir da 2ª parcela/))
  test('sem o campo, texto de antes', () => assert.match(fraseDaPontualidade(plano(), 216.9), /cada parcela sai por/))
})

describe('o campo sobrevive à leitura', () => {
  test('false fica false', () => assert.equal(plano(false).regras.pontualidade.naPrimeira, false))
  test('ausente vira null', () => assert.equal(plano().regras.pontualidade.naPrimeira, null))
  test('lixo vira null', () => assert.equal(plano('x' as any).regras.pontualidade.naPrimeira, null))
})

describe('só a 1ª parcela + boleto parcelado a preço próprio: tudo segue o boleto', () => {
  const soBoleto = () => plano()
  const semPreco = () => {
    const p = plano()
    p.regras.entrada.boletoParcelado.valorBase = null
    return p
  }
  const escolha = { opcao: 'entrada' as const, meio: 'boleto', parcelas: 12, valorPagoCentavos: 21690, pagoEm: new Date(2026, 10, 6), valorParcelaCentavos: 21690, valorTotalCentavos: 260280 }
  test('parcelas do acadêmico = valores do boleto', () => {
    const r = parcelasDoPlano(soBoleto(), escolha)
    assert.equal(r.length, 12)
    assert.ok(r.every((x) => x.valorBrutoCentavos === 21690))
    assert.equal(r.reduce((s, x) => s + x.valorBrutoCentavos, 0), 260280)
    assert.equal(r[0]!.situacao, 'PAGA'); assert.equal(r[1]!.situacao, undefined)
  })
  test('sem preço próprio, parcelas seguem o plano como antes', () => {
    const r = parcelasDoPlano(semPreco(), { ...escolha, valorPagoCentavos: 14990 })
    assert.equal(r.length, 12)
    assert.ok(r.every((x) => x.valorBrutoCentavos === 14990))
  })
  test('tela: o que paga agora é o boleto, não a mensalidade', () => {
    assert.equal(valorAgoraDaOpcao(soBoleto(), 'entrada'), 216.9)
    assert.match(descreverOpcao(soBoleto(), 'entrada').detalhe, /216,90 agora e mais 11x de R\$\s216,90/)
  })
  test('tela sem preço próprio: como antes', () => {
    assert.equal(valorAgoraDaOpcao(semPreco(), 'entrada'), 149.9)
  })
  test('tela com outra forma ligada: mantém a mensalidade', () => {
    const p = plano(); p.regras.entrada.pix.ativo = true
    assert.equal(boletoUnicoDaEntrada(p), null)
    assert.equal(valorAgoraDaOpcao(p, 'entrada'), 149.9)
  })
  test('campo marcado: entrada com desconto na tela', () => assert.equal(valorAgoraDaOpcao(plano(true), 'entrada'), 173.9))
  test('frase na opção entrada sem o campo: a partir da 2ª', () => assert.match(fraseDaPontualidade(plano(), 216.9, 'entrada'), /a partir da 2ª parcela/))
})
