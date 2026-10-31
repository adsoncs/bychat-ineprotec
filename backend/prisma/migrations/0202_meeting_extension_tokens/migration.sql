-- Tokens da extensão de reuniões. O model existe no schema desde a extensão
-- (lib/meetingExtensionAuth.ts), mas a tabela foi criada por `db push` e nunca
-- teve migration: o ineprotec ficou sem ela. IF NOT EXISTS: onde já existe,
-- não faz nada.
CREATE TABLE IF NOT EXISTS `bychat_meeting_extension_tokens` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` INTEGER NOT NULL,
    `tokenHash` VARCHAR(64) NOT NULL,
    `label` VARCHAR(120) NULL,
    `lastUsedAt` DATETIME(3) NULL,
    `revokedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `bychat_meeting_extension_tokens_tokenHash_key`(`tokenHash`),
    INDEX `bychat_meeting_extension_tokens_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
