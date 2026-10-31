-- Disparos Inteligentes (smart_broadcast): campanhas por número próprio (Evolution),
-- com ritmo humanizado, saúde/aquecimento por número e cache de checagem de número.

-- CreateTable
CREATE TABLE `bychat_smart_campaigns` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'draft',
    `senderInstances` JSON NOT NULL,
    `messageBlocks` JSON NOT NULL,
    `audienceType` VARCHAR(12) NOT NULL,
    `audienceMeta` JSON NULL,
    `pacingProfileId` INTEGER NULL,
    `pacingConfig` JSON NOT NULL,
    `windowConfig` JSON NOT NULL,
    `dailyCapPerNumber` INTEGER NOT NULL DEFAULT 20,
    `requireOptIn` BOOLEAN NOT NULL DEFAULT false,
    `legalBasis` VARCHAR(30) NULL,
    `scheduledAt` DATETIME(3) NULL,
    `startedAt` DATETIME(3) NULL,
    `completedAt` DATETIME(3) NULL,
    `riskState` VARCHAR(16) NOT NULL DEFAULT 'ok',
    `riskReason` VARCHAR(191) NULL,
    `totalRecipients` INTEGER NOT NULL DEFAULT 0,
    `sentCount` INTEGER NOT NULL DEFAULT 0,
    `failedCount` INTEGER NOT NULL DEFAULT 0,
    `skippedCount` INTEGER NOT NULL DEFAULT 0,
    `repliedCount` INTEGER NOT NULL DEFAULT 0,
    `createdByUserId` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `bychat_smart_campaigns_status_idx`(`status`),
    INDEX `bychat_smart_campaigns_scheduledAt_idx`(`scheduledAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bychat_smart_campaign_recipients` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `campaignId` INTEGER NOT NULL,
    `leadId` INTEGER NULL,
    `phone` VARCHAR(30) NOT NULL,
    `phoneKey` VARCHAR(30) NOT NULL,
    `name` VARCHAR(191) NULL,
    `variables` JSON NOT NULL,
    `assignedInstanceId` INTEGER NULL,
    `assignedInstance` VARCHAR(100) NULL,
    `variantIndex` INTEGER NOT NULL DEFAULT 0,
    `plannedAt` DATETIME(3) NULL,
    `status` VARCHAR(12) NOT NULL DEFAULT 'pending',
    `skipReason` VARCHAR(30) NULL,
    `externalId` VARCHAR(191) NULL,
    `error` VARCHAR(500) NULL,
    `sentText` TEXT NULL,
    `scheduledAt` DATETIME(3) NULL,
    `sentAt` DATETIME(3) NULL,
    `deliveredAt` DATETIME(3) NULL,
    `readAt` DATETIME(3) NULL,
    `repliedAt` DATETIME(3) NULL,
    `failedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `bychat_smart_campaign_recipients_campaignId_status_idx`(`campaignId`, `status`),
    INDEX `bychat_smart_campaign_recipients_plannedAt_idx`(`plannedAt`),
    INDEX `bychat_smart_campaign_recipients_externalId_idx`(`externalId`),
    INDEX `bychat_smart_campaign_recipients_phoneKey_idx`(`phoneKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bychat_smart_sender_health` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `instanceId` INTEGER NOT NULL,
    `instanceName` VARCHAR(100) NOT NULL,
    `day` DATE NOT NULL,
    `sent` INTEGER NOT NULL DEFAULT 0,
    `delivered` INTEGER NOT NULL DEFAULT 0,
    `failed` INTEGER NOT NULL DEFAULT 0,
    `replies` INTEGER NOT NULL DEFAULT 0,
    `notFound` INTEGER NOT NULL DEFAULT 0,
    `warmupDay` INTEGER NOT NULL DEFAULT 1,
    `dailyCap` INTEGER NOT NULL DEFAULT 20,
    `state` VARCHAR(12) NOT NULL DEFAULT 'warming',
    `pausedUntil` DATETIME(3) NULL,
    `pauseReason` VARCHAR(191) NULL,
    `score` INTEGER NOT NULL DEFAULT 100,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `bychat_smart_sender_health_instanceName_idx`(`instanceName`),
    UNIQUE INDEX `bychat_smart_sender_health_instanceId_day_key`(`instanceId`, `day`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bychat_smart_pacing_profiles` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(60) NOT NULL,
    `description` VARCHAR(255) NULL,
    `isSystem` BOOLEAN NOT NULL DEFAULT false,
    `minDelayMs` INTEGER NOT NULL DEFAULT 40000,
    `maxDelayMs` INTEGER NOT NULL DEFAULT 180000,
    `sessionSize` INTEGER NOT NULL DEFAULT 20,
    `sessionBreakMs` INTEGER NOT NULL DEFAULT 600000,
    `typingEnabled` BOOLEAN NOT NULL DEFAULT true,
    `readReceipts` BOOLEAN NOT NULL DEFAULT true,
    `dailyCapStart` INTEGER NOT NULL DEFAULT 20,
    `dailyCapMax` INTEGER NOT NULL DEFAULT 250,
    `warmupCurve` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `bychat_smart_pacing_profiles_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bychat_smart_number_checks` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `phoneKey` VARCHAR(30) NOT NULL,
    `exists` BOOLEAN NOT NULL,
    `jid` VARCHAR(100) NULL,
    `checkedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `bychat_smart_number_checks_phoneKey_key`(`phoneKey`),
    INDEX `bychat_smart_number_checks_checkedAt_idx`(`checkedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `bychat_smart_campaign_recipients` ADD CONSTRAINT `bychat_smart_campaign_recipients_campaignId_fkey` FOREIGN KEY (`campaignId`) REFERENCES `bychat_smart_campaigns`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

