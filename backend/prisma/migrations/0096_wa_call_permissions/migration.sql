-- Permissão de chamada de voz (opt-in) por consumidor — WhatsApp Business Calling API.
CREATE TABLE `bychat_wa_call_permissions` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `phone` VARCHAR(30) NOT NULL,
  `phoneNumberId` VARCHAR(100) NOT NULL,
  `status` VARCHAR(30) NOT NULL,
  `expiresAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `bychat_wa_call_permissions_phone_phoneNumberId_key`(`phone`, `phoneNumberId`),
  INDEX `bychat_wa_call_permissions_phone_idx`(`phone`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
