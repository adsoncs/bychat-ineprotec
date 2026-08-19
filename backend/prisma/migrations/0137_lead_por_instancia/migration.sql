-- Lead passa a pertencer à instância por onde o contato chegou.
-- Antes o lead era único por telefone no tenant: um contato que escrevesse
-- para duas empresas do mesmo tenant caía na mesma conversa, e o atendente de
-- uma enxergava o atendimento da outra.
ALTER TABLE `bychat_leads` ADD COLUMN `instanceName` VARCHAR(100) NULL;

-- Busca do lead por telefone + instância.
CREATE INDEX `bychat_leads_phoneKey_instanceName_idx` ON `bychat_leads`(`phoneKey`, `instanceName`);
