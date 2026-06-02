-- Roteamento de leads por instância WhatsApp (sem precisar de chatbot)
ALTER TABLE `bychat_whatsapp_instances`
  ADD COLUMN `defaultTeamId` INT NULL,
  ADD INDEX `bychat_whatsapp_instances_defaultTeamId_idx` (`defaultTeamId`),
  ADD CONSTRAINT `bychat_whatsapp_instances_defaultTeamId_fkey`
    FOREIGN KEY (`defaultTeamId`) REFERENCES `bychat_teams`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE;
