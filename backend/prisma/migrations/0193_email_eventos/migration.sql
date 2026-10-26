-- E-mail: eventos da Resend (entregue, aberto, clicado, spam) no registro de envio
-- e lista de endereços bloqueados (bounce/spam) do domínio compartilhado.

-- AlterTable
ALTER TABLE `bychat_outbound_sends` ADD COLUMN `clickedAt` DATETIME(3) NULL,
    ADD COLUMN `clicks` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `complainedAt` DATETIME(3) NULL,
    ADD COLUMN `openedAt` DATETIME(3) NULL,
    ADD COLUMN `opens` INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX `bychat_outbound_sends_externalId_idx` ON `bychat_outbound_sends`(`externalId`);

-- CreateTable
CREATE TABLE `bychat_email_supressoes` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `email` VARCHAR(191) NOT NULL,
    `motivo` VARCHAR(20) NOT NULL,
    `detalhe` VARCHAR(500) NULL,
    `envioId` INTEGER NULL,
    `criadoPor` VARCHAR(191) NULL,
    `criadoEm` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `bychat_email_supressoes_email_key`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
