-- Fluxo de atendimento do chatbot roteirizado (vinha do terram):
-- `scriptedConfig` no chatbot (opt-in; null = roteiro de sempre) e a tabela da
-- pesquisa de satisfação ao encerrar. Idempotente: o terram já tem as duas.

SET @tem := (SELECT COUNT(*) FROM information_schema.columns
             WHERE table_schema = DATABASE() AND table_name = 'bychat_chatbots' AND column_name = 'scriptedConfig');
SET @sql := IF(@tem = 0, 'ALTER TABLE `bychat_chatbots` ADD COLUMN `scriptedConfig` JSON NULL', 'SELECT 1');
PREPARE passo FROM @sql;
EXECUTE passo;
DEALLOCATE PREPARE passo;

CREATE TABLE IF NOT EXISTS `bychat_chatbot_csat` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `leadId` INTEGER NOT NULL,
    `chatbotId` INTEGER NULL,
    `teamId` INTEGER NULL,
    `agentUserId` INTEGER NULL,
    `rating` INTEGER NULL,
    `lowScore` BOOLEAN NOT NULL DEFAULT false,
    `askedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `respondedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `bychat_chatbot_csat_leadId_idx`(`leadId`),
    INDEX `bychat_chatbot_csat_chatbotId_createdAt_idx`(`chatbotId`, `createdAt`),
    INDEX `bychat_chatbot_csat_lowScore_idx`(`lowScore`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
