-- Painel de gestão de pagamentos.
-- 1) PaymentWebhookHit: audit de cada POST recebido nos webhooks Pagar.me/Asaas.
-- 2) Coupon: cadastro admin de cupons (estrutura preparada, aplicação no checkout futuro).
-- 3) CouponRedemption: snapshot do uso de cupom por inscrição.

CREATE TABLE `bychat_payment_webhook_hits` (
  `id`             INT          NOT NULL AUTO_INCREMENT,
  `connectionId`   INT          NULL,
  `provider`       VARCHAR(20)  NOT NULL,
  `eventType`      VARCHAR(100) NOT NULL,
  `externalId`     VARCHAR(191) NULL,
  `status`         VARCHAR(20)  NOT NULL DEFAULT 'received',
  `registrationId` INT          NULL,
  `errorMessage`   TEXT         NULL,
  `payload`        JSON         NOT NULL,
  `signatureValid` BOOLEAN      NOT NULL DEFAULT TRUE,
  `remoteIp`       VARCHAR(45)  NULL,
  `userAgent`      TEXT         NULL,
  `receivedAt`     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `idx_pwh_provider_received` (`provider`, `receivedAt` DESC),
  INDEX `idx_pwh_connection_received` (`connectionId`, `receivedAt` DESC),
  INDEX `idx_pwh_external` (`externalId`),
  INDEX `idx_pwh_status` (`status`),
  CONSTRAINT `fk_pwh_connection`
    FOREIGN KEY (`connectionId`)
    REFERENCES `bychat_payment_provider_connections` (`id`)
    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `bychat_coupons` (
  `id`           INT          NOT NULL AUTO_INCREMENT,
  `code`         VARCHAR(50)  NOT NULL,
  `description`  VARCHAR(255) NULL,
  `type`         VARCHAR(10)  NOT NULL,
  `value`        DECIMAL(12,2) NOT NULL,
  `minAmount`    DECIMAL(12,2) NULL,
  `maxDiscount`  DECIMAL(12,2) NULL,
  `usageLimit`   INT          NULL,
  `usageCount`   INT          NOT NULL DEFAULT 0,
  `perUserLimit` INT          NOT NULL DEFAULT 1,
  `portalIds`    JSON         NULL,
  `validFrom`    DATETIME(3)  NULL,
  `validUntil`   DATETIME(3)  NULL,
  `active`       BOOLEAN      NOT NULL DEFAULT TRUE,
  `createdBy`    INT          NULL,
  `createdAt`    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`    DATETIME(3)  NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_coupon_code` (`code`),
  INDEX `idx_coupon_active` (`active`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `bychat_coupon_redemptions` (
  `id`             INT          NOT NULL AUTO_INCREMENT,
  `couponId`       INT          NOT NULL,
  `registrationId` INT          NOT NULL,
  `amountBefore`   DECIMAL(12,2) NOT NULL,
  `discountValue`  DECIMAL(12,2) NOT NULL,
  `amountAfter`    DECIMAL(12,2) NOT NULL,
  `couponSnapshot` JSON         NOT NULL,
  `redeemedAt`     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `idx_cr_coupon` (`couponId`),
  INDEX `idx_cr_registration` (`registrationId`),
  CONSTRAINT `fk_cr_coupon`
    FOREIGN KEY (`couponId`)
    REFERENCES `bychat_coupons` (`id`)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
