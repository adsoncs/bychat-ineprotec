// src/services/inboundMedia.ts
//
// Mídia recebida do cliente (foto, áudio, documento) → algo que o motor de IA
// (aiJourneyEngine) consiga usar. Sem isto o chatbot só via TEXTO: foto sem
// legenda nem chegava nele (o webhook retornava antes), e foto com legenda
// chegava sem a foto — o bot respondia no escuro, ou ficava mudo, enquanto a
// pessoa esperava. Veio do severiano (out/2026), onde já roda em produção.
//
// Só é usado quando o tenant liga a leitura de mídia na jornada
// (Setting `ai.journey.read_media`). Desligado, o motor continua como sempre:
// só texto.
//
// Duas conversões:
//   imagem → bloco de imagem base64 no turno do modelo (visão);
//   áudio  → transcrição local pelo MESMO serviço do webhook
//            (services/audioTranscription.ts, faster-whisper, sem API externa),
//            respeitando a chave "transcrever áudios" de Configurações.
// O resto (documento, vídeo) vira um marcador de texto honesto, para o bot
// reconhecer o envio e seguir o atendimento em vez de ignorar a pessoa.

import { promises as fs } from 'node:fs'
import { join, normalize, sep } from 'node:path'
import { execFile } from 'node:child_process'
import { transcreverAudio, transcricaoLigada } from './audioTranscription.js'

export interface InboundMedia {
  /** image | audio | video | document | sticker | gif */
  type: string
  /** caminho relativo salvo pelo webhook (ex.: /uploads/evolution-media/x.jpg) */
  url?: string | null
  mime?: string | null
  name?: string | null
  /** true = o webhook já gravou esta mensagem na conversa (não gravar de novo) */
  saved?: boolean
}

// A API aceita imagem base64 até ~5MB; acima disso a chamada inteira falha e o
// lead fica sem resposta. Trabalhamos com folga e reduzimos o que passar disso.
const MAX_IMAGE_BYTES = 3 * 1024 * 1024
const RESIZE_TIMEOUT_MS = 15000

const EXT_MIME: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
  webp: 'image/webp', gif: 'image/gif',
}
const SUPPORTED_IMAGE_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])

const UPLOADS_ROOT = join(process.cwd(), '..', 'uploads')

/**
 * Caminho absoluto de um mediaUrl relativo (/uploads/... fica um nível acima do
 * backend, igual ao fastify-static do server.ts). Devolve null para o que não é
 * arquivo nosso: URL externa, ou caminho que tente sair de uploads/ — o motor
 * lê o arquivo e manda o conteúdo ao modelo, então não pode ler fora dali.
 */
export function mediaAbsPath(url: string): string | null {
  const limpo = String(url || '').split('?')[0]!.replace(/^\/+/, '')
  if (!limpo.startsWith('uploads/')) return null
  const abs = normalize(join(process.cwd(), '..', limpo))
  return abs.startsWith(UPLOADS_ROOT + sep) ? abs : null
}

function run(cmd: string, args: string[], timeout: number): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout, maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => {
      if (err) reject(err); else resolve(String(stdout || ''))
    })
  })
}

/**
 * Lê a imagem para base64. Se estiver acima do teto, reduz com ffmpeg (já
 * instalado no host, usado pelo pipeline de áudio) — 1568px é o lado máximo que
 * a Anthropic recomenda; acima disso a imagem é reescalada do lado dela mesmo.
 * Devolve null quando não dá para usar: o chamador cai no marcador de texto.
 */
export async function readImageForModel(url: string, mime?: string | null): Promise<{ data: string; mediaType: string } | null> {
  try {
    const abs = mediaAbsPath(url)
    if (!abs) return null
    const ext = (abs.split('.').pop() || '').toLowerCase()
    let mediaType = (mime && SUPPORTED_IMAGE_MIME.has(mime) ? mime : EXT_MIME[ext]) || ''
    if (!SUPPORTED_IMAGE_MIME.has(mediaType)) return null

    let buf = await fs.readFile(abs)
    if (buf.length > MAX_IMAGE_BYTES) {
      const out = `${abs}.small.jpg`
      try {
        await run('ffmpeg', ['-y', '-i', abs, '-vf', "scale='min(1568,iw)':-2", '-q:v', '4', out], RESIZE_TIMEOUT_MS)
        buf = await fs.readFile(out)
        mediaType = 'image/jpeg'
        await fs.unlink(out).catch(() => {})
      } catch { return null }
      if (buf.length > MAX_IMAGE_BYTES) return null
    }
    return { data: buf.toString('base64'), mediaType }
  } catch {
    return null
  }
}

/**
 * Transcreve um áudio recebido que chegou SEM texto. A Evolution e o webhook da
 * Cloud API já transcrevem na entrada quando a chave está ligada — isto cobre o
 * que escapou (ex.: falha pontual). Com a chave "transcrever áudios" desligada
 * não transcreve: a configuração da tela vale também aqui.
 */
export async function transcribeInboundAudio(url: string): Promise<string | null> {
  try {
    if (!(await transcricaoLigada())) return null
    const abs = mediaAbsPath(url)
    if (!abs) return null
    const buf = await fs.readFile(abs)
    const ext = (abs.split('.').pop() || '').toLowerCase()
    return await transcreverAudio(buf, ext || null)
  } catch {
    return null
  }
}

/** Descrição honesta do que chegou, para o bot reagir sem inventar conteúdo. */
export function mediaPlaceholder(media: InboundMedia): string {
  switch (media.type) {
    case 'image': return '[o cliente enviou uma imagem]'
    case 'sticker': return '[o cliente enviou uma figurinha]'
    case 'audio': return '[o cliente enviou um áudio que não foi possível transcrever]'
    case 'video': return '[o cliente enviou um vídeo — você não consegue assisti-lo]'
    case 'gif': return '[o cliente enviou um GIF]'
    case 'document': return `[o cliente enviou um documento${media.name ? `: ${media.name}` : ''} — você não consegue abri-lo]`
    default: return `[o cliente enviou um anexo (${media.type})]`
  }
}
