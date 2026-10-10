-- Equipe: chat interno entre pessoas e equipes (services/equipeChat).
CREATE TABLE `bychat_equipe_conversas` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `tipo` VARCHAR(10) NOT NULL,
  `nome` VARCHAR(120) NULL,
  `descricao` VARCHAR(255) NULL,
  `teamId` INTEGER NULL,
  `leadId` INTEGER NULL,
  `chaveDireta` VARCHAR(40) NULL,
  `criadoPorId` INTEGER NULL,
  `ultimaMensagemEm` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `bychat_equipe_conversas_teamId_key`(`teamId`),
  UNIQUE INDEX `bychat_equipe_conversas_leadId_key`(`leadId`),
  UNIQUE INDEX `bychat_equipe_conversas_chaveDireta_key`(`chaveDireta`),
  INDEX `bychat_equipe_conversas_ultimaMensagemEm_idx`(`ultimaMensagemEm`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `bychat_equipe_membros` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `conversaId` INTEGER NOT NULL,
  `userId` INTEGER NOT NULL,
  `papel` VARCHAR(10) NOT NULL DEFAULT 'membro',
  `silenciada` BOOLEAN NOT NULL DEFAULT false,
  `ultimaLidaId` INTEGER NULL,
  `entrouEm` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `bychat_equipe_membros_conversaId_userId_key`(`conversaId`, `userId`),
  INDEX `bychat_equipe_membros_userId_idx`(`userId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `bychat_equipe_mensagens` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `conversaId` INTEGER NOT NULL,
  `userId` INTEGER NULL,
  `corpo` TEXT NULL,
  `cartao` JSON NULL,
  `anexos` JSON NULL,
  `mencoes` JSON NULL,
  `links` JSON NULL,
  `reacoes` JSON NULL,
  `respostaAId` INTEGER NULL,
  `editadaEm` DATETIME(3) NULL,
  `apagadaEm` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `bychat_equipe_mensagens_conversaId_id_idx`(`conversaId`, `id`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `bychat_equipe_membros` ADD CONSTRAINT `bychat_equipe_membros_conversaId_fkey` FOREIGN KEY (`conversaId`) REFERENCES `bychat_equipe_conversas`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `bychat_equipe_mensagens` ADD CONSTRAINT `bychat_equipe_mensagens_conversaId_fkey` FOREIGN KEY (`conversaId`) REFERENCES `bychat_equipe_conversas`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
