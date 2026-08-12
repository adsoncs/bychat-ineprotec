-- Cor de identificação por canal: com vários números, todos apareciam com a
-- mesma cor do provedor e não dava para distinguir a origem na operação.
ALTER TABLE `bychat_whatsapp_instances` ADD COLUMN `color` VARCHAR(9) NULL;
ALTER TABLE `bychat_cloud_api_connections` ADD COLUMN `color` VARCHAR(9) NULL;
