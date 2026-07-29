-- AlterTable
ALTER TABLE `bychat_aca_avaliacoes` ADD COLUMN `siglaEsquema` VARCHAR(12) NULL;

-- CreateTable
CREATE TABLE `bychat_aca_equivalencia_grupos` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `nome` VARCHAR(191) NOT NULL,
    `observacao` TEXT NULL,
    `bidirecional` BOOLEAN NOT NULL DEFAULT false,
    `ativo` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `bychat_aca_equivalencia_grupos_ativo_idx`(`ativo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bychat_aca_equivalencia_itens` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `grupoId` INTEGER NOT NULL,
    `componenteId` INTEGER NOT NULL,
    `lado` ENUM('ORIGEM', 'DESTINO') NOT NULL,

    INDEX `bychat_aca_equivalencia_itens_componenteId_idx`(`componenteId`),
    UNIQUE INDEX `bychat_aca_equivalencia_itens_grupoId_componenteId_lado_key`(`grupoId`, `componenteId`, `lado`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `bychat_aca_equivalencia_itens` ADD CONSTRAINT `bychat_aca_equivalencia_itens_grupoId_fkey` FOREIGN KEY (`grupoId`) REFERENCES `bychat_aca_equivalencia_grupos`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

