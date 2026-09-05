// tests/moduleRegistry.test.ts
//
// Invariantes do MODULE_REGISTRY — o mapa que decide, para cada rota, qual
// módulo a governa. Este arquivo existe porque duas vezes seguidas um defeito
// dele passou despercebido e só apareceu depois, em produção:
//
//   1. `/api/bychat/leads` estava declarado em `leads` E em `intelligence`.
//      Funcionava por acidente: `getModuleForRoute` era um `.find()` e `leads`
//      estava escrito antes no arquivo. Uma reordenação inocente teria tirado a
//      tela de Leads de todo tenant com Inteligência desligada.
//   2. `/api/admin/meta` (marketing) engolia `/api/admin/meta-ads-report`
//      (vendas): desligar "Vendas & Anúncios" não desligava o relatório, e
//      desligar "Marketing" derrubava um relatório que ninguém associava a ele.
//
// Nenhum dos dois é visível lendo o registry — só cruzando os prefixos. Daí o
// teste. Ele NÃO toca o banco: lê o registry importado (nada de regex sobre o
// arquivo, que foi justamente o que me fez ver um problema onde não havia, ao
// capturar palavras dentro de comentários).
//
//   cd backend && npm test

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { MODULE_REGISTRY, getModuleForRoute } from '../src/lib/moduleRegistry.js'

describe('MODULE_REGISTRY — invariantes', () => {
  test('todo id é único', () => {
    const vistos = new Set<string>()
    for (const m of MODULE_REGISTRY) {
      assert.ok(!vistos.has(m.id), `id duplicado no registry: ${m.id}`)
      vistos.add(m.id)
    }
  })

  test('todo prefixo de rota começa com /api', () => {
    for (const m of MODULE_REGISTRY) {
      for (const p of m.routePrefixes) {
        assert.ok(
          p.startsWith('/api'),
          `${m.id}: prefixo "${p}" não começa com /api — nunca vai casar com URL nenhuma, ` +
          'e o módulo fica sem governar a rota que ele acha que governa',
        )
      }
    }
  })

  test('nenhum prefixo é declarado por dois módulos', () => {
    const dono = new Map<string, string>()
    for (const m of MODULE_REGISTRY) {
      for (const p of m.routePrefixes) {
        const anterior = dono.get(p)
        assert.ok(
          !anterior,
          `prefixo "${p}" declarado em "${anterior}" e em "${m.id}". ` +
          'Dois módulos disputando a mesma rota: qual ganha vira detalhe de ordenação, ' +
          'e desligar um deles bloqueia (ou deixa de bloquear) coisa que ninguém previu.',
        )
        dono.set(p, m.id)
      }
    }
  })

  test('toda página pertence a um módulo só', () => {
    const dono = new Map<string, string>()
    for (const m of MODULE_REGISTRY) {
      for (const pg of m.pages) {
        const anterior = dono.get(pg)
        assert.ok(!anterior, `página "${pg}" declarada em "${anterior}" e em "${m.id}"`)
        dono.set(pg, m.id)
      }
    }
  })

  test('inheritFrom aponta para um módulo que existe', () => {
    const ids = new Set(MODULE_REGISTRY.map((m) => m.id))
    for (const m of MODULE_REGISTRY) {
      const pai = (m as { inheritFrom?: string }).inheritFrom
      if (!pai) continue
      assert.ok(ids.has(pai), `${m.id}: inheritFrom "${pai}" não existe no registry`)
    }
  })

  test('prefixo que engole outro entrega a rota ao mais específico', () => {
    // Não é proibido um prefixo conter outro — `/api/admin/meta` e
    // `/api/admin/meta-ads-report` podem coexistir. O que não pode é o mais
    // curto ficar com a rota do mais longo, que é o defeito que existiu.
    for (const curto of MODULE_REGISTRY) {
      for (const pc of curto.routePrefixes) {
        for (const longo of MODULE_REGISTRY) {
          if (longo.id === curto.id) continue
          for (const pl of longo.routePrefixes) {
            if (!pl.startsWith(pc) || pl === pc) continue
            const dono = getModuleForRoute(`${pl}/x`)
            assert.equal(
              dono?.id, longo.id,
              `"${pl}" (${longo.id}) está sendo governado por "${pc}" (${curto.id}) — ` +
              'o prefixo mais específico tem de ganhar',
            )
          }
        }
      }
    }
  })

  test('o caso que motivou o teste: meta-ads-report é de vendas', () => {
    assert.equal(getModuleForRoute('/api/admin/meta-ads-report/dashboard')?.id, 'vendas')
    assert.equal(getModuleForRoute('/api/admin/meta/campaigns')?.id, 'marketing')
  })

  test('as rotas de leads pertencem ao módulo leads', () => {
    // Guarda contra a reincidência do primeiro defeito: qualquer módulo que
    // volte a reivindicar /api/bychat/leads faz este teste falhar.
    assert.equal(getModuleForRoute('/api/bychat/leads')?.id, 'leads')
    assert.equal(getModuleForRoute('/api/bychat/leads/123')?.id, 'leads')
  })
})
