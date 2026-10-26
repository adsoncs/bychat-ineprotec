-- Campanhas de e-mail marketing e seus destinatários.

-- CreateTable
CREATE TABLE `bychat_email_campanhas` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `nome` VARCHAR(191) NOT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'rascunho',
    `templateId` INTEGER NULL,
    `assunto` VARCHAR(191) NOT NULL,
    `assuntoB` VARCHAR(191) NULL,
    `html` LONGTEXT NULL,
    `publico` JSON NOT NULL,
    `agendadaPara` DATETIME(3) NULL,
    `iniciadaEm` DATETIME(3) NULL,
    `concluidaEm` DATETIME(3) NULL,
    `total` INTEGER NOT NULL DEFAULT 0,
    `criadoPor` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `bychat_email_campanhas_status_agendadaPara_idx`(`status`, `agendadaPara`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bychat_email_campanha_envios` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `campanhaId` INTEGER NOT NULL,
    `leadId` INTEGER NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `variante` VARCHAR(1) NOT NULL DEFAULT 'A',
    `status` VARCHAR(20) NOT NULL DEFAULT 'pendente',
    `motivo` VARCHAR(300) NULL,
    `externalId` VARCHAR(191) NULL,
    `tentativas` INTEGER NOT NULL DEFAULT 0,
    `enviadoEm` DATETIME(3) NULL,

    INDEX `bychat_email_campanha_envios_campanhaId_status_idx`(`campanhaId`, `status`),
    INDEX `bychat_email_campanha_envios_externalId_idx`(`externalId`),
    UNIQUE INDEX `bychat_email_campanha_envios_campanhaId_leadId_key`(`campanhaId`, `leadId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `bychat_email_campanha_envios` ADD CONSTRAINT `bychat_email_campanha_envios_campanhaId_fkey` FOREIGN KEY (`campanhaId`) REFERENCES `bychat_email_campanhas`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
