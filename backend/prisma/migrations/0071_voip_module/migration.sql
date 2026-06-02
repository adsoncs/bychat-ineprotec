-- Módulo VoIP — integração FaleMaisVoip (PABX Virtual).
-- Aditivo: nova tabela de CDR (bychat_voip_calls) + coluna de ramal no usuário.
--
-- Decisão: campos "tipo enum" (direction/status/source) como VARCHAR — mesma
-- razão do 0070 (Prisma 5 + ENUM MySQL dá P2032). Validação fica no app (TS).
-- leadId/userId/activityId são scalars sem FK de propósito: bulk_sync pode não
-- casar com lead e não queremos back-relations em users/leads.

-- Ramal (extension) do operador no PABX, usado pelo click-to-call (v1/dial).
ALTER TABLE `bychat_users` ADD COLUMN `voipExtension` VARCHAR(20) NULL;

CREATE TABLE `bychat_voip_calls` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `leadId` INT NULL,
  `activityId` INT NULL,
  `userId` INT NULL,
  `userName` VARCHAR(191) NULL,
  `extension` VARCHAR(20) NULL,
  `phone` VARCHAR(30) NOT NULL,
  `callerId` VARCHAR(30) NULL,
  `direction` VARCHAR(10) NOT NULL DEFAULT 'outbound',
  `provider` VARCHAR(30) NOT NULL DEFAULT 'falemais',
  `providerCallId` VARCHAR(64) NULL,
  `uniqueid` VARCHAR(64) NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'dialing',
  `startedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `answeredAt` DATETIME(3) NULL,
  `durationSec` INT NULL,
  `recordingUrl` TEXT NULL,
  `recordingPath` VARCHAR(255) NULL,
  `recordingSyncedAt` DATETIME(3) NULL,
  `source` VARCHAR(20) NOT NULL DEFAULT 'click_to_call',
  `raw` JSON NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_voip_lead` (`leadId`),
  KEY `idx_voip_user` (`userId`),
  KEY `idx_voip_status` (`status`),
  KEY `idx_voip_provider_call` (`providerCallId`),
  KEY `idx_voip_uniqueid` (`uniqueid`),
  KEY `idx_voip_started` (`startedAt`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
