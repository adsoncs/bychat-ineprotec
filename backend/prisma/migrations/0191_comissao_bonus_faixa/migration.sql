-- Comissão: bônus por faixa (por vendedor, por mês). Aditivo.
ALTER TABLE `bychat_commission_rules` ADD COLUMN `bonusFaixas` JSON NULL;

CREATE TABLE `bychat_commission_bonuses` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `ruleId` INTEGER NULL,
    `userId` INTEGER NOT NULL,
    `competencia` DATE NOT NULL,
    `quantidade` INTEGER NOT NULL DEFAULT 0,
    `faixaMin` INTEGER NOT NULL DEFAULT 0,
    `valor` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `status` VARCHAR(12) NOT NULL DEFAULT 'prevista',
    `pagaEm` DATETIME(3) NULL,
    `pagaPor` INTEGER NULL,
    `observacoes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `bychat_commission_bonuses_ruleId_userId_competencia_key`(`ruleId`, `userId`, `competencia`),
    INDEX `bychat_commission_bonuses_userId_competencia_idx`(`userId`, `competencia`),
    INDEX `bychat_commission_bonuses_competencia_idx`(`competencia`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `bychat_commission_bonuses` ADD CONSTRAINT `bychat_commission_bonuses_ruleId_fkey` FOREIGN KEY (`ruleId`) REFERENCES `bychat_commission_rules`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
