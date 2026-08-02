-- CreateTable
CREATE TABLE `bychat_web_stack_scans` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `domain` VARCHAR(191) NOT NULL,
    `finalUrl` TEXT NULL,
    `httpStatus` INTEGER NULL,
    `title` VARCHAR(255) NULL,
    `tlsValid` BOOLEAN NOT NULL DEFAULT true,
    `error` VARCHAR(255) NULL,
    `hasMetaPixel` BOOLEAN NOT NULL DEFAULT false,
    `hasGoogleAds` BOOLEAN NOT NULL DEFAULT false,
    `hasGa4` BOOLEAN NOT NULL DEFAULT false,
    `hasGtm` BOOLEAN NOT NULL DEFAULT false,
    `hasOtherPixel` BOOLEAN NOT NULL DEFAULT false,
    `hasChat` BOOLEAN NOT NULL DEFAULT false,
    `hasCrm` BOOLEAN NOT NULL DEFAULT false,
    `cms` VARCHAR(40) NULL,
    `detected` JSON NULL,
    `gapScore` INTEGER NOT NULL DEFAULT 0,
    `leadId` INTEGER NULL,
    `companyId` INTEGER NULL,
    `scannedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `bychat_web_stack_scans_domain_key`(`domain`),
    INDEX `bychat_web_stack_scans_gapScore_idx`(`gapScore`),
    INDEX `bychat_web_stack_scans_leadId_idx`(`leadId`),
    INDEX `bychat_web_stack_scans_companyId_idx`(`companyId`),
    INDEX `bychat_web_stack_scans_cms_idx`(`cms`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

