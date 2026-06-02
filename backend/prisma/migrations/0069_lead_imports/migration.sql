-- 0069_lead_imports
-- Módulo de importação de leads via planilha (CSV/Excel).
--
-- Fluxo:
--   1. Admin faz upload de CSV/xlsx → preview salva linha aqui com status=preview
--      + mapping JSON + parsedRows JSON (até 5000 linhas)
--   2. Admin revisa e confirma → commit lê parsedRows, processa em chunks,
--      atualiza status=running → done; errors JSON acumula falhas individuais.
--   3. previewExpiresAt: previews abandonados (sem commit em 24h) são limpos.
--
-- status: preview | running | done | failed | expired
-- totals: { created, updated, skipped, failed, total }
-- mapping: { srcColumn: targetField, ... } + opções (matchBy, etc.)

CREATE TABLE `bychat_lead_imports` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `importedByUserId` INT NULL,
  `fileName` VARCHAR(255) NOT NULL,
  `fileSize` INT NULL,
  `status` VARCHAR(15) NOT NULL DEFAULT 'preview',
  `totals` JSON NULL,
  `mapping` JSON NOT NULL,
  `parsedRows` MEDIUMTEXT NULL,
  `errors` JSON NULL,
  `previewExpiresAt` DATETIME(3) NULL,
  `startedAt` DATETIME(3) NULL,
  `finishedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `bychat_lead_imports_status_idx` (`status`),
  KEY `bychat_lead_imports_importedByUserId_idx` (`importedByUserId`),
  CONSTRAINT `bychat_lead_imports_importedByUserId_fkey`
    FOREIGN KEY (`importedByUserId`) REFERENCES `bychat_users`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
