-- Integração Kommo CRM — tabela de mapeamento de IDs externos → locais.
-- Idempotência do importador: re-sync faz upsert via (entityType, kommoId).

CREATE TABLE `bychat_kommo_mappings` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `entityType` VARCHAR(30) NOT NULL,
    `kommoId` VARCHAR(40) NOT NULL,
    `localId` INTEGER NOT NULL,
    `meta` JSON NULL,
    `syncedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `bychat_kommo_mappings_entityType_kommoId_key`(`entityType`, `kommoId`),
    INDEX `bychat_kommo_mappings_entityType_localId_idx`(`entityType`, `localId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
