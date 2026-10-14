-- Registro das entregas do rodízio (services/teamRouting.ts): rodízio justo
-- com peso e limite diário por atendente.
CREATE TABLE `bychat_routing_distributions` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `teamId` INTEGER NOT NULL,
  `userId` INTEGER NOT NULL,
  `origem` VARCHAR(30) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `bychat_routing_distributions_teamId_createdAt_idx`(`teamId`, `createdAt`),
  INDEX `bychat_routing_distributions_userId_createdAt_idx`(`userId`, `createdAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
