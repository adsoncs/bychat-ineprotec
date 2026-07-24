-- AlterTable: atalho "/" do compositor de Conversas.
-- Guarda o gatilho sem a barra (ex.: "doc" → operador digita "/doc").
ALTER TABLE `bychat_message_templates` ADD COLUMN `shortcut` VARCHAR(40) NULL;

-- CreateIndex
CREATE INDEX `bychat_message_templates_shortcut_idx` ON `bychat_message_templates`(`shortcut`);
