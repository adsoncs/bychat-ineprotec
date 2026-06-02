// src/services/routing/transferExpire.ts
// Reforma F3 — cron que expira transferRequests pending após expiresAt.
// Roda a cada 30min. Marca status=expired + LeadEvent TRANSFER_EXPIRED.

import { prisma } from '../../lib/prisma.js'
import { logEvent, EVENT_TYPES } from '../leadHistory.js'

const INTERVAL_MS = 30 * 60 * 1000
let _handle: ReturnType<typeof setInterval> | null = null

export async function expireStaleTransferRequests(): Promise<number> {
  const now = new Date()
  const stale = await prisma.leadTransferRequest.findMany({
    where: { status: 'pending', expiresAt: { lt: now } },
    select: { id: true, leadId: true, fromUserId: true, toUserId: true },
    take: 200,
  })
  if (stale.length === 0) return 0

  // Atualiza em batch + logs
  await prisma.leadTransferRequest.updateMany({
    where: { id: { in: stale.map((s) => s.id) }, status: 'pending' },
    data: { status: 'expired', respondedAt: now },
  })

  for (const s of stale) {
    logEvent({
      leadId: s.leadId,
      type: EVENT_TYPES.TRANSFER_EXPIRED,
      category: 'operator',
      title: 'Transferência expirou sem resposta',
      actorType: 'system',
      metadata: { requestId: s.id, fromUserId: s.fromUserId, toUserId: s.toUserId },
    })
  }

  console.log(`[routing/transferExpire] ${stale.length} transferências expiradas`)
  return stale.length
}

export function startTransferExpireScheduler(): void {
  if (_handle) return
  console.log('[routing/transferExpire] scheduler iniciado (cada 30min)')
  _handle = setInterval(() => {
    expireStaleTransferRequests().catch((e) => {
      console.error('[routing/transferExpire] erro:', (e as any)?.message ?? e)
    })
  }, INTERVAL_MS)
}

export function stopTransferExpireScheduler(): void {
  if (_handle) { clearInterval(_handle); _handle = null }
}
