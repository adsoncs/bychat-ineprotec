// tests/moduleUmbrella.test.ts
//
// As invariantes do guarda-chuva — a fundação da loja de módulos.
//
// O produto tinha DUAS taxonomias para a mesma coisa: o menu agrupava por
// `group` (sidebar.config.ts) e a tela de módulos por `category` (aqui). Dois
// arquivos mantidos à mão, nada garantindo que concordassem — e pararam de
// concordar: 7 dos 16 grupos do menu misturavam categorias, e "Chatbots" vivia
// em Marketing no menu e em Captação na tela de módulos.
//
// Enquanto era só arrumação, dava para conviver. Virando catálogo de loja, não:
// o cliente compra um pacote e precisa receber exatamente o que viu.
//
// Este teste guarda o que não pode voltar a divergir. Módulo novo sem
// guarda-chuva quebra aqui, na hora de escrever — não seis meses depois, quando
// alguém for vendê-lo.
//
//   cd backend && npx tsx --test tests/moduleUmbrella.test.ts

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { MODULE_REGISTRY, UMBRELLA_REQUIRES } from '../src/lib/moduleRegistry.js'

const GUARDA_CHUVAS = [
  'atendimento', 'crm_vendas', 'marketing_canais', 'automacao_integracoes',
  'educacional', 'erp_academico', 'plataforma',
] as const

describe('todo módulo tem um guarda-chuva', () => {
  test('nenhum módulo fica sem', () => {
    const sem = MODULE_REGISTRY.filter((m) => !m.umbrella).map((m) => m.id)
    assert.deepEqual(sem, [], 'módulo sem guarda-chuva não tem como ser vendido nem exibido')
  })

  test('só os sete guarda-chuvas conhecidos', () => {
    const invalidos = MODULE_REGISTRY
      .filter((m) => !GUARDA_CHUVAS.includes(m.umbrella as never))
      .map((m) => `${m.id}=${m.umbrella}`)
    assert.deepEqual(invalidos, [], 'um oitavo guarda-chuva é uma decisão de produto, não um typo')
  })

  test('cada módulo cai num guarda-chuva que a loja conhece', () => {
    // Um guarda-chuva VAZIO é legítimo: nem toda instalação tem todos os
    // pacotes — o severiano é escola de captação e não tem um único módulo de
    // ERP. A loja simplesmente não oferece o pacote que não existe ali.
    // O que não pode é um módulo apontar para fora da lista, e disso cuida o
    // teste acima.
    const usados = new Set(MODULE_REGISTRY.map((m) => m.umbrella))
    assert.ok(usados.size > 0, 'nenhum módulo classificado')
    for (const u of usados) {
      assert.ok(GUARDA_CHUVAS.includes(u as never), `"${u}" não é um guarda-chuva conhecido`)
    }
  })
})

describe('como cada módulo entra na conta', () => {
  test('módulo core é sempre base', () => {
    const errados = MODULE_REGISTRY
      .filter((m) => m.core && m.cobranca !== 'base')
      .map((m) => `${m.id}=${m.cobranca}`)
    assert.deepEqual(errados, [],
      'core é a plataforma: cobrar à parte por ele é vender o que o cliente já tem')
  })

  test('só módulo core é base', () => {
    const errados = MODULE_REGISTRY
      .filter((m) => m.cobranca === 'base' && !m.core)
      .map((m) => m.id)
    assert.deepEqual(errados, [],
      'marcar como base o que não é core entrega de graça o que deveria ser vendido')
  })

  test('todo módulo declara uma forma de cobrança válida', () => {
    const validas = ['base', 'pacote', 'uso']
    const errados = MODULE_REGISTRY
      .filter((m) => !validas.includes(m.cobranca))
      .map((m) => `${m.id}=${m.cobranca}`)
    assert.deepEqual(errados, [])
  })

  test('o que tem custo por uso não é vendido por preço fixo', () => {
    // Cada uso destes gasta dinheiro nosso: token de IA, conversa cobrada pela
    // Meta, minuto de VoIP. Empacotá-los num valor fixo é vender prejuízo a
    // quem usa muito.
    const porUso = ['intelligence', 'ai_journey', 'conversation_audit', 'whatsapp',
                    'broadcast', 'smart_broadcast', 'voip', 'meetings']
    for (const id of porUso) {
      const m = MODULE_REGISTRY.find((x) => x.id === id)
      if (!m) continue
      assert.equal(m.cobranca, 'uso', `${id} tem custo marginal e precisa ser medido`)
    }
  })
})

describe('dependência não atravessa guarda-chuva', () => {
  test('o que um módulo exige está no mesmo pacote ou na base', () => {
    // Se um módulo do pacote X exige um módulo do pacote Y, vender X sozinho
    // entrega algo quebrado — e o carrinho teria de arrastar Y sem o cliente
    // pedir. A corrente do ERP tem 6 níveis; ela só se sustenta porque vive
    // inteira dentro de um pacote só.
    const porId = new Map(MODULE_REGISTRY.map((m) => [m.id, m]))
    const furos: string[] = []
    for (const m of MODULE_REGISTRY) {
      for (const dep of m.dependsOn ?? []) {
        const d = porId.get(dep)
        if (!d) { furos.push(`${m.id} → ${dep} (não existe)`); continue }
        if (d.cobranca === 'base') continue
        if (d.umbrella === m.umbrella) continue
        // Cruzar pacote é permitido, desde que DECLARADO: o ERP Acadêmico
        // exige o Educacional, e o carrinho precisa saber disso antes da compra.
        const exigidos = UMBRELLA_REQUIRES[m.umbrella] ?? []
        if (!exigidos.includes(d.umbrella)) {
          furos.push(`${m.id} (${m.umbrella}) → ${dep} (${d.umbrella})`)
        }
      }
    }
    assert.deepEqual(furos, [],
      'dependência cruzando pacote sem estar declarada em UMBRELLA_REQUIRES: '
      + 'o cliente compraria um pacote que não funciona sozinho, e só descobriria depois')
  })
})

describe('o que um pacote exige', () => {
  test('todo pacote exigido existe de verdade', () => {
    const nomes = new Set(GUARDA_CHUVAS as readonly string[])
    for (const [pacote, exigidos] of Object.entries(UMBRELLA_REQUIRES)) {
      for (const e of exigidos ?? []) {
        assert.ok(nomes.has(e), `${pacote} exige "${e}", que não é um pacote`)
      }
    }
  })

  test('nenhum pacote exige a si mesmo', () => {
    for (const [pacote, exigidos] of Object.entries(UMBRELLA_REQUIRES)) {
      assert.ok(!(exigidos ?? []).includes(pacote), `${pacote} exige a si mesmo`)
    }
  })

  test('a exigência declarada é real — existe dependência que a justifique', () => {
    // Uma exigência sem módulo que a sustente seria uma amarra comercial
    // inventada: obrigaria o cliente a comprar dois pacotes sem motivo técnico.
    const porId = new Map(MODULE_REGISTRY.map((m) => [m.id, m]))
    for (const [pacote, exigidos] of Object.entries(UMBRELLA_REQUIRES)) {
      // A exigência só é verificável onde o pacote existe. Numa instalação sem
      // ERP, "ERP exige Educacional" não tem o que sustentá-la — e isso não é
      // defeito: é um pacote que aquele cliente não tem.
      const temOPacote = MODULE_REGISTRY.some((m) => m.umbrella === pacote)
      if (!temOPacote) continue
      for (const alvo of exigidos ?? []) {
        const usada = MODULE_REGISTRY.some((m) => m.umbrella === pacote
          && (m.dependsOn ?? []).some((d) => porId.get(d)?.umbrella === alvo))
        assert.ok(usada, `${pacote} exige ${alvo}, mas nenhum módulo dele depende de ${alvo}`)
      }
    }
  })
})
