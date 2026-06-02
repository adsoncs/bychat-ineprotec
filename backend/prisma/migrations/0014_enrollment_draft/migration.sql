-- Rascunho de inscrição: salva formData intermediário por sessão.
-- Permite ao candidato recuperar progresso se fechar o browser ou trocar de dispositivo.
CREATE TABLE `bychat_enrollment_drafts` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `portalId` INT NOT NULL,
  `sessionId` VARCHAR(64) NOT NULL,
  `formData` JSON NOT NULL,
  `currentStep` INT NOT NULL DEFAULT 0,
  `email` VARCHAR(191) NULL,
  `whatsapp` VARCHAR(30) NULL,
  `ipAddress` VARCHAR(45) NULL,
  `expiresAt` DATETIME(3) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `bychat_enrollment_drafts_sessionId_uniq` (`sessionId`),
  KEY `bychat_enrollment_drafts_portalId_idx` (`portalId`),
  KEY `bychat_enrollment_drafts_expiresAt_idx` (`expiresAt`),
  KEY `bychat_enrollment_drafts_email_idx` (`email`),
  KEY `bychat_enrollment_drafts_whatsapp_idx` (`whatsapp`),
  CONSTRAINT `bychat_enrollment_drafts_portal_fk`
    FOREIGN KEY (`portalId`) REFERENCES `bychat_enrollment_portals`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB;
