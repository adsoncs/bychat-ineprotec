// Sincronização de respostas do Gmail (push via Pub/Sub dispara isto).
// Usa o History API a partir do lastHistoryId guardado na GmailConfig.

import { prisma } from '../lib/prisma.js'
import { gmailHistoryMessageIds, gmailGetProfile } from '../lib/google.js'
import { ingestInboundGmailMessage } from './gmailClientEmail.js'

/** Processa novas mensagens da caixa desde o último cursor. Idempotente.
 *  Retorna quantas respostas foram registradas. */
export async function syncGmailChannel(configId: number): Promise<number> {
  const config = await prisma.gmailConfig.findUnique({
    where: { id: configId },
    include: { connection: { select: { id: true, email: true, active: true } } },
  })
  if (!config || !config.active || !config.connection?.active) return 0

  const connectionId = config.connectionId
  const email = config.connection.email

  // Sem cursor ainda → estabelece a linha de base (não reprocessa histórico antigo).
  if (!config.lastHistoryId) {
    const prof = await gmailGetProfile(connectionId)
    await prisma.gmailConfig.update({
      where: { id: configId },
      data: { lastHistoryId: String(prof.historyId || ''), lastSyncAt: new Date() },
    })
    return 0
  }

  let messageIds: string[] = []
  let newHistoryId = config.lastHistoryId
  try {
    const r = await gmailHistoryMessageIds(connectionId, config.lastHistoryId)
    messageIds = r.messageIds
    newHistoryId = r.newHistoryId
  } catch (err: any) {
    // 404 = cursor expirou → rebaseia no historyId atual (perde a janela, mas não trava).
    if (err?.code === 404 || err?.response?.status === 404) {
      const prof = await gmailGetProfile(connectionId)
      await prisma.gmailConfig.update({
        where: { id: configId },
        data: { lastHistoryId: String(prof.historyId || ''), lastSyncAt: new Date() },
      })
      return 0
    }
    throw err
  }

  let ingested = 0
  for (const mid of messageIds) {
    try {
      const id = await ingestInboundGmailMessage(email, mid, connectionId)
      if (id) ingested++
    } catch (e) {
      console.error(`[gmailSync] falha ingerindo msg ${mid}:`, (e as Error).message)
    }
  }

  await prisma.gmailConfig.update({
    where: { id: configId },
    data: {
      lastHistoryId: newHistoryId,
      lastSyncAt: new Date(),
      ...(ingested > 0 ? { totalReceived: { increment: ingested } } : {}),
    },
  })
  return ingested
}

/** Dispara sync pela conta (e-mail) que o Pub/Sub notificou. */
export async function syncGmailByEmail(email: string): Promise<number> {
  const config = await prisma.gmailConfig.findFirst({
    where: { active: true, syncReplies: true, connection: { email, active: true } },
    select: { id: true },
  })
  if (!config) return 0
  return syncGmailChannel(config.id)
}
