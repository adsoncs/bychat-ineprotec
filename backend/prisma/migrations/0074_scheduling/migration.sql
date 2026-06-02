-- Módulo de Agendamento de Reuniões (scheduling)

-- CreateTable
CREATE TABLE `bychat_meeting_types` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `slug` VARCHAR(100) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `color` VARCHAR(20) NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `durationMin` INTEGER NOT NULL DEFAULT 30,
    `bufferBeforeMin` INTEGER NOT NULL DEFAULT 0,
    `bufferAfterMin` INTEGER NOT NULL DEFAULT 0,
    `slotIncrementMin` INTEGER NOT NULL DEFAULT 30,
    `minNoticeMin` INTEGER NOT NULL DEFAULT 240,
    `bookingWindowDays` INTEGER NOT NULL DEFAULT 60,
    `maxPerDay` INTEGER NULL,
    `visibleSlotsPerDay` INTEGER NULL,
    `timezone` VARCHAR(60) NOT NULL DEFAULT 'America/Sao_Paulo',
    `locationType` VARCHAR(30) NOT NULL DEFAULT 'google_meet',
    `locationDetail` VARCHAR(255) NULL,
    `assignmentMode` VARCHAR(20) NOT NULL DEFAULT 'fixed',
    `ownerUserId` INTEGER NULL,
    `teamId` INTEGER NULL,
    `funnelId` INTEGER NULL,
    `stageKey` VARCHAR(60) NULL,
    `defaultTeamId` INTEGER NULL,
    `landingPageId` INTEGER NULL,
    `intakeFields` JSON NULL,
    `confirmationConfig` JSON NULL,
    `pixelConfig` JSON NULL,
    `totalBookings` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `bychat_meeting_types_slug_key`(`slug`),
    INDEX `bychat_meeting_types_active_idx`(`active`),
    INDEX `bychat_meeting_types_ownerUserId_idx`(`ownerUserId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bychat_availability_schedules` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(120) NOT NULL,
    `ownerUserId` INTEGER NULL,
    `meetingTypeId` INTEGER NULL,
    `timezone` VARCHAR(60) NOT NULL DEFAULT 'America/Sao_Paulo',
    `rules` JSON NOT NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `bychat_availability_schedules_ownerUserId_idx`(`ownerUserId`),
    INDEX `bychat_availability_schedules_meetingTypeId_idx`(`meetingTypeId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bychat_availability_exceptions` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `scheduleId` INTEGER NOT NULL,
    `date` DATE NOT NULL,
    `unavailable` BOOLEAN NOT NULL DEFAULT true,
    `startTime` VARCHAR(5) NULL,
    `endTime` VARCHAR(5) NULL,
    `note` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `bychat_availability_exceptions_scheduleId_date_idx`(`scheduleId`, `date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bychat_bookings` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `token` VARCHAR(64) NOT NULL,
    `meetingTypeId` INTEGER NOT NULL,
    `leadId` INTEGER NULL,
    `operatorUserId` INTEGER NULL,
    `startAt` DATETIME(3) NOT NULL,
    `endAt` DATETIME(3) NOT NULL,
    `timezone` VARCHAR(60) NOT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'scheduled',
    `inviteeName` VARCHAR(191) NULL,
    `inviteeEmail` VARCHAR(191) NULL,
    `inviteePhone` VARCHAR(30) NULL,
    `answers` JSON NULL,
    `locationType` VARCHAR(30) NULL,
    `meetLink` TEXT NULL,
    `googleEventId` VARCHAR(255) NULL,
    `activityId` INTEGER NULL,
    `cancelReason` VARCHAR(255) NULL,
    `rescheduledFromId` INTEGER NULL,
    `source` VARCHAR(30) NOT NULL DEFAULT 'scheduling',
    `visitorId` VARCHAR(64) NULL,
    `utmSource` VARCHAR(191) NULL,
    `utmMedium` VARCHAR(191) NULL,
    `utmCampaign` VARCHAR(191) NULL,
    `utmContent` VARCHAR(191) NULL,
    `utmTerm` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `bychat_bookings_token_key`(`token`),
    INDEX `bychat_bookings_meetingTypeId_startAt_idx`(`meetingTypeId`, `startAt`),
    INDEX `bychat_bookings_operatorUserId_startAt_idx`(`operatorUserId`, `startAt`),
    INDEX `bychat_bookings_leadId_idx`(`leadId`),
    INDEX `bychat_bookings_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
