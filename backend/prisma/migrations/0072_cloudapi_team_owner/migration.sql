-- Paridade Cloud API ↔ Evolution: setor padrão + agente dedicado na conexão
ALTER TABLE `bychat_cloud_api_connections`
  ADD COLUMN `defaultTeamId` INTEGER NULL,
  ADD COLUMN `ownerUserId` INTEGER NULL;

CREATE INDEX `bychat_cloud_api_connections_defaultTeamId_idx` ON `bychat_cloud_api_connections`(`defaultTeamId`);
CREATE INDEX `bychat_cloud_api_connections_ownerUserId_idx` ON `bychat_cloud_api_connections`(`ownerUserId`);

ALTER TABLE `bychat_cloud_api_connections`
  ADD CONSTRAINT `bychat_cloud_api_connections_defaultTeamId_fkey` FOREIGN KEY (`defaultTeamId`) REFERENCES `bychat_teams`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `bychat_cloud_api_connections_ownerUserId_fkey` FOREIGN KEY (`ownerUserId`) REFERENCES `bychat_users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
