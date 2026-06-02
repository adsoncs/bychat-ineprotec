-- CreateTable
CREATE TABLE `bychat_trash` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `entityType` VARCHAR(50) NOT NULL,
    `entityId` INTEGER NOT NULL,
    `entityLabel` VARCHAR(191) NOT NULL,
    `snapshot` JSON NOT NULL,
    `deletedBy` INTEGER NULL,
    `deletedByName` VARCHAR(191) NULL,
    `reason` VARCHAR(255) NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `restoredAt` DATETIME(3) NULL,
    `restoredBy` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `bychat_trash_entityType_idx`(`entityType`),
    INDEX `bychat_trash_entityType_entityId_idx`(`entityType`, `entityId`),
    INDEX `bychat_trash_deletedBy_idx`(`deletedBy`),
    INDEX `bychat_trash_expiresAt_idx`(`expiresAt`),
    INDEX `bychat_trash_restoredAt_idx`(`restoredAt`),
    INDEX `bychat_trash_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
