// tests/whatsappMediaFormat.test.ts
//
// Guarda a regra de contêiner de mídia da API Oficial da Meta.
//
// Existe por causa do incidente ineprotec (04-09/09/2026): 7 de 7 áudios
// enviados pelo painel nunca chegaram ao destinatário. Todos saíam em `.webm`
// — único contêiner que o Chrome grava —, a Meta aceitava a requisição e só
// depois devolvia `failed` com 131053 no webhook de status. O mesmo arquivo
// passava pela Evolution, então o defeito ficou invisível em 11 dos 12
// tenants.
//
// O ponto sensível é `aceitoPelaMeta`: relaxar qualquer linha dela devolve o
// bug em silêncio, porque o envio continua "dando certo" na hora.
//
//   cd backend && npm test

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  aceitoPelaMeta,
  caminhoDerivado,
  caminhoLocalDeUploads,
  trocarArquivoNaUrl,
  converterParaFormatoAceito,
  sondar,
  mimeDoArquivo,
} from '../src/services/whatsappMediaFormat.js'
import { UPLOADS_DIR } from '../src/lib/uploadsDir.js'

const temFfmpeg = (() => {
  try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); return true } catch { return false }
})()

describe('aceitoPelaMeta — áudio', () => {
  test('WebM é recusado, mesmo com Opus dentro (o caso do incidente)', () => {
    assert.equal(aceitoPelaMeta('audio', { formato: 'matroska,webm', audio: 'opus', video: null }), false)
  })

  test('Ogg só vale com Opus', () => {
    assert.equal(aceitoPelaMeta('audio', { formato: 'ogg', audio: 'opus', video: null }), true)
    assert.equal(aceitoPelaMeta('audio', { formato: 'ogg', audio: 'vorbis', video: null }), false)
  })

  test('os outros contêineres da lista da Meta', () => {
    assert.equal(aceitoPelaMeta('audio', { formato: 'mp3', audio: 'mp3', video: null }), true)
    assert.equal(aceitoPelaMeta('audio', { formato: 'mov,mp4,m4a,3gp,3g2,mj2', audio: 'aac', video: null }), true)
    assert.equal(aceitoPelaMeta('audio', { formato: 'amr', audio: 'amr_nb', video: null }), true)
  })

  test('WAV não está na lista', () => {
    assert.equal(aceitoPelaMeta('audio', { formato: 'wav', audio: 'pcm_s16le', video: null }), false)
  })
})

describe('aceitoPelaMeta — vídeo', () => {
  test('MP4 precisa de H.264; áudio, se houver, precisa ser AAC', () => {
    assert.equal(aceitoPelaMeta('video', { formato: 'mov,mp4,m4a', audio: 'aac', video: 'h264' }), true)
    assert.equal(aceitoPelaMeta('video', { formato: 'mov,mp4,m4a', audio: null, video: 'h264' }), true)
    assert.equal(aceitoPelaMeta('video', { formato: 'mov,mp4,m4a', audio: 'opus', video: 'h264' }), false)
    assert.equal(aceitoPelaMeta('video', { formato: 'mov,mp4,m4a', audio: 'aac', video: 'vp9' }), false)
  })

  test('WebM de vídeo cai no mesmo 131053', () => {
    assert.equal(aceitoPelaMeta('video', { formato: 'matroska,webm', audio: 'opus', video: 'vp8' }), false)
  })
})

describe('caminhoLocalDeUploads', () => {
  test('URL nossa vira caminho dentro da pasta de uploads', () => {
    const abs = caminhoLocalDeUploads('https://ineprotec.attrae.com.br/uploads/abc.webm')
    assert.equal(abs, join(UPLOADS_DIR, 'abc.webm'))
  })

  test('subpasta e querystring', () => {
    assert.equal(
      caminhoLocalDeUploads('https://x.tld/uploads/cloud-api/a.ogg?v=2'),
      join(UPLOADS_DIR, 'cloud-api/a.ogg'),
    )
  })

  test('mídia de fora não é tocada', () => {
    assert.equal(caminhoLocalDeUploads('https://cdn.terceiro.com/audio/x.webm'), null)
  })

  test('não deixa sair da pasta', () => {
    assert.equal(caminhoLocalDeUploads('https://x.tld/uploads/../../etc/passwd'), null)
    assert.equal(caminhoLocalDeUploads('https://x.tld/uploads/%2e%2e/%2e%2e/etc/passwd'), null)
  })
})

describe('nomes e URLs', () => {
  test('o derivado fica ao lado do original, com marca própria', () => {
    assert.equal(caminhoDerivado('/up/abc.webm', 'ogg'), '/up/abc.wa.ogg')
    assert.equal(caminhoDerivado('/up/sem-extensao', 'ogg'), '/up/sem-extensao.wa.ogg')
  })

  test('trocar o arquivo preserva o resto da URL', () => {
    assert.equal(
      trocarArquivoNaUrl('https://x.tld/uploads/abc.webm', 'abc.wa.ogg'),
      'https://x.tld/uploads/abc.wa.ogg',
    )
  })

  test('MIME do convertido', () => {
    assert.equal(mimeDoArquivo('/up/a.wa.ogg'), 'audio/ogg')
    assert.equal(mimeDoArquivo('/up/a.wa.mp4'), 'video/mp4')
  })
})

describe('conversão de verdade (precisa de ffmpeg)', { skip: !temFfmpeg ? 'ffmpeg não instalado' : false }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'wamedia-'))

  test('WebM/Opus vira Ogg/Opus sem recodificar', async () => {
    const origem = join(dir, 'nota.webm')
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2',
      '-c:a', 'libopus', '-f', 'webm', origem])

    const antes = await sondar(origem)
    assert.equal(aceitoPelaMeta('audio', antes!), false)

    const saida = await converterParaFormatoAceito(origem, 'audio')
    assert.notEqual(saida, origem)
    assert.ok(existsSync(saida))

    const depois = await sondar(saida)
    assert.equal(depois!.audio, 'opus')       // mesmo codec: foi só troca de caixa
    assert.ok(depois!.formato.includes('ogg'))
    assert.equal(aceitoPelaMeta('audio', depois!), true)
  })

  test('WAV é recodificado em Opus', async () => {
    const origem = join(dir, 'gravacao.wav')
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', origem])

    const saida = await converterParaFormatoAceito(origem, 'audio')
    const depois = await sondar(saida)
    assert.equal(depois!.audio, 'opus')
    assert.equal(aceitoPelaMeta('audio', depois!), true)
  })

  test('o que já está bom não é mexido', async () => {
    const origem = join(dir, 'ok.ogg')
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1',
      '-c:a', 'libopus', origem])
    assert.equal(await converterParaFormatoAceito(origem, 'audio'), origem)
  })

  test('arquivo ilegível segue como está — converter às cegas seria pior', async () => {
    const origem = join(dir, 'quebrado.webm')
    writeFileSync(origem, 'isto não é mídia')
    assert.equal(await converterParaFormatoAceito(origem, 'audio'), origem)
  })

  test('documento e imagem não passam por conversão', async () => {
    const origem = join(dir, 'contrato.pdf')
    writeFileSync(origem, '%PDF-1.4')
    assert.equal(await converterParaFormatoAceito(origem, 'document'), origem)
  })

  test.after?.(() => rmSync(dir, { recursive: true, force: true }))
})
