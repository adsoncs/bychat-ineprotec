-- Nome de exibição do operador: o que o contato vê quando a identificação está
-- ligada. Separado de `name` (cadastro) por privacidade e por concisão.
ALTER TABLE `bychat_users` ADD COLUMN `displayName` VARCHAR(80) NULL;
