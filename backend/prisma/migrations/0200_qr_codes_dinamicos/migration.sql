-- QR Codes dinâmicos com rastreio de leitura (QR) e clique (link curto).
-- Só tabelas novas.

-- CreateTable
CREATE TABLE `bychat_qr_codes` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `slug` VARCHAR(64) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `kind` VARCHAR(20) NOT NULL DEFAULT 'url',
    `destinationUrl` TEXT NULL,
    `payload` JSON NULL,
    `style` JSON NULL,
    `utmSource` VARCHAR(100) NULL,
    `utmMedium` VARCHAR(100) NULL,
    `utmCampaign` VARCHAR(191) NULL,
    `utmContent` VARCHAR(191) NULL,
    `utmTerm` VARCHAR(191) NULL,
    `folder` VARCHAR(100) NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `expiresAt` DATETIME(3) NULL,
    `expiredUrl` TEXT NULL,
    `totalScans` INTEGER NOT NULL DEFAULT 0,
    `uniqueScans` INTEGER NOT NULL DEFAULT 0,
    `totalClicks` INTEGER NOT NULL DEFAULT 0,
    `uniqueClicks` INTEGER NOT NULL DEFAULT 0,
    `lastAccessAt` DATETIME(3) NULL,
    `createdBy` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `bychat_qr_codes_slug_key`(`slug`),
    INDEX `bychat_qr_codes_active_idx`(`active`),
    INDEX `bychat_qr_codes_folder_idx`(`folder`),
    INDEX `bychat_qr_codes_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bychat_qr_code_accesses` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `qrId` INTEGER NOT NULL,
    `via` VARCHAR(8) NOT NULL,
    `visitorHash` VARCHAR(64) NOT NULL,
    `isUnique` BOOLEAN NOT NULL DEFAULT false,
    `ip` VARCHAR(45) NULL,
    `userAgent` TEXT NULL,
    `referer` TEXT NULL,
    `deviceType` VARCHAR(20) NULL,
    `browser` VARCHAR(50) NULL,
    `os` VARCHAR(50) NULL,
    `language` VARCHAR(20) NULL,
    `country` VARCHAR(8) NULL,
    `city` VARCHAR(100) NULL,
    `utmSource` VARCHAR(100) NULL,
    `utmMedium` VARCHAR(100) NULL,
    `utmCampaign` VARCHAR(191) NULL,
    `utmContent` VARCHAR(191) NULL,
    `utmTerm` VARCHAR(191) NULL,
    `queryParams` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `bychat_qr_code_accesses_qrId_createdAt_idx`(`qrId`, `createdAt`),
    INDEX `bychat_qr_code_accesses_qrId_visitorHash_idx`(`qrId`, `visitorHash`),
    INDEX `bychat_qr_code_accesses_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `bychat_qr_code_accesses` ADD CONSTRAINT `bychat_qr_code_accesses_qrId_fkey` FOREIGN KEY (`qrId`) REFERENCES `bychat_qr_codes`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
