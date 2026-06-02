-- 0037_lead_outcome_won_lost
-- Fase 23: classificação manual de Lead como Ganho/Perdido + catálogo de motivos.
-- Aditiva: leads existentes mantêm outcome=NULL ("em andamento"), sem alteração de comportamento.

CREATE TABLE `bychat_loss_reasons` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(100) NOT NULL,
  `color` VARCHAR(20) NULL,
  `position` INT NOT NULL DEFAULT 0,
  `active` TINYINT(1) NOT NULL DEFAULT 1,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  INDEX `bychat_loss_reasons_active_position_idx` (`active`, `position`)
) ENGINE=InnoDB;

ALTER TABLE `bychat_leads`
  ADD COLUMN `outcome` VARCHAR(10) NULL,
  ADD COLUMN `outcomeAt` DATETIME(3) NULL,
  ADD COLUMN `outcomeBy` INT NULL,
  ADD COLUMN `outcomeNote` TEXT NULL,
  ADD COLUMN `lostReasonId` INT NULL,
  ADD INDEX `bychat_leads_outcome_idx` (`outcome`),
  ADD INDEX `bychat_leads_outcome_outcomeAt_idx` (`outcome`, `outcomeAt`),
  ADD CONSTRAINT `bychat_leads_lostReasonId_fkey`
    FOREIGN KEY (`lostReasonId`) REFERENCES `bychat_loss_reasons`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE;

-- Seed inicial dos motivos de perda mais comuns (admin pode editar/desativar/adicionar)
INSERT INTO `bychat_loss_reasons` (`name`, `color`, `position`, `active`, `createdAt`, `updatedAt`) VALUES
  ('Sem orçamento', '#f59e0b', 0, 1, NOW(3), NOW(3)),
  ('Sem fit com o produto', '#6b7280', 10, 1, NOW(3), NOW(3)),
  ('Foi para o concorrente', '#ef4444', 20, 1, NOW(3), NOW(3)),
  ('Não respondeu', '#94a3b8', 30, 1, NOW(3), NOW(3)),
  ('Decidiu não comprar agora', '#0ea5e9', 40, 1, NOW(3), NOW(3)),
  ('Outro', '#a855f7', 90, 1, NOW(3), NOW(3));
