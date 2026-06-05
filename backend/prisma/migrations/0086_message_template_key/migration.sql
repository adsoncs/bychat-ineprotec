-- Chave estável p/ referência por código (separada do `name`, que o usuário edita).
ALTER TABLE `bychat_message_templates`
  ADD COLUMN `key` VARCHAR(80) NULL,
  ADD INDEX `bychat_message_templates_key_idx` (`key`);
