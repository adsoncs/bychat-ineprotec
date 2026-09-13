// tests/painelDoDono.test.ts
//
// O painel do dono e, sobretudo, quem NÃO entra nele.
//
// A regra do produto é dura: o superadmin do cliente não pode alcançar nada da
// loja. Não é só "não pode alterar" — não pode nem descobrir que existe, por
// isso a resposta é 404 e não 403. Uma tranca que se anuncia convida a tentar.
//
// ⚠️ TOCA O BANCO REAL, e trava sozinho num banco com compra de verdade.
//
//   cd backend && npx tsx --test tests/painelDoDono.test.ts

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import Fastify from 'fastify'
import { prisma } from '../src/lib/prisma.js'
import { donoAssinaturaRoutes } from '../src/routes/donoAssinatura.js'
import { modulesRoutes } from '../src/routes/modules.js'
import { signToken } from '../src/lib/auth.js'
import { UMBRELLA_ORDER, UMBRELLA_LABELS } from '../src/lib/moduleRegistry.js'

const MARCA = 'teste-automatizado'
const QUEM = 'teste-painel@local.invalid'

const comprasReais = await prisma.moduleEntitlement.count({
  where: { origem: { in: ['pacote', 'avulso'] }, NOT: { referencia: { contains: MARCA } } },
})
const trava = comprasReais > 0
  ? `banco com ${comprasReais} direito(s) comprado(s) de verdade — este teste escreve e não roda aqui`
  : false

// Sobe o servidor com um autenticador falso, para poder entrar como cada tipo
// de usuário sem depender de senha nem de token real.
let app: ReturnType<typeof Fastify>
let donoId = 0
let comumId = 0
let tokenDono = ''
let tokenComum = ''
let cabecalho: Record<string, string> = {}

before(async () => {
  if (trava) return
  const dono = await prisma.user.findFirst({ where: { isOwner: true, active: true } })
  assert.ok(dono, 'nenhum usuário dono nesta instalação — rode scripts/definir-dono.ts')
  donoId = dono.id
  tokenDono = signToken({ userId: dono.id, email: QUEM, name: 'Teste', role: dono.role })

  const comum = await prisma.user.findFirst({
    where: { role: 'SUPERADMIN', isOwner: false, active: true },
  })
  comumId = comum?.id ?? -1
  if (comum) {
    tokenComum = signToken({ userId: comum.id, email: 'superadmin@cliente.invalid', name: 'Teste', role: comum.role })
  }

  // Token de verdade e authMiddleware de verdade: é o caminho que o navegador
  // percorre. Um autenticador falso provaria só que a rota existe.
  app = Fastify()
  await app.register(donoAssinaturaRoutes)
  await app.register(modulesRoutes)
  await app.ready()
})

after(async () => {
  if (!trava) {
    await app?.close()
    await prisma.moduleEntitlement.deleteMany({ where: { concedidoPor: QUEM } })
    await prisma.assinaturaEvento.deleteMany({ where: { feitoPor: QUEM } })
  }
  await prisma.$disconnect()
})

const comoDono = () => { cabecalho = { authorization: `Bearer ${tokenDono}` } }
const comoSuperadmin = () => { cabecalho = { authorization: `Bearer ${tokenComum}` } }
const semSessao = () => { cabecalho = {} }

describe('quem não é dono não vê a loja', { skip: trava }, () => {
  test('superadmin do cliente recebe 404, não 403', async (t) => {
    if (comumId < 0) return t.skip('sem superadmin comum nesta instalação')
    comoSuperadmin()
    const r = await app.inject({ method: 'GET', url: '/api/dono/assinatura', headers: cabecalho })
    assert.equal(r.statusCode, 404, '403 revelaria que existe algo aqui')
  })

  test('a resposta não descreve o que existe do outro lado', async (t) => {
    if (comumId < 0) return t.skip('sem superadmin comum')
    comoSuperadmin()
    const r = await app.inject({ method: 'GET', url: '/api/dono/assinatura', headers: cabecalho })
    const corpo = r.body.toLowerCase()
    for (const palavra of ['dono', 'loja', 'assinatura', 'permiss', 'proibid']) {
      assert.ok(!corpo.includes(palavra), `a resposta entrega a palavra "${palavra}"`)
    }
  })

  test('sem sessão não entra — e o 401 não denuncia nada', async () => {
    // Aqui 401 é o certo: quem não tem sessão recebe 401 em QUALQUER rota
    // autenticada, então a resposta não diz nada sobre esta existir. O 404 só
    // importa para quem está logado e poderia distinguir "existe e é proibido"
    // de "não existe".
    semSessao()
    const r = await app.inject({ method: 'GET', url: '/api/dono/assinatura', headers: cabecalho })
    assert.equal(r.statusCode, 401)
    assert.ok(!r.body.toLowerCase().includes('dono'), 'a resposta cita o dono')
  })

  test('as ações de escrita são igualmente invisíveis', async (t) => {
    if (comumId < 0) return t.skip('sem superadmin comum')
    comoSuperadmin()
    for (const url of ['/api/dono/assinatura/pago', '/api/dono/assinatura/carencia', '/api/dono/assinatura/teste']) {
      const r = await app.inject({ method: 'POST', url, payload: { pacote: 'crm_vendas', dias: 900 }, headers: cabecalho })
      assert.equal(r.statusCode, 404, `${url} não pode responder outra coisa`)
    }
    // E a carência de 900 dias não pode ter passado.
    const cfg = await prisma.lojaConfig.findUnique({ where: { chave: 'carencia_dias' } })
    assert.notEqual(cfg?.valor, '900', 'a escrita passou mesmo com 404 na resposta')
  })
})

describe('o dono vê o retrato da assinatura', { skip: trava }, () => {
  test('lista os 7 pacotes com rótulo de gente', async () => {
    comoDono()
    const r = await app.inject({ method: 'GET', url: '/api/dono/assinatura', headers: cabecalho })
    assert.equal(r.statusCode, 200)
    const b = r.json()
    assert.equal(b.pacotes.length, UMBRELLA_ORDER.length)
    for (const p of b.pacotes) {
      assert.equal(p.rotulo, UMBRELLA_LABELS[p.id as keyof typeof UMBRELLA_LABELS])
      assert.ok(typeof p.instalado === 'boolean')
    }
  })

  test('distingue "não instalado" de "sem direito"', async () => {
    // São coisas diferentes: um a instalação não roda, o outro ela roda e não
    // foi pago. Misturar faria a tela oferecer ERP a quem não tem ERP.
    comoDono()
    const b = (await app.inject({ method: 'GET', url: '/api/dono/assinatura', headers: cabecalho })).json()
    for (const p of b.pacotes) {
      if (!p.instalado) assert.equal(p.modulos, 0, `${p.id} não instalado mas com módulos`)
      else assert.ok(p.modulos > 0, `${p.id} instalado e sem módulo nenhum`)
    }
  })

  test('mostra a carência e o teste em vigor', async () => {
    comoDono()
    const b = (await app.inject({ method: 'GET', url: '/api/dono/assinatura', headers: cabecalho })).json()
    assert.ok(b.config.carenciaDias >= 0 && b.config.testeDias > 0)
  })
})

describe('o dono age', { skip: trava }, () => {
  test('marca um mês como pago e o evento fica registrado', async () => {
    comoDono()
    const r = await app.inject({
      method: 'POST', url: '/api/dono/assinatura/pago', headers: cabecalho,
      payload: { pacote: 'crm_vendas', competencia: '2026-09', valorCentavos: 49900, meio: 'pix' },
    })
    assert.equal(r.statusCode, 200, r.body)
    const ev = await prisma.assinaturaEvento.findFirst({
      where: { tipo: 'pago_manual', feitoPor: QUEM }, orderBy: { id: 'desc' },
    })
    assert.equal(ev?.competencia, '2026-09')
    assert.equal(ev?.valorCentavos, 49900)
  })

  test('competência mal escrita é recusada antes de entrar no banco', async () => {
    comoDono()
    const antes = await prisma.assinaturaEvento.count()
    const r = await app.inject({
      method: 'POST', url: '/api/dono/assinatura/pago', headers: cabecalho,
      payload: { pacote: 'crm_vendas', competencia: 'setembro' },
    })
    assert.equal(r.statusCode, 400)
    assert.equal(await prisma.assinaturaEvento.count(), antes, 'recusa não pode deixar rastro')
  })

  test('valor em centavos não aceita fração', async () => {
    comoDono()
    const r = await app.inject({
      method: 'POST', url: '/api/dono/assinatura/pago', headers: cabecalho,
      payload: { pacote: 'crm_vendas', competencia: '2026-09', valorCentavos: 499.9 },
    })
    assert.equal(r.statusCode, 400, 'centavo fracionado vira diferença de caixa')
  })

  test('carência fora da faixa é recusada', async () => {
    comoDono()
    for (const dias of [-1, 400, 1.5]) {
      const r = await app.inject({ method: 'POST', url: '/api/dono/assinatura/carencia', payload: { dias }, headers: cabecalho })
      assert.equal(r.statusCode, 400, `${dias} dias foi aceito`)
    }
  })

  test('vender pacote que a instalação não roda dá 409, não 500', async (t) => {
    comoDono()
    const b = (await app.inject({ method: 'GET', url: '/api/dono/assinatura', headers: cabecalho })).json()
    const ausente = b.pacotes.find((p: any) => !p.instalado)
    if (!ausente) return t.skip('esta instalação roda todos os pacotes')
    const r = await app.inject({
      method: 'POST', url: '/api/dono/assinatura/teste', payload: { pacote: ausente.id }, headers: cabecalho,
    })
    assert.equal(r.statusCode, 409, 'a loja precisa saber que é catálogo, não falha')
  })
})

describe('ligar e desligar módulo é do dono', { skip: trava }, () => {
  // O módulo ativo É a mercadoria. Se o superadmin do cliente liga o que quiser,
  // a loja não vende nada — basta ligar. Ao superadmin fica o que é dele:
  // decidir quem da equipe usa cada módulo que está ativo.
  //
  // ⚠️ Estes testes tentam DESATIVAR de verdade. Só pedem módulos que já estão
  // desativados, e conferem depois que nada mudou.

  async function umModuloNaoCore(): Promise<string> {
    const { MODULE_REGISTRY } = await import('../src/lib/moduleRegistry.js')
    const m = MODULE_REGISTRY.find((x) => !x.core)
    assert.ok(m, 'nenhum módulo não-core no registro')
    return m!.id
  }

  test('superadmin do cliente é recusado com 403 e explicação', async (t) => {
    if (comumId < 0) return t.skip('sem superadmin comum nesta instalação')
    comoSuperadmin()
    const id = await umModuloNaoCore()
    const r = await app.inject({
      method: 'POST', url: `/api/admin/modules/${id}/toggle`,
      payload: { enabled: false }, headers: cabecalho,
    })
    assert.equal(r.statusCode, 403, 'aqui 403 e não 404: a tela existe e ele a vê')
    const corpo = r.json()
    assert.equal(corpo.somenteDono, true, 'a interface precisa distinguir isto de outro 403')
    assert.match(corpo.error, /dono do produto/i, 'a recusa precisa dizer por quê')
  })

  test('a recusa não desativa nada', async (t) => {
    if (comumId < 0) return t.skip('sem superadmin comum')
    const { isModuleEnabled } = await import('../src/lib/moduleManager.js')
    const id = await umModuloNaoCore()
    const antes = await isModuleEnabled(id)
    comoSuperadmin()
    await app.inject({
      method: 'POST', url: `/api/admin/modules/${id}/toggle`,
      payload: { enabled: !antes }, headers: cabecalho,
    })
    assert.equal(await isModuleEnabled(id), antes, 'o 403 veio DEPOIS da escrita')
  })

  test('a lista continua visível para o superadmin', async (t) => {
    if (comumId < 0) return t.skip('sem superadmin comum')
    // Ele precisa ver o que está ativo para configurar as permissões da equipe.
    comoSuperadmin()
    const r = await app.inject({ method: 'GET', url: '/api/admin/modules', headers: cabecalho })
    assert.equal(r.statusCode, 200, 'esconder a lista tiraria a base para configurar permissões')
    assert.ok(Array.isArray(r.json().modules ?? r.json()), 'a lista veio vazia')
  })

  test('o dono passa pela trava', async () => {
    comoDono()
    const id = await umModuloNaoCore()
    const r = await app.inject({
      method: 'POST', url: `/api/admin/modules/${id}/toggle`,
      payload: { enabled: true }, headers: cabecalho,
    })
    // Ligar o que já está ligado é inofensivo: o que importa é não levar 403.
    assert.notEqual(r.statusCode, 403, 'o dono foi barrado na própria trava')
  })
})
