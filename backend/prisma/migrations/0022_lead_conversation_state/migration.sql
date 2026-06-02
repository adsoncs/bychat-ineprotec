-- Conversation state: separa "atendimento ativo" no módulo Conversas de
-- "mensagens recebidas sem ticket aberto" (caixa de entrada bruta).
--
-- Ticket existe quando conversationOpenedAt != null AND conversationClosedAt = null.
-- Quando ticket é fechado (closedAt > openedAt), nova mensagem recebida reabre
-- automaticamente (handler em recebimento).

ALTER TABLE `bychat_leads`
  ADD COLUMN `conversationOpenedAt` DATETIME(3) NULL,
  ADD COLUMN `conversationClosedAt` DATETIME(3) NULL;

CREATE INDEX `bychat_leads_convo_state_idx`
  ON `bychat_leads`(`conversationOpenedAt`, `conversationClosedAt`);
