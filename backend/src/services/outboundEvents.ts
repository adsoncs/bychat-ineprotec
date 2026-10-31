// src/services/outboundEvents.ts
//
// Emite o domain event `message.sent` para saídas que NÃO passam pelo
// ticketMessageSender — hoje: chatbot de diagnóstico e Jornada de IA.
//
// Por que não usar `logEvent(MESSAGE_SENT)` como o painel faz: aquele caminho
// grava uma linha em `bychat_lead_events` a cada mensagem. O bot fala muito
// mais que um humano — a timeline do lead viraria uma parede de "Mensagem
// enviada" e todo contador que soma eventos `message_sent` (produtividade do
// atendimento, relatórios) passaria a misturar bot com operador. Aqui só o
// evento em memória é emitido: quem escuta são os workflows, e nada é
// persistido.
//
// `source` é o que o filtro "Enviada por" do gatilho compara:
//   panel | scheduled  → ticketMessageSender (operador ou envio agendado)
//   chatbot            → chatbotFlow (diagnóstico / IA de atendimento)
//   ai_journey         → aiJourneyEngine (Jornada de IA)
//   workflow           → workers.ts (passo "enviar WhatsApp" de um fluxo)

import { eventBus } from '../lib/eventBus.js'

export type OutboundSource = 'chatbot' | 'ai_journey'

export interface EmitOutboundMessageInput {
  leadId: number
  source: OutboundSource
  /** whatsapp | instagram | telegram | web_chat — o canal por onde saiu. */
  channel?: string | null
  chatbotId?: number | null
  funnelId?: number | null
}

export function emitOutboundMessage(input: EmitOutboundMessageInput): void {
  const { leadId, source, channel, chatbotId, funnelId } = input
  if (!leadId) return

  try {
    eventBus.emitDomain({
      type: 'message.sent',
      leadId,
      chatbotId: chatbotId ?? undefined,
      funnelId: funnelId ?? undefined,
      // Mesmo formato que o logEvent monta, para o matchesTriggerConfig do
      // workflowEngine achar `source` e `channel` no lugar de sempre.
      payload: {
        channel: channel || 'whatsapp',
        source,
        metadata: { automated: true },
      },
      timestamp: new Date(),
    })
  } catch (err) {
    // Nunca derruba o envio: o evento é acessório à mensagem, que já saiu.
    console.error(`[outboundEvents] falha ao emitir message.sent (lead ${leadId}):`, err)
  }
}
