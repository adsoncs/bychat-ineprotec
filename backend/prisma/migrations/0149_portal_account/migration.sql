-- CreateTable
CREATE TABLE `bychat_portal_accounts` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `leadId` INTEGER NOT NULL,
    `senhaHash` VARCHAR(255) NULL,
    `senhaDefinidaEm` DATETIME(3) NULL,
    `emailVerificadoEm` DATETIME(3) NULL,
    `whatsappVerificadoEm` DATETIME(3) NULL,
    `tentativas` INTEGER NOT NULL DEFAULT 0,
    `bloqueadoAte` DATETIME(3) NULL,
    `ultimoLoginEm` DATETIME(3) NULL,
    `ativo` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `bychat_portal_accounts_leadId_key`(`leadId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bychat_portal_sessions` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `accountId` INTEGER NOT NULL,
    `tokenHash` VARCHAR(64) NOT NULL,
    `family` VARCHAR(36) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `revokedAt` DATETIME(3) NULL,
    `replacedById` INTEGER NULL,
    `lastUsedAt` DATETIME(3) NULL,
    `userAgent` VARCHAR(255) NULL,
    `ip` VARCHAR(45) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `bychat_portal_sessions_tokenHash_key`(`tokenHash`),
    INDEX `bychat_portal_sessions_accountId_idx`(`accountId`),
    INDEX `bychat_portal_sessions_family_idx`(`family`),
    INDEX `bychat_portal_sessions_expiresAt_idx`(`expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bychat_portal_access_links` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `accountId` INTEGER NOT NULL,
    `tokenHash` VARCHAR(64) NOT NULL,
    `finalidade` VARCHAR(30) NOT NULL DEFAULT 'primeiro_acesso',
    `canal` VARCHAR(20) NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `usadoEm` DATETIME(3) NULL,
    `ip` VARCHAR(45) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `bychat_portal_access_links_tokenHash_key`(`tokenHash`),
    INDEX `bychat_portal_access_links_accountId_idx`(`accountId`),
    INDEX `bychat_portal_access_links_expiresAt_idx`(`expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `bychat_portal_accounts` ADD CONSTRAINT `bychat_portal_accounts_leadId_fkey` FOREIGN KEY (`leadId`) REFERENCES `bychat_leads`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `bychat_portal_sessions` ADD CONSTRAINT `bychat_portal_sessions_accountId_fkey` FOREIGN KEY (`accountId`) REFERENCES `bychat_portal_accounts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `bychat_portal_access_links` ADD CONSTRAINT `bychat_portal_access_links_accountId_fkey` FOREIGN KEY (`accountId`) REFERENCES `bychat_portal_accounts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

