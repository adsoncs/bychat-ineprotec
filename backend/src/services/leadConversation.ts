// src/services/leadConversation.ts
// Estado de "atendimento ativo" no módulo Conversas.
//
// Conversa "aberta" = lead aparece como ticket em Conversas; novas mensagens
// caem direto no atendimento. Conversa "fechada" = ticket sai da listagem
// principal, fica em Resolvidos. Mensagens novas em conversa fechada REABREM
// automaticamente. Mensagens em lead que NUNCA teve conversa aberta ficam na
// "Caixa de entrada bruta" — operador decide se abre.

import { prisma } from '../lib/prisma.js'
import { logEvent } from './leadHistory.js'

interface OpenOpts {
  byUserId?: number
  byUserName?: string
  reason?: string // 'manual', 'outbound', 'reopen_message', 'chatbot_escalation'
}

// Abre (ou reabre) o atendimento. Idempotente: se já está aberto, não muda.
export async function openConversation(leadId: number, opts: OpenOpts = {}): Promise<{ opened: boolean; reopened: boolean }> {
  const cur = await prisma.lead.findUnique({
    where: { id: leadId },
    select: { id: true, conversationOpenedAt: true, conversationClosedAt: true, snoozedUntil: true },
  })
  if (!cur) return { opened: false, reopened: false }
  // Conversa já está aberta (sem closedAt mais recente que openedAt)
  const isOpen = cur.conversationOpenedAt && (!cur.conversationClosedAt || cur.conversationClosedAt < cur.conversationOpenedAt)
  if (isOpen) {
    // Mesmo idempotente, limpa snooze: cliente voltou a falar (ou operador
    // mandou outbound) → não faz sentido continuar adormecido.
    if (cur.snoozedUntil && cur.snoozedUntil > new Date()) {
      await prisma.lead.update({ where: { id: leadId }, data: { snoozedUntil: null } })
    }
    return { opened: false, reopened: false }
  }

  const wasReopen = !!cur.conversationOpenedAt && !!cur.conversationClosedAt
  await prisma.lead.update({
    where: { id: leadId },
    data: { conversationOpenedAt: new Date(), conversationClosedAt: null, snoozedUntil: null },
  })
  logEvent({
    leadId,
    type: (wasReopen ? 'conversation_reopened' : 'conversation_opened') as any,
    category: 'lifecycle',
    title: wasReopen ? 'Atendimento reaberto' : 'Atendimento iniciado',
    source: opts.reason || 'panel',
    actorType: opts.byUserId ? 'operator' : 'system',
    userId: opts.byUserId,
    userName: opts.byUserName,
    description: opts.reason || undefined,
  })
  return { opened: !wasReopen, reopened: wasReopen }
}

// Encerra o atendimento. Lead some da listagem principal mas fica em Resolvidos.
// Próxima mensagem reabre automaticamente.
//
// Caso o lead nunca tenha tido conversa aberta (Caixa), abre e fecha em um
// só passo — útil pra "descartar" leads (spam, engano) direto da Caixa sem
// precisar Assumir antes.
export async function closeConversation(leadId: number, opts: OpenOpts = {}): Promise<{ closed: boolean }> {
  const cur = await prisma.lead.findUnique({
    where: { id: leadId },
    select: { conversationOpenedAt: true, conversationClosedAt: true },
  })
  if (!cur) return { closed: false }
  // Já fechado e não há reabertura pendente
  if (cur.conversationClosedAt && cur.conversationOpenedAt && cur.conversationClosedAt >= cur.conversationOpenedAt) {
    return { closed: false }
  }

  const now = new Date()
  // Sem conversa aberta: abre + fecha agora (descarte da Caixa). Senão, só fecha.
  //
  // Encerrar zera o não-lido. Antes o contador ficava como estava e a conversa
  // saía da aba — e como o painel procurava o número na lista da aba, ele nunca
  // mais tinha como zerar: ficava "não lida" para sempre, já resolvida. Encerrar
  // é o gesto mais explícito de "terminei com isto"; se chegar mensagem nova, o
  // webhook reabre a conversa e volta a contar.
  const data = cur.conversationOpenedAt
    ? { conversationClosedAt: now, unreadMessages: 0 }
    : { conversationOpenedAt: now, conversationClosedAt: now, unreadMessages: 0 }

  await prisma.lead.update({ where: { id: leadId }, data })
  logEvent({
    leadId,
    type: 'conversation_closed' as any,
    category: 'lifecycle',
    title: cur.conversationOpenedAt ? 'Atendimento encerrado' : 'Lead descartado da Caixa',
    source: 'panel',
    actorType: opts.byUserId ? 'operator' : 'system',
    userId: opts.byUserId,
    userName: opts.byUserName,
    description: opts.reason || undefined,
  })
  return { closed: true }
}

// Garante que a conversa está aberta — usado em outbound (operador mandou
// mensagem) e em reabertura por mensagem inbound em conversa fechada.
export async function ensureConversationOpen(leadId: number, opts: OpenOpts = {}) {
  return openConversation(leadId, opts)
}

// Helpers de filtro reutilizáveis nas queries de tickets.
// inbox    = atendimento ativo (ticket aberto agora). openConversation sempre
//            zera closedAt, então closedAt == null + openedAt != null garante "aberto".
// raw      = mensagens recebidas em lead que nunca teve ticket aberto.
// resolved = ticket fechado (lead já foi atendido alguma vez e o operador encerrou).
export const conversationFilters = {
  inbox:    { conversationOpenedAt: { not: null }, conversationClosedAt: null },
  resolved: { conversationClosedAt: { not: null } },
  raw:      { conversationOpenedAt: null, lastMessageAt: { not: null } },
} as const
