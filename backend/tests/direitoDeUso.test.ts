// tests/direitoDeUso.test.ts
//
// O direito de uso — a peça que permite a loja vender e ativar sozinha.
//
// Até aqui, "módulo ligado" era só um interruptor do admin. A loja exige uma
// segunda pergunta antes dele: o cliente tem direito a isso? As duas juntas
// decidem, e separá-las é o que torna possível cancelar (tirar o direito sem
// apagar a preferência do admin) e impede um admin de ligar o que não pagou.
//
// O que mais importa aqui é o teste de que NADA mudou para quem já era cliente:
// a migration 0157 deu direito sem prazo sobre tudo. Uma reforma de cobrança
// que apaga função de cliente pagante é pior que nenhuma reforma.
//
// ⚠️ TOCA O BANCO REAL. Tudo criado leva `origem: 'teste'` e é apagado no fim.
//
//   cd backend && npx tsx --test tests/direitoDeUso.test.ts

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { prisma } from '../src/lib/prisma.js'
import { MODULE_REGISTRY } from '../src/lib/moduleRegistry.js'
import {
  modulosComDireito, temDireito, concederPacote, concederModulo,
  revogarPacote, invalidarCacheDeDireitos, resumoDeDireitos,
} from '../src/services/moduleEntitlements.js'

// Um módulo real, não-core, para os testes de concessão avulsa.
const COBAIA = MODULE_REGISTRY.find((m) => !m.core && m.umbrella === 'marketing_canais')!.id

// Tudo que este teste cria leva esta marca, e a limpeza apaga SÓ o que tem a
// marca. Limpar por `origem` seria catastrófico: numa instalação de cliente,
// `origem: 'pacote'` são as compras de verdade, e a limpeza as apagaria.
const MARCA = 'teste-automatizado'

async function limpar() {
  await prisma.moduleEntitlement.deleteMany({ where: { referencia: MARCA } })
  invalidarCacheDeDireitos()
}

before(limpar)
after(async () => { await limpar(); await prisma.$disconnect() })

describe('quem já era cliente não perde nada', () => {
  test('todo módulo do registro tem direito vigente', async () => {
    // A migration 0157 concedeu `origem: migracao` sem prazo para tudo que
    // existia. Se este teste falhar numa instalação real, alguém acabou de
    // tirar função de cliente pagante sem perceber.
    const comDireito = await modulosComDireito()
    const sem = MODULE_REGISTRY.filter((m) => !comDireito.has(m.id)).map((m) => m.id)
    assert.deepEqual(sem, [],
      'módulo sem direito numa instalação que já era cliente: a loja está tirando o que ele já tinha')
  })

  test('módulo core tem direito mesmo sem linha na tabela', async () => {
    // Core é a plataforma. Se dependesse de compra, um erro de cobrança
    // derrubaria o produto inteiro.
    const core = MODULE_REGISTRY.filter((m) => m.core)
    for (const m of core) assert.ok(await temDireito(m.id), `${m.id} é core e precisa valer sempre`)
  })
})

describe('comprar um pacote', () => {
  test('concede todos os módulos do guarda-chuva', async () => {
    const r = await concederPacote({ pacote: 'marketing_canais', referencia: MARCA })
    const doPacote = MODULE_REGISTRY.filter((m) => m.umbrella === 'marketing_canais' && !m.core)
    for (const m of doPacote) {
      assert.ok(r.concedidos.includes(m.id), `${m.id} deveria vir junto no pacote`)
    }
  })

  test('arrasta os pacotes exigidos', async () => {
    // O ERP exige o Educacional: 4 módulos dele dependem disso. Vender ERP
    // sozinho entregaria telas que não abrem.
    const r = await concederPacote({ pacote: 'erp_academico', referencia: MARCA })
    assert.ok(r.pacotes.includes('educacional'),
      'comprar ERP tem de trazer o Educacional junto — senão o cliente compra algo quebrado')
    const edu = MODULE_REGISTRY.find((m) => m.umbrella === 'educacional' && !m.core)
    if (edu) assert.ok(r.concedidos.includes(edu.id))
  })

  test('comprar de novo renova, não duplica', async () => {
    await concederPacote({ pacote: 'marketing_canais', referencia: MARCA })
    await concederPacote({ pacote: 'marketing_canais', referencia: MARCA })
    const alvo = MODULE_REGISTRY.find((m) => m.umbrella === 'marketing_canais' && !m.core)!
    const n = await prisma.moduleEntitlement.count({ where: { moduleId: alvo.id, origem: 'pacote' } })
    assert.equal(n, 1, 'renovação criando linha nova quebraria a revogação por pacote')
  })

  test('core não vira linha de direito', async () => {
    const r = await concederPacote({ pacote: 'crm_vendas', referencia: MARCA })
    const core = MODULE_REGISTRY.filter((m) => m.core).map((m) => m.id)
    const indevidos = r.concedidos.filter((id) => core.includes(id))
    assert.deepEqual(indevidos, [], 'conceder core é registrar o óbvio e sujar o cancelamento')
  })
})

describe('prazo', () => {
  test('direito vencido não vale', async () => {
    await concederModulo({
      moduleId: COBAIA, origem: 'teste',
      expiraEm: new Date(Date.now() - 60_000), referencia: MARCA,
    })
    // O de migração ainda vale, então o módulo segue com direito — o que este
    // teste prova é que a LINHA vencida não entra na conta.
    const vigentes = await prisma.moduleEntitlement.count({
      where: { moduleId: COBAIA, origem: 'teste', expiraEm: { gt: new Date() } },
    })
    assert.equal(vigentes, 0)
  })

  test('direito vencido continua registrado — o histórico é o que permite reativar', async () => {
    const linha = await prisma.moduleEntitlement.findFirst({ where: { moduleId: COBAIA, origem: 'teste' } })
    assert.ok(linha, 'apagar o vencido perderia "até quando ele teve isso?"')
  })
})

describe('cancelar um pacote', () => {
  test('tira o que o pacote deu, e só isso', async () => {
    await concederPacote({ pacote: 'marketing_canais', referencia: MARCA })
    // O mesmo módulo, também dado em negociação: cancelar a assinatura não
    // pode levar junto o que um humano prometeu.
    await concederModulo({ moduleId: COBAIA, origem: 'cortesia', referencia: MARCA })

    await revogarPacote('marketing_canais')

    const doPacote = await prisma.moduleEntitlement.count({
      where: { origem: 'pacote', pacote: 'marketing_canais' },
    })
    assert.equal(doPacote, 0, 'o pacote precisa sair inteiro')

    const cortesia = await prisma.moduleEntitlement.findFirst({
      where: { moduleId: COBAIA, origem: 'cortesia' },
    })
    assert.ok(cortesia, 'a cortesia é de outra origem e não pode cair junto')
  })
})

describe('o resumo do que a instalação tem', () => {
  test('agrupa por pacote e não inventa módulo', async () => {
    const resumo = await resumoDeDireitos()
    assert.ok(resumo.length > 0)
    const ids = new Set(MODULE_REGISTRY.map((m) => m.id))
    for (const g of resumo) {
      for (const m of g.modulos) {
        assert.ok(ids.has(m.id), `${m.id} não existe no registro`)
      }
    }
  })
})
