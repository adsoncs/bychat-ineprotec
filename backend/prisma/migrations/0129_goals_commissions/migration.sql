-- Módulo Metas e Comissões.
--
-- Sobe cinco tabelas, todas penduradas no que já existe: a comissão é derivada
-- da negociação ganha (bychat_negotiations, cascade), o agente é um usuário e a
-- meta é por par (agente, funil). Nenhuma coluna é digitada duas vezes — o valor
-- da venda continua morando na negociação, e o lançamento guarda só a fotografia
-- da taxa que valia no fechamento.
--
-- Sem backfill: comissão de venda antiga não é inventada retroativamente (a regra
-- que valia naquele mês não existe no sistema). Para começar a contar um período
-- já fechado, o gestor usa o recálculo do período depois de cadastrar as regras.

-- CreateTable
CREATE TABLE `bychat_commission_rules` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `nome` VARCHAR(120) NOT NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `funnelId` INTEGER NULL,
    `prioridade` INTEGER NOT NULL DEFAULT 0,
    `base` VARCHAR(10) NOT NULL DEFAULT 'liquido',
    `tipoUnico` VARCHAR(10) NOT NULL DEFAULT 'percent',
    `taxaUnico` DECIMAL(12, 2) NULL,
    `tipoRecorrente` VARCHAR(10) NOT NULL DEFAULT 'percent',
    `taxaRecorrente` DECIMAL(12, 2) NULL,
    `mesesRecorrente` INTEGER NOT NULL DEFAULT 1,
    `aceleradorAtivo` BOOLEAN NOT NULL DEFAULT false,
    `aceleradorMetrica` VARCHAR(20) NULL,
    `observacoes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `bychat_commission_rules_active_funnelId_idx`(`active`, `funnelId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bychat_commission_tiers` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `ruleId` INTEGER NOT NULL,
    `atingimentoMin` INTEGER NOT NULL DEFAULT 0,
    `tipoUnico` VARCHAR(10) NOT NULL DEFAULT 'percent',
    `taxaUnico` DECIMAL(12, 2) NULL,
    `tipoRecorrente` VARCHAR(10) NOT NULL DEFAULT 'percent',
    `taxaRecorrente` DECIMAL(12, 2) NULL,

    INDEX `bychat_commission_tiers_ruleId_atingimentoMin_idx`(`ruleId`, `atingimentoMin`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bychat_commission_rule_users` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `ruleId` INTEGER NOT NULL,
    `userId` INTEGER NOT NULL,

    INDEX `bychat_commission_rule_users_userId_idx`(`userId`),
    UNIQUE INDEX `bychat_commission_rule_users_ruleId_userId_key`(`ruleId`, `userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bychat_goals` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` INTEGER NULL,
    `funnelId` INTEGER NULL,
    `metric` VARCHAR(20) NOT NULL,
    `periodStart` DATE NOT NULL,
    `periodEnd` DATE NOT NULL,
    `target` DECIMAL(14, 2) NOT NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `observacoes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `bychat_goals_periodStart_periodEnd_idx`(`periodStart`, `periodEnd`),
    INDEX `bychat_goals_userId_metric_idx`(`userId`, `metric`),
    INDEX `bychat_goals_funnelId_metric_idx`(`funnelId`, `metric`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bychat_commission_entries` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `negotiationId` INTEGER NOT NULL,
    `leadId` INTEGER NOT NULL,
    `userId` INTEGER NULL,
    `funnelId` INTEGER NULL,
    `ruleId` INTEGER NULL,
    `tierId` INTEGER NULL,
    `competencia` DATE NOT NULL,
    `fechadaEm` DATETIME(3) NOT NULL,
    `baseUnico` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `baseRecorrente` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `tipoUnico` VARCHAR(10) NULL,
    `taxaUnico` DECIMAL(12, 2) NULL,
    `tipoRecorrente` VARCHAR(10) NULL,
    `taxaRecorrente` DECIMAL(12, 2) NULL,
    `mesesRecorrente` INTEGER NOT NULL DEFAULT 1,
    `valorUnico` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `valorRecorrente` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `valorTotal` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `atingimento` DECIMAL(7, 2) NULL,
    `status` VARCHAR(12) NOT NULL DEFAULT 'prevista',
    `pagaEm` DATETIME(3) NULL,
    `pagaPor` INTEGER NULL,
    `observacoes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `bychat_commission_entries_negotiationId_key`(`negotiationId`),
    INDEX `bychat_commission_entries_userId_competencia_idx`(`userId`, `competencia`),
    INDEX `bychat_commission_entries_competencia_idx`(`competencia`),
    INDEX `bychat_commission_entries_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `bychat_commission_tiers` ADD CONSTRAINT `bychat_commission_tiers_ruleId_fkey` FOREIGN KEY (`ruleId`) REFERENCES `bychat_commission_rules`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `bychat_commission_rule_users` ADD CONSTRAINT `bychat_commission_rule_users_ruleId_fkey` FOREIGN KEY (`ruleId`) REFERENCES `bychat_commission_rules`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `bychat_commission_rule_users` ADD CONSTRAINT `bychat_commission_rule_users_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `bychat_users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `bychat_goals` ADD CONSTRAINT `bychat_goals_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `bychat_users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `bychat_goals` ADD CONSTRAINT `bychat_goals_funnelId_fkey` FOREIGN KEY (`funnelId`) REFERENCES `bychat_funnels`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `bychat_commission_entries` ADD CONSTRAINT `bychat_commission_entries_negotiationId_fkey` FOREIGN KEY (`negotiationId`) REFERENCES `bychat_negotiations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `bychat_commission_entries` ADD CONSTRAINT `bychat_commission_entries_ruleId_fkey` FOREIGN KEY (`ruleId`) REFERENCES `bychat_commission_rules`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

