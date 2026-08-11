-- Tipo do anexo do modelo, gravado no upload em vez de adivinhado pela extensão
-- do arquivo na hora do envio.
ALTER TABLE `bychat_message_templates` ADD COLUMN `attachmentType` VARCHAR(20) NULL;
