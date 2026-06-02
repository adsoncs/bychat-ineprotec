-- AlterTable (LGPD + enrichment state no Lead)
ALTER TABLE `bychat_leads`
  ADD COLUMN `lgpdConsent` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `lgpdConsentAt` DATETIME(3) NULL,
  ADD COLUMN `enrichmentStatus` VARCHAR(20) NULL,
  ADD COLUMN `enrichmentScore` INTEGER NULL,
  ADD COLUMN `enrichedAt` DATETIME(3) NULL;

CREATE INDEX `bychat_leads_enrichmentStatus_idx` ON `bychat_leads`(`enrichmentStatus`);

-- CreateTable
CREATE TABLE `bychat_lead_enrichment` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `leadId` INTEGER NOT NULL,
    `source` VARCHAR(50) NOT NULL,
    `field` VARCHAR(80) NOT NULL,
    `value` TEXT NOT NULL,
    `confidence` DOUBLE NOT NULL DEFAULT 0.5,
    `rawData` JSON NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'active',
    `fetchedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expiresAt` DATETIME(3) NULL,

    INDEX `bychat_lead_enrichment_leadId_idx`(`leadId`),
    INDEX `bychat_lead_enrichment_source_idx`(`source`),
    INDEX `bychat_lead_enrichment_field_idx`(`field`),
    INDEX `bychat_lead_enrichment_leadId_field_idx`(`leadId`, `field`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `bychat_lead_enrichment`
  ADD CONSTRAINT `bychat_lead_enrichment_leadId_fkey`
  FOREIGN KEY (`leadId`) REFERENCES `bychat_leads`(`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;
