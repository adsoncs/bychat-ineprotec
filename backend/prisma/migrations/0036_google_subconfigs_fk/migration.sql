-- 0036_google_subconfigs_fk
-- Adiciona FK de Drive/Tasks/Gmail configs para GoogleConnection (lacuna histórica do schema).
-- Necessário para roteamento Híbrido B (queries com `include: { connection }`).

ALTER TABLE `bychat_google_drive_configs`
  ADD CONSTRAINT `bychat_google_drive_configs_connectionId_fkey`
  FOREIGN KEY (`connectionId`) REFERENCES `bychat_google_connections`(`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `bychat_google_tasks_configs`
  ADD CONSTRAINT `bychat_google_tasks_configs_connectionId_fkey`
  FOREIGN KEY (`connectionId`) REFERENCES `bychat_google_connections`(`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `bychat_gmail_configs`
  ADD CONSTRAINT `bychat_gmail_configs_connectionId_fkey`
  FOREIGN KEY (`connectionId`) REFERENCES `bychat_google_connections`(`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;
