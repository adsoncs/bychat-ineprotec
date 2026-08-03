// src/services/smartBroadcast/runner.ts
//
// Execução. O planner já decidiu quem recebe, por qual número e a que horas;
// aqui só se cumpre a agenda — e se abortam envios que deixaram de fazer sentido
// entre o planejamento e a hora marcada.
//
// Três cuidados que valem registro:
//
// • A fila NÃO é carregada de uma vez. O scheduler enfileira apenas o que vence
//   nos próximos minutos. Uma campanha de 5.000 destinatários espalhada por uma
//   semana não pode virar 5.000 jobs vivos no Redis desde o primeiro minuto.
//
// • Um envio por vez POR NÚMERO, garantido por lock no Redis. Dois jobs do mesmo
//   chip em paralelo produziriam duas mensagens no mesmo segundo — exatamente o
//   padrão que o resto do módulo trabalha para evitar.
//
// • A decisão final de enviar é tomada no momento do envio, não no planejamento:
//   opt-out, janela de silêncio e teto do número são reconsultados. Alguém que
//   pediu para sair ontem não recebe hoje porque "já estava agendado".

import { Worker } from 'bullmq'
import { prisma } from '../../lib/prisma.js'
import { queues } from '../../lib/queues.js'
import { redis } from '../../lib/redis.js'
import { canSendNow } from '../messageGovernance.js'
import { recordSend, markSendSent, markSendFailed } from '../outboundSendTracking.js'
import { createEvolutionProviderFor } from '../whatsappProvider.js'
import { renderBlocks, buildRecipientLink, type MessageBlock } from './variants.js'
import { simulateTyping, sleep, interBubbleDelay } from './typing.js'
import { DEFAULT_PACING, DEFAULT_WINDOW, nextWindowStart, type PacingConfig, type WindowConfig } from './pacing.js'
import { getOrCreateHealth, isAvailable, bumpCounters } from './health.js'
import { noteSendOk, noteSendFailure, evaluateCampaign, refreshAllScores } from './guard.js'
import { isSuppressed } from './suppression.js'

const QUEUE = 'wf-smart-broadcast'
/** Janela de antecipação do scheduler: só entra na fila o que vence já. */
const LOOKAHEAD_MS = 3 * 60_000
const TICK_MS = 30_000
/** Lock por número — cobre o envio mais a digitação simulada. */
const SEND_LOCK_MS = 90_000

const redisConnection = {
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: parseInt(process.env.REDIS_PORT || '6379'),
  password: process.env.REDIS_PASSWORD || undefined,
}

// ─── Worker ─────────────────────────────────────────────

async function acquireLock(instanceId: number): Promise<boolean> {
  const ok = await redis.set(`smartbc-lock-${instanceId}`, '1', 'PX', SEND_LOCK_MS, 'NX')
  return ok === 'OK'
}

async function releaseLock(instanceId: number): Promise<void> {
  await redis.del(`smartbc-lock-${instanceId}`).catch(() => {})
}

/** Empurra o destinatário para mais tarde sem consumir tentativa. */
async function reschedule(recipientId: number, at: Date, reason: string): Promise<void> {
  await prisma.smartCampaignRecipient.update({
    where: { id: recipientId },
    data: { plannedAt: at, status: 'scheduled', error: reason.slice(0, 500) },
  })
}

async function markSkipped(recipientId: number, reason: string): Promise<void> {
  await prisma.smartCampaignRecipient.update({
    where: { id: recipientId },
    data: { status: 'skipped', skipReason: reason.slice(0, 30) },
  })
}

function createSmartWorker(): Worker {
  return new Worker(QUEUE, async (job) => {
    const { recipientId } = job.data as { recipientId: number }
    const rec = await prisma.smartCampaignRecipient.findUnique({ where: { id: recipientId } })
    if (!rec || ['sent', 'delivered', 'read', 'replied', 'skipped'].includes(rec.status)) return

    const campaign = await prisma.smartCampaign.findUnique({ where: { id: rec.campaignId } })
    if (!campaign) return

    // Campanha pausada/cancelada entre o agendamento e agora → devolve ao plano.
    if (campaign.status !== 'running') {
      await prisma.smartCampaignRecipient.update({ where: { id: rec.id }, data: { status: 'scheduled' } })
      return
    }

    const pacing: PacingConfig = { ...DEFAULT_PACING, ...((campaign.pacingConfig ?? {}) as Partial<PacingConfig>) }
    const window: WindowConfig = { ...DEFAULT_WINDOW, ...((campaign.windowConfig ?? {}) as Partial<WindowConfig>) }

    if (!rec.assignedInstanceId || !rec.assignedInstance) {
      await markSkipped(rec.id, 'no_sender')
      return
    }

    // ── Saúde do número: bloqueado, pausado ou teto batido → outro dia ──
    const health = await getOrCreateHealth(rec.assignedInstanceId, rec.assignedInstance)
    if (health.state === 'blocked') {
      await markSkipped(rec.id, 'sender_blocked')
      return
    }
    if (!isAvailable(health)) {
      const retryAt = health.pausedUntil && health.pausedUntil > new Date()
        ? new Date(health.pausedUntil.getTime() + 60_000)
        : nextWindowStart(new Date(Date.now() + 8 * 3600_000), window)
      await reschedule(rec.id, retryAt, health.pauseReason ?? 'teto diário do número atingido')
      return
    }

    // ── Lista de bloqueio global ──
    // Reconsultada AQUI, e não só no planejamento: entre agendar e enviar pode
    // ter entrado um pedido de saída por outro canal.
    if (await isSuppressed(rec.phone)) {
      await markSkipped(rec.id, 'suppressed')
      return
    }

    // ── Governança: opt-out, janela de silêncio, blacklist, frequência ──
    if (rec.leadId) {
      const verdict = await canSendNow(rec.leadId, 'whatsapp')
      if (!verdict.ok) {
        if (verdict.reason === 'opt_out' || verdict.reason === 'blacklist') {
          await markSkipped(rec.id, verdict.reason)
          return
        }
        const retryAt = verdict.retryAt ?? new Date(Date.now() + 3600_000)
        await reschedule(rec.id, nextWindowStart(retryAt, window), verdict.reason ?? 'bloqueado pela governança')
        return
      }
    }

    // ── Um envio por vez neste número ──
    if (!(await acquireLock(rec.assignedInstanceId))) {
      await reschedule(rec.id, new Date(Date.now() + 45_000), 'número ocupado')
      return
    }

    const blocks = ((campaign.messageBlocks ?? []) as unknown) as MessageBlock[]
    const vars = { ...((rec.variables ?? {}) as Record<string, string>) }
    // `{{link}}` vira uma URL própria deste destinatário (UTMs + rc=<id>).
    if (campaign.linkUrl) vars.link = buildRecipientLink(campaign.linkUrl, campaign.name, rec.id)
    const rendered = renderBlocks(blocks, vars, rec.phoneKey || rec.phone, { optOutFooter: campaign.optOutFooter })
    const fullText = rendered.map((r) => r.text).filter(Boolean).join('\n')

    const tracked = await recordSend({
      channel: 'whatsapp', queueName: QUEUE, jobId: job.id ? String(job.id) : null,
      leadId: rec.leadId, recipient: rec.phone,
      bodyPreview: `[disparo inteligente] ${campaign.name}`,
      attempts: job.attemptsMade + 1, maxAttempts: job.opts?.attempts ?? null,
      source: 'smart_broadcast', sourceId: campaign.id,
    })

    try {
      await prisma.smartCampaignRecipient.update({ where: { id: rec.id }, data: { status: 'sending' } })
      const provider = createEvolutionProviderFor(rec.assignedInstance)
      let lastId: string | null = null

      for (let i = 0; i < rendered.length; i++) {
        const block = rendered[i]!
        if (!block.text && !block.mediaUrl) continue

        if (pacing.typingEnabled) {
          await simulateTyping(provider, rec.phone, block.text || '…', block.mediaType === 'audio' ? 'recording' : 'composing')
        }

        const result = block.mediaUrl
          ? await provider.sendMedia(rec.phone, block.mediaUrl, block.mediaType || 'image', block.text || undefined, block.mediaName || undefined)
          : await provider.sendText(rec.phone, block.text)
        lastId = result.messageId ?? lastId

        // Conversa do lead precisa refletir o que ele recebeu — senão o operador
        // atende sem saber o que foi dito em seu nome.
        if (rec.leadId) {
          await prisma.message.create({
            data: {
              leadId: rec.leadId, fromMe: true, body: block.text || '(mídia)',
              mediaType: block.mediaUrl ? (block.mediaType || 'image') : 'text',
              mediaUrl: block.mediaUrl, provider: 'evolution',
              evolutionInstance: rec.assignedInstance, externalId: result.messageId,
              senderName: 'Disparo Inteligente',
            },
          }).catch(() => {})
        }

        if (i < rendered.length - 1) await sleep(interBubbleDelay(block.delayAfterMs))
      }

      await markSendSent(tracked.id, tracked.startedAt, { externalId: lastId ?? undefined })
      await prisma.smartCampaignRecipient.update({
        where: { id: rec.id },
        data: { status: 'sent', sentAt: new Date(), externalId: lastId, sentText: fullText.slice(0, 4000), error: null },
      })
      await prisma.smartCampaign.update({ where: { id: campaign.id }, data: { sentCount: { increment: 1 } } })
      await bumpCounters(rec.assignedInstanceId, { sent: 1 })
      await noteSendOk(rec.assignedInstanceId)
      await evaluateCampaign(campaign.id).catch(() => {})
    } catch (err: any) {
      const msg = String(err?.message ?? err)
      await markSendFailed(tracked.id, tracked.startedAt, { error: msg })
      await prisma.smartCampaignRecipient.update({
        where: { id: rec.id },
        data: { status: 'failed', failedAt: new Date(), error: msg.slice(0, 500) },
      })
      await prisma.smartCampaign.update({ where: { id: campaign.id }, data: { failedCount: { increment: 1 } } })
      await bumpCounters(rec.assignedInstanceId, { failed: 1 })
      await noteSendFailure(rec.assignedInstanceId, msg)
      await evaluateCampaign(campaign.id).catch(() => {})
      // Não relança: repetir o envio agora atropelaria o ritmo planejado. O
      // disjuntor já reagiu, e a falha fica visível na tela.
    } finally {
      await releaseLock(rec.assignedInstanceId)
      await maybeComplete(campaign.id)
    }
  }, {
    connection: redisConnection,
    // O espaçamento real vem do plano; a concorrência só permite que números
    // diferentes trabalhem ao mesmo tempo.
    concurrency: 4,
  })
}

async function maybeComplete(campaignId: number): Promise<void> {
  const remaining = await prisma.smartCampaignRecipient.count({
    where: { campaignId, status: { in: ['pending', 'scheduled', 'sending'] } },
  })
  if (remaining > 0) return
  await prisma.smartCampaign.updateMany({
    where: { id: campaignId, status: 'running' },
    data: { status: 'completed', completedAt: new Date() },
  })
}

// ─── Scheduler ──────────────────────────────────────────

async function enqueueDue(): Promise<number> {
  const horizon = new Date(Date.now() + LOOKAHEAD_MS)
  const due = await prisma.smartCampaignRecipient.findMany({
    where: {
      status: 'scheduled',
      plannedAt: { lte: horizon },
      campaign: { status: 'running' },
    },
    select: { id: true, plannedAt: true },
    orderBy: { plannedAt: 'asc' },
    take: 500,
  })
  for (const r of due) {
    const delay = Math.max(0, (r.plannedAt?.getTime() ?? Date.now()) - Date.now())
    await queues.smartBroadcast.add(
      'send',
      { recipientId: r.id },
      // jobId determinístico evita duplicar quando o tick repete antes do envio.
      // (Sem ":" no id — BullMQ usa ":" como separador interno de chave.)
      { jobId: `smartbc-rec-${r.id}`, delay, attempts: 1, removeOnComplete: 500, removeOnFail: 200 },
    ).catch(() => {})
  }
  return due.length
}

async function startDueCampaigns(): Promise<void> {
  const due = await prisma.smartCampaign.findMany({
    where: { status: 'scheduled', scheduledAt: { lte: new Date() } },
    select: { id: true },
  })
  for (const c of due) {
    await prisma.smartCampaign.update({
      where: { id: c.id },
      data: { status: 'running', startedAt: new Date() },
    }).catch(() => {})
  }
}

let _worker: Worker | null = null
let _handle: ReturnType<typeof setInterval> | null = null
let _scoreHandle: ReturnType<typeof setInterval> | null = null

export function startSmartBroadcastWorker(): void {
  if (!_worker) _worker = createSmartWorker()
  if (_handle) return
  import('./profiles.js')
    .then((m) => m.seedSystemProfiles())
    .catch((e) => console.warn('[smartBroadcast] perfis de ritmo não semeados:', e?.message))
  console.log('[smartBroadcast] worker + scheduler iniciados (tick 30s)')
  _handle = setInterval(() => {
    startDueCampaigns()
      .then(() => enqueueDue())
      .catch((e) => console.error('[smartBroadcast] tick erro:', e?.message ?? e))
  }, TICK_MS)
  // Score alimenta o rodízio entre números; de hora em hora basta.
  _scoreHandle = setInterval(() => {
    refreshAllScores().catch(() => {})
  }, 3600_000)
}

export function stopSmartBroadcastWorker(): void {
  if (_handle) { clearInterval(_handle); _handle = null }
  if (_scoreHandle) { clearInterval(_scoreHandle); _scoreHandle = null }
  _worker?.close().catch(() => {})
  _worker = null
}
