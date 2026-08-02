-- CreateTable
CREATE TABLE `bychat_reputation_companies` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `slug` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `segment` VARCHAR(191) NULL,
    `area` VARCHAR(191) NULL,
    `lastPeriod` VARCHAR(7) NULL,
    `complaints` INTEGER NOT NULL DEFAULT 0,
    `unansweredRate` DOUBLE NULL,
    `unresolvedRate` DOUBLE NULL,
    `ratedShare` DOUBLE NULL,
    `avgScore` DOUBLE NULL,
    `avgResponseDays` DOUBLE NULL,
    `topProblem` VARCHAR(255) NULL,
    `topUf` VARCHAR(2) NULL,
    `complaintsDelta` DOUBLE NULL,
    `opportunityScore` INTEGER NOT NULL DEFAULT 0,
    `status` VARCHAR(20) NOT NULL DEFAULT 'new',
    `leadId` INTEGER NULL,
    `notes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `bychat_reputation_companies_slug_key`(`slug`),
    INDEX `bychat_reputation_companies_opportunityScore_idx`(`opportunityScore`),
    INDEX `bychat_reputation_companies_segment_idx`(`segment`),
    INDEX `bychat_reputation_companies_status_idx`(`status`),
    INDEX `bychat_reputation_companies_lastPeriod_idx`(`lastPeriod`),
    INDEX `bychat_reputation_companies_leadId_idx`(`leadId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bychat_reputation_snapshots` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `companyId` INTEGER NOT NULL,
    `period` VARCHAR(7) NOT NULL,
    `complaints` INTEGER NOT NULL DEFAULT 0,
    `unanswered` INTEGER NOT NULL DEFAULT 0,
    `rated` INTEGER NOT NULL DEFAULT 0,
    `unresolved` INTEGER NOT NULL DEFAULT 0,
    `avgScore` DOUBLE NULL,
    `avgResponseDays` DOUBLE NULL,
    `breakdown` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `bychat_reputation_snapshots_period_idx`(`period`),
    UNIQUE INDEX `bychat_reputation_snapshots_companyId_period_key`(`companyId`, `period`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bychat_reputation_imports` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `period` VARCHAR(7) NOT NULL,
    `sourceCode` VARCHAR(30) NULL,
    `fileName` VARCHAR(191) NULL,
    `fileBytes` INTEGER NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'running',
    `rows` INTEGER NOT NULL DEFAULT 0,
    `companies` INTEGER NOT NULL DEFAULT 0,
    `durationMs` INTEGER NULL,
    `error` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `bychat_reputation_imports_period_key`(`period`),
    INDEX `bychat_reputation_imports_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `bychat_reputation_snapshots` ADD CONSTRAINT `bychat_reputation_snapshots_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `bychat_reputation_companies`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

