-- Funil dos leads do chatbot por conexão WhatsApp (Cloud API + Evolution).
--   Quando setado, leads do chatbot são promovidos a este funil/etapa (respeitando
--   as regras do form). Vazio = comportamento atual. Aditivo.

ALTER TABLE `bychat_cloud_api_connections`
  ADD COLUMN `funnelId` INTEGER NULL,
  ADD COLUMN `stageKey` VARCHAR(80) NULL,
  ADD INDEX `bychat_cloud_api_connections_funnelId_idx` (`funnelId`),
  ADD CONSTRAINT `bychat_cloud_api_connections_funnelId_fkey`
    FOREIGN KEY (`funnelId`) REFERENCES `bychat_funnels`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `bychat_whatsapp_instances`
  ADD COLUMN `funnelId` INTEGER NULL,
  ADD COLUMN `stageKey` VARCHAR(80) NULL,
  ADD INDEX `bychat_whatsapp_instances_funnelId_idx` (`funnelId`),
  ADD CONSTRAINT `bychat_whatsapp_instances_funnelId_fkey`
    FOREIGN KEY (`funnelId`) REFERENCES `bychat_funnels`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
