-- Origem real da mensagem (qual número/canal) para o módulo Conversas
ALTER TABLE `bychat_messages`
  ADD COLUMN `evolutionInstance` VARCHAR(100) NULL,
  ADD COLUMN `cloudApiConnectionId` INTEGER NULL;

CREATE INDEX `bychat_messages_cloudApiConnectionId_idx` ON `bychat_messages`(`cloudApiConnectionId`);

ALTER TABLE `bychat_messages`
  ADD CONSTRAINT `bychat_messages_cloudApiConnectionId_fkey` FOREIGN KEY (`cloudApiConnectionId`) REFERENCES `bychat_cloud_api_connections`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
