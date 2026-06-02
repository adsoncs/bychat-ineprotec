-- ═══════════════════════════════════════════════════════════════════
-- EnrollmentDocument evolui para suportar análise IA + FK tipada
-- F2.1 — Fundação da análise documental com Claude Sonnet visão
-- ═══════════════════════════════════════════════════════════════════

-- Rename da coluna legada `type` → `typeCode` (preserva dados existentes).
-- Novos uploads populam `typeId` (FK) + `typeCode` (string legada para compat).
ALTER TABLE `bychat_enrollment_documents`
  CHANGE COLUMN `type` `typeCode` VARCHAR(30) NOT NULL;

-- FK para DocumentType (nullable — docs pré-F2 não têm)
ALTER TABLE `bychat_enrollment_documents`
  ADD COLUMN `typeId` INT NULL,
  ADD INDEX `bychat_enrollment_documents_typeId_idx` (`typeId`),
  ADD CONSTRAINT `bychat_enrollment_documents_type_fk`
    FOREIGN KEY (`typeId`) REFERENCES `bychat_edu_document_types`(`id`) ON DELETE SET NULL;

-- Campos de análise IA
ALTER TABLE `bychat_enrollment_documents`
  ADD COLUMN `aiStatus` VARCHAR(20) NOT NULL DEFAULT 'pending',
  ADD COLUMN `aiSuggestion` VARCHAR(20) NULL,
  ADD COLUMN `aiConfidence` DOUBLE NULL,
  ADD COLUMN `aiAnalysis` JSON NULL,
  ADD COLUMN `aiCostUsd` DOUBLE NULL,
  ADD COLUMN `aiProcessedAt` DATETIME(3) NULL,
  ADD INDEX `bychat_enrollment_documents_aiStatus_idx` (`aiStatus`);

-- Docs existentes: marca aiStatus como 'skipped' (não passarão por IA retroativamente).
UPDATE `bychat_enrollment_documents` SET `aiStatus` = 'skipped' WHERE `aiStatus` = 'pending';

-- Best-effort: tenta resolver `typeId` para docs legados matching pelo typeCode.
-- Não-fatal se não encontrar (fica null).
UPDATE `bychat_enrollment_documents` d
  LEFT JOIN `bychat_edu_document_types` t ON t.`code` = d.`typeCode`
  SET d.`typeId` = t.`id`
  WHERE d.`typeId` IS NULL AND t.`id` IS NOT NULL;
