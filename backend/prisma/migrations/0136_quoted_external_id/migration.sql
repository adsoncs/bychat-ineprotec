-- Guarda o externalId da mensagem citada mesmo quando ela ainda não foi gravada.
-- A resolução para `quotedMsgId` passa a poder acontecer depois (na leitura),
-- em vez de ser descartada quando a citada chega fora de ordem.
ALTER TABLE `bychat_messages` ADD COLUMN `quotedExternalId` VARCHAR(191) NULL;

-- Busca das respostas ainda não resolvidas.
CREATE INDEX `bychat_messages_quotedExternalId_idx` ON `bychat_messages`(`quotedExternalId`);
