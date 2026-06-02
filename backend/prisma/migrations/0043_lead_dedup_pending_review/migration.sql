-- 0043_lead_dedup_pending_review
-- Fase 24: Categoria A (Captura) — sempre cria lead novo, sinaliza duplicado.
-- Em vez de upsert silencioso, cada submissão de Form/Meta/EnrollmentPortal/API/Make
-- cria um lead distinto e marca duplicateStatus='pending_review' apontando pro
-- candidato master via possibleDuplicateOfId. Decisão de mesclar/manter é humana.
-- Categoria B (WhatsApp/Telegram/Instagram) continua com upsert por identidade.
--
-- Aditiva: leads existentes ficam com duplicateStatus='none' (default).

ALTER TABLE `bychat_leads`
  ADD COLUMN `possibleDuplicateOfId` INT NULL,
  ADD COLUMN `duplicateStatus` VARCHAR(20) NOT NULL DEFAULT 'none',
  ADD COLUMN `duplicateMatchedBy` VARCHAR(20) NULL,
  ADD COLUMN `duplicateFlaggedAt` DATETIME(3) NULL,
  ADD COLUMN `duplicateResolvedAt` DATETIME(3) NULL,
  ADD INDEX `bychat_leads_duplicateStatus_idx` (`duplicateStatus`),
  ADD INDEX `bychat_leads_possibleDuplicateOfId_idx` (`possibleDuplicateOfId`),
  ADD CONSTRAINT `bychat_leads_possibleDuplicateOfId_fkey`
    FOREIGN KEY (`possibleDuplicateOfId`) REFERENCES `bychat_leads`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE;
