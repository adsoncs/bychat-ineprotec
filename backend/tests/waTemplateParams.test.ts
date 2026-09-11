// tests/waTemplateParams.test.ts
//
// O caso real: em 11/09/2026 a Tatiane agendou uma reunião no beyond e recebeu
//
//     Olá, —!
//     Recebemos o seu agendamento da *—* para — 📅
//     Acesse pelo link no horário marcado: —
//
// Os dados estavam todos no lead. O template aprovado na Meta é POSICIONAL
// ({{1}}..{{4}}) e o código passa os valores POR NOME — ninguém traduzia um para
// o outro, então cada parâmetro caía no placeholder. A Meta aceitou, o envio
// "deu certo", e o operador teve de refazer a conversa na mão.
//
//   cd backend && npx tsx --test tests/waTemplateParams.test.ts

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  EMPTY_PARAM_PLACEHOLDER,
  buildBodyParams,
  renderTemplateText,
  templateBodyTokens,
} from '../src/lib/waTemplateParams.js'

// O template #7 do beyond, como está aprovado na Meta.
const POSICIONAL = [
  {
    type: 'BODY',
    text: 'Olá, {{1}}!\n\nRecebemos o seu agendamento da *{{2}}* para {{3}} 📅\n\nAcesse pelo link no horário marcado: {{4}}',
  },
  { type: 'FOOTER', text: 'BeyondHub' },
]

const NOMEADO = [
  { type: 'BODY', text: 'Olá, {{nome}}! Sua visita está marcada para {{data_visita}} às {{hora_visita}}.' },
]

const ORDEM = ['nome', 'reuniao', 'quando', 'link']

const VALORES = {
  nome: 'Tatiane Delmiro de Seixas',
  reuniao: 'Reunião com BeyondHub',
  quando: 'quinta-feira, 11 de setembro de 2026 às 17:00',
  link: 'https://meet.google.com/abc-defg-hij',
}

describe('template posicional preenchido por nome', () => {
  test('o caso da Tatiane: os quatro campos chegam preenchidos', () => {
    const { params, faltando } = buildBodyParams(POSICIONAL, VALORES, ORDEM)
    assert.deepEqual(faltando, [], 'nenhuma variável pode ficar sem valor')
    assert.equal(params.length, 4)
    assert.equal(params[0].text, 'Tatiane Delmiro de Seixas')
    assert.equal(params[1].text, 'Reunião com BeyondHub')
    assert.equal(params[2].text, 'quinta-feira, 11 de setembro de 2026 às 17:00')
    assert.equal(params[3].text, 'https://meet.google.com/abc-defg-hij')
  })

  test('posicional NÃO leva parameter_name — a Meta recusa com #132000', () => {
    const { params } = buildBodyParams(POSICIONAL, VALORES, ORDEM)
    for (const p of params) assert.equal(p.parameter_name, undefined)
  })

  test('o texto registrado é o que o cliente leu', () => {
    const texto = renderTemplateText(POSICIONAL, VALORES, ORDEM)
    assert.match(texto, /Olá, Tatiane Delmiro de Seixas!/)
    assert.match(texto, /Reunião com BeyondHub/)
    assert.ok(!texto.includes(EMPTY_PARAM_PLACEHOLDER), 'nenhum travessão sobra no texto')
  })

  test('sem a ordem, o posicional denuncia em vez de sair em branco', () => {
    // Era exatamente esta chamada — sem ordem — que produzia a mensagem com "—".
    const { faltando } = buildBodyParams(POSICIONAL, VALORES)
    assert.deepEqual(faltando, ['1', '2', '3', '4'],
      'quem envia precisa SABER que a mensagem sairia vazia')
  })
})

describe('template nomeado continua como era', () => {
  test('casa pelo nome do token, sem depender de ordem', () => {
    const valores = { nome: 'Marcia', data_visita: '12/09/2026', hora_visita: '14h30' }
    const { params, faltando } = buildBodyParams(NOMEADO, valores, ORDEM)
    assert.deepEqual(faltando, [])
    assert.equal(params[0].text, 'Marcia')
    assert.equal(params[0].parameter_name, 'nome', 'nomeado EXIGE parameter_name')
    assert.equal(params[1].text, '12/09/2026')
    assert.equal(params[2].text, '14h30')
  })

  test('a ordem posicional não atrapalha um template nomeado', () => {
    const { params } = buildBodyParams(NOMEADO, { nome: 'Marcia', data_visita: 'x', hora_visita: 'y' }, ORDEM)
    assert.equal(params[0].text, 'Marcia', 'não pode pegar o "nome" pela posição 1 por acidente')
  })
})

describe('o que falta é sempre dito', () => {
  test('nomeado sem um dos valores', () => {
    const { faltando } = buildBodyParams(NOMEADO, { nome: 'Marcia' })
    assert.deepEqual(faltando, ['data_visita', 'hora_visita'])
  })

  test('posicional com valor faltando no meio', () => {
    const { faltando } = buildBodyParams(POSICIONAL, { ...VALORES, quando: '' }, ORDEM)
    assert.deepEqual(faltando, ['3'])
  })

  test('template sem BODY (sincronização vazia) não tem o que faltar', () => {
    const { params, faltando } = buildBodyParams([], VALORES, ORDEM)
    assert.deepEqual(params, [])
    assert.deepEqual(faltando, [])
  })

  test('valores já entregues por número continuam valendo', () => {
    const { params, faltando } = buildBodyParams(POSICIONAL, { '1': 'A', '2': 'B', '3': 'C', '4': 'D' })
    assert.deepEqual(faltando, [])
    assert.equal(params[0].text, 'A')
  })
})

describe('leitura dos tokens', () => {
  test('reconhece posicional e ordena por número', () => {
    const r = templateBodyTokens([{ type: 'BODY', text: '{{3}} {{1}} {{2}}' }])
    assert.equal(r.named, false)
    assert.deepEqual(r.tokens, ['1', '2', '3'])
  })

  test('reconhece nomeado e preserva a ordem de aparição', () => {
    const r = templateBodyTokens([{ type: 'BODY', text: '{{saudacao}} {{nome}}' }])
    assert.equal(r.named, true)
    assert.deepEqual(r.tokens, ['saudacao', 'nome'])
  })

  test('variável repetida conta uma vez só — é como a Meta conta', () => {
    const r = templateBodyTokens([{ type: 'BODY', text: '{{1}} e de novo {{1}}, com {{2}}' }])
    assert.deepEqual(r.tokens, ['1', '2'])
  })
})
