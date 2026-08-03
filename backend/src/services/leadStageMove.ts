// src/services/leadStageMove.ts
// Helper central de movimentação de etapa/funil do lead.
//
// Antes disso, o par "atualiza Lead.status + grava LeadStageMovement + emite
// lead.stage_changed" estava replicado inline em vários call sites (aiJourney,
// aiJourneyService, kommoSync, schedulingService...) — cada um lembrando de uma
// parte. O comentário do model LeadStageMovement já prometia um helper
// `recordLeadStageMovement` que nunca existiu. Este é ele.
//
// Idempotente: quando origem e destino são o mesmo par (funnelId, stageKey), não
// escreve nada e devolve `moved: false`.

import { prisma } from '../lib/prisma.js'
import { eventBus } from '../lib/eventBus.js'
import { logEvent, EVENT_TYPES } from './leadHistory.js'

export interface MoveLeadStageInput {
  leadId: number
  /** Etapa de destino (Stage.key). Quando omitida, só troca de funil. */
  toStageKey?: string | null
  /** Funil de destino. Omitido = mantém o funil atual. */
  toFunnelId?: number | null
  /** 'panel' | 'workflow' | 'chatbot' | 'status_summary' | 'api' | ... */
  source?: string
  reason?: string
  userId?: number | null
  metadata?: Record<string, unknown>
  /** Não emite lead.stage_changed (quem chama já emite algo equivalente). */
  skipEvent?: boolean
}

export interface MoveLeadStageResult {
  moved: boolean
  fromStageKey: string | null
  toStageKey: string | null
  fromFunnelId: number | null
  toFunnelId: number | null
}

export async function moveLeadStage(input: MoveLeadStageInput): Promise<MoveLeadStageResult> {
  const { leadId, source = 'manual', reason, userId = null, metadata, skipEvent } = input

  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: { id: true, status: true, funnelId: true, chatbotId: true },
  })
  if (!lead) throw new Error(`Lead ${leadId} não encontrado`)

  const fromStageKey = lead.status ?? null
  const fromFunnelId = lead.funnelId ?? null
  const toStageKey = input.toStageKey ?? fromStageKey
  const toFunnelId = input.toFunnelId ?? fromFunnelId

  const noop = toStageKey === fromStageKey && toFunnelId === fromFunnelId
  if (noop) {
    return { moved: false, fromStageKey, toStageKey, fromFunnelId, toFunnelId }
  }

  const data: { status?: string; funnelId?: number } = {}
  if (toStageKey && toStageKey !== fromStageKey) data.status = toStageKey
  if (toFunnelId && toFunnelId !== fromFunnelId) data.funnelId = toFunnelId
  await prisma.lead.update({ where: { id: leadId }, data })

  // Histórico do Relatório de Funil. Não derruba a operação se falhar — a
  // instalação pode estar numa versão sem a tabela.
  await prisma.leadStageMovement.create({
    data: {
      leadId,
      fromFunnelId,
      toFunnelId,
      fromStageKey,
      toStageKey,
      movedByUserId: userId,
      source,
      reason: reason ? reason.slice(0, 255) : null,
      metadata: (metadata ?? null) as never,
    },
  }).catch(() => { /* tabela ausente em versões antigas */ })

  logEvent({
    leadId,
    type: EVENT_TYPES.STATUS_CHANGED,
    category: 'lifecycle',
    title: reason || 'Etapa alterada',
    source,
    actorType: userId ? 'operator' : 'system',
    userId: userId ?? undefined,
    oldValue: fromStageKey ?? undefined,
    newValue: toStageKey ?? undefined,
    metadata: { fromFunnelId, toFunnelId, ...(metadata ?? {}) },
  })

  if (!skipEvent) {
    eventBus.emitDomain({
      type: 'lead.stage_changed',
      leadId,
      funnelId: toFunnelId ?? undefined,
      chatbotId: lead.chatbotId ?? undefined,
      payload: {
        oldValue: fromStageKey,
        newValue: toStageKey,
        metadata: { fromFunnelId, toFunnelId, source, ...(metadata ?? {}) },
      },
      timestamp: new Date(),
    })
  }

  return { moved: true, fromStageKey, toStageKey, fromFunnelId, toFunnelId }
}
