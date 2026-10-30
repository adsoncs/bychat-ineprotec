-- Integração Clinica Experts (agenda da clínica): vínculo entre o registro daqui
-- e o UUID de lá. Só tabela nova. IF NOT EXISTS: no elementus ela já existe
-- (veio na 0138_clinica_experts de lá).

CREATE TABLE IF NOT EXISTS `bychat_clinica_experts_mappings` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `entityType` VARCHAR(20) NOT NULL,
  `ceUuid` VARCHAR(64) NOT NULL,
  `localId` INTEGER NOT NULL,
  `meta` JSON NULL,
  `syncedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  UNIQUE INDEX `bychat_clinica_experts_mappings_entityType_ceUuid_key`(`entityType`, `ceUuid`),
  INDEX `bychat_clinica_experts_mappings_entityType_localId_idx`(`entityType`, `localId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
