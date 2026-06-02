// src/services/outboundSendTracking.ts
// Rastreamento persistente de envios outbound (WhatsApp, Email, SMS, Webhook).
// Workers chamam recordSend() ao receber o job e markSendStatus() ao concluir.
// Alimenta a tabela bychat_outbound_sends usada pelo painel Filas & Monitor.

import { prisma } from '../lib/prisma.js'

export type SendChannel = 'whatsapp' | 'email' | 'sms' | 'webhook'

export interface RecordSendInput {
  channel: SendChannel
  queueName: string
  jobId: string | null
  leadId: number | null
  recipient: string
  subject?: string | null
  bodyPreview?: string | null
  attempts: number
  maxAttempts?: number | null
  source?: string | null
  sourceId?: number | null
}

// Cria registro inicial 'processing' quando o worker começa.
export async function recordSend(input: RecordSendInput): Promise<{ id: number; startedAt: number }> {
  const startedAt = Date.now()
  const send = await prisma.outboundSend.create({
    data: {
      channel: input.channel,
      queueName: input.queueName,
      jobId: input.jobId,
      leadId: input.leadId ?? null,
      recipient: input.recipient,
      subject: input.subject ?? null,
      bodyPreview: input.bodyPreview ? input.bodyPreview.substring(0, 500) : null,
      attempts: input.attempts,
      maxAttempts: input.maxAttempts ?? null,
      source: input.source ?? null,
      sourceId: input.sourceId ?? null,
      status: 'processing',
      processingAt: new Date(),
    },
    select: { id: true },
  })
  return { id: send.id, startedAt }
}

export interface MarkSentInput {
  externalId?: string | null
  metadata?: any
}

// Marca como enviado com sucesso ao provider.
export async function markSendSent(
  sendId: number,
  startedAt: number,
  input: MarkSentInput = {},
): Promise<void> {
  const now = new Date()
  const latencyMs = Date.now() - startedAt
  await prisma.outboundSend.update({
    where: { id: sendId },
    data: {
      status: 'sent',
      sentAt: now,
      latencyMs,
      externalId: input.externalId ?? undefined,
      metadata: input.metadata ?? undefined,
    },
  })
}

export interface MarkFailedInput {
  error: string
  metadata?: any
}

// Marca como falha com mensagem de erro.
export async function markSendFailed(
  sendId: number,
  startedAt: number,
  input: MarkFailedInput,
): Promise<void> {
  const now = new Date()
  const latencyMs = Date.now() - startedAt
  await prisma.outboundSend.update({
    where: { id: sendId },
    data: {
      status: 'failed',
      failedAt: now,
      latencyMs,
      error: input.error.substring(0, 2000),
      metadata: input.metadata ?? undefined,
    },
  })
}

// Marca como entregue (callback de delivery quando disponível — Resend, WhatsApp ack=2/3).
export async function markSendDelivered(externalId: string): Promise<void> {
  const send = await prisma.outboundSend.findFirst({
    where: { externalId },
    orderBy: { id: 'desc' },
    select: { id: true, deliveredAt: true },
  })
  if (!send || send.deliveredAt) return
  await prisma.outboundSend.update({
    where: { id: send.id },
    data: { status: 'delivered', deliveredAt: new Date() },
  })
}

// Marca como lido (WhatsApp ack=4 / email open).
export async function markSendRead(externalId: string): Promise<void> {
  const send = await prisma.outboundSend.findFirst({
    where: { externalId },
    orderBy: { id: 'desc' },
    select: { id: true, readAt: true },
  })
  if (!send || send.readAt) return
  await prisma.outboundSend.update({
    where: { id: send.id },
    data: { status: 'read', readAt: new Date() },
  })
}

// Wrapper conveniente: executa fn() e grava sucesso ou erro automaticamente.
// Workers usam assim:
//   await trackedSend({ channel, queueName, jobId, leadId, recipient, ... }, async () => {
//     const result = await provider.send(...)
//     return { externalId: result.id, metadata: { ... } }
//   })
export async function trackedSend<T extends MarkSentInput>(
  meta: RecordSendInput,
  fn: () => Promise<T>,
): Promise<T> {
  const { id, startedAt } = await recordSend(meta).catch((e) => {
    // Se gravação falhar, não impede o envio em si — só perde o rastreio
    console.error('[OutboundSend] recordSend falhou:', e)
    return { id: 0, startedAt: Date.now() }
  })

  try {
    const result = await fn()
    if (id > 0) {
      await markSendSent(id, startedAt, {
        externalId: result.externalId ?? null,
        metadata: result.metadata,
      }).catch((e) => console.error('[OutboundSend] markSent falhou:', e))
    }
    return result
  } catch (err: any) {
    if (id > 0) {
      await markSendFailed(id, startedAt, {
        error: err?.message || String(err),
      }).catch((e) => console.error('[OutboundSend] markFailed falhou:', e))
    }
    throw err
  }
}
