-- 0045_form_default_team
-- Adiciona `defaultTeamId` em `bychat_forms` e `bychat_meta_forms` para
-- rotear leads automaticamente ao setor configurado quando criados via
-- esses canais (formulário público / Meta Lead Ads).

ALTER TABLE `bychat_forms`
  ADD COLUMN `defaultTeamId` INT NULL,
  ADD INDEX `bychat_forms_defaultTeamId_idx` (`defaultTeamId`),
  ADD CONSTRAINT `bychat_forms_defaultTeamId_fkey`
    FOREIGN KEY (`defaultTeamId`) REFERENCES `bychat_teams`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `bychat_meta_forms`
  ADD COLUMN `defaultTeamId` INT NULL,
  ADD INDEX `bychat_meta_forms_defaultTeamId_idx` (`defaultTeamId`),
  ADD CONSTRAINT `bychat_meta_forms_defaultTeamId_fkey`
    FOREIGN KEY (`defaultTeamId`) REFERENCES `bychat_teams`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE;
