-- Lead passa a pertencer também à CONEXÃO da API oficial por onde o contato
-- chegou — o par do `instanceName` (Evolution, migration 0137). Sem isto a
-- API oficial achava o lead só pelo telefone: um contato que escrevesse para
-- um número Evolution e para um número da API oficial caía na mesma conversa,
-- e o agente respondia pelo número errado sem perceber.
ALTER TABLE `bychat_leads` ADD COLUMN `cloudApiConnectionId` INTEGER NULL;

-- Busca do lead por telefone + conexão.
CREATE INDEX `bychat_leads_phoneKey_cloudApiConnectionId_idx` ON `bychat_leads`(`phoneKey`, `cloudApiConnectionId`);
