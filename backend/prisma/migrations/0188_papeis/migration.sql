-- Papéis e Permissões (novo modelo): papel + capacidades + alcance, pacotes por pessoa.
-- Aditiva: ninguém usa ainda (users.papelId nulo = modelo antigo).
CREATE TABLE `bychat_papeis` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `nome` VARCHAR(100) NOT NULL,
  `descricao` VARCHAR(255) NULL,
  `sistema` BOOLEAN NOT NULL DEFAULT false,
  `papelBase` VARCHAR(20) NOT NULL,
  `origem` VARCHAR(80) NULL,
  `arquivado` BOOLEAN NOT NULL DEFAULT false,
  `criadoPor` INTEGER NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `bychat_papeis_nome_key`(`nome`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `bychat_papel_capacidades` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `papelId` INTEGER NOT NULL,
  `capacidade` VARCHAR(100) NOT NULL,
  `separacao` BOOLEAN NOT NULL DEFAULT false,
  UNIQUE INDEX `bychat_papel_capacidades_papelId_capacidade_key`(`papelId`, `capacidade`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `bychat_papel_alcances` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `papelId` INTEGER NOT NULL,
  `tipo` ENUM('LEADS', 'AGENDA', 'INSCRICOES', 'FINANCEIRO', 'VISOES') NOT NULL,
  `alcance` ENUM('MEUS', 'EQUIPE', 'LIDERADAS', 'RECORTES', 'TUDO') NOT NULL,
  UNIQUE INDEX `bychat_papel_alcances_papelId_tipo_key`(`papelId`, `tipo`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `bychat_pacotes` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `nome` VARCHAR(100) NOT NULL,
  `descricao` VARCHAR(255) NULL,
  `origem` VARCHAR(80) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `bychat_pacotes_nome_key`(`nome`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `bychat_pacote_capacidades` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `pacoteId` INTEGER NOT NULL,
  `capacidade` VARCHAR(100) NOT NULL,
  UNIQUE INDEX `bychat_pacote_capacidades_pacoteId_capacidade_key`(`pacoteId`, `capacidade`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `bychat_usuario_pacotes` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `userId` INTEGER NOT NULL,
  `pacoteId` INTEGER NOT NULL,
  UNIQUE INDEX `bychat_usuario_pacotes_userId_pacoteId_key`(`userId`, `pacoteId`),
  INDEX `bychat_usuario_pacotes_pacoteId_idx`(`pacoteId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `bychat_users` ADD COLUMN `papelId` INTEGER NULL;

ALTER TABLE `bychat_users` ADD CONSTRAINT `bychat_users_papelId_fkey` FOREIGN KEY (`papelId`) REFERENCES `bychat_papeis`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `bychat_papel_capacidades` ADD CONSTRAINT `bychat_papel_capacidades_papelId_fkey` FOREIGN KEY (`papelId`) REFERENCES `bychat_papeis`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `bychat_papel_alcances` ADD CONSTRAINT `bychat_papel_alcances_papelId_fkey` FOREIGN KEY (`papelId`) REFERENCES `bychat_papeis`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `bychat_pacote_capacidades` ADD CONSTRAINT `bychat_pacote_capacidades_pacoteId_fkey` FOREIGN KEY (`pacoteId`) REFERENCES `bychat_pacotes`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `bychat_usuario_pacotes` ADD CONSTRAINT `bychat_usuario_pacotes_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `bychat_users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `bychat_usuario_pacotes` ADD CONSTRAINT `bychat_usuario_pacotes_pacoteId_fkey` FOREIGN KEY (`pacoteId`) REFERENCES `bychat_pacotes`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
