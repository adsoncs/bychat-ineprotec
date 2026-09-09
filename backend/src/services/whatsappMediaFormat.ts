// src/services/whatsappMediaFormat.ts
//
// Põe a mídia num contêiner que o WhatsApp aceita ANTES de o link ir para a
// Meta.
//
// Este arquivo existe por causa do incidente ineprotec (04-09/09/2026): todo
// áudio gravado no painel saía em `.webm` — é o único contêiner que o Chrome
// grava — e a API Oficial da Meta não aceita WebM em áudio. A requisição de
// envio era ACEITA (a Meta devolvia o wamid na hora, porque mandamos por
// `link` e ela busca o arquivo depois) e só minutos depois chegava o status
// `failed` com o código 131053 "Media upload error". Resultado: 7 de 7 áudios
// do tenant nunca chegaram a ninguém, e o atendente via "não entregue" sem
// entender o motivo. Pela Evolution os mesmos `.webm` passavam — o Baileys
// converte por conta própria —, então o defeito só aparecia em quem usa a
// Cloud API como canal único.
//
// O que a Cloud API aceita (documentação de mídia da Meta):
//   áudio — audio/aac, audio/amr, audio/mpeg, audio/mp4, audio/ogg (só OPUS)
//   vídeo — video/mp4 (H.264 + AAC), video/3gp
// WebM não está em nenhuma das duas listas, e `audio/ogg` com Vorbis dentro
// também é recusado: por isso a decisão aqui olha o CODEC pelo ffprobe, nunca
// só a extensão do arquivo.
//
// A conversão de áudio quase sempre é troca de contêiner sem recodificar
// (`-c:a copy`): o WebM do navegador já vem em Opus, que é exatamente o codec
// que o WhatsApp usa nas notas de voz. Um áudio de 6 s levou 100.760 → 100.486
// bytes, instantâneo e sem perda.
//
// Sem ffmpeg instalado nada disso acontece: o arquivo segue como está, que é o
// comportamento antigo. Converter é melhoria; não converter não pode derrubar
// o envio.

import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { extname, join, basename } from 'node:path'
import { UPLOADS_DIR } from '../lib/uploadsDir.js'

export type TipoMidia = 'image' | 'video' | 'audio' | 'document' | 'sticker' | 'gif' | string

/** Só áudio e vídeo têm exigência de contêiner; o resto passa direto. */
const TIPOS_COM_EXIGENCIA = new Set(['audio', 'video', 'gif'])

const TIMEOUT_PROBE = 15_000
const TIMEOUT_AUDIO = 60_000
const TIMEOUT_VIDEO = 180_000

/** Sufixo do derivado, para reconhecer (e reaproveitar) o que já foi convertido. */
const SUFIXO = '.wa'

interface Sonda {
  formato: string
  audio: string | null
  video: string | null
}

function exec(cmd: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
      if (err) reject(err)
      else resolve(String(stdout || ''))
    })
  })
}

/**
 * Codecs e contêiner do arquivo. `null` quando o ffprobe não existe ou não
 * entendeu o arquivo — nesse caso o chamador deixa a mídia como está, porque
 * converter às cegas é pior do que tentar enviar.
 */
export async function sondar(caminho: string): Promise<Sonda | null> {
  try {
    const saida = await exec('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=format_name:stream=codec_type,codec_name',
      '-of', 'json',
      caminho,
    ], TIMEOUT_PROBE)

    const dados = JSON.parse(saida) as {
      format?: { format_name?: string }
      streams?: Array<{ codec_type?: string; codec_name?: string }>
    }
    const formato = String(dados.format?.format_name || '')
    if (!formato) return null

    const streams = Array.isArray(dados.streams) ? dados.streams : []
    const primeiro = (tipo: string) =>
      streams.find(s => s.codec_type === tipo)?.codec_name?.toLowerCase() || null

    return { formato, audio: primeiro('audio'), video: primeiro('video') }
  } catch {
    return null
  }
}

/**
 * O par (contêiner, codec) já é um dos que a Meta aceita?
 *
 * O `format_name` do ffprobe vem como lista ("matroska,webm", "mov,mp4,m4a…"),
 * por isso a checagem é por substring.
 */
export function aceitoPelaMeta(tipo: TipoMidia, s: Sonda): boolean {
  const f = s.formato.toLowerCase()
  if (tipo === 'audio') {
    if (f.includes('matroska') || f.includes('webm')) return false // o caso do incidente
    if (f.includes('ogg')) return s.audio === 'opus'               // ogg/Vorbis é recusado
    if (f.includes('mp3')) return s.audio === 'mp3'
    if (f.includes('amr')) return true
    if (f.includes('mp4') || f.includes('m4a')) return s.audio === 'aac'
    if (f.includes('aac') || f.includes('adts')) return true
    return false
  }
  // vídeo e GIF (que viaja como MP4)
  if (f.includes('matroska') || f.includes('webm')) return false
  if (f.includes('3gp')) return true
  if (f.includes('mp4')) return s.video === 'h264' && (s.audio === null || s.audio === 'aac')
  return false
}

/** Caminho do derivado ao lado do original: `abc.webm` → `abc.wa.ogg`. */
export function caminhoDerivado(original: string, novaExt: string): string {
  const ext = extname(original)
  const semExt = ext ? original.slice(0, -ext.length) : original
  return `${semExt}${SUFIXO}.${novaExt}`
}

/**
 * Converte o arquivo para um contêiner aceito e devolve o caminho do derivado.
 * Devolve o próprio caminho de entrada quando já está bom, quando não dá para
 * sondar, ou quando o ffmpeg falha — nunca lança.
 */
export async function converterParaFormatoAceito(caminho: string, tipo: TipoMidia): Promise<string> {
  if (!TIPOS_COM_EXIGENCIA.has(String(tipo))) return caminho
  if (!existsSync(caminho)) return caminho

  const sonda = await sondar(caminho)
  if (!sonda) return caminho
  if (aceitoPelaMeta(tipo, sonda)) return caminho

  const ehAudio = tipo === 'audio'
  const destino = caminhoDerivado(caminho, ehAudio ? 'ogg' : 'mp4')
  if (existsSync(destino)) return destino // já convertido antes

  // Opus dentro de WebM só precisa mudar de caixa; qualquer outro codec de
  // áudio é recodificado em Opus mono 32 kbps, que é o perfil de nota de voz.
  const args = ehAudio
    ? (sonda.audio === 'opus'
        ? ['-v', 'error', '-y', '-i', caminho, '-vn', '-c:a', 'copy', '-f', 'ogg', destino]
        : ['-v', 'error', '-y', '-i', caminho, '-vn', '-c:a', 'libopus', '-b:a', '32k', '-ar', '48000', '-ac', '1', '-f', 'ogg', destino])
    : ['-v', 'error', '-y', '-i', caminho, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28',
       '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart', '-f', 'mp4', destino]

  try {
    await exec('ffmpeg', args, ehAudio ? TIMEOUT_AUDIO : TIMEOUT_VIDEO)
    return existsSync(destino) ? destino : caminho
  } catch {
    return caminho
  }
}

/**
 * Arquivo local por trás de uma URL `/uploads/...`, ou `null` se a URL aponta
 * para fora (mídia de terceiro, link avulso). Recusa qualquer caminho que
 * tente sair da pasta.
 */
export function caminhoLocalDeUploads(url: string): string | null {
  const marca = '/uploads/'
  const i = url.indexOf(marca)
  if (i < 0) return null
  let rel: string
  try {
    rel = decodeURIComponent(url.slice(i + marca.length).split('?')[0].split('#')[0])
  } catch {
    return null
  }
  if (!rel || rel.startsWith('/') || rel.split(/[\\/]/).includes('..')) return null
  const abs = join(UPLOADS_DIR, rel)
  if (abs !== UPLOADS_DIR && !abs.startsWith(UPLOADS_DIR + '/')) return null
  return abs
}

/** Troca só o nome do arquivo, preservando o resto da URL. */
export function trocarArquivoNaUrl(url: string, novoNome: string): string {
  const corte = url.split('?')[0].lastIndexOf('/')
  if (corte < 0) return url
  const qs = url.slice(url.split('?')[0].length)
  return url.slice(0, corte + 1) + encodeURIComponent(novoNome) + qs
}

/**
 * Guarda do envio: recebe a URL que iria para a Meta e devolve uma URL de
 * formato aceito, convertendo o arquivo se preciso. URL de fora, arquivo
 * inexistente ou conversão falha devolvem a URL original inalterada.
 */
export async function garantirUrlAceita(url: string, tipo: TipoMidia): Promise<string> {
  if (!TIPOS_COM_EXIGENCIA.has(String(tipo))) return url
  const local = caminhoLocalDeUploads(url)
  if (!local || !existsSync(local)) return url
  const convertido = await converterParaFormatoAceito(local, tipo)
  if (convertido === local) return url
  return trocarArquivoNaUrl(url, basename(convertido))
}

/** Extensão e MIME do arquivo já convertido, para o painel exibir certo. */
export function mimeDoArquivo(caminho: string): string {
  const ext = extname(caminho).toLowerCase()
  if (ext === '.ogg') return 'audio/ogg'
  if (ext === '.mp4') return 'video/mp4'
  if (ext === '.mp3') return 'audio/mpeg'
  return 'application/octet-stream'
}

