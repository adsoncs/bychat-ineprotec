// src/services/leadOutcome.ts
// Fase 23: classificação manual Ganho/Perdido + reabertura.
// Encapsula efeitos colaterais: persistência, eventos, cancelamento de activities,
// reconciliação com DetectedSale. Cadências reagem via listener no eventBus.

import { prisma } from '../lib/prisma.js'
import { logEvent, EVENT_TYPES, type ActorType } from './leadHistory.js'
import { sendLeadQualityFeedback, classifyLossAsQuality } from './metaLeadQualityFeedback.js'

export type OutcomeKind = 'won' | 'lost'

export interface MarkWonInput {
  leadId: number
  value?: number | null
  note?: string | null
  userId?: number
  userName?: string
  ipAddress?: string
  /**
   * Quem já cuidou da proposta avisa aqui. É o caso da rota `/negotiations/:id/
   * close`: ela fecha UMA proposta escolhida a dedo, e deixar a sincronia rodar
   * fecharia junto as outras que o lead tenha em aberto — as do outro filho, do
   * outro período — como se tivessem sido vendidas.
   */
  skipNegotiationSync?: boolean
  /** Título do evento na timeline. Default: "Marcado como Ganho". */
  eventTitle?: string
}

export interface MarkLostInput {
  leadId: number
  reasonId?: number | null
  note?: string | null
  userId?: number
  userName?: string
  ipAddress?: string
  /** Ver `MarkWonInput.skipNegotiationSync`. */
  skipNegotiationSync?: boolean
  /** Título do evento na timeline. Default: "Marcado como Perdido". */
  eventTitle?: string
}

export interface ReopenInput {
  leadId: number
  userId?: number
  userName?: string
  ipAddress?: string
}

async function actor(userId?: number, userName?: string): Promise<{ userId?: number; userName?: string; actorType: ActorType }> {
  if (userId) return { userId, userName, actorType: 'operator' }
  return { actorType: 'system' }
}

// ── Auto-move (Fase 23-F): move lead para Stage com terminalKind ─
// Se houver Stage com terminalKind correspondente no funil do lead, atualiza status.
// Retorna { from, to } se moveu, null caso contrário.
async function autoMoveToTerminalStage(
  leadId: number,
  kind: 'won' | 'lost',
): Promise<{ from: string; to: string } | null> {
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: { id: true, status: true, funnelId: true },
  })
  if (!lead?.funnelId) return null

  const target = await prisma.stage.findFirst({
    where: { funnelId: lead.funnelId, terminalKind: kind, active: true },
    orderBy: { position: 'asc' },
  })
  if (!target || target.key === lead.status) return null

  await prisma.lead.update({
    where: { id: leadId },
    data: { status: target.key },
  })
  return { from: lead.status, to: target.key }
}

// ── Cancela activities pendentes do lead (Ganho/Perdido) ─
async function cancelPendingActivities(leadId: number, reason: 'lead_won' | 'lead_lost'): Promise<number> {
  const pending = await prisma.activity.findMany({
    where: { leadId, status: 'pending' },
    select: { id: true, metadata: true },
  })
  if (pending.length === 0) return 0
  await Promise.all(pending.map((a) => {
    const meta = (a.metadata as Record<string, any>) || {}
    return prisma.activity.update({
      where: { id: a.id },
      data: {
        status: 'cancelled',
        metadata: { ...meta, cancelReason: reason, cancelledAt: new Date().toISOString() },
      },
    })
  }))
  return pending.length
}

// ── Reconcilia DetectedSale (idempotente) ────────────────
// Se houver venda detectada pendente, confirma; se não houver e o operador
// informou um valor, cria um registro confirmado para fechar o ciclo.
async function reconcileDetectedSale(leadId: number, value: number | null | undefined, userId: number | undefined): Promise<void> {
  const pending = await prisma.detectedSale.findFirst({
    where: { leadId, status: { in: ['detected'] } },
    orderBy: { detectedAt: 'desc' },
  })
  if (pending) {
    await prisma.detectedSale.update({
      where: { id: pending.id },
      data: {
        status: 'confirmed',
        confirmedAt: new Date(),
        confirmedBy: userId ?? null,
        value: value != null ? (value as any) : pending.value,
      },
    })
    return
  }
  if (value != null) {
    await prisma.detectedSale.create({
      data: {
        leadId,
        value: value as any,
        currency: 'BRL',
        detectionMethod: 'manual',
        confidence: 'high',
        status: 'confirmed',
        confirmedAt: new Date(),
        confirmedBy: userId ?? null,
      },
    })
  }
}

// ── API pública ──────────────────────────────────────────

export async function markLeadWon(input: MarkWonInput): Promise<{ leadId: number; cancelledActivities: number; negotiations: { fechadas: number; ambiguas: number } }> {
  const { leadId, value, note, userId, userName, ipAddress, skipNegotiationSync, eventTitle } = input
  const before = await prisma.lead.findUnique({
    where: { id: leadId },
    select: { id: true, outcome: true, saleDetected: true, saleValue: true },
  })
  if (!before) throw new Error('Lead não encontrado')

  const data: Record<string, any> = {
    outcome: 'won',
    outcomeAt: new Date(),
    outcomeBy: userId ?? null,
    outcomeNote: note ?? null,
    lostReasonId: null,
  }
  if (value != null && Number.isFinite(value)) {
    data.saleDetected = true
    data.saleValue = value
    data.saleDetectedAt = before.saleDetected ? undefined : new Date()
  }

  await prisma.lead.update({ where: { id: leadId }, data })
  const cancelled = await cancelPendingActivities(leadId, 'lead_won')
  await reconcileDetectedSale(leadId, value ?? null, userId)
  const moved = await autoMoveToTerminalStage(leadId, 'won')
  // Fecha a proposta junto. Aqui e não nas rotas porque TODO caminho de marcação
  // passa por esta função — botão do painel, Resumo, etapa de desfecho, API — e
  // o cliente pediu que o valor seja lançado venha de onde vier.
  const { syncNegotiationsWithLeadOutcome } = await import('./negotiationOutcomeSync.js')
  const negs = skipNegotiationSync
    ? { fechadas: 0, ambiguas: 0 }
    : await syncNegotiationsWithLeadOutcome(leadId, 'won', { userId, nota: note ?? undefined })
        .catch((e) => { console.warn('[leadOutcome] negociação:', (e as Error).message); return { fechadas: 0, ambiguas: 0 } })

  logEvent({
    leadId,
    type: EVENT_TYPES.LEAD_WON,
    category: 'lifecycle',
    title: eventTitle ?? (value != null ? `Marcado como Ganho — R$ ${value.toFixed(2)}` : 'Marcado como Ganho'),
    source: 'panel',
    ...(await actor(userId, userName)),
    description: note || undefined,
    metadata: { value: value ?? null, previousOutcome: before.outcome, autoMovedTo: moved?.to ?? null, negociacoesFechadas: negs.fechadas, negociacoesAmbiguas: negs.ambiguas },
    ipAddress,
  })

  // Se moveu de etapa, registra também como STATUS_CHANGED para CAPI/sheets
  if (moved) {
    logEvent({
      leadId,
      type: EVENT_TYPES.STATUS_CHANGED,
      category: 'lifecycle',
      title: `Status alterado: ${moved.from} → ${moved.to} (auto via Ganho)`,
      source: 'panel',
      ...(await actor(userId, userName)),
      oldValue: moved.from,
      newValue: moved.to,
      metadata: { autoFromOutcome: 'won' },
      ipAddress,
    })
  }

  // Meta Lead Ads Quality Feedback — manda CONVERTED pro Meta otimizar Lookalikes.
  // Silencioso quando o lead não veio de Lead Ads ou a feature está off.
  sendLeadQualityFeedback({ leadId, quality: 'CONVERTED' }).catch(() => {})

  return { leadId, cancelledActivities: cancelled, negotiations: negs }
}

export async function markLeadLost(input: MarkLostInput): Promise<{ leadId: number; cancelledActivities: number; negotiations: { fechadas: number; ambiguas: number } }> {
  const { leadId, reasonId, note, userId, userName, ipAddress, skipNegotiationSync, eventTitle } = input
  const before = await prisma.lead.findUnique({
    where: { id: leadId },
    select: { id: true, outcome: true },
  })
  if (!before) throw new Error('Lead não encontrado')

  let validReasonId: number | null = null
  if (reasonId != null) {
    const r = await prisma.lossReason.findUnique({ where: { id: reasonId }, select: { id: true, active: true } })
    if (r && r.active) validReasonId = r.id
  }

  await prisma.lead.update({
    where: { id: leadId },
    data: {
      outcome: 'lost',
      outcomeAt: new Date(),
      outcomeBy: userId ?? null,
      outcomeNote: note ?? null,
      lostReasonId: validReasonId,
    },
  })
  const cancelled = await cancelPendingActivities(leadId, 'lead_lost')
  const moved = await autoMoveToTerminalStage(leadId, 'lost')
  // Perda fecha TODAS as propostas abertas: nenhuma soma receita, então não há
  // risco em fechar demais — ao contrário do ganho, que exige proposta única.
  const { syncNegotiationsWithLeadOutcome } = await import('./negotiationOutcomeSync.js')
  const negs = skipNegotiationSync
    ? { fechadas: 0, ambiguas: 0 }
    : await syncNegotiationsWithLeadOutcome(leadId, 'lost', { userId, lostReasonId: validReasonId, nota: note ?? undefined })
        .catch((e) => { console.warn('[leadOutcome] negociação:', (e as Error).message); return { fechadas: 0, ambiguas: 0 } })

  let reasonName: string | undefined
  if (validReasonId) {
    const r = await prisma.lossReason.findUnique({ where: { id: validReasonId }, select: { name: true } })
    reasonName = r?.name
  }

  logEvent({
    leadId,
    type: EVENT_TYPES.LEAD_LOST,
    category: 'lifecycle',
    title: eventTitle ?? (reasonName ? `Marcado como Perdido — ${reasonName}` : 'Marcado como Perdido'),
    source: 'panel',
    ...(await actor(userId, userName)),
    description: note || undefined,
    metadata: { reasonId: validReasonId, reasonName, previousOutcome: before.outcome, autoMovedTo: moved?.to ?? null, negociacoesFechadas: negs.fechadas },
    ipAddress,
  })

  if (moved) {
    logEvent({
      leadId,
      type: EVENT_TYPES.STATUS_CHANGED,
      category: 'lifecycle',
      title: `Status alterado: ${moved.from} → ${moved.to} (auto via Perdido)`,
      source: 'panel',
      ...(await actor(userId, userName)),
      oldValue: moved.from,
      newValue: moved.to,
      metadata: { autoFromOutcome: 'lost' },
      ipAddress,
    })
  }

  // Meta Lead Ads Quality Feedback — INVALID se motivo indica spam/fake,
  // NOT_INTERESTED caso contrário. Silencioso quando lead não é de Lead Ads
  // ou a feature está off.
  const quality = classifyLossAsQuality(reasonName)
  sendLeadQualityFeedback({ leadId, quality }).catch(() => {})

  return { leadId, cancelledActivities: cancelled, negotiations: negs }
}

export async function reopenLead(input: ReopenInput): Promise<{ leadId: number; previousOutcome: string | null }> {
  const { leadId, userId, userName, ipAddress } = input
  const before = await prisma.lead.findUnique({
    where: { id: leadId },
    select: { id: true, outcome: true, lostReasonId: true },
  })
  if (!before) throw new Error('Lead não encontrado')
  if (!before.outcome) return { leadId, previousOutcome: null }

  await prisma.lead.update({
    where: { id: leadId },
    data: {
      outcome: null,
      outcomeAt: null,
      outcomeBy: null,
      outcomeNote: null,
      lostReasonId: null,
    },
  })

  logEvent({
    leadId,
    type: EVENT_TYPES.LEAD_OUTCOME_CLEARED,
    category: 'lifecycle',
    title: 'Lead reaberto (em andamento)',
    source: 'panel',
    ...(await actor(userId, userName)),
    metadata: { previousOutcome: before.outcome, previousLostReasonId: before.lostReasonId },
    ipAddress,
  })

  return { leadId, previousOutcome: before.outcome }
}
