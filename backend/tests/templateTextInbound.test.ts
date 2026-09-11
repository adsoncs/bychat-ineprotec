// tests/templateTextInbound.test.ts
//
// Mensagem com botões ou lista tem texto — e o webhook não o lia.
//
// A Evolution entrega esse tipo com o conteúdo em `templateMessage`, aninhado
// num `hydratedTemplate`. O extrator olhava só `conversation` e
// `extendedTextMessage`, então a mensagem inteira era descartada: não virava
// bolha, não entrava no histórico, não existia.
//
// Medido no elementus em 11/09/2026: 137 dessas em 11 dias, todas lembretes de
// consulta que a clínica dispara por fora ("Por aqui está tudo certo para sua
// consulta às 14:00"). O atendente abria a ficha do paciente sem ver que ele já
// tinha sido avisado — e o "confirmado" que voltava chegava sem contexto.
//
//   cd backend && npx tsx --test tests/templateTextInbound.test.ts

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

// Cópia fiel do helper de routes/whatsapp.ts. O webhook é uma rota Fastify de
// milhares de linhas, com import de banco e fila: extrair a regra é o que
// permite testá-la sem subir a instalação inteira.
function templateText(message: any): string {
  const t = message?.templateMessage
  if (!t) return ''
  const h = t.hydratedTemplate || t.hydratedFourRowTemplate || t.fourRowTemplate || {}
  return String(
    h.hydratedContentText
    || h.content?.text
    || t.interactiveMessageTemplate?.body?.text
    || '',
  ).trim()
}

describe('o lembrete de consulta do elementus', () => {
  test('payload real: o texto é lido do hydratedTemplate', () => {
    const message = {
      templateMessage: {
        templateId: '1415812523651272',
        hydratedTemplate: {
          templateId: '1415812523651272',
          hydratedButtons: [],
          hydratedTitleText: '',
          hydratedContentText:
            'OláPedro tudo tranquilo? \n\nPor aqui está tudo certo aqui para sua consulta às 14:00!'
            + '\n\nJá vou mandar a localização para facilitar!\nhttps://maps.app.goo.gl/8JzvHjm76mKwq2rS9',
        },
      },
    }
    const t = templateText(message)
    assert.match(t, /sua consulta às 14:00/)
    assert.match(t, /maps\.app\.goo\.gl/, 'o link da clínica não pode se perder')
  })

  test('formato antigo (hydratedFourRowTemplate)', () => {
    const t = templateText({
      templateMessage: { hydratedFourRowTemplate: { hydratedContentText: 'Seu horário está reservado' } },
    })
    assert.equal(t, 'Seu horário está reservado')
  })

  test('formato com content.text', () => {
    const t = templateText({ templateMessage: { fourRowTemplate: { content: { text: 'Confirme sua presença' } } } })
    assert.equal(t, 'Confirme sua presença')
  })

  test('espaços em volta não entram no histórico', () => {
    assert.equal(templateText({ templateMessage: { hydratedTemplate: { hydratedContentText: '  Olá  ' } } }), 'Olá')
  })
})

describe('não inventa texto onde não há', () => {
  test('mensagem comum não é afetada', () => {
    assert.equal(templateText({ conversation: 'Bom dia' }), '')
  })

  test('template sem texto devolve vazio, não "[object Object]"', () => {
    assert.equal(templateText({ templateMessage: { hydratedTemplate: { hydratedButtons: [] } } }), '')
    assert.equal(templateText({ templateMessage: {} }), '')
  })

  test('entradas degeneradas não derrubam o webhook', () => {
    for (const v of [null, undefined, {}, { templateMessage: null }, 'texto solto']) {
      assert.equal(templateText(v as any), '')
    }
  })
})
