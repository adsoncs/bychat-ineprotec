-- Fase 1 do checkout transparente — fundação:
-- 1) Toggle por portal entre 'link' (paymentlinks hospedado) e 'transparent' (checkout no portal).
-- 2) Public key opcional na conexão (Pagar.me usa pra tokenizar cartão no frontend, PCI SAQ A).
-- 3) Tabela de métodos de pagamento por inscrição — 1 linha por método ativo (PIX/boleto/cartão),
--    permite candidato trocar de método sem perder histórico.

ALTER TABLE `bychat_enrollment_portals`
  ADD COLUMN `paymentMode` VARCHAR(20) NOT NULL DEFAULT 'link';

ALTER TABLE `bychat_payment_provider_connections`
  ADD COLUMN `publicKey` TEXT NULL;

CREATE TABLE `bychat_enrollment_payment_methods` (
  `id`               INT          NOT NULL AUTO_INCREMENT,
  `registrationId`   INT          NOT NULL,
  `method`           VARCHAR(20)  NOT NULL,
  `provider`         VARCHAR(20)  NOT NULL,
  `externalId`       VARCHAR(191) NULL,
  `status`           VARCHAR(20)  NOT NULL DEFAULT 'pending',
  `amount`           DECIMAL(12,2) NOT NULL,
  `expiresAt`        DATETIME(3)  NULL,
  `qrCode`           TEXT         NULL,
  `qrCodeUrl`        TEXT         NULL,
  `boletoLine`       VARCHAR(60)  NULL,
  `boletoBarcode`    VARCHAR(60)  NULL,
  `boletoPdfUrl`     TEXT         NULL,
  `boletoDueAt`      DATETIME(3)  NULL,
  `cardLastDigits`   VARCHAR(4)   NULL,
  `cardBrand`        VARCHAR(20)  NULL,
  `cardHolderName`   VARCHAR(191) NULL,
  `lastErrorMessage` TEXT         NULL,
  `paidAt`           DATETIME(3)  NULL,
  `createdAt`        DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`        DATETIME(3)  NOT NULL,
  PRIMARY KEY (`id`),
  INDEX `idx_epm_registration` (`registrationId`),
  INDEX `idx_epm_external`     (`externalId`),
  INDEX `idx_epm_status`       (`status`),
  CONSTRAINT `fk_epm_registration`
    FOREIGN KEY (`registrationId`)
    REFERENCES `bychat_enrollment_registrations` (`id`)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
