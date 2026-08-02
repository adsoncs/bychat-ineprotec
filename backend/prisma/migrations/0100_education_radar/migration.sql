-- CreateTable
CREATE TABLE `bychat_education_institutions` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `inepCode` VARCHAR(20) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `uf` VARCHAR(2) NULL,
    `city` VARCHAR(120) NULL,
    `cityCode` VARCHAR(10) NULL,
    `district` VARCHAR(120) NULL,
    `address` TEXT NULL,
    `zip` VARCHAR(12) NULL,
    `phone` VARCHAR(40) NULL,
    `privateCategory` INTEGER NULL,
    `urban` BOOLEAN NOT NULL DEFAULT true,
    `lastYear` INTEGER NULL,
    `classes` INTEGER NOT NULL DEFAULT 0,
    `classesInf` INTEGER NOT NULL DEFAULT 0,
    `classesFund` INTEGER NOT NULL DEFAULT 0,
    `classesMed` INTEGER NOT NULL DEFAULT 0,
    `classesProf` INTEGER NOT NULL DEFAULT 0,
    `classesEja` INTEGER NOT NULL DEFAULT 0,
    `classesDelta` DOUBLE NULL,
    `hasInternet` BOOLEAN NOT NULL DEFAULT false,
    `hasInternetAdmin` BOOLEAN NOT NULL DEFAULT false,
    `hasInternetLearn` BOOLEAN NOT NULL DEFAULT false,
    `opportunityScore` INTEGER NOT NULL DEFAULT 0,
    `domain` VARCHAR(191) NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'new',
    `leadId` INTEGER NULL,
    `notes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `bychat_education_institutions_inepCode_key`(`inepCode`),
    INDEX `bychat_education_institutions_opportunityScore_idx`(`opportunityScore`),
    INDEX `bychat_education_institutions_uf_city_idx`(`uf`, `city`),
    INDEX `bychat_education_institutions_classes_idx`(`classes`),
    INDEX `bychat_education_institutions_status_idx`(`status`),
    INDEX `bychat_education_institutions_lastYear_idx`(`lastYear`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bychat_education_snapshots` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `institutionId` INTEGER NOT NULL,
    `year` INTEGER NOT NULL,
    `classes` INTEGER NOT NULL DEFAULT 0,
    `classesInf` INTEGER NOT NULL DEFAULT 0,
    `classesFund` INTEGER NOT NULL DEFAULT 0,
    `classesMed` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `bychat_education_snapshots_year_idx`(`year`),
    UNIQUE INDEX `bychat_education_snapshots_institutionId_year_key`(`institutionId`, `year`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bychat_education_imports` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `year` INTEGER NOT NULL,
    `fileName` VARCHAR(191) NULL,
    `fileBytes` INTEGER NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'running',
    `schools` INTEGER NOT NULL DEFAULT 0,
    `rowsRead` INTEGER NOT NULL DEFAULT 0,
    `durationMs` INTEGER NULL,
    `error` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `bychat_education_imports_year_key`(`year`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `bychat_education_snapshots` ADD CONSTRAINT `bychat_education_snapshots_institutionId_fkey` FOREIGN KEY (`institutionId`) REFERENCES `bychat_education_institutions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

