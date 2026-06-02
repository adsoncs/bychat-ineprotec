-- Heartbeat de presença online dos operadores
ALTER TABLE `bychat_users`
  ADD COLUMN `lastSeenAt` DATETIME(3) NULL,
  ADD INDEX `bychat_users_lastSeenAt_idx` (`lastSeenAt`);
