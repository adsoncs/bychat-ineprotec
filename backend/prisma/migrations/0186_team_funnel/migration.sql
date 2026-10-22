-- Funil da equipe: equipe e funil andam juntos. Lead mandado para a equipe sem
-- funil explícito (fallback, transferência, reativação sem resposta) vai para
-- o funil dela.
ALTER TABLE `bychat_teams` ADD COLUMN `funnelId` INTEGER NULL;
CREATE INDEX `bychat_teams_funnelId_idx` ON `bychat_teams`(`funnelId`);
ALTER TABLE `bychat_teams` ADD CONSTRAINT `bychat_teams_funnelId_fkey` FOREIGN KEY (`funnelId`) REFERENCES `bychat_funnels`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
