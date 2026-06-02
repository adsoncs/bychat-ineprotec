-- 0064_sla_first_response
-- Fase 10 do módulo Lead Routing — SLA de primeira resposta.
--
-- Lead.firstResponseAt: timestamp da primeira ação efetiva do agente atribuído.
-- "Ação efetiva" hoje = Activity completed pelo assignedUser. F10+ pode adicionar
-- outros gatilhos (mensagem outbound, conversa atendida).
--
-- Setting routing.sla.firstResponseMinutes: tempo máximo desejado em minutos
-- entre assignedAt e firstResponseAt para SLA ser cumprido. Default 30.

ALTER TABLE `bychat_leads`
  ADD COLUMN `firstResponseAt` DATETIME(3) NULL;

CREATE INDEX `bychat_leads_firstResponseAt_idx` ON `bychat_leads`(`firstResponseAt`);

INSERT INTO `bychat_settings` (`key`, `value`, `label`, `grp`, `fieldType`, `createdAt`, `updatedAt`)
  VALUES (
    'routing.sla.firstResponseMinutes',
    CAST('30' AS JSON),
    'SLA — tempo máximo de primeira resposta (minutos)',
    'routing',
    'number',
    CURRENT_TIMESTAMP(3),
    CURRENT_TIMESTAMP(3)
  )
  ON DUPLICATE KEY UPDATE `updatedAt` = CURRENT_TIMESTAMP(3);
