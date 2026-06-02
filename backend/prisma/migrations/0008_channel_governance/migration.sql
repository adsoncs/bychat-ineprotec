-- Sales Engagement A4: ChannelGovernance por equipe.
-- teamId NULL = configuração "global" (fallback). Unique impede duplicatas por equipe.

CREATE TABLE `bychat_channel_governance` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `teamId` INTEGER NULL,
    `maxPerChannelPerDay` JSON NOT NULL,
    `silenceWindow` JSON NOT NULL,
    `blacklist` JSON NOT NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `bychat_channel_governance_teamId_key`(`teamId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `bychat_channel_governance`
    ADD CONSTRAINT `bychat_channel_governance_teamId_fkey`
    FOREIGN KEY (`teamId`) REFERENCES `bychat_teams`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE;
