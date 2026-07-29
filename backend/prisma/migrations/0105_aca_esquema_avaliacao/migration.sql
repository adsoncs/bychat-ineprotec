-- CreateTable
CREATE TABLE `bychat_aca_esquemas_avaliacao` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `escopo` ENUM('INSTITUCIONAL', 'CURSO', 'MATRIZ', 'DISCIPLINA') NOT NULL DEFAULT 'INSTITUCIONAL',
    `escopoId` INTEGER NULL,
    `nome` VARCHAR(191) NOT NULL,
    `descricao` TEXT NULL,
    `escala` ENUM('NUMERICA_0_10', 'NUMERICA_0_100', 'CONCEITO') NOT NULL DEFAULT 'NUMERICA_0_10',
    `notaMinima` DOUBLE NOT NULL DEFAULT 0,
    `notaMaxima` DOUBLE NOT NULL DEFAULT 10,
    `casasDecimais` INTEGER NOT NULL DEFAULT 1,
    `arredondamento` ENUM('MATEMATICO', 'CIMA', 'BAIXO') NOT NULL DEFAULT 'MATEMATICO',
    `mapaConceitos` JSON NULL,
    `formulaMedia` VARCHAR(500) NULL,
    `mediaAprovacao` DOUBLE NOT NULL DEFAULT 6,
    `notaEliminatoria` DOUBLE NULL,
    `exameHabilitado` BOOLEAN NOT NULL DEFAULT false,
    `exameMinimo` DOUBLE NULL,
    `formulaFinal` VARCHAR(500) NULL,
    `mediaFinalAprovacao` DOUBLE NULL,
    `segundaChamadaHabilitada` BOOLEAN NOT NULL DEFAULT false,
    `frequenciaMinima` INTEGER NOT NULL DEFAULT 75,
    `limiteDependencias` INTEGER NULL,
    `ativo` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `bychat_aca_esquemas_avaliacao_ativo_idx`(`ativo`),
    UNIQUE INDEX `bychat_aca_esquemas_avaliacao_escopo_escopoId_key`(`escopo`, `escopoId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bychat_aca_esquema_componentes` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `esquemaId` INTEGER NOT NULL,
    `sigla` VARCHAR(12) NOT NULL,
    `nome` VARCHAR(100) NOT NULL,
    `peso` DOUBLE NOT NULL DEFAULT 1,
    `ordem` INTEGER NOT NULL DEFAULT 0,
    `obrigatorio` BOOLEAN NOT NULL DEFAULT true,

    INDEX `bychat_aca_esquema_componentes_esquemaId_idx`(`esquemaId`),
    UNIQUE INDEX `bychat_aca_esquema_componentes_esquemaId_sigla_key`(`esquemaId`, `sigla`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `bychat_aca_esquema_componentes` ADD CONSTRAINT `bychat_aca_esquema_componentes_esquemaId_fkey` FOREIGN KEY (`esquemaId`) REFERENCES `bychat_aca_esquemas_avaliacao`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

