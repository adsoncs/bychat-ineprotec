-- CreateEnum
CREATE TABLE IF NOT EXISTS `_prisma_migrations` (
    `id`                    VARCHAR(36) NOT NULL,
    `checksum`              VARCHAR(64) NOT NULL,
    `finished_at`           DATETIME(3),
    `migration_name`        VARCHAR(255) NOT NULL,
    `logs`                  TEXT,
    `rolled_back_at`        DATETIME(3),
    `started_at`            DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `applied_steps_count`   INT UNSIGNED NOT NULL DEFAULT 0,
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `raiox_leads` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `empresa` VARCHAR(191) NOT NULL,
    `nome` VARCHAR(191) NOT NULL DEFAULT '',
    `whatsapp` VARCHAR(30) NOT NULL,
    `email` VARCHAR(191) NOT NULL DEFAULT '',
    `segmento` VARCHAR(100) NULL,
    `cidade` VARCHAR(100) NULL,
    `formData` JSON NOT NULL,
    `scores` JSON NOT NULL,
    `analysis` JSON NULL,
    `solucaoNome` VARCHAR(100) NULL,
    `maturidade` VARCHAR(50) NULL,
    `status` ENUM('NOVO', 'CONTATADO', 'REUNIAO', 'PROPOSTA', 'FECHADO', 'PERDIDO') NOT NULL DEFAULT 'NOVO',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `raiox_leads_status_idx`(`status`),
    INDEX `raiox_leads_createdAt_idx`(`createdAt`),
    INDEX `raiox_leads_segmento_idx`(`segmento`),
    INDEX `raiox_leads_email_idx`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
