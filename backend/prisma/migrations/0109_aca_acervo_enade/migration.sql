-- AlterTable
ALTER TABLE `bychat_aca_ged_arquivos` ADD COLUMN `classificacao` VARCHAR(60) NULL,
    ADD COLUMN `eliminacaoTermoId` INTEGER NULL,
    ADD COLUMN `eliminadoEm` DATETIME(3) NULL,
    ADD COLUMN `guardaAte` DATETIME(3) NULL,
    ADD COLUMN `hashSha256` VARCHAR(64) NULL,
    ADD COLUMN `mimeType` VARCHAR(100) NULL,
    ADD COLUMN `prazoGuardaAnos` INTEGER NULL,
    ADD COLUMN `tamanhoBytes` INTEGER NULL,
    ADD COLUMN `temporalidade` VARCHAR(12) NOT NULL DEFAULT 'PERMANENTE';

-- CreateTable
CREATE TABLE `bychat_aca_eliminacao_termos` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `numero` VARCHAR(40) NOT NULL,
    `dataTermo` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `comissao` TEXT NOT NULL,
    `responsavel` VARCHAR(191) NULL,
    `observacao` TEXT NULL,
    `itensJson` JSON NULL,
    `qtdItens` INTEGER NOT NULL DEFAULT 0,
    `criadoPor` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `bychat_aca_eliminacao_termos_numero_key`(`numero`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bychat_aca_enade_regularidade` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `alunoId` INTEGER NOT NULL,
    `vinculoId` INTEGER NULL,
    `ano` INTEGER NOT NULL,
    `condicao` VARCHAR(14) NOT NULL,
    `situacao` VARCHAR(14) NOT NULL DEFAULT 'PENDENTE',
    `dispensaMotivo` TEXT NULL,
    `documentoUrl` TEXT NULL,
    `observacao` TEXT NULL,
    `registradoPor` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `bychat_aca_enade_regularidade_situacao_idx`(`situacao`),
    UNIQUE INDEX `bychat_aca_enade_regularidade_alunoId_ano_condicao_key`(`alunoId`, `ano`, `condicao`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `bychat_aca_enade_regularidade` ADD CONSTRAINT `bychat_aca_enade_regularidade_alunoId_fkey` FOREIGN KEY (`alunoId`) REFERENCES `bychat_aca_alunos`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

