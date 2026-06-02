-- 0066_instance_owner_user
-- Reforma F2 — WhatsApp instância dedicada por agente.
--
-- WhatsAppInstance.ownerUserId (nullable, FK User com onDelete SetNull):
-- quando preenchido, lead que entra por essa instância é atribuído direto
-- ao agente. defaultTeamId continua sendo o fallback (não removemos — instância
-- pode ter os dois preenchidos; convenção: owner ganha prioridade).
--
-- Validação cruzada (canSendVia) verifica que, ao enviar mensagem por
-- instância, o user respeita: owner-only OU membro do defaultTeam.

ALTER TABLE `bychat_whatsapp_instances`
  ADD COLUMN `ownerUserId` INT NULL,
  ADD KEY `bychat_whatsapp_instances_ownerUserId_idx` (`ownerUserId`),
  ADD CONSTRAINT `bychat_whatsapp_instances_ownerUserId_fkey`
    FOREIGN KEY (`ownerUserId`) REFERENCES `bychat_users`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE;
