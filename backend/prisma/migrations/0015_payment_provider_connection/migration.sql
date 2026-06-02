-- Gateway de pagamento como integração separada (reutilizável por N portais)
CREATE TABLE `bychat_payment_provider_connections` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(191) NOT NULL,
  `provider` VARCHAR(30) NOT NULL,
  `environment` VARCHAR(20) NOT NULL DEFAULT 'sandbox',
  `apiKey` TEXT NOT NULL,
  `defaultBillingType` VARCHAR(20) NULL,
  `webhookToken` VARCHAR(64) NOT NULL,
  `webhookSecret` VARCHAR(191) NULL,
  `companyDocument` VARCHAR(20) NULL,
  `pixKey` VARCHAR(191) NULL,
  `accountHolder` VARCHAR(191) NULL,
  `active` BOOLEAN NOT NULL DEFAULT TRUE,
  `lastTestedAt` DATETIME(3) NULL,
  `lastTestStatus` VARCHAR(30) NULL,
  `lastTestMessage` TEXT NULL,
  `createdBy` INT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `bychat_payment_conn_webhookToken_uniq` (`webhookToken`),
  KEY `bychat_payment_conn_provider_idx` (`provider`),
  KEY `bychat_payment_conn_active_idx` (`active`)
) ENGINE=InnoDB;

-- Vincula portal a uma conexão pré-configurada
ALTER TABLE `bychat_enrollment_portals`
  ADD COLUMN `paymentConnectionId` INT NULL,
  ADD INDEX `bychat_enrollment_portals_paymentConnectionId_idx` (`paymentConnectionId`),
  ADD CONSTRAINT `bychat_enrollment_portals_payment_conn_fk`
    FOREIGN KEY (`paymentConnectionId`) REFERENCES `bychat_payment_provider_connections`(`id`) ON DELETE SET NULL;
