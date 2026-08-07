-- CreateTable
CREATE TABLE `bychat_home_screens` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(120) NOT NULL,
    `description` VARCHAR(255) NULL,
    `blocks` JSON NOT NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `isSystem` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bychat_home_screen_assignments` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `screenId` INTEGER NOT NULL,
    `role` ENUM('SUPERADMIN', 'ADMIN', 'MANAGER', 'AGENT', 'VIEWER') NULL,
    `userId` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `bychat_home_screen_assignments_screenId_idx`(`screenId`),
    UNIQUE INDEX `bychat_home_screen_assignments_role_key`(`role`),
    UNIQUE INDEX `bychat_home_screen_assignments_userId_key`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `bychat_home_screen_assignments` ADD CONSTRAINT `bychat_home_screen_assignments_screenId_fkey` FOREIGN KEY (`screenId`) REFERENCES `bychat_home_screens`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

