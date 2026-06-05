-- WhatsApp Flows estáticos (F3): formulário nativo do WhatsApp gerado a partir de um Form.
--   bychat_cloud_api_flows → Flow JSON + metaFlowId/status por conexão Cloud API.
--   bychat_chatbots.useFlow → coletar dados via Flow (tela única) em vez de pergunta-a-pergunta.

CREATE TABLE `bychat_cloud_api_flows` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `connectionId` INTEGER NOT NULL,
  `formId` INTEGER NULL,
  `metaFlowId` VARCHAR(100) NULL,
  `name` VARCHAR(191) NOT NULL,
  `status` VARCHAR(30) NOT NULL DEFAULT 'draft',
  `flowJson` JSON NOT NULL,
  `screenId` VARCHAR(60) NOT NULL DEFAULT 'INTAKE',
  `lastError` TEXT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  INDEX `bychat_cloud_api_flows_connectionId_idx`(`connectionId`),
  INDEX `bychat_cloud_api_flows_formId_idx`(`formId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `bychat_cloud_api_flows`
  ADD CONSTRAINT `bychat_cloud_api_flows_connectionId_fkey`
  FOREIGN KEY (`connectionId`) REFERENCES `bychat_cloud_api_connections`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `bychat_chatbots`
  ADD COLUMN `useFlow` BOOLEAN NOT NULL DEFAULT false;
