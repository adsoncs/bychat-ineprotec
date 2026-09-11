// tests/whatsappErrosLinha.test.ts
//
// "Connection Closed" não é o aparelho desconectado.
//
// É o socket do Baileys, dentro da Evolution. A instância continua reportando
// `open`, responde a consultas autenticadas, e mesmo assim recusa TODO envio.
// No elementus, em 11/09/2026, foram 41 tentativas em um dia — nenhuma saiu,
// com a tela mostrando a linha conectada e o operador clicando em enviar.
//
// A frase antiga mandava esse operador reconectar o QR Code. Ele ia até o
// celular, via o WhatsApp normalmente conectado, e voltava sem entender —
// porque o aparelho dele nunca esteve fora do ar. O que precisa religar está
// no servidor.
//
//   cd backend && npx tsx --test tests/whatsappErrosLinha.test.ts

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { humanizeWhatsAppError } from '../src/lib/whatsappErrors.js'

describe('socket fechado × aparelho desconectado', () => {
  test('o erro real do elementus (HTTP 500) manda religar a CONEXÃO, não o aparelho', () => {
    const m = humanizeWhatsAppError(
      { status: 500, error: 'Internal Server Error', response: { message: 'Connection Closed' } }, 500,
    )
    assert.match(m, /parou de aceitar envios/)
    assert.match(m, /Reconectar/, 'precisa dizer ONDE se resolve')
    assert.ok(!/QR Code/.test(m), 'o aparelho está conectado — mandar ao QR Code é mandar procurar o problema errado')
  })

  test('a variante HTTP 400 do mesmo erro cai na mesma frase', () => {
    const m = humanizeWhatsAppError(
      { status: 400, error: 'Bad Request', response: { message: ['Error: Connection Closed'] } }, 400,
    )
    assert.match(m, /parou de aceitar envios/)
  })

  test('aparelho REALMENTE desconectado continua indo ao QR Code', () => {
    for (const cru of [{ message: 'instance desconectada' }, { message: 'Device logged out' }]) {
      const m = humanizeWhatsAppError(cru, 401)
      assert.match(m, /QR Code/, `deveria mandar ao QR Code: ${JSON.stringify(cru)}`)
    }
  })
})

describe('as outras recusas seguem reconhecidas', () => {
  test('instância que não existe mais', () => {
    assert.match(humanizeWhatsAppError({ message: 'instance not found' }, 404), /não existe mais/)
  })

  test('número sem WhatsApp continua nomeando o número', () => {
    const m = humanizeWhatsAppError({ response: { message: [{ exists: false, number: '5562999998888' }] } }, 400)
    assert.match(m, /não tem WhatsApp|não respondeu como conta/)
  })

  test('excesso de envios', () => {
    assert.match(humanizeWhatsAppError({ message: 'rate limit exceeded' }, 429), /Aguarde alguns minutos/)
  })

  test('erro desconhecido não vira causa inventada', () => {
    const m = humanizeWhatsAppError({ message: 'algo totalmente novo' }, 503)
    assert.ok(!/QR Code|desconectada/.test(m), 'sem diagnóstico, não se chuta um')
  })
})
