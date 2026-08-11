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

async function evoFetch(path: string, body: unknown): Promise<any> {
  const url = process.env.EVOLUTION_API_URL || ''
  const key = process.env.EVOLUTION_API_KEY || ''
  if (!url || !key) throw new Error('Evolution API não configurada')
  const r = await fetch(`${url}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: key },
    body: JSON.stringify(body),
  })
  if (!r.ok) throw new Error(`Evolution ${r.status}`)
  return r.json()
}

export interface ResultadoMidias {
  baixadas: number
  falharam: number
  restantes: number
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
    where: {
      leadId,
      mediaUrl: null,
      externalId: { not: null },
      mediaType: { in: ['image', 'video', 'audio', 'sticker', 'document'] },
    },
    orderBy: { timestamp: 'desc' },
    take: limite,
    select: { id: true, externalId: true, fromMe: true, mediaType: true },
  })
  if (!pendentes.length) return { baixadas: 0, falharam: 0, restantes: 0 }

  let baixadas = 0
  let falharam = 0

  for (const m of pendentes) {
    try {
      const resp = await evoFetch(`/chat/getBase64FromMediaMessage/${job.instanceName}`, {
        message: { key: { id: m.externalId, remoteJid: job.remoteJid, fromMe: m.fromMe } },
      })
      if (!resp?.base64) { falharam++; continue }
      const url = await salvar(Buffer.from(resp.base64, 'base64'), resp?.mimetype || '', m.mediaType || 'document')
      await prisma.message.update({ where: { id: m.id }, data: { mediaUrl: url } })
      baixadas++
    } catch {
      // Mídia expirada no servidor do WhatsApp é o caso mais comum aqui: o
      // arquivo some depois de um tempo e não há como recuperar. Não é erro
      // nosso, e insistir não adianta.
      falharam++
    }
  }

  const restantes = await prisma.message.count({
    where: {
      leadId, mediaUrl: null, externalId: { not: null },
      mediaType: { in: ['image', 'video', 'audio', 'sticker', 'document'] },
    },
  })

  // Mantém o contador do job coerente com a realidade da conversa.
  await prisma.chatImportJob.updateMany({ where: { leadId }, data: { midiasPendentes: restantes } }).catch(() => {})

  return { baixadas, falharam, restantes }
}

/** Quantas mídias desta conversa ainda estão sem arquivo. */
export async function contarMidiasPendentes(leadId: number): Promise<number> {
  return prisma.message.count({
    where: {
      leadId, mediaUrl: null, externalId: { not: null },
      mediaType: { in: ['image', 'video', 'audio', 'sticker', 'document'] },
    },
  })
}
