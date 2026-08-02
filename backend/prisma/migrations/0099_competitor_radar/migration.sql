-- CreateTable
CREATE TABLE `bychat_competitor_agencies` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `placeId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `categories` VARCHAR(255) NULL,
    `address` TEXT NULL,
    `city` VARCHAR(120) NULL,
    `uf` VARCHAR(60) NULL,
    `website` VARCHAR(255) NULL,
    `domain` VARCHAR(191) NULL,
    `phone` VARCHAR(40) NULL,
    `rating` DOUBLE NULL,
    `reviewsCount` INTEGER NULL,
    `negativeWithText` INTEGER NOT NULL DEFAULT 0,
    `searchTerm` VARCHAR(191) NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'new',
    `notes` TEXT NULL,
    `lastScanAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `bychat_competitor_agencies_placeId_key`(`placeId`),
    INDEX `bychat_competitor_agencies_city_idx`(`city`),
    INDEX `bychat_competitor_agencies_rating_idx`(`rating`),
    INDEX `bychat_competitor_agencies_status_idx`(`status`),
    INDEX `bychat_competitor_agencies_domain_idx`(`domain`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bychat_competitor_reviews` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `agencyId` INTEGER NOT NULL,
    `externalId` VARCHAR(191) NOT NULL,
    `stars` INTEGER NOT NULL,
    `text` TEXT NOT NULL,
    `publishedAt` DATETIME(3) NULL,
    `ownerReplied` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `bychat_competitor_reviews_externalId_key`(`externalId`),
    INDEX `bychat_competitor_reviews_agencyId_idx`(`agencyId`),
    INDEX `bychat_competitor_reviews_stars_idx`(`stars`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `bychat_competitor_reviews` ADD CONSTRAINT `bychat_competitor_reviews_agencyId_fkey` FOREIGN KEY (`agencyId`) REFERENCES `bychat_competitor_agencies`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

