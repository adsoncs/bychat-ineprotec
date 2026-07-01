// Renova o Gmail watch (expira ~7 dias). Roda 1x/dia e re-registra as caixas
// com syncReplies ligado cuja expiração está próxima (< 2 dias) ou ausente.

import { prisma } from '../lib/prisma.js'
import { gmailWatch } from '../lib/google.js'

const DAY = 24 * 60 * 60 * 1000

async function resolvePubsubTopic(): Promise<string> {
  if (process.env.GMAIL_PUBSUB_TOPIC) return process.env.GMAIL_PUBSUB_TOPIC
  const s = await prisma.setting.findUnique({ where: { key: 'gmail.pubsub_topic' } }).catch(() => null)
  return s ? String(s.value).replace(/"/g, '').trim() : ''
}

async function renewTick(): Promise<void> {
  const topic = await resolvePubsubTopic()
  if (!topic) return
  const configs = await prisma.gmailConfig.findMany({
    where: { active: true, syncReplies: true, connection: { active: true } },
    select: { id: true, connectionId: true, watchExpiration: true },
  })
  const soon = new Date(Date.now() + 2 * DAY)
  for (const c of configs) {
    if (c.watchExpiration && c.watchExpiration > soon) continue // ainda válido
    try {
      const { historyId, expiration } = await gmailWatch(c.connectionId, topic)
      await prisma.gmailConfig.update({
        where: { id: c.id },
        data: { watchExpiration: expiration, ...(historyId ? { lastHistoryId: String(historyId) } : {}) },
      })
      console.log(`[gmailWatchRenew] watch renovado config ${c.id} (expira ${expiration?.toISOString()})`)
    } catch (e) {
      console.error(`[gmailWatchRenew] falha renovando config ${c.id}:`, (e as Error).message)
    }
  }
}

export function startGmailWatchRenew(): void {
  // primeira execução logo após o boot, depois 1x/dia
  setTimeout(() => { renewTick().catch(() => {}) }, 60_000)
  setInterval(() => { renewTick().catch(() => {}) }, DAY)
}
