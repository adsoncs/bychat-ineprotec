// Gmail ↔ Cliente: envio de e-mail a partir do Lead (gravando Activity) e
// ingestão das RESPOSTAS (só das threads que o sistema enviou) como Activity.
//
// Decisão do produto (beyond): caixa ÚNICA da empresa. O canal de e-mail do
// cliente é o GmailConfig com syncReplies=true (fallback: 1ª config ativa).

import { promises as fs } from 'fs'
import { join, extname } from 'path'
import crypto from 'crypto'
import { prisma } from '../lib/prisma.js'
import { gmailSendEmail, gmailGetParsedMessage } from '../lib/google.js'

export interface OutboundAttachment { filename: string; mimeType: string; content: Buffer }

export interface ClientGmailChannel {
  configId: number
  connectionId: number
  email: string
  senderName: string
  signature: string
}

/** Resolve a caixa da empresa usada para e-mails de cliente. */
export async function getClientGmailChannel(): Promise<ClientGmailChannel | null> {
  const config =
    (await prisma.gmailConfig.findFirst({
      where: { active: true, syncReplies: true, connection: { active: true } },
      include: { connection: { select: { id: true, email: true } } },
      orderBy: { id: 'asc' },
    })) ??
    (await prisma.gmailConfig.findFirst({
      where: { active: true, connection: { active: true } },
      include: { connection: { select: { id: true, email: true } } },
      orderBy: { id: 'asc' },
    }))
  if (!config?.connection) return null
  return {
    configId: config.id,
    connectionId: config.connectionId,
    email: config.connection.email,
    senderName: config.senderName || '',
    signature: config.signature || '',
  }
}

function htmlFromText(text: string): string {
  return `<p>${text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\n/g, '<br>')}</p>`
}

/**
 * Envia um e-mail ao cliente pela caixa da empresa e grava como Activity
 * (type=email, direction=outbound) correlacionada por thread. Se for resposta
 * a um e-mail recebido (replyToActivityId), mantém a thread (In-Reply-To).
 */
export async function sendLeadEmail(input: {
  leadId: number
  userId?: number | null
  userName?: string | null
  to: string
  subject: string
  body: string
  bodyHtml?: string
  replyToActivityId?: number | null
  attachments?: OutboundAttachment[]
}): Promise<{ activityId: number; gmailThreadId: string; gmailMessageId: string; attachments: number }> {
  const channel = await getClientGmailChannel()
  if (!channel) throw new Error('Nenhuma caixa de Gmail da empresa configurada para e-mail de cliente.')

  // Resposta dentro de uma thread existente.
  let threadId: string | undefined
  let inReplyTo: string | undefined
  let subject = input.subject
  if (input.replyToActivityId) {
    const ref = await prisma.activity.findUnique({
      where: { id: input.replyToActivityId },
      select: { gmailThreadId: true, metadata: true, messageSubject: true },
    })
    if (ref?.gmailThreadId) {
      threadId = ref.gmailThreadId
      const meta = (ref.metadata as any) || {}
      inReplyTo = meta.rfc822MessageId || undefined
      if (!subject && ref.messageSubject) subject = ref.messageSubject.startsWith('Re:') ? ref.messageSubject : `Re: ${ref.messageSubject}`
    }
  }

  const baseHtml = input.bodyHtml || htmlFromText(input.body)
  const bodyHtml = channel.signature ? `${baseHtml}<br><br>${channel.signature}` : baseHtml
  const from = channel.senderName ? `${channel.senderName} <${channel.email}>` : channel.email

  const atts = input.attachments || []
  const sent = await gmailSendEmail(channel.connectionId, {
    to: input.to,
    subject,
    body: input.body,
    bodyHtml,
    from,
    threadId,
    inReplyTo,
    attachments: atts.length
      ? atts.map(a => ({ filename: a.filename, mimeType: a.mimeType, contentBase64: a.content.toString('base64') }))
      : undefined,
  })

  const activity = await prisma.activity.create({
    data: {
      leadId: input.leadId,
      userId: input.userId ?? null,
      userName: input.userName || channel.senderName || channel.email,
      type: 'email',
      title: subject || '(sem assunto)',
      status: 'sent',
      direction: 'outbound',
      scheduledAt: new Date(),
      completedAt: new Date(),
      recipientEmail: input.to,
      messageSubject: subject,
      messageBody: input.body, // texto puro (o HTML fica em metadata.bodyHtml)
      gmailThreadId: sent.threadId,
      gmailMessageId: sent.messageId,
      metadata: { source: 'gmail', rfc822MessageId: sent.rfc822MessageId, from, bodyHtml },
    },
  })

  // Persiste os anexos enviados vinculados à atividade (aparecem na thread do lead).
  if (atts.length) {
    const uploadsDir = join(process.cwd(), '..', 'uploads', 'lead-attachments')
    await fs.mkdir(uploadsDir, { recursive: true })
    for (const a of atts) {
      try {
        const ext = (extname(a.filename).slice(1) || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 10) || 'bin'
        const savedName = `${input.leadId}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.${ext}`
        await fs.writeFile(join(uploadsDir, savedName), a.content)
        await prisma.leadAttachment.create({
          data: {
            leadId: input.leadId,
            activityId: activity.id,
            fileName: (a.filename || 'arquivo').slice(0, 255),
            fileSize: a.content.length,
            mimeType: a.mimeType || 'application/octet-stream',
            storagePath: `lead-attachments/${savedName}`,
            uploadedById: input.userId ?? null,
            uploadedByName: (input.userName || channel.senderName || null)?.slice(0, 100) ?? null,
            description: null,
          },
        })
      } catch (e) {
        console.error('[gmailSend] falha ao persistir anexo:', (e as Error).message)
      }
    }
  }

  await prisma.gmailConfig.update({ where: { id: channel.configId }, data: { totalSent: { increment: 1 } } }).catch(() => {})

  return { activityId: activity.id, gmailThreadId: sent.threadId, gmailMessageId: sent.messageId, attachments: atts.length }
}

/**
 * Ingere UMA mensagem recebida do Gmail como Activity inbound — SOMENTE se ela
 * pertence a uma thread que o sistema enviou (resposta a e-mail nosso). Idempotente.
 * Retorna o id da Activity criada, ou null se ignorada (não é resposta nossa / duplicada).
 */
export async function ingestInboundGmailMessage(channelEmail: string, messageId: string, connectionId: number): Promise<number | null> {
  // Dedup: já registramos esta mensagem?
  const dup = await prisma.activity.findFirst({ where: { gmailMessageId: messageId }, select: { id: true } })
  if (dup) return null

  const msg = await gmailGetParsedMessage(connectionId, messageId)
  if (!msg.threadId) return null

  // Só ingere se a thread foi iniciada por um e-mail NOSSO (outbound).
  const origin = await prisma.activity.findFirst({
    where: { gmailThreadId: msg.threadId, direction: 'outbound', type: 'email' },
    orderBy: { id: 'asc' },
    select: { leadId: true },
  })
  if (!origin) return null

  // Ignora se a "resposta" foi enviada pela própria caixa (eco do nosso envio).
  const fromAddr = (msg.from.match(/<([^>]+)>/)?.[1] || msg.from).trim().toLowerCase()
  if (fromAddr && channelEmail && fromAddr === channelEmail.toLowerCase()) return null

  const activity = await prisma.activity.create({
    data: {
      leadId: origin.leadId,
      userId: null,
      userName: msg.from || 'Cliente',
      type: 'email',
      title: msg.subject || '(resposta sem assunto)',
      status: 'completed',
      direction: 'inbound',
      scheduledAt: new Date(),
      completedAt: new Date(),
      recipientEmail: channelEmail,
      messageSubject: msg.subject,
      messageBody: msg.body,
      gmailThreadId: msg.threadId,
      gmailMessageId: msg.id,
      metadata: { source: 'gmail', direction: 'inbound', from: msg.from, date: msg.date, inReplyTo: msg.inReplyTo, snippet: msg.snippet },
    },
  })
  return activity.id
}
