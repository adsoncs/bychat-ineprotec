-- Integridade da redação: detecção de IA (com limite de tolerância por
-- processo), similaridade e comportamento de escrita. Ver lib/integridadeRedacao.ts.
ALTER TABLE `bychat_edu_selection_processes` ADD COLUMN `essayIntegrity` JSON NULL;

ALTER TABLE `bychat_edu_essay_submissions`
  ADD COLUMN `aiAuthorshipPct` DOUBLE NULL,
  ADD COLUMN `integrityStatus` VARCHAR(20) NULL,
  ADD COLUMN `integrity` JSON NULL,
  ADD COLUMN `typingTelemetry` JSON NULL,
  ADD COLUMN `integrityDecision` VARCHAR(20) NULL,
  ADD COLUMN `integrityNote` TEXT NULL,
  ADD COLUMN `integrityReviewedBy` INTEGER NULL,
  ADD COLUMN `integrityReviewedAt` DATETIME(3) NULL;

CREATE INDEX `bychat_edu_essay_submissions_integrityStatus_idx` ON `bychat_edu_essay_submissions`(`integrityStatus`);
