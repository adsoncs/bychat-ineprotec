// src/services/chatMediaFetcher.ts
//
// Baixa a mídia das mensagens importadas do aparelho.
//
// A importação (chatImportRunner) grava a mensagem com o tipo certo e SEM
// arquivo: baixar tudo de antemão é o que trava a sincronização — cada arquivo
// é uma chamada à Evolution mais gravação em disco, e uma conversa antiga tem
// centenas. Aqui o download acontece quando o operador abre a conversa, só do
// que ele vai realmente ver.
//
// A mídia do WhatsApp é criptografada ponta a ponta: a `url` do histórico não
// abre no navegador. Quem decifra é `getBase64FromMediaMessage`, que precisa da
// `key` original da mensagem — remontada aqui a partir do externalId (id), do
// remoteJid do job de importação e do fromMe da própria mensagem.

import { mkdir, writeFile } from 'fs/promises'
import { join } from 'path'
import { prisma } from '../lib/prisma.js'

const EVO_MEDIA_DIR = join(process.cwd(), '..', 'uploads', 'evolution-media')

function extDe(mime: string, fallback: string): string {
  const m = (mime || '').split(';')[0].trim().toLowerCase()
  const map: Record<string, string> = {
    'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
    'video/mp4': 'mp4', 'video/3gpp': '3gp', 'video/quicktime': 'mov',
    'audio/ogg': 'ogg', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/amr': 'amr', 'audio/wav': 'wav',
    'application/pdf': 'pdf',
  }
  if (map[m]) return map[m]
  const sub = (m.split('/')[1] || '').replace(/[^a-z0-9]/g, '')
  return sub || fallback
}

async function salvar(buf: Buffer, mime: string, mediaType: string): Promise<string> {
  const fb = mediaType === 'image' ? 'jpg'
    : mediaType === 'video' ? 'mp4'
      : mediaType === 'audio' ? 'ogg'
        : mediaType === 'sticker' ? 'webp' : 'bin'
  const ext = extDe(mime, fb)
  await mkdir(EVO_MEDIA_DIR, { recursive: true })
  const nome = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${ext}`
  await writeFile(join(EVO_MEDIA_DIR, nome), buf)
  return `/uploads/evolution-media/${nome}`
}

/** Teto por arquivo. Decifrar mídia antiga é lento, e mídia sumida do servidor
 *  do WhatsApp fica pendurada — sem isso, uma única chamada trava o lote. */
const TIMEOUT_POR_MIDIA_MS = 12_000
/** Orçamento do lote inteiro. O nginx corta o upstream em 60s: se a resposta
 *  não sair antes disso, o operador recebe erro de proxy no lugar do resultado,
 *  mesmo com as mídias sendo gravadas. Melhor devolver o parcial e deixar ele
 *  pedir o resto. */
const ORCAMENTO_LOTE_MS = 30_000

/** Erro da Evolution com o corpo preservado — é o corpo que diz se o arquivo
 *  sumiu de vez ou se foi um tropeço passageiro. */
class EvoMediaError extends Error {
  readonly status: number
  readonly corpo: string
  constructor(status: number, corpo: string) {
    super(`Evolution ${status}`)
    this.status = status
    this.corpo = corpo
  }
}

/**
 * Arquivo que o WhatsApp não entrega mais.
 *
 * O CDN devolve "Failed to fetch stream" quando a URL cifrada expirou (o
 * parâmetro `oe=` da própria URL é a validade). Isso é definitivo: nem o
 * aparelho recupera. Timeout e queda de rede, ao contrário, merecem nova
 * tentativa — por isso a distinção.
 */
function midiaSumiu(e: unknown): boolean {
  if (!(e instanceof EvoMediaError)) return false
  return e.status === 400 && /failed to fetch stream|no such file|not found/i.test(e.corpo)
}

async function evoFetch(path: string, body: unknown): Promise<any> {
  const url = process.env.EVOLUTION_API_URL || ''
  const key = process.env.EVOLUTION_API_KEY || ''
  if (!url || !key) throw new Error('Evolution API não configurada')
  const r = await fetch(`${url}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: key },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_POR_MIDIA_MS),
  })
  if (!r.ok) throw new EvoMediaError(r.status, await r.text().catch(() => ''))
  return r.json()
}

export interface ResultadoMidias {
  baixadas: number
  falharam: number
  restantes: number
  /** Verdadeiro quando o lote parou pelo tempo, não por ter acabado. */
  parcial?: boolean
  /** Quantas o WhatsApp já expirou — não voltam, e não serão tentadas de novo. */
  expiradas?: number
}

/** Mídias sem arquivo que ainda vale a pena tentar. */
function filtroPendentes(leadId: number) {
  return {
    leadId,
    mediaUrl: null,
    mediaUnavailableAt: null,
    externalId: { not: null },
    mediaType: { in: ['image', 'video', 'audio', 'sticker', 'document'] },
  }
}

/**
 * Baixa as mídias pendentes de uma conversa.
 *
 * `limite` existe porque uma conversa importada pode ter centenas de imagens:
 * abrir a conversa não pode virar uma rajada de downloads. O front chama de
 * novo conforme o operador rola o histórico.
 */
export async function baixarMidiasPendentes(leadId: number, limite = 15): Promise<ResultadoMidias> {
  // O remoteJid original vive no job de importação — a mensagem só guarda o
  // externalId. Em chat @lid o JID não é o telefone, então reconstruir a partir
  // do número do lead daria uma key inválida.
  const job = await prisma.chatImportJob.findFirst({
    where: { leadId },
    orderBy: { createdAt: 'desc' },
    select: { remoteJid: true, instanceName: true },
  })
  if (!job) return { baixadas: 0, falharam: 0, restantes: 0 }

  const pendentes = await prisma.message.findMany({
    where: filtroPendentes(leadId),
    orderBy: { timestamp: 'desc' },
    take: limite,
    select: { id: true, externalId: true, fromMe: true, mediaType: true },
  })
  if (!pendentes.length) return { baixadas: 0, falharam: 0, restantes: 0 }

  let baixadas = 0
  let falharam = 0
  let expiradas = 0
  let parcial = false
  const prazo = Date.now() + ORCAMENTO_LOTE_MS

  for (const m of pendentes) {
    // Para antes que o proxy corte: o que já baixou fica gravado e a tela
    // convida a pedir o resto.
    if (Date.now() > prazo) { parcial = true; break }
    try {
      const resp = await evoFetch(`/chat/getBase64FromMediaMessage/${job.instanceName}`, {
        message: { key: { id: m.externalId, remoteJid: job.remoteJid, fromMe: m.fromMe } },
      })
      if (!resp?.base64) { falharam++; continue }
      const url = await salvar(Buffer.from(resp.base64, 'base64'), resp?.mimetype || '', m.mediaType || 'document')
      await prisma.message.update({ where: { id: m.id }, data: { mediaUrl: url } })
      baixadas++
    } catch (e) {
      falharam++
      // Arquivo expirado no servidor do WhatsApp é o caso mais comum aqui, e é
      // definitivo: fica marcado para não custar mais 5 segundos por clique.
      if (midiaSumiu(e)) {
        expiradas++
        await prisma.message.update({ where: { id: m.id }, data: { mediaUnavailableAt: new Date() } }).catch(() => {})
      }
    }
  }

  const restantes = await prisma.message.count({ where: filtroPendentes(leadId) })

  // Mantém o contador do job coerente com a realidade da conversa.
  await prisma.chatImportJob.updateMany({ where: { leadId }, data: { midiasPendentes: restantes } }).catch(() => {})

  return { baixadas, falharam, restantes, parcial, expiradas }
}

/** Quantas mídias desta conversa ainda dá para baixar (as expiradas não contam
 *  — um contador que nunca zera é pior do que contador nenhum). */
export async function contarMidiasPendentes(leadId: number): Promise<number> {
  return prisma.message.count({ where: filtroPendentes(leadId) })
}
