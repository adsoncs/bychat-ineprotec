// src/services/priorityScoreService.ts
//
// Sales Engagement C1: cálculo do priorityScore (0-100) por lead.
// Composto:
//   • fit     (0-40): completude do cadastro (proxy de qualificação)
//   • intent  (0-40): sinais recentes de engajamento (mensagens/eventos)
//   • urgency (0-20): decay desde a última atividade
//
// O score alimenta a fila do operador e a priorização da cadência.
// Recalculado:
//   - on-event (chamar `updateLeadPriorityScore(leadId)` em hooks-chave)
//   - cron a cada 5min (C2 — `recalcRecentLeads()` nos últimos 7 dias)
//
// Filosofia: regras transparentes e baratas. IA fica em C3 (reply classifier).

import { Worker, Job } from 'bullmq'
import { prisma } from '../lib/prisma.js'
import { queues, redisConnection } from '../lib/queues.js'
import { eventBus, type DomainEvent } from '../lib/eventBus.js'
import { bullmqJobsTotal, captureException } from '../lib/observability.js'

export interface ScoreBreakdown {
  fit: number
  intent: number
  urgency: number
  total: number
}

const RECENT_LEADS_WINDOW_DAYS = 7

// ─── Pesos (0-100 total) ─────────────────────────────────

const FIT_FIELD_WEIGHTS: Record<string, number> = {
  whatsapp: 8,
  email: 8,
  nome: 8,
  status: 8,
  funnelId: 8,
}
// fit max = 40

const INTENT_MAX = 40
const URGENCY_MAX = 20

// ─── Cálculo ─────────────────────────────────────────────

export async function computePriorityScore(leadId: number): Promise<ScoreBreakdown | null> {
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: {
      id: true,
      nome: true,
      whatsapp: true,
      email: true,
      status: true,
      funnelId: true,
      lastMessageAt: true,
      lastActivityAt: true,
    },
  })
  if (!lead) return null

  const now = new Date()

  // ── fit: completude ──
  let fit = 0
  if (lead.whatsapp) fit += FIT_FIELD_WEIGHTS.whatsapp!
  if (lead.email) fit += FIT_FIELD_WEIGHTS.email!
  if (lead.nome) fit += FIT_FIELD_WEIGHTS.nome!
  if (lead.status) fit += FIT_FIELD_WEIGHTS.status!
  if (lead.funnelId) fit += FIT_FIELD_WEIGHTS.funnelId!

  // ── intent: engajamento recente ──
  // (a) Mensagens recebidas em 24h: cada uma 5pt, máx 20.
  // (b) LeadEvent communication 72h: cada um 2pt, máx 10.
  // (c) lastMessageAt: <1h=10, <24h=5, senão 0.
  const since24h = new Date(now.getTime() - 24 * 60 * 60 * 1000)
  const since72h = new Date(now.getTime() - 72 * 60 * 60 * 1000)
  const [recvCount, commEventsCount] = await Promise.all([
    prisma.message.count({
      where: { leadId, fromMe: false, timestamp: { gte: since24h } },
    }),
    prisma.leadEvent.count({
      where: { leadId, category: 'communication', createdAt: { gte: since72h } },
    }),
  ])

  let intent = 0
  intent += Math.min(20, recvCount * 5)
  intent += Math.min(10, commEventsCount * 2)
  if (lead.lastMessageAt) {
    const ageMs = now.getTime() - lead.lastMessageAt.getTime()
    if (ageMs < 60 * 60 * 1000) intent += 10
    else if (ageMs < 24 * 60 * 60 * 1000) intent += 5
  }
  intent = Math.min(INTENT_MAX, intent)

  // ── urgency: decay sobre lastActivityAt ──
  let urgency = 0
  const lastAct = lead.lastActivityAt ?? lead.lastMessageAt
  if (lastAct) {
    const hoursSince = (now.getTime() - lastAct.getTime()) / (60 * 60 * 1000)
    if (hoursSince < 1) urgency = 20
    else if (hoursSince < 6) urgency = 15
    else if (hoursSince < 24) urgency = 10
    else if (hoursSince < 72) urgency = 5
    else urgency = 0
  }

  return {
    fit,
    intent,
    urgency,
    total: fit + intent + urgency,
  }
}

/** Recalcula e persiste o score do lead. Idempotente — pode ser chamado
 * em qualquer ponto sem efeitos colaterais além do update. */
export async function updateLeadPriorityScore(leadId: number): Promise<number | null> {
  const breakdown = await computePriorityScore(leadId)
  if (!breakdown) return null
  await prisma.lead.update({
    where: { id: leadId },
    data: { priorityScore: breakdown.total, priorityScoreAt: new Date() },
  })
  return breakdown.total
}

/** Recálculo em lote pra cron: leads com `lastActivityAt` (ou `updatedAt`)
 * dentro da janela de N dias. Limita 500/run pra não bloquear o tick. */
export async function recalcRecentLeads(): Promise<{ updated: number }> {
  const since = new Date(Date.now() - RECENT_LEADS_WINDOW_DAYS * 24 * 60 * 60 * 1000)
  const leads = await prisma.lead.findMany({
    where: {
      OR: [{ lastActivityAt: { gte: since } }, { updatedAt: { gte: since } }],
    },
    select: { id: true },
    take: 500,
  })

  let updated = 0
  for (const { id } of leads) {
    try {
      const r = await updateLeadPriorityScore(id)
      if (r !== null) updated++
    } catch (err) {
      console.error(`[priorityScore] lead ${id} falhou:`, err)
    }
  }
  return { updated }
}

// ─── C2: scheduler + on-event ────────────────────────────

const QUEUE_NAME = 'wf-priority-score'
const TICK_JOB_NAME = 'recalc'
const TICK_INTERVAL_MS = 5 * 60 * 1000 // 5min

let worker: Worker | null = null

/** Inicia worker BullMQ (5min) + subscriber pra recalcular on-event.
 * Idempotente. */
export async function startPriorityScoreScheduler(): Promise<void> {
  if (worker) return

  worker = new Worker(
    QUEUE_NAME,
    async (job: Job) => {
      if (job.name !== TICK_JOB_NAME) return
      const result = await recalcRecentLeads()
      console.log(`[priorityScore] recalc concluído: ${result.updated} leads`)
    },
    { connection: redisConnection, concurrency: 1 },
  )

  worker.on('failed', (job, err) => {
    console.error(`[priorityScore] tick falhou:`, err.message)
    bullmqJobsTotal.inc({ queue: QUEUE_NAME, status: 'failed' })
    captureException(err, { queue: QUEUE_NAME, jobId: job?.id })
  })
  worker.on('completed', () => {
    bullmqJobsTotal.inc({ queue: QUEUE_NAME, status: 'completed' })
  })

  await queues.priorityScore.add(
    TICK_JOB_NAME,
    {},
    { repeat: { every: TICK_INTERVAL_MS }, removeOnComplete: 50, removeOnFail: 30 },
  )

  // On-event: recalc imediato em hooks-chave. Fire-and-forget — erro num
  // recalc não derruba o evento.
  eventBus.on('message.received', handlePriorityEvent)
  eventBus.on('lead.stage_changed', handlePriorityEvent)
  eventBus.on('lead.created', handlePriorityEvent)
}

export async function stopPriorityScoreScheduler(): Promise<void> {
  eventBus.off('message.received', handlePriorityEvent)
  eventBus.off('lead.stage_changed', handlePriorityEvent)
  eventBus.off('lead.created', handlePriorityEvent)
  if (!worker) return
  await worker.close()
  worker = null
}

function handlePriorityEvent(event: DomainEvent): void {
  if (!event.leadId) return
  updateLeadPriorityScore(event.leadId).catch((err) => {
    console.error(`[priorityScore] on-event lead ${event.leadId} falhou:`, err)
    captureException(err, { stage: 'priority_on_event', leadId: event.leadId })
  })
}
