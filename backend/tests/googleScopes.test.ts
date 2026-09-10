// tests/googleScopes.test.ts
//
// Guarda o que cada conexão do Google pede de permissão.
//
// Existe porque conectar o Google para UMA finalidade pedia acesso a TODAS: quem
// só queria ligar o Google Ads via a tela de consentimento pedir também
// `gmail.readonly`. Uma agência que opera o CRM de um cliente não pode entregar
// a caixa de entrada da própria empresa para configurar relatório de anúncio —
// e foi exatamente por isso que a conexão do severiano ficou parada.
//
// O ponto sensível é o conjunto `ads`: qualquer escopo a mais que entre aqui
// volta a pedir dado que a tarefa não usa, e ninguém percebe, porque a tela de
// consentimento é do Google e passa longe do nosso código.
//
//   cd backend && npm test

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { GOOGLE_SCOPE_SETS, ALL_GOOGLE_SCOPES, scopesFor, conexaoTemAds } from '../src/lib/google.js'

const ADWORDS = 'https://www.googleapis.com/auth/adwords'

describe('conjunto "ads" — o mínimo para a Google Ads API', () => {
  test('pede adwords', () => {
    assert.ok(GOOGLE_SCOPE_SETS.ads.includes(ADWORDS))
  })

  test('NÃO pede Gmail, Drive, Planilhas, Agenda nem Tarefas', () => {
    const proibidos = ['gmail', 'drive', 'spreadsheets', 'calendar', 'tasks']
    for (const s of GOOGLE_SCOPE_SETS.ads) {
      for (const p of proibidos) {
        assert.ok(!s.includes(p), `o conjunto "ads" não pode pedir ${s}`)
      }
    }
  })

  test('leva só a identidade junto — para sabermos qual e-mail autorizou', () => {
    const extras = GOOGLE_SCOPE_SETS.ads.filter(s => s !== ADWORDS)
    assert.deepEqual([...extras].sort(), [
      'https://www.googleapis.com/auth/userinfo.email',
      'https://www.googleapis.com/auth/userinfo.profile',
      'openid',
    ].sort())
  })

  test('é menor que o completo', () => {
    assert.ok(GOOGLE_SCOPE_SETS.ads.length < ALL_GOOGLE_SCOPES.length)
  })
})

describe('scopesFor — o padrão nunca encolhe sozinho', () => {
  test('sem parâmetro devolve o conjunto completo (comportamento antigo)', () => {
    assert.deepEqual([...scopesFor(undefined)], ALL_GOOGLE_SCOPES)
    assert.deepEqual([...scopesFor(null)], ALL_GOOGLE_SCOPES)
    assert.deepEqual([...scopesFor('')], ALL_GOOGLE_SCOPES)
  })

  test('nome desconhecido cai no completo, não num conjunto menor', () => {
    assert.deepEqual([...scopesFor('qualquer-coisa')], ALL_GOOGLE_SCOPES)
  })

  test('"ads" devolve o restrito', () => {
    assert.deepEqual([...scopesFor('ads')], [...GOOGLE_SCOPE_SETS.ads])
  })

  test('o completo continua trazendo Gmail — quem usa a conexão inteira não é afetado', () => {
    assert.ok(ALL_GOOGLE_SCOPES.some(s => s.includes('gmail')))
    assert.ok(ALL_GOOGLE_SCOPES.includes(ADWORDS))
  })
})

describe('conexaoTemAds — evita o 403 sem explicação', () => {
  test('reconhece a conexão restrita e a completa', () => {
    assert.equal(conexaoTemAds(GOOGLE_SCOPE_SETS.ads.join(' ')), true)
    assert.equal(conexaoTemAds(ALL_GOOGLE_SCOPES.join(' ')), true)
  })

  test('recusa conexão sem o escopo', () => {
    assert.equal(conexaoTemAds('openid https://www.googleapis.com/auth/calendar'), false)
    assert.equal(conexaoTemAds(''), false)
    assert.equal(conexaoTemAds(null), false)
  })

  test('não casa por pedaço de string', () => {
    assert.equal(conexaoTemAds('https://www.googleapis.com/auth/adwords.readonly'), false)
  })
})
