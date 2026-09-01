// src/services/leadConversation.ts
// Estado de "atendimento ativo" no módulo Conversas.
//
// Conversa "aberta" = lead aparece como ticket em Conversas; novas mensagens
// caem direto no atendimento. Conversa "fechada" = ticket sai da listagem
// principal, fica em Resolvidos. Mensagem nova em conversa fechada devolve o
// lead para a CAIXA — ver markConversationReopened. Mensagens em lead que
// NUNCA teve conversa aberta ficam na "Caixa de entrada bruta" — operador
// decide se abre.

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
    select: {
      id: true, conversationOpenedAt: true, conversationClosedAt: true,
      snoozedUntil: true, conversationReopenedAt: true,
    },
  })
  if (!cur) return { opened: false, reopened: false }
  // Conversa já está aberta (sem closedAt mais recente que openedAt)
  const isOpen = cur.conversationOpenedAt && (!cur.conversationClosedAt || cur.conversationClosedAt < cur.conversationOpenedAt)
  if (isOpen) {
    // Mesmo idempotente, limpa snooze: cliente voltou a falar (ou operador
    // mandou outbound) → não faz sentido continuar adormecido.
    if ((cur.snoozedUntil && cur.snoozedUntil > new Date()) || cur.conversationReopenedAt) {
      await prisma.lead.update({
        where: { id: leadId },
        data: { snoozedUntil: null, conversationReopenedAt: null },
      })
    }
    return { opened: false, reopened: false }
  }

  const wasReopen = !!cur.conversationOpenedAt && !!cur.conversationClosedAt
  await prisma.lead.update({
    where: { id: leadId },
    // conversationReopenedAt zera aqui: a espera na Caixa termina no instante em
    // que alguém assume ou responde, e é isso que tira o lead da Caixa.
    data: {
      conversationOpenedAt: new Date(), conversationClosedAt: null,
      snoozedUntil: null, conversationReopenedAt: null,
    },
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
  // conversationReopenedAt volta a NULL: encerrar é a resposta ao retorno do
  // contato, e sem zerar o lead ficaria preso na Caixa depois de resolvido.
  const data = cur.conversationOpenedAt
    ? { conversationClosedAt: now, unreadMessages: 0, conversationReopenedAt: null }
    : { conversationOpenedAt: now, conversationClosedAt: now, unreadMessages: 0, conversationReopenedAt: null }

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
// mensagem) e ao assumir o ticket.
export async function ensureConversationOpen(leadId: number, opts: OpenOpts = {}) {
  return openConversation(leadId, opts)
}

/**
 * O contato voltou a falar numa conversa JÁ ENCERRADA.
 *
 * Isto chamava openConversation, e o lead voltava direto para Atendimento com o
 * dono de antes: a conversa renascia "em atendimento" sem ninguém ter pegado, e
 * quem estivesse de olho na Caixa não via que havia trabalho novo. Agora o
 * retorno cai na CAIXA, que é justamente a fila de "chegou e ninguém pegou".
 *
 * O encerramento fica de pé (conversationClosedAt intacto) e quem marca o
 * retorno é conversationReopenedAt — é ele que tira o lead de Resolvidos. Para
 * ONDE ele vai depende de haver responsável: com dono, para Aguardando (a fila
 * de quem responde); sem dono, para a Caixa (a fila de quem pega). Assim o dono
 * não é mexido: assignedUserId é o responsável no funil inteiro, não só na
 * conversa, e zerá-lo a cada retorno tiraria o lead da carteira do vendedor,
 * das metas e das comissões.
 *
 * A marca também LIBERA a resposta no painel: quem reabriu foi o contato, e
 * exigir que o operador clicasse em "Reabrir" antes de digitar era pedir que
 * ele repetisse um gesto que o cliente já tinha feito.
 *
 * Idempotente e sem renovar: a segunda mensagem seguida preserva o instante da
 * primeira. Renovar faria o lead rejuvenescer na fila a cada mensagem e passar
 * na frente de quem espera há mais tempo.
 */
export async function markConversationReopened(leadId: number, opts: OpenOpts = {}): Promise<{ reopened: boolean }> {
  const cur = await prisma.lead.findUnique({
    where: { id: leadId },
    select: { conversationOpenedAt: true, conversationClosedAt: true, conversationReopenedAt: true },
  })
  if (!cur) return { reopened: false }
  // Só vale para conversa encerrada: a aberta não tem o que reabrir, e o lead
  // que nunca conversou já entra na Caixa pelo caminho normal.
  const encerrada = !!cur.conversationOpenedAt && !!cur.conversationClosedAt
  if (!encerrada || cur.conversationReopenedAt) return { reopened: false }

  await prisma.lead.update({
    where: { id: leadId },
    data: { conversationReopenedAt: new Date(), snoozedUntil: null },
  })
  logEvent({
    leadId,
    type: 'conversation_reopened' as any,
    category: 'lifecycle',
    title: 'Contato voltou a falar — conversa devolvida à Caixa',
    source: opts.reason || 'reopen_message',
    actorType: 'lead',
    description: opts.reason || undefined,
  })
  return { reopened: true }
}

// Helpers de filtro reutilizáveis nas queries de tickets. A definição que MANDA
// é a de routes/atendimento.ts (condicaoDaCaixa) — estes são o mesmo critério
// escrito curto, e mudar um sem o outro é o que faz o contador discordar da lista.
// inbox    = atendimento ativo (ticket aberto agora). openConversation sempre
//            zera closedAt, então closedAt == null + openedAt != null garante "aberto".
// raw      = lead que nunca teve ticket aberto, MAIS o retorno SEM dono. O
//            retorno de quem TEM dono é Aguardando: fila do responsável, não
//            fila pública.
// resolved = ticket fechado e sem retorno pendente do contato.
export const conversationFilters = {
  inbox:    { conversationOpenedAt: { not: null }, conversationClosedAt: null },
  resolved: { conversationClosedAt: { not: null }, conversationReopenedAt: null },
  raw:      { OR: [
    { conversationOpenedAt: null, lastMessageAt: { not: null } },
    { conversationReopenedAt: { not: null }, assignedUserId: null },
  ] },
} as const
