// tests/audioTranscription.test.ts
//
// A transcrição estava LIGADA e não acontecia.
//
// O código vivia dentro de `routes/whatsapp.ts` — o webhook da Evolution — e não
// era exportado. Quem recebe áudio pela Cloud API passa por outro arquivo e
// nunca chamava nada disso. No ineprotec, que só tem Cloud API, a chave
// "transcrever áudios" ficou ligada em Configurações e os 62 áudios de 30 dias
// chegaram sem uma linha de texto — e sem um erro sequer no log, porque não
// havia o que falhar: a chamada não existia.
//
// Uma configuração que a tela promete e o código não cumpre é pior que uma
// configuração ausente: o operador confia nela e para de ouvir os áudios.
//
//   cd backend && npx tsx --test tests/audioTranscription.test.ts

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { extensaoDeAudio, transcreverAudio } from '../src/services/audioTranscription.js'

describe('a extensão decide o decodificador', () => {
  test('o formato que a Cloud API entrega', () => {
    // A Meta manda `audio/ogg; codecs=opus` — com parâmetro depois do ponto e
    // vírgula. Comparar a string inteira não casaria com nada.
    assert.equal(extensaoDeAudio('audio/ogg; codecs=opus'), 'ogg')
    assert.equal(extensaoDeAudio('audio/ogg'), 'ogg')
    assert.equal(extensaoDeAudio('audio/opus'), 'ogg')
  })

  test('áudio encaminhado chega em outros formatos', () => {
    assert.equal(extensaoDeAudio('audio/mpeg'), 'mp3')
    assert.equal(extensaoDeAudio('audio/mp4'), 'm4a')
    assert.equal(extensaoDeAudio('audio/x-m4a'), 'm4a')
    assert.equal(extensaoDeAudio('audio/wav'), 'wav')
    assert.equal(extensaoDeAudio('audio/amr'), 'amr')
  })

  test('maiúsculas e espaços não atrapalham', () => {
    assert.equal(extensaoDeAudio('  AUDIO/MPEG  '), 'mp3')
  })

  test('sem mime, assume ogg — que é o caso comum dos dois canais', () => {
    for (const v of [null, undefined, '', 'coisa/desconhecida']) {
      assert.equal(extensaoDeAudio(v as any), 'ogg')
    }
  })

  test('aceita extensão crua, não só mime', () => {
    // O webhook da Cloud API do terram já passava `saved.ext` ("ogg", "m4a").
    // Tratar isso como mime desconhecido jogaria fora um formato correto.
    assert.equal(extensaoDeAudio('m4a'), 'm4a')
    assert.equal(extensaoDeAudio('mp3'), 'mp3')
    assert.equal(extensaoDeAudio('.wav'), 'wav')
  })

  test('lixo longo não vira extensão', () => {
    assert.equal(extensaoDeAudio('nome-de-arquivo-inteiro-sem-sentido'), 'ogg')
  })
})

describe('falhar não pode custar a mensagem', () => {
  test('buffer que não é áudio devolve null, sem lançar', async () => {
    // Se isto lançasse, o webhook perderia a mensagem INTEIRA por causa da
    // legenda — o áudio deixaria de existir na conversa.
    const r = await transcreverAudio(Buffer.from('isto não é um áudio'), 'audio/ogg')
    assert.equal(r, null)
  })

  test('buffer vazio também', async () => {
    assert.equal(await transcreverAudio(Buffer.alloc(0), 'audio/ogg'), null)
  })
})
