// tests/variantesDeDiscagem.test.ts
//
// Guarda as outras grafias que tentamos quando o WhatsApp diz que o número não
// existe.
//
// Existe por causa do lead 841 do severiano (09/09/2026): a Ideal Cartuchos
// atende num FIXO com WhatsApp Business, (18) 3623-4401. `phoneKey` insere o
// nono dígito em TODO número de 8 dígitos — fixo incluído —, então o cadastro
// virou `5518936234401`, que não existe no WhatsApp. A Evolution recusava o
// envio, a operadora tentou 13 vezes em 9 minutos e nada saiu. Consultada a
// grafia sem o 9, a mesma Evolution respondeu `exists: true` com o nome da loja.
//
// A conta de fixos assim nos 12 tenants no dia: 5.103 leads.
//
// O ponto sensível é não gerar variante para celular de verdade — sugerir
// `5518912257989` para quem tem `5518991225798` faria o envio ir para outro
// número. Por isso a distinção é pelo primeiro dígito: fixo começa em 2-5,
// celular em 9 (antes, 6-9).
//
//   cd backend && npm test

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { variantesDeDiscagem, phoneKey, numeroDiscavel, toWaNumber, displayPhone } from '../src/lib/phone.js'

describe('fixo que ganhou o nono dígito por engano', () => {
  test('o caso da Ideal Cartuchos', () => {
    // é o próprio phoneKey que cria o número inexistente
    assert.equal(phoneKey('551836234401'), '5518936234401')
    assert.deepEqual(variantesDeDiscagem('5518936234401'), ['551836234401'])
  })

  test('vale para todo início de fixo (2 a 5)', () => {
    assert.deepEqual(variantesDeDiscagem('5511925551234'), ['551125551234'])
    assert.deepEqual(variantesDeDiscagem('5511935551234'), ['551135551234'])
    assert.deepEqual(variantesDeDiscagem('5511945551234'), ['551145551234'])
    assert.deepEqual(variantesDeDiscagem('5511955551234'), ['551155551234'])
  })
})

describe('celular antigo, sem o nono dígito', () => {
  test('ganha a variante com 9', () => {
    assert.deepEqual(variantesDeDiscagem('551891225798'), ['5518991225798'])
    assert.deepEqual(variantesDeDiscagem('551186543210'), ['5511986543210'])
  })
})

describe('o que NÃO pode gerar variante', () => {
  test('celular já correto fica em paz', () => {
    assert.deepEqual(variantesDeDiscagem('5518991225798'), [])
  })

  test('fixo já correto não ganha o 9 de volta', () => {
    // 551836234401 tem 8 dígitos começando em 3 — é fixo, não celular antigo
    assert.deepEqual(variantesDeDiscagem('551836234401'), [])
  })

  test('LID não é telefone', () => {
    assert.deepEqual(variantesDeDiscagem('10200597692602'), [])
    assert.deepEqual(variantesDeDiscagem('273576666079449'), [])
    assert.deepEqual(variantesDeDiscagem('123093846614261@lid'), [])
  })

  test('vazio e lixo', () => {
    assert.deepEqual(variantesDeDiscagem(''), [])
    assert.deepEqual(variantesDeDiscagem(null), [])
    assert.deepEqual(variantesDeDiscagem('abc'), [])
  })

  test('número de outro país não é mexido', () => {
    assert.deepEqual(variantesDeDiscagem('12125551234'), [])
    assert.deepEqual(variantesDeDiscagem('351912345678'), [])
  })
})

describe('a variante é sempre um número discável diferente do original', () => {
  for (const n of ['5518936234401', '551891225798', '5511925551234']) {
    test(n, () => {
      for (const v of variantesDeDiscagem(n)) {
        assert.notEqual(v, n)
        assert.match(v, /^55[1-9][1-9]\d{8,9}$/)
      }
    })
  }
})

// 01/10/2026: a Ideal Cartuchos de novo, agora lead 1334. A operadora editou o
// contato várias vezes tirando o 9 e ele voltava: a gravação passa o `whatsapp`
// pela normalização, que punha o 9 de volta. O número discável (o que se grava e
// se disca) não tem mais esse 9; a chave de match continua igual.
describe('número discável: fixo sem o nono dígito, chave intacta', () => {
  test('o fixo digitado sem o 9 fica sem o 9', () => {
    for (const n of ['551836234401', '1836234401', '(18) 3623-4401', '+55 18 3623-4401']) {
      assert.equal(numeroDiscavel(n), '551836234401', n)
      assert.equal(toWaNumber(n), '551836234401', n)
      assert.equal(displayPhone(n), '551836234401', n)
    }
  })

  test('a chave continua a mesma: a conversa antiga não se separa do lead', () => {
    assert.equal(phoneKey('551836234401'), '5518936234401')
    assert.equal(phoneKey('5518936234401'), '5518936234401')
  })

  test('9 digitado por quem preencheu é respeitado (celular de SP em 9 5xxx existe)', () => {
    assert.equal(numeroDiscavel('5511955551234'), '5511955551234')
    assert.equal(numeroDiscavel('11 95555-1234'), '5511955551234')
    assert.equal(numeroDiscavel('5518936234401'), '5518936234401')
  })

  test('celular antigo sem o 9 continua ganhando o 9', () => {
    assert.equal(numeroDiscavel('551891225798'), '5518991225798')
    assert.equal(numeroDiscavel('1881233917'), '5518981233917')
  })

  test('celular completo, estrangeiro e LID não mudam', () => {
    assert.equal(numeroDiscavel('5518991225798'), '5518991225798')
    assert.equal(numeroDiscavel('+1 (689) 206-4057'), phoneKey('+1 (689) 206-4057'))
    assert.equal(numeroDiscavel('273228723392569@lid'), null)
  })
})
