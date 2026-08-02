-- Integração CRM Educacional (Wakeme): mapeia o GUID do lead no CRM para o
-- lead local, garantindo idempotência do re-sync. `meta.dataModificacao` é o
-- que permite detectar alteração — o filtro da API é por data de CRIAÇÃO.
CREATE TABLE `bychat_crmedu_mappings` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `entityType` VARCHAR(30) NOT NULL,
  `crmId` VARCHAR(40) NOT NULL,
  `localId` INTEGER NOT NULL,
  `meta` JSON NULL,
  `syncedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `bychat_crmedu_mappings_entityType_crmId_key`(`entityType`, `crmId`),
  INDEX `bychat_crmedu_mappings_entityType_localId_idx`(`entityType`, `localId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
