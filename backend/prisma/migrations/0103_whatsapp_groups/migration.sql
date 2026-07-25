-- Conversas de GRUPO de WhatsApp (Evolution).
-- Grupo vira um Lead com isGroup=true; groupJid é a identidade (não há telefone).
ALTER TABLE `bychat_leads` ADD COLUMN `isGroup` BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE `bychat_leads` ADD COLUMN `groupJid` VARCHAR(64) NULL;

-- CreateIndex
CREATE INDEX `bychat_leads_groupJid_idx` ON `bychat_leads`(`groupJid`);
CREATE INDEX `bychat_leads_isGroup_idx` ON `bychat_leads`(`isGroup`);

-- Toggle por conexão: sem isso o webhook descarta grupo (comportamento histórico).
ALTER TABLE `bychat_whatsapp_instances` ADD COLUMN `receiveGroups` BOOLEAN NOT NULL DEFAULT false;
