// Catálogo central dos eventos-gatilho disponíveis para Workflows.
// Mantém em sync com `services/leadHistory.ts:EVENT_TO_DOMAIN` e os
// `eventBus.emitDomain({ type: ... })` espalhados pelo backend.
//
// `requiresModule` opcional: o evento só aparece se o módulo correspondente
// estiver ATIVO em Configurações > Módulos. Caso contrário, gating UI esconde
// o item da lista. Backend ignora workflows referenciando triggers de módulos
// desativados (workflows ficam órfãos mas não quebram nada).

export type TriggerCategory = 'lead' | 'message' | 'activity' | 'sales' | 'system' | 'educational' | 'enrollment_portal'

export interface TriggerEvent {
  value: string
  label: string
  description?: string
  category: TriggerCategory
  /** Módulo que precisa estar ATIVO pra esse trigger ser oferecido na UI. */
  requiresModule?: 'educacional' | 'enrollment_portals'
}

export const TRIGGER_EVENT_CATALOG: TriggerEvent[] = [
  // ── Ciclo de vida do lead ────────────────────────────────
  { value: 'lead.created',                  label: '🆕 Lead criado',                  category: 'lead' },
  { value: 'lead.stage_changed',            label: '➡️ Etapa do funil alterada',      category: 'lead' },
  { value: 'lead.summary_changed',          label: '🏷️ Resumo alterado',              category: 'lead' },
  { value: 'lead.funnel_changed',           label: '🔀 Funil alterado',               category: 'lead' },
  { value: 'lead.tag_added',                label: '🏷️ Etiqueta adicionada',          category: 'lead' },
  { value: 'lead.tag_removed',              label: '🏷️ Etiqueta removida',            category: 'lead' },
  { value: 'lead.assigned',                 label: '👤 Lead atribuído a operador',    category: 'lead' },
  { value: 'lead.closed',                   label: '🔒 Lead fechado (atendimento)',   category: 'lead' },
  { value: 'lead.reopened',                 label: '🔓 Lead reaberto',                category: 'lead' },
  { value: 'lead.won',                      label: '🏆 Lead Ganho',                   category: 'lead' },
  { value: 'lead.lost',                     label: '❌ Lead Perdido',                 category: 'lead' },
  { value: 'lead.outcome_cleared',          label: '↩️ Outcome removido (reaberto)',  category: 'lead' },
  { value: 'lead.duplicate_detected',       label: '👥 Duplicado detectado',          category: 'lead' },
  { value: 'lead.duplicate_kept_separate',  label: '✂️ Duplicado mantido separado',   category: 'lead' },
  { value: 'lead.leads_merged',             label: '🔗 Leads mesclados',              category: 'lead' },

  // ── Mensagens & atendimento ──────────────────────────────
  { value: 'message.received',              label: '📥 Mensagem recebida',             category: 'message' },
  { value: 'message.sent',                  label: '📤 Mensagem enviada',              category: 'message' },
  { value: 'inactivity.detected',           label: '⏱️ Inatividade detectada',         category: 'message' },
  { value: 'inactivity.closed',             label: '⏱️ Conversa fechada por inatividade', category: 'message' },

  // ── Atividades & diagnóstico ─────────────────────────────
  { value: 'activity.completed',            label: '✅ Atividade concluída',           category: 'activity' },
  { value: 'diagnosis.completed',           label: '📋 Diagnóstico concluído',         category: 'activity' },

  // ── Vendas ───────────────────────────────────────────────
  { value: 'sale.detected',                 label: '💰 Venda detectada',               category: 'sales' },

  // ── Sistema/análise ──────────────────────────────────────
  { value: 'loss_reason.spike',             label: '📈 Pico em motivos de perda',      category: 'system' },

  // ── Portal de Matrículas (requer módulo `enrollment_portals`) ──
  { value: 'enrollment.submitted',                label: '🎓 Inscrição recebida',                category: 'enrollment_portal', requiresModule: 'enrollment_portals' },
  { value: 'enrollment.cancelled',                label: '🚫 Inscrição cancelada',               category: 'enrollment_portal', requiresModule: 'enrollment_portals' },
  { value: 'enrollment.interest_submitted',       label: '🌱 Interesse capturado (magic link)',  category: 'enrollment_portal', requiresModule: 'enrollment_portals' },
  { value: 'enrollment.payment_confirmed',        label: '💳 Pagamento confirmado',              category: 'enrollment_portal', requiresModule: 'enrollment_portals' },
  { value: 'enrollment.payment_pending_reminder', label: '⏰ Lembrete de pagamento',             category: 'enrollment_portal', requiresModule: 'enrollment_portals' },
  { value: 'enrollment.document_approved',        label: '📄 Documento aprovado',                category: 'enrollment_portal', requiresModule: 'enrollment_portals' },
  { value: 'enrollment.document_rejected',        label: '📄 Documento rejeitado',               category: 'enrollment_portal', requiresModule: 'enrollment_portals' },

  // ── Educacional — avaliações (requer módulo `educacional`) ──
  { value: 'enrollment.essay_submitted',          label: '📝 Redação recebida',                   category: 'educational', requiresModule: 'educacional' },
  { value: 'enrollment.essay_approved',           label: '📝 Redação aprovada',                   category: 'educational', requiresModule: 'educacional' },
  { value: 'enrollment.essay_rejected',           label: '📝 Redação rejeitada',                  category: 'educational', requiresModule: 'educacional' },
  { value: 'enrollment.enem_approved',            label: '🎯 ENEM aprovado (acima do corte)',     category: 'educational', requiresModule: 'educacional' },
  { value: 'enrollment.enem_rejected',            label: '🎯 ENEM rejeitado (abaixo do corte)',   category: 'educational', requiresModule: 'educacional' },
  { value: 'enrollment.presencial_scheduled',     label: '📅 Prova presencial agendada',          category: 'educational', requiresModule: 'educacional' },
  { value: 'enrollment.presencial_approved',      label: '✅ Aprovado no presencial',             category: 'educational', requiresModule: 'educacional' },
  { value: 'enrollment.presencial_rejected',      label: '❌ Reprovado no presencial',            category: 'educational', requiresModule: 'educacional' },
  { value: 'enrollment.fully_evaluated',          label: '🎓 Avaliação completa',                 category: 'educational', requiresModule: 'educacional' },
]

export const CATEGORY_LABELS: Record<TriggerCategory, string> = {
  lead:              'Ciclo de vida do lead',
  message:           'Mensagens & atendimento',
  activity:          'Atividades & diagnóstico',
  sales:             'Vendas',
  system:            'Sistema',
  educational:       'Educacional',
  enrollment_portal: 'Portal de Matrículas',
}

/** Filtra eventos cujo módulo está desativado (`enabledModules` é o set dos módulos ativos). */
export function filterAvailableTriggers(enabledModules: Set<string>): TriggerEvent[] {
  return TRIGGER_EVENT_CATALOG.filter((t) => !t.requiresModule || enabledModules.has(t.requiresModule))
}

/** Acha o label de um event value. */
export function triggerLabel(value: string): string {
  return TRIGGER_EVENT_CATALOG.find((t) => t.value === value)?.label ?? value
}
