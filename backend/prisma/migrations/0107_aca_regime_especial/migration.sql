-- CreateTable
CREATE TABLE `bychat_aca_regimes_especiais` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `alunoId` INTEGER NOT NULL,
    `vinculoId` INTEGER NULL,
    `tipo` VARCHAR(20) NOT NULL,
    `dataInicio` DATETIME(3) NOT NULL,
    `dataFim` DATETIME(3) NOT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'SOLICITADO',
    `amparoLegal` VARCHAR(120) NULL,
    `atestadoUrl` TEXT NULL,
    `observacao` TEXT NULL,
    `planoAtividades` TEXT NULL,
    `deferidoPor` INTEGER NULL,
    `deferidoEm` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `bychat_aca_regimes_especiais_alunoId_status_idx`(`alunoId`, `status`),
    INDEX `bychat_aca_regimes_especiais_dataInicio_dataFim_idx`(`dataInicio`, `dataFim`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `bychat_aca_regimes_especiais` ADD CONSTRAINT `bychat_aca_regimes_especiais_alunoId_fkey` FOREIGN KEY (`alunoId`) REFERENCES `bychat_aca_alunos`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

