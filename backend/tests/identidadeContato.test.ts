// tests/identidadeContato.test.ts
//
// LID do WhatsApp não é telefone de ninguém.
//
// Quando a Meta entrega só o LID e nem `remoteJidAlt` nem as heurísticas
// devolvem o número, o valor que circula pelo código é o LID. Ele serve para
// RESPONDER — e por isso circula —, mas gravá-lo na coluna `whatsapp` do lead
// custa caro e em silêncio: a pessoa volta com o número real e vira outro lead,
// o disparo ativo não chega, e a ficha mostra um telefone que ninguém disca.
//
// Medido no severiano em 10/09/2026: 21 leads com LID na coluna de telefone,
// 15 deles sem `waLid` — a convergência que o placeholder prometia nunca
// poderia acontecer.
//
//   cd backend && npm run test:identidade-contato

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { identidadeDoContato } from '../src/lib/phone.js'
import { SEM_NUMERO, nomeInicialWhatsapp, telefoneComoNome } from '../src/services/leadDisplayName.js'

describe('LID nunca vira telefone', () => {
  test('o caso do severiano: 15 dígitos que não formam telefone', () => {
    const r = identidadeDoContato('187303641276560')
    assert.equal(r.whatsapp, '', 'a coluna de telefone fica vazia')
    assert.equal(r.waLid, '187303641276560', 'e o LID é guardado onde liga a conversa à pessoa')
  })

  test('LID com sufixo @lid', () => {
    const r = identidadeDoContato('123093846614261@lid')
    assert.equal(r.whatsapp, '')
    assert.equal(r.waLid, '123093846614261@lid')
  })

  test('JID de grupo também não é telefone', () => {
    const r = identidadeDoContato('120363426592263503@g.us')
    assert.equal(r.whatsapp, '', 'um grupo virou lead com "telefone" no severiano')
    assert.equal(r.waLid, '120363426592263503@g.us')
  })

  test('outros LIDs achados na base', () => {
    for (const lid of ['10200597692602', '229776488968429', '273576666079449', '67251017384013']) {
      const r = identidadeDoContato(lid)
      assert.equal(r.whatsapp, '', `${lid} não é telefone`)
      assert.equal(r.waLid, lid)
    }
  })
})

describe('telefone de verdade passa intacto', () => {
  test('celular brasileiro', () => {
    const r = identidadeDoContato('5562999998888')
    assert.equal(r.whatsapp, '5562999998888')
    assert.equal(r.waLid, null)
  })

  test('sem o 55', () => {
    assert.equal(identidadeDoContato('62999998888').whatsapp, '62999998888')
  })

  test('estrangeiro com DDI — o caso da Marcia', () => {
    const r = identidadeDoContato('16892064057')
    assert.equal(r.whatsapp, '16892064057', 'número dos EUA não pode ser confundido com LID')
    assert.equal(r.waLid, null)
  })

  test('Portugal', () => {
    assert.equal(identidadeDoContato('351912345678').whatsapp, '351912345678')
  })

  test('15 dígitos que SÃO um telefone continuam telefone', () => {
    // O LID do severiano tem 15 dígitos, e o teto do E.164 também é 15: quem
    // separasse os dois pelo tamanho jogaria fora um número discável. Quem
    // decide é a estrutura — este é um celular austríaco com DDI (+43 664).
    const r = identidadeDoContato('436641234567890')
    assert.equal(r.waLid, null, 'não é LID só por ser longo')
    assert.equal(r.whatsapp, '436641234567890')
  })

  test('máscara e espaços não atrapalham', () => {
    const r = identidadeDoContato(' +55 (62) 99999-8888 ')
    assert.equal(r.waLid, null)
    assert.equal(r.whatsapp, '+55 (62) 99999-8888', 'o valor chega inteiro a quem grava')
  })
})

describe('entradas vazias', () => {
  test('vazio, nulo e indefinido não inventam nada', () => {
    for (const v of ['', '   ', null, undefined]) {
      const r = identidadeDoContato(v as any)
      assert.equal(r.whatsapp, '')
      assert.equal(r.waLid, null)
    }
  })
})

describe('o nome que o operador vê', () => {
  test('LID não vira um telefone de mentira na lista', () => {
    assert.equal(telefoneComoNome('187303641276560'), SEM_NUMERO,
      'formatado, este LID virava "+18 7303641276560" — algo que se tenta discar')
  })

  test('JID de grupo também não', () => {
    assert.equal(telefoneComoNome('120363426592263503@g.us'), SEM_NUMERO)
  })

  test('telefone de verdade continua sendo mostrado', () => {
    assert.match(telefoneComoNome('5562998716285'), /62/, 'o operador reconhece o número')
    assert.notEqual(telefoneComoNome('5562998716285'), SEM_NUMERO)
  })

  test('o rótulo de espera é o mais fraco: o número real toma o lugar dele', () => {
    const semNumero = nomeInicialWhatsapp({ phone: '187303641276560' })
    assert.equal(semNumero.nome, SEM_NUMERO)
    assert.equal(semNumero.origem, 'sem_numero')

    const comNumero = nomeInicialWhatsapp({ phone: '5562998716285' })
    assert.equal(comNumero.origem, 'telefone')
  })

  test('nome da agenda da empresa vence os dois', () => {
    const r = nomeInicialWhatsapp({ nomeAgenda: 'Marcia — mãe da Júlia', phone: '187303641276560' })
    assert.equal(r.nome, 'Marcia — mãe da Júlia')
    assert.equal(r.origem, 'agenda')
  })
})
