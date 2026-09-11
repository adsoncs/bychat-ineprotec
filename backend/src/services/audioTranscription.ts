// src/services/audioTranscription.ts
//
// Transcrição de áudio recebido, em português, rodando na própria máquina
// (faster-whisper via `scripts/transcribe.py` — sem chave de API, sem enviar o
// áudio do contato para fora).
//
// Por que virou serviço: o código vivia dentro de `routes/whatsapp.ts`, o
// webhook da Evolution, e não era exportado. Quem recebe áudio pela Cloud API
// passava por outro arquivo e nunca chamava nada disso — então no ineprotec, que
// só tem Cloud API, a chave "transcrever áudios" ficava LIGADA em Configurações
// e nenhum áudio era transcrito. 62 áudios em 30 dias, nenhuma transcrição, sem
// erro nenhum no log: não havia o que falhar, a chamada não existia.
//
// Uma configuração que a tela promete e o código não cumpre é pior que uma
// configuração ausente — o operador confia nela.

import { prisma } from '../lib/prisma.js'

let flagEmCache: { value: boolean; at: number } | null = null
const TTL_MS = 60_000

/** Chamado pelo PUT /api/admin/settings — o toggle vale no áudio seguinte. */
export function invalidarFlagTranscricao(): void {
  flagEmCache = null
}

/** A instalação está com "transcrever áudios" ligado? (padrão: sim) */
export async function transcricaoLigada(): Promise<boolean> {
  if (flagEmCache && Date.now() - flagEmCache.at < TTL_MS) return flagEmCache.value
  let enabled = true
  const row = await prisma.setting
    .findUnique({ where: { key: 'conversations.transcribe_audio' } })
    .catch(() => null)
  if (row && row.value != null) {
    const v = typeof row.value === 'string' ? row.value.replace(/^"|"$/g, '') : row.value
    enabled = v === true || v === 'true' || v === 1 || v === '1'
  }
  flagEmCache = { value: enabled, at: Date.now() }
  return enabled
}

/**
 * Transcreve o áudio. Devolve `null` quando não dá — nunca lança: um áudio que
 * não transcreve continua tocável na conversa, e derrubar o webhook por causa
 * da legenda perderia a mensagem inteira.
 *
 * `extensao` importa: o ffmpeg que o whisper usa por baixo decide o decodificador
 * pelo arquivo. A Cloud API entrega `audio/ogg`, a Evolution costuma entregar
 * o mesmo, mas gravações encaminhadas chegam como mp3/m4a — salvar tudo como
 * `.ogg` fazia o decodificador errar em cima de um arquivo que era válido.
 */
export async function transcreverAudio(
  audioBuffer: Buffer,
  formato?: string | null,
): Promise<string | null> {
  try {
    const { writeFileSync, unlinkSync, mkdirSync } = await import('fs')
    const { join } = await import('path')
    const { execFileSync } = await import('child_process')
    const { randomUUID } = await import('crypto')

    const tmpDir = '/tmp/bychat-audio'
    mkdirSync(tmpDir, { recursive: true })

    const tmpFile = join(tmpDir, `${randomUUID()}.${extensaoDeAudio(formato)}`)
    writeFileSync(tmpFile, audioBuffer)

    try {
      // execFile, não exec: o caminho do arquivo entra como argumento, não como
      // texto de shell. É o que impede um nome de arquivo de virar comando.
      const scriptPath = join(process.cwd(), 'scripts', 'transcribe.py')
      const result = execFileSync('python3', [scriptPath, tmpFile], {
        timeout: 120_000,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      })
      const parsed = JSON.parse(String(result).trim())
      if (parsed.error) {
        console.error(`[audio] transcrição falhou: ${parsed.error}`)
        return null
      }
      const texto = String(parsed.text || '').trim()
      return texto || null
    } finally {
      try { unlinkSync(tmpFile) } catch { /* o arquivo já era temporário */ }
    }
  } catch (err: any) {
    console.error('[audio] transcrição falhou:', err?.message || err)
    return null
  }
}

export function extensaoDeAudio(formato?: string | null): string {
  const m = String(formato || '').toLowerCase().split(';')[0]!.trim()
  // Já é uma extensão? Quem chama nem sempre tem o mime — o webhook da Cloud
  // API do terram passa `saved.ext` ("ogg", "m4a"). Aceitar os dois evita que
  // um chamador correto caia no palpite do default.
  if (m && !m.includes('/')) {
    const limpa = m.replace(/^\./, '')
    if (/^[a-z0-9]{2,5}$/.test(limpa)) return limpa
  }
  const mapa: Record<string, string> = {
    'audio/ogg': 'ogg',
    'audio/opus': 'ogg',
    'audio/mpeg': 'mp3',
    'audio/mp3': 'mp3',
    'audio/mp4': 'm4a',
    'audio/m4a': 'm4a',
    'audio/x-m4a': 'm4a',
    'audio/wav': 'wav',
    'audio/x-wav': 'wav',
    'audio/webm': 'webm',
    'audio/amr': 'amr',
    'audio/aac': 'aac',
  }
  return mapa[m] || 'ogg'
}

/**
 * Nome anterior, mantido porque o webhook da Cloud API do terram já chamava
 * assim desde antes. Trocar o nome lá dentro seria uma mudança sem ganho, e
 * apagaria o histórico de quem resolveu isso primeiro.
 */
export const transcribeAudio = transcreverAudio
