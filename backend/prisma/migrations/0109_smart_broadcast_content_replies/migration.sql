-- Disparos Inteligentes F3/F4: rodapé de opt-out, link por destinatário e ações na resposta.

-- AlterTable
ALTER TABLE `bychat_smart_campaigns` ADD COLUMN `linkUrl` VARCHAR(500) NULL,
    ADD COLUMN `optOutFooter` VARCHAR(191) NULL,
    ADD COLUMN `replyActions` JSON NULL;
