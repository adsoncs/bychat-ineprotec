-- Disparos Inteligentes F5/F6: lista de supressão global e envio no melhor horário do contato.

-- AlterTable
ALTER TABLE `bychat_smart_campaigns` ADD COLUMN `usePreferredTime` BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE `bychat_smart_suppressions` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `phoneKey` VARCHAR(30) NOT NULL,
    `phone` VARCHAR(30) NOT NULL,
    `reason` VARCHAR(30) NOT NULL DEFAULT 'manual',
    `note` VARCHAR(255) NULL,
    `createdByUserId` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `bychat_smart_suppressions_phoneKey_key`(`phoneKey`),
    INDEX `bychat_smart_suppressions_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

