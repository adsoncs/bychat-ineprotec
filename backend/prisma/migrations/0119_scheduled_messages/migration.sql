-- Mensagem agendada 1-a-1 no Conversas.
-- A linha é a fonte da verdade do agendamento; o job do BullMQ é só transporte.
CREATE TABLE `bychat_scheduled_messages` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `leadId` INTEGER NOT NULL,
  `scheduledAt` DATETIME(3) NOT NULL,
  `status` VARCHAR(16) NOT NULL DEFAULT 'pending',
  `kind` VARCHAR(16) NOT NULL DEFAULT 'text',
  `templateId` INTEGER NULL,
  `body` TEXT NULL,
  `hsmPayload` JSON NULL,
  `channelId` VARCHAR(60) NULL,
  `cancelIfReplied` BOOLEAN NOT NULL DEFAULT true,
  `createdByUserId` INTEGER NULL,
  `canceledByUserId` INTEGER NULL,
  `sentAt` DATETIME(3) NULL,
  `sentMessageId` INTEGER NULL,
  `errorMessage` TEXT NULL,
  `attempts` INTEGER NOT NULL DEFAULT 0,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  INDEX `bychat_scheduled_messages_status_scheduledAt_idx`(`status`, `scheduledAt`),
  INDEX `bychat_scheduled_messages_leadId_status_idx`(`leadId`, `status`),
  INDEX `bychat_scheduled_messages_createdByUserId_idx`(`createdByUserId`),
  INDEX `bychat_scheduled_messages_templateId_idx`(`templateId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `bychat_scheduled_messages` ADD CONSTRAINT `bychat_scheduled_messages_leadId_fkey`
  FOREIGN KEY (`leadId`) REFERENCES `bychat_leads`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `bychat_scheduled_messages` ADD CONSTRAINT `bychat_scheduled_messages_templateId_fkey`
  FOREIGN KEY (`templateId`) REFERENCES `bychat_message_templates`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `bychat_scheduled_messages` ADD CONSTRAINT `bychat_scheduled_messages_createdByUserId_fkey`
  FOREIGN KEY (`createdByUserId`) REFERENCES `bychat_users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `bychat_scheduled_messages` ADD CONSTRAINT `bychat_scheduled_messages_canceledByUserId_fkey`
  FOREIGN KEY (`canceledByUserId`) REFERENCES `bychat_users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
