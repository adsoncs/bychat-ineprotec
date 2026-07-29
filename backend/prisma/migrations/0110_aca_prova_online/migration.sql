-- CreateTable
CREATE TABLE `bychat_aca_questoes` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `area` VARCHAR(60) NOT NULL,
    `enunciado` TEXT NOT NULL,
    `tipo` VARCHAR(14) NOT NULL DEFAULT 'OBJETIVA',
    `alternativas` JSON NULL,
    `gabarito` VARCHAR(4) NULL,
    `peso` DOUBLE NOT NULL DEFAULT 1,
    `dificuldade` VARCHAR(10) NULL,
    `ativa` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `bychat_aca_questoes_area_ativa_idx`(`area`, `ativa`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bychat_aca_provas` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `processoId` INTEGER NULL,
    `titulo` VARCHAR(191) NOT NULL,
    `instrucoes` TEXT NULL,
    `inicioEm` DATETIME(3) NULL,
    `fimEm` DATETIME(3) NULL,
    `duracaoMinutos` INTEGER NOT NULL DEFAULT 120,
    `notaMaxima` DOUBLE NOT NULL DEFAULT 100,
    `publicada` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `bychat_aca_provas_processoId_idx`(`processoId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bychat_aca_prova_itens` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `provaId` INTEGER NOT NULL,
    `questaoId` INTEGER NOT NULL,
    `ordem` INTEGER NOT NULL DEFAULT 0,
    `peso` DOUBLE NOT NULL DEFAULT 1,

    UNIQUE INDEX `bychat_aca_prova_itens_provaId_questaoId_key`(`provaId`, `questaoId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bychat_aca_prova_aplicacoes` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `provaId` INTEGER NOT NULL,
    `inscricaoId` INTEGER NULL,
    `candidatoNome` VARCHAR(191) NOT NULL,
    `candidatoCpf` VARCHAR(20) NULL,
    `token` VARCHAR(64) NOT NULL,
    `iniciadaEm` DATETIME(3) NULL,
    `entregueEm` DATETIME(3) NULL,
    `status` VARCHAR(14) NOT NULL DEFAULT 'EM_ABERTO',
    `notaObjetiva` DOUBLE NULL,
    `notaDissertativa` DOUBLE NULL,
    `notaFinal` DOUBLE NULL,
    `observacao` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `bychat_aca_prova_aplicacoes_token_key`(`token`),
    INDEX `bychat_aca_prova_aplicacoes_provaId_status_idx`(`provaId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bychat_aca_prova_respostas` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `aplicacaoId` INTEGER NOT NULL,
    `questaoId` INTEGER NOT NULL,
    `resposta` TEXT NULL,
    `correta` BOOLEAN NULL,
    `notaManual` DOUBLE NULL,
    `parecer` TEXT NULL,
    `corrigidaPor` INTEGER NULL,
    `corrigidaEm` DATETIME(3) NULL,

    UNIQUE INDEX `bychat_aca_prova_respostas_aplicacaoId_questaoId_key`(`aplicacaoId`, `questaoId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `bychat_aca_prova_itens` ADD CONSTRAINT `bychat_aca_prova_itens_provaId_fkey` FOREIGN KEY (`provaId`) REFERENCES `bychat_aca_provas`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `bychat_aca_prova_itens` ADD CONSTRAINT `bychat_aca_prova_itens_questaoId_fkey` FOREIGN KEY (`questaoId`) REFERENCES `bychat_aca_questoes`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `bychat_aca_prova_aplicacoes` ADD CONSTRAINT `bychat_aca_prova_aplicacoes_provaId_fkey` FOREIGN KEY (`provaId`) REFERENCES `bychat_aca_provas`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `bychat_aca_prova_respostas` ADD CONSTRAINT `bychat_aca_prova_respostas_aplicacaoId_fkey` FOREIGN KEY (`aplicacaoId`) REFERENCES `bychat_aca_prova_aplicacoes`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

