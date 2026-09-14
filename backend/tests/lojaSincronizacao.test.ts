// tests/lojaSincronizacao.test.ts
//
// A porta entre a loja central e este tenant.
//
// É a peça em que um erro custa dos dois lados: solta demais, qualquer um
// concede módulos a si mesmo; apertada demais, um cliente que pagou fica sem
// sistema. Por isso os testes cobrem tanto quem NÃO pode entrar quanto a
// convergência do estado.
//
// ⚠️ TOCA O BANCO REAL. Trava sozinho num banco com compra de verdade.
//
//   cd backend && npx tsx --test tests/lojaSincronizacao.test.ts

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import Fastify from 'fastify'
import { prisma } from '../src/lib/prisma.js'
import { lojaSincronizacaoRoutes } from '../src/routes/lojaSincronizacao.js'
import { assinarPedido, conferirAssinatura } from '../src/lib/lojaAssinatura.js'
import { modulosComDireito, invalidarCacheDeDireitos, pacotesDisponiveis, modulosDoPacote } from '../src/services/moduleEntitlements.js'

const MARCA = 'teste-automatizado'
const SEGREDO = 'segredo-de-teste-nao-usar-em-producao-0123456789abcdef'

const comprasReais = await prisma.moduleEntitlement.count({
  where: { origem: { in: ['pacote', 'avulso'] }, NOT: { referencia: { contains: MARCA } } },
})
const trava = comprasReais > 0
  ? `banco com ${comprasReais} direito(s) comprado(s) — este teste concede e revoga, e não roda aqui`
  : false

let app: ReturnType<typeof Fastify>
let segredoOriginal: string | undefined

function pedido(corpo: unknown, opts: { segredo?: string; timestamp?: string } = {}) {
  const cru = JSON.stringify(corpo)
  const ts = opts.timestamp ?? String(Math.floor(Date.now() / 1000))
  return {
    payload: cru,
    headers: {
      'content-type': 'application/json',
      'x-loja-timestamp': ts,
      'x-loja-assinatura': assinarPedido(opts.segredo ?? SEGREDO, ts, cru),
    },
  }
}

before(async () => {
  if (trava) return
  segredoOriginal = process.env.LOJA_SEGREDO
  process.env.LOJA_SEGREDO = SEGREDO
  app = Fastify()
  await app.register(lojaSincronizacaoRoutes)
  await app.ready()
})

after(async () => {
  if (!trava) {
    await app?.close()
    await prisma.moduleEntitlement.deleteMany({ where: { concedidoPor: 'loja' } })
    await prisma.assinaturaEvento.deleteMany({ where: { feitoPor: 'loja' } })
    if (segredoOriginal === undefined) delete process.env.LOJA_SEGREDO
    else process.env.LOJA_SEGREDO = segredoOriginal
    invalidarCacheDeDireitos()
  }
  await prisma.$disconnect()
})

describe('a assinatura do pedido', () => {
  const ts = String(Math.floor(Date.now() / 1000))
  const corpo = '{"pacotes":["crm_vendas"]}'

  test('pedido bem assinado passa', () => {
    const r = conferirAssinatura({
      corpoCru: corpo, timestamp: ts, segredo: SEGREDO,
      assinatura: assinarPedido(SEGREDO, ts, corpo),
    })
    assert.equal(r.ok, true)
  })

  test('corpo alterado depois de assinado é recusado', () => {
    // É o ataque óbvio: capturar um pedido legítimo e trocar o pacote.
    const r = conferirAssinatura({
      corpoCru: '{"pacotes":["erp_academico"]}', timestamp: ts, segredo: SEGREDO,
      assinatura: assinarPedido(SEGREDO, ts, corpo),
    })
    assert.deepEqual(r, { ok: false, motivo: 'assinatura_invalida' })
  })

  test('segredo de outro tenant não serve', () => {
    // É o ponto de ter um segredo por instalação: vazar o de um não abre os 12.
    const r = conferirAssinatura({
      corpoCru: corpo, timestamp: ts, segredo: SEGREDO,
      assinatura: assinarPedido('segredo-de-outra-instalacao', ts, corpo),
    })
    assert.equal(r.ok, false)
  })

  test('pedido antigo não vale para sempre', () => {
    // Sem o timestamp na mensagem assinada, bastaria repetir um pedido gravado
    // para renovar de graça todo mês.
    const velho = String(Math.floor(Date.now() / 1000) - 3600)
    const r = conferirAssinatura({
      corpoCru: corpo, timestamp: velho, segredo: SEGREDO,
      assinatura: assinarPedido(SEGREDO, velho, corpo),
    })
    assert.deepEqual(r, { ok: false, motivo: 'fora_da_janela' })
  })

  test('relógio adiantado do outro lado também é recusado', () => {
    const futuro = String(Math.floor(Date.now() / 1000) + 3600)
    const r = conferirAssinatura({
      corpoCru: corpo, timestamp: futuro, segredo: SEGREDO,
      assinatura: assinarPedido(SEGREDO, futuro, corpo),
    })
    assert.deepEqual(r, { ok: false, motivo: 'fora_da_janela' })
  })

  test('sem segredo configurado, nada passa', () => {
    const r = conferirAssinatura({ corpoCru: corpo, timestamp: ts, segredo: undefined, assinatura: 'x' })
    assert.deepEqual(r, { ok: false, motivo: 'sem_segredo' })
  })
})

describe('a rota recusa quem não deve entrar', { skip: trava }, () => {
  test('sem assinatura: 401', async () => {
    const r = await app.inject({
      method: 'POST', url: '/api/loja/assinatura',
      payload: { pacotes: [] }, headers: { 'content-type': 'application/json' },
    })
    assert.equal(r.statusCode, 401)
  })

  test('assinado com o segredo errado: 401', async () => {
    const r = await app.inject({
      method: 'POST', url: '/api/loja/assinatura',
      ...pedido({ pacotes: ['crm_vendas'] }, { segredo: 'errado' }),
    })
    assert.equal(r.statusCode, 401)
  })

  test('a recusa não diz QUAL foi o problema', async () => {
    // Distinguir "fora da janela" de "assinatura inválida" ajuda quem tenta
    // adivinhar o segredo.
    const r = await app.inject({
      method: 'POST', url: '/api/loja/assinatura',
      ...pedido({ pacotes: [] }, { segredo: 'errado' }),
    })
    const corpo = r.body.toLowerCase()
    for (const p of ['janela', 'timestamp', 'hmac', 'segredo']) {
      assert.ok(!corpo.includes(p), `a resposta entrega "${p}"`)
    }
  })

  test('recusa não escreve nada', async () => {
    const antes = await prisma.moduleEntitlement.count({ where: { concedidoPor: 'loja' } })
    await app.inject({
      method: 'POST', url: '/api/loja/assinatura',
      ...pedido({ pacotes: ['crm_vendas'] }, { segredo: 'errado' }),
    })
    assert.equal(await prisma.moduleEntitlement.count({ where: { concedidoPor: 'loja' } }), antes,
      'o 401 veio DEPOIS da escrita')
  })
})

describe('o estado desejado converge', { skip: trava }, () => {
  const doisPacotes = ['atendimento', 'crm_vendas']

  test('concede os pacotes contratados com a data da loja', async () => {
    const ate = new Date(Date.now() + 30 * 864e5)
    const r = await app.inject({
      method: 'POST', url: '/api/loja/assinatura',
      ...pedido({ pacotes: doisPacotes, vigenteAte: ate.toISOString(), referencia: `${MARCA}:pay_1` }),
    })
    assert.equal(r.statusCode, 200, r.body)
    const linhas = await prisma.moduleEntitlement.findMany({
      where: { concedidoPor: 'loja', pacote: { in: doisPacotes } },
    })
    assert.ok(linhas.length > 0, 'nenhum direito gravado')
    for (const l of linhas) {
      assert.equal(l.expiraEm?.toISOString().slice(0, 10), ate.toISOString().slice(0, 10))
    }
  })

  test('repetir o mesmo pedido não duplica nada', async () => {
    // Webhook repete. Se repetir concedesse de novo, o histórico viraria ruído
    // e a revogação por pacote pararia de funcionar.
    const ate = new Date(Date.now() + 30 * 864e5).toISOString()
    const corpo = { pacotes: doisPacotes, vigenteAte: ate, referencia: `${MARCA}:pay_1` }
    await app.inject({ method: 'POST', url: '/api/loja/assinatura', ...pedido(corpo) })
    const antes = await prisma.moduleEntitlement.count({ where: { concedidoPor: 'loja' } })
    await app.inject({ method: 'POST', url: '/api/loja/assinatura', ...pedido(corpo) })
    assert.equal(await prisma.moduleEntitlement.count({ where: { concedidoPor: 'loja' } }), antes)
  })

  test('pacote que sai do contrato é revogado', async () => {
    // É o downgrade, sem precisar de um comando próprio para ele.
    const ate = new Date(Date.now() + 30 * 864e5).toISOString()
    await app.inject({
      method: 'POST', url: '/api/loja/assinatura',
      ...pedido({ pacotes: ['crm_vendas'], vigenteAte: ate, referencia: `${MARCA}:pay_2` }),
    })
    const sobrou = await prisma.moduleEntitlement.count({
      where: { origem: 'pacote', pacote: 'atendimento' },
    })
    assert.equal(sobrou, 0, 'o pacote retirado do contrato continuou concedido')
  })

  test('o acesso acompanha o que foi concedido', async () => {
    invalidarCacheDeDireitos()
    const comDireito = await modulosComDireito()
    for (const id of modulosDoPacote('crm_vendas')) {
      assert.ok(comDireito.has(id), `${id} foi concedido e não abre`)
    }
  })

  test('GET assinado como se tivesse corpo é recusado', async () => {
    // Guarda a pegadinha: quem assinar "{}" num GET recebe 401 e vai achar que
    // o segredo está errado. O teste existe para o erro ter nome.
    const ts = String(Math.floor(Date.now() / 1000))
    const r = await app.inject({
      method: 'GET', url: '/api/loja/estado',
      headers: { 'x-loja-timestamp': ts, 'x-loja-assinatura': assinarPedido(SEGREDO, ts, '{}') },
    })
    assert.equal(r.statusCode, 401)
  })

  test('data inválida é recusada antes de gravar', async () => {
    // Gravar "Invalid Date" tiraria o acesso de um cliente que pagou.
    const r = await app.inject({
      method: 'POST', url: '/api/loja/assinatura',
      ...pedido({ pacotes: ['crm_vendas'], vigenteAte: 'mês que vem' }),
    })
    assert.equal(r.statusCode, 400)
  })

  test('pacote inexistente é recusado', async () => {
    const r = await app.inject({
      method: 'POST', url: '/api/loja/assinatura',
      ...pedido({ pacotes: ['erp_de_outro_planeta'], vigenteAte: null }),
    })
    assert.equal(r.statusCode, 400)
  })

  test('pacote que a instalação não roda dá 409, não sucesso vazio', async (t) => {
    const ausente = (['erp_academico', 'educacional'] as const).find((p) => !pacotesDisponiveis().includes(p))
    if (!ausente) return t.skip('esta instalação roda todos os pacotes')
    const r = await app.inject({
      method: 'POST', url: '/api/loja/assinatura',
      ...pedido({ pacotes: [ausente], vigenteAte: null }),
    })
    assert.equal(r.statusCode, 409, 'a loja precisa saber que não há o que entregar')
  })

  test('a loja consegue perguntar o que este tenant entende', async () => {
    // É assim que se descobre webhook perdido antes do cliente descobrir.
    // GET não tem corpo: assina-se a string VAZIA, não "{}".
    const ts = String(Math.floor(Date.now() / 1000))
    const r = await app.inject({
      method: 'GET', url: '/api/loja/estado',
      headers: { 'x-loja-timestamp': ts, 'x-loja-assinatura': assinarPedido(SEGREDO, ts, '') },
    })
    assert.equal(r.statusCode, 200, r.body)
    const b = r.json()
    assert.ok(Array.isArray(b.instalados) && b.instalados.length > 0)
    assert.ok(b.pacotes.every((p: { rotulo?: string }) => typeof p.rotulo === 'string'))
  })
})
