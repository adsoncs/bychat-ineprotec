-- Importação de conversas do aparelho conectado (Evolution/QR).
CREATE TABLE `bychat_chat_import_jobs` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `instanceName` VARCHAR(120) NOT NULL,
  `remoteJid` VARCHAR(120) NOT NULL,
  `telefone` VARCHAR(20) NOT NULL,
  `nome` VARCHAR(191) NULL,
  `leadId` INTEGER NULL,
  `status` VARCHAR(16) NOT NULL DEFAULT 'pending',
  `totalNaOrigem` INTEGER NOT NULL DEFAULT 0,
  `importadas` INTEGER NOT NULL DEFAULT 0,
  `jaExistiam` INTEGER NOT NULL DEFAULT 0,
  `midiasPendentes` INTEGER NOT NULL DEFAULT 0,
  `erro` TEXT NULL,
  `createdByUserId` INTEGER NULL,
  `startedAt` DATETIME(3) NULL,
  `finishedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  INDEX `bychat_chat_import_jobs_status_createdAt_idx`(`status`, `createdAt`),
  INDEX `bychat_chat_import_jobs_leadId_idx`(`leadId`),
  INDEX `bychat_chat_import_jobs_createdByUserId_idx`(`createdByUserId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `bychat_chat_import_jobs` ADD CONSTRAINT `bychat_chat_import_jobs_leadId_fkey`
  FOREIGN KEY (`leadId`) REFERENCES `bychat_leads`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `bychat_chat_import_jobs` ADD CONSTRAINT `bychat_chat_import_jobs_createdByUserId_fkey`
  FOREIGN KEY (`createdByUserId`) REFERENCES `bychat_users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
