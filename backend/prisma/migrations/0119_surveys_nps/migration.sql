-- CreateTable
CREATE TABLE `bychat_surveys` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `description` VARCHAR(255) NULL,
    `questions` JSON NOT NULL,
    `npsQuestionKey` VARCHAR(100) NULL,
    `messages` JSON NULL,
    `flowId` INTEGER NULL,
    `expiresAfterHours` INTEGER NOT NULL DEFAULT 168,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `createdBy` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `bychat_surveys_active_idx`(`active`),
    INDEX `bychat_surveys_flowId_idx`(`flowId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bychat_survey_responses` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `surveyId` INTEGER NOT NULL,
    `leadId` INTEGER NULL,
    `phone` VARCHAR(30) NULL,
    `answers` JSON NOT NULL,
    `npsScore` INTEGER NULL,
    `npsCategory` VARCHAR(20) NULL,
    `channel` VARCHAR(30) NOT NULL DEFAULT 'whatsapp_flow',
    `respondedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `bychat_survey_responses_surveyId_respondedAt_idx`(`surveyId`, `respondedAt`),
    INDEX `bychat_survey_responses_leadId_idx`(`leadId`),
    INDEX `bychat_survey_responses_npsCategory_idx`(`npsCategory`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bychat_survey_sessions` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `surveyId` INTEGER NOT NULL,
    `leadId` INTEGER NULL,
    `phone` VARCHAR(30) NOT NULL,
    `flowToken` VARCHAR(120) NULL,
    `state` JSON NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'pending',
    `sentAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `respondedAt` DATETIME(3) NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `bychat_survey_sessions_flowToken_key`(`flowToken`),
    INDEX `bychat_survey_sessions_surveyId_status_idx`(`surveyId`, `status`),
    INDEX `bychat_survey_sessions_phone_status_idx`(`phone`, `status`),
    INDEX `bychat_survey_sessions_leadId_idx`(`leadId`),
    INDEX `bychat_survey_sessions_expiresAt_idx`(`expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `bychat_survey_responses` ADD CONSTRAINT `bychat_survey_responses_surveyId_fkey` FOREIGN KEY (`surveyId`) REFERENCES `bychat_surveys`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `bychat_survey_sessions` ADD CONSTRAINT `bychat_survey_sessions_surveyId_fkey` FOREIGN KEY (`surveyId`) REFERENCES `bychat_surveys`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
