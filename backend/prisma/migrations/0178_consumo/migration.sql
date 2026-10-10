-- Consumo medido (volumetria e repasse — lib/consumo.ts). Uma linha por uso
-- que custa dinheiro nosso; começa pela IA (tokens por chamada).
CREATE TABLE `bychat_consumo` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `fonte` VARCHAR(30) NOT NULL,
  `provedor` VARCHAR(30) NOT NULL,
  `item` VARCHAR(100) NOT NULL,
  `funcionalidade` VARCHAR(60) NOT NULL,
  `entrada` INTEGER NOT NULL DEFAULT 0,
  `saida` INTEGER NOT NULL DEFAULT 0,
  `cacheEscrita` INTEGER NOT NULL DEFAULT 0,
  `cacheLeitura` INTEGER NOT NULL DEFAULT 0,
  `quantidade` DECIMAL(18, 4) NOT NULL DEFAULT 0,
  `unidade` VARCHAR(20) NOT NULL DEFAULT 'token',
  `custoUsd` DECIMAL(14, 6) NULL,
  `leadId` INTEGER NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `bychat_consumo_fonte_createdAt_idx`(`fonte`, `createdAt`),
  INDEX `bychat_consumo_funcionalidade_createdAt_idx`(`funcionalidade`, `createdAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
