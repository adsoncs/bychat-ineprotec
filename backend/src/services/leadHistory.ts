// src/services/leadHistory.ts
// Serviço centralizado de histórico/tracking de eventos do lead
// Todos os eventos são logados de forma assíncrona (fire-and-forget)

import { prisma } from '../lib/prisma.js'
import { eventBus } from '../lib/eventBus.js'

// ─── Types ───────────────────────────────────────────────

export type EventCategory = 'lifecycle' | 'communication' | 'operator' | 'system' | 'integration'
export type ActorType = 'lead' | 'operator' | 'system' | 'ai' | 'integration'

export interface LogEventParams {
  leadId: number
  type: string            // ex: lead_created, status_changed, message_received
  category: EventCategory
  title: string           // título curto pt-BR
  channel?: string        // whatsapp, web_chat, web_form, api, system, manual
  source?: string         // webhook, panel, chatbot, inactivity_service
  userId?: number
  userName?: string
  actorType?: ActorType
  description?: string
  oldValue?: string
  newValue?: string
  metadata?: Record<string, any>
  ipAddress?: string
}

// ─── Event Types Constants ───────────────────────────────

export const EVENT_TYPES = {
  // Lifecycle
  LEAD_CREATED:            'lead_created',
  LEAD_EDITED:             'lead_edited',
  LEAD_DELETED:            'lead_deleted',
  STATUS_CHANGED:          'status_changed',
  DIAGNOSIS_STARTED:       'diagnosis_started',
  DIAGNOSIS_PROGRESS:      'diagnosis_progress',
  DIAGNOSIS_COMPLETED:     'diagnosis_completed',
  LEAD_REOPENED:           'lead_reopened',
  LEAD_CLOSED:             'lead_closed',

  // Communication
  MESSAGE_RECEIVED:        'message_received',
  MESSAGE_SENT:            'message_sent',
  MESSAGE_INTERNAL:        'message_internal',
  REPORT_SENT:             'report_sent',
  NOTIFICATION_SENT:       'notification_sent',

  // Operator actions
  OPERATOR_VIEWED:         'operator_viewed',
  OPERATOR_MARKED_READ:    'operator_marked_read',
  OPERATOR_ASSIGNED:       'operator_assigned',

  // Routing (F4): regra condicional definiu setor/operador na criação do lead
  ROUTING_RULE_MATCHED:    'routing_rule_matched',

  // Routing (F8): cron de escalação devolveu o lead pra fila por algum motivo.
  // Metadata.reason: agent_on_vacation | agent_inactive | agent_offline | no_response.
  AGENT_REASSIGNED_ESCALATION: 'agent_reassigned_escalation',

  // Routing F3: transferência consensual entre agentes.
  TRANSFER_REQUESTED:  'transfer_requested',
  TRANSFER_ACCEPTED:   'transfer_accepted',
  TRANSFER_REJECTED:   'transfer_rejected',
  TRANSFER_CANCELLED:  'transfer_cancelled',
  TRANSFER_EXPIRED:    'transfer_expired',

  // Routing F5: hand-off automático no fim do turno do agente.
  SHIFT_HANDOVER:      'shift_handover',

  // System / AI
  AI_SENTIMENT_GENERATED:  'ai_sentiment_generated',
  AI_ANALYSIS_GENERATED:   'ai_analysis_generated',
  AI_CHAT_RESPONSE:        'ai_chat_response',
  INACTIVITY_DETECTED:     'inactivity_detected',
  INACTIVITY_NOTIFIED:     'inactivity_notified',
  INACTIVITY_CLOSED:       'inactivity_closed',
  SCORES_CALCULATED:       'scores_calculated',

  // Integration
  WHATSAPP_CONNECTED:      'whatsapp_connected',
  WEBHOOK_RECEIVED:        'webhook_received',
  CSV_EXPORTED:            'csv_exported',
  FUNNEL_CHANGED:          'funnel_changed',

  // Tags
  TAG_ADDED:               'tag_added',
  TAG_REMOVED:             'tag_removed',

  // Anotações
  ANNOTATION_SAVED:        'annotation_saved',

  // Workflow / Automação
  SALE_DETECTED:           'sale_detected',
  ACTIVITY_COMPLETED:      'activity_completed',
  WORKFLOW_STARTED:        'workflow_started',
  WORKFLOW_STEP_EXECUTED:  'workflow_step_executed',
  WORKFLOW_COMPLETED:      'workflow_completed',
  WORKFLOW_PAUSED:         'workflow_paused',

  // Outcome (Fase 23): classificação manual Ganho/Perdido/Reabrir
  LEAD_WON:                'lead_won',
  LEAD_LOST:               'lead_lost',
  LEAD_OUTCOME_CLEARED:    'lead_outcome_cleared', // reabertura

  // Dedup (Fase 24): duplicação preventiva — cria novo lead e sinaliza pro operador
  DUPLICATE_DETECTED:      'duplicate_detected', // novo lead casou com existente
  DUPLICATE_KEPT_SEPARATE: 'duplicate_kept_separate',
  LEADS_MERGED:            'leads_merged', // mantido pra retro-compat (já usado em dedup.ts:213)
} as const

// ─── Mapeamento EVENT_TYPE -> Domain Event ──────────────

const EVENT_TO_DOMAIN: Record<string, string> = {
  [EVENT_TYPES.LEAD_CREATED]:        'lead.created',
  [EVENT_TYPES.STATUS_CHANGED]:      'lead.stage_changed',
  [EVENT_TYPES.TAG_ADDED]:           'lead.tag_added',
  [EVENT_TYPES.TAG_REMOVED]:         'lead.tag_removed',
  [EVENT_TYPES.OPERATOR_ASSIGNED]:   'lead.assigned',
  [EVENT_TYPES.LEAD_CLOSED]:         'lead.closed',
  [EVENT_TYPES.LEAD_REOPENED]:       'lead.reopened',
  [EVENT_TYPES.FUNNEL_CHANGED]:      'lead.funnel_changed',
  [EVENT_TYPES.MESSAGE_RECEIVED]:    'message.received',
  [EVENT_TYPES.MESSAGE_SENT]:        'message.sent',
  [EVENT_TYPES.INACTIVITY_DETECTED]: 'inactivity.detected',
  [EVENT_TYPES.INACTIVITY_CLOSED]:   'inactivity.closed',
  [EVENT_TYPES.SALE_DETECTED]:       'sale.detected',
  [EVENT_TYPES.ACTIVITY_COMPLETED]:  'activity.completed',
  [EVENT_TYPES.DIAGNOSIS_COMPLETED]: 'diagnosis.completed',
  [EVENT_TYPES.LEAD_WON]:            'lead.won',
  [EVENT_TYPES.LEAD_LOST]:           'lead.lost',
  [EVENT_TYPES.LEAD_OUTCOME_CLEARED]:'lead.outcome_cleared',
  [EVENT_TYPES.DUPLICATE_DETECTED]:  'lead.duplicate_detected',
  [EVENT_TYPES.DUPLICATE_KEPT_SEPARATE]: 'lead.duplicate_kept_separate',
  [EVENT_TYPES.LEADS_MERGED]:        'lead.leads_merged',
}

// ─── Main log function (fire-and-forget) ─────────────────

export function logEvent(params: LogEventParams): void {
  const {
    leadId, type, category, title,
    channel, source, userId, userName,
    actorType = 'system',
    description, oldValue, newValue,
    metadata, ipAddress
  } = params

  // Fire and forget — não bloqueia a rota
  prisma.leadEvent.create({
    data: {
      leadId,
      type,
      category,
      title,
      channel: channel || null,
      source: source || null,
      userId: userId || null,
      userName: userName || null,
      actorType,
      description: description || null,
      oldValue: oldValue || null,
      newValue: newValue || null,
      metadata: metadata || undefined,
      ipAddress: ipAddress || null,
    }
  }).catch(err => {
    console.error(`[LeadHistory] Failed to log event ${type} for lead ${leadId}:`, err.message)
  })

  // Emit domain event for workflow engine
  const domainType = EVENT_TO_DOMAIN[type]
  if (domainType) {
    eventBus.emitDomain({
      type: domainType,
      leadId,
      chatbotId: metadata?.chatbotId,
      funnelId: metadata?.funnelId,
      payload: { oldValue, newValue, metadata, channel, source },
      timestamp: new Date(),
    })
  }
}

// ─── Helper: extrair IP do request Fastify ───────────────

export function getIp(req: any): string {
  return req.ip || req.headers?.['x-forwarded-for'] || req.headers?.['x-real-ip'] || ''
}

// ─── Helper: extrair dados do operador do request ────────

export function getOperator(req: any): { userId?: number; userName?: string; actorType: ActorType } {
  const user = (req as any).user
  if (user) {
    return {
      userId: user.userId,
      userName: user.name || user.email,
      actorType: 'operator'
    }
  }
  return { actorType: 'system' }
}
