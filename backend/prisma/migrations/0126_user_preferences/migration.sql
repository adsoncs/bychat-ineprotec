-- Preferências da conta (notificações: som e aviso na área de trabalho).
-- JSON para não exigir migration a cada preferência nova.
ALTER TABLE `bychat_users` ADD COLUMN `preferences` JSON NULL;
