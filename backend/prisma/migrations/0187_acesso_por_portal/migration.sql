-- Acesso por portal (polos e parceiros): equipes que enxergam cada portal.
-- Portal sem linhas continua aberto; nada muda até alguém configurar.
CREATE TABLE `bychat_portal_acesso_equipes` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `portalId` INTEGER NOT NULL,
  `teamId` INTEGER NOT NULL,
  `nivel` ENUM('VER', 'OPERAR') NOT NULL DEFAULT 'VER',
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `bychat_portal_acesso_equipes_portalId_teamId_key`(`portalId`, `teamId`),
  INDEX `bychat_portal_acesso_equipes_teamId_idx`(`teamId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `bychat_portal_acesso_equipes`
  ADD CONSTRAINT `bychat_portal_acesso_equipes_portalId_fkey` FOREIGN KEY (`portalId`) REFERENCES `bychat_enrollment_portals`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `bychat_portal_acesso_equipes_teamId_fkey` FOREIGN KEY (`teamId`) REFERENCES `bychat_teams`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- Secretaria, Financeiro, Coordenação: a equipe enxerga todos os portais.
ALTER TABLE `bychat_teams` ADD COLUMN `veTodosOsPortais` BOOLEAN NOT NULL DEFAULT false;
