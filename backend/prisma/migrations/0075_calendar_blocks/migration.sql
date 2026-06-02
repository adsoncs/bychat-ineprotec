-- Compromissos/bloqueios manuais na agenda (alimentam o calendário e reduzem slots)
CREATE TABLE `bychat_calendar_blocks` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `operatorUserId` INTEGER NULL,
  `title` VARCHAR(191) NOT NULL DEFAULT '',
  `kind` VARCHAR(191) NOT NULL DEFAULT 'busy',
  `startAt` DATETIME(3) NOT NULL,
  `endAt` DATETIME(3) NOT NULL,
  `allDay` BOOLEAN NOT NULL DEFAULT false,
  `color` VARCHAR(20) NULL,
  `note` TEXT NULL,
  `createdByUserId` INTEGER NULL,
  `source` VARCHAR(191) NOT NULL DEFAULT 'manual',
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  INDEX `bychat_calendar_blocks_operatorUserId_startAt_idx`(`operatorUserId`, `startAt`),
  INDEX `bychat_calendar_blocks_startAt_idx`(`startAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
