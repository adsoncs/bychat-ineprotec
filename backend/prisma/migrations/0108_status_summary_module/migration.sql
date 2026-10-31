-- Módulo Resumo (status_summary): o operador classifica a SITUAÇÃO do atendimento
-- e o motor deriva etapa, atividades, prazos, responsável e outcome.
-- Ver services/statusSummaryEngine.ts.

-- CreateTable
CREATE TABLE `bychat_status_summaries` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `code` VARCHAR(20) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `helpText` TEXT NULL,
    `funnelId` INTEGER NULL,
    `sector` VARCHAR(10) NULL,
    `color` VARCHAR(20) NULL,
    `position` INTEGER NOT NULL DEFAULT 0,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `targetFunnelId` INTEGER NULL,
    `targetStageKey` VARCHAR(50) NULL,
    `setOutcome` VARCHAR(10) NULL,
    `requireLossReason` BOOLEAN NOT NULL DEFAULT false,
    `defaultLossReasonId` INTEGER NULL,
    `temperature` VARCHAR(10) NULL,
    `closeOpenActivities` BOOLEAN NOT NULL DEFAULT false,
    `enrollCadenceId` INTEGER NULL,
    `nextSummaryCode` VARCHAR(20) NULL,
    `autoAdvanceOnDue` BOOLEAN NOT NULL DEFAULT false,
    `allowedFromStages` JSON NULL,
    `requiredFields` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `bychat_status_summaries_funnelId_code_key`(`funnelId`, `code`),
    INDEX `bychat_status_summaries_active_position_idx`(`active`, `position`),
    INDEX `bychat_status_summaries_funnelId_active_idx`(`funnelId`, `active`),
    INDEX `bychat_status_summaries_code_idx`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bychat_activity_templates` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `code` VARCHAR(20) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `defaultDescription` TEXT NULL,
    `type` VARCHAR(30) NOT NULL,
    `messageTemplateId` INTEGER NULL,
    `dueMode` VARCHAR(20) NOT NULL DEFAULT 'immediate',
    `dueValue` INTEGER NOT NULL DEFAULT 0,
    `assigneeMode` VARCHAR(20) NOT NULL DEFAULT 'lead_owner',
    `assigneeTeamId` INTEGER NULL,
    `assigneeUserId` INTEGER NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `bychat_activity_templates_code_key`(`code`),
    INDEX `bychat_activity_templates_active_idx`(`active`),
    INDEX `bychat_activity_templates_type_idx`(`type`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bychat_status_summary_activities` (
    `summaryId` INTEGER NOT NULL,
    `activityTemplateId` INTEGER NOT NULL,
    `dueOverrideMode` VARCHAR(20) NULL,
    `dueOverrideValue` INTEGER NULL,
    `titleOverride` VARCHAR(191) NULL,
    `order` INTEGER NOT NULL DEFAULT 0,

    INDEX `bychat_status_summary_activities_activityTemplateId_idx`(`activityTemplateId`),
    PRIMARY KEY (`summaryId`, `activityTemplateId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bychat_lead_status_history` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `leadId` INTEGER NOT NULL,
    `fromSummaryId` INTEGER NULL,
    `toSummaryId` INTEGER NOT NULL,
    `fromCode` VARCHAR(20) NULL,
    `toCode` VARCHAR(20) NOT NULL,
    `changedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `changedByUserId` INTEGER NULL,
    `source` VARCHAR(30) NULL,
    `note` TEXT NULL,
    `effects` JSON NULL,

    INDEX `bychat_lead_status_history_leadId_changedAt_idx`(`leadId`, `changedAt`),
    INDEX `bychat_lead_status_history_toSummaryId_changedAt_idx`(`toSummaryId`, `changedAt`),
    INDEX `bychat_lead_status_history_changedAt_idx`(`changedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AlterTable: Lead ganha o resumo atual
ALTER TABLE `bychat_leads`
    ADD COLUMN `statusSummaryId` INTEGER NULL,
    ADD COLUMN `statusSummaryAt` DATETIME(3) NULL;

CREATE INDEX `bychat_leads_statusSummaryId_idx` ON `bychat_leads`(`statusSummaryId`);
CREATE INDEX `bychat_leads_statusSummaryId_statusSummaryAt_idx` ON `bychat_leads`(`statusSummaryId`, `statusSummaryAt`);

-- AlterTable: Activity ganha responsável pela EXECUÇÃO (userId continua sendo o criador)
ALTER TABLE `bychat_activities`
    ADD COLUMN `assignedUserId` INTEGER NULL,
    ADD COLUMN `assignedTeamId` INTEGER NULL,
    ADD COLUMN `templateCode` VARCHAR(20) NULL;

CREATE INDEX `bychat_activities_assignedUserId_status_idx` ON `bychat_activities`(`assignedUserId`, `status`);
CREATE INDEX `bychat_activities_assignedTeamId_status_idx` ON `bychat_activities`(`assignedTeamId`, `status`);
CREATE INDEX `bychat_activities_templateCode_status_idx` ON `bychat_activities`(`templateCode`, `status`);

-- AlterTable: Stage declara SLA e temperatura esperada
ALTER TABLE `bychat_stages`
    ADD COLUMN `slaHours` INTEGER NULL,
    ADD COLUMN `temperature` VARCHAR(10) NULL;

-- AddForeignKey
ALTER TABLE `bychat_status_summaries` ADD CONSTRAINT `bychat_status_summaries_funnelId_fkey` FOREIGN KEY (`funnelId`) REFERENCES `bychat_funnels`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `bychat_activity_templates` ADD CONSTRAINT `bychat_activity_templates_messageTemplateId_fkey` FOREIGN KEY (`messageTemplateId`) REFERENCES `bychat_message_templates`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `bychat_activity_templates` ADD CONSTRAINT `bychat_activity_templates_assigneeTeamId_fkey` FOREIGN KEY (`assigneeTeamId`) REFERENCES `bychat_teams`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `bychat_activity_templates` ADD CONSTRAINT `bychat_activity_templates_assigneeUserId_fkey` FOREIGN KEY (`assigneeUserId`) REFERENCES `bychat_users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `bychat_status_summary_activities` ADD CONSTRAINT `bychat_status_summary_activities_summaryId_fkey` FOREIGN KEY (`summaryId`) REFERENCES `bychat_status_summaries`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `bychat_status_summary_activities` ADD CONSTRAINT `bychat_status_summary_activities_activityTemplateId_fkey` FOREIGN KEY (`activityTemplateId`) REFERENCES `bychat_activity_templates`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `bychat_lead_status_history` ADD CONSTRAINT `bychat_lead_status_history_leadId_fkey` FOREIGN KEY (`leadId`) REFERENCES `bychat_leads`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `bychat_lead_status_history` ADD CONSTRAINT `bychat_lead_status_history_toSummaryId_fkey` FOREIGN KEY (`toSummaryId`) REFERENCES `bychat_status_summaries`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `bychat_lead_status_history` ADD CONSTRAINT `bychat_lead_status_history_changedByUserId_fkey` FOREIGN KEY (`changedByUserId`) REFERENCES `bychat_users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `bychat_leads` ADD CONSTRAINT `bychat_leads_statusSummaryId_fkey` FOREIGN KEY (`statusSummaryId`) REFERENCES `bychat_status_summaries`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `bychat_activities` ADD CONSTRAINT `bychat_activities_assignedUserId_fkey` FOREIGN KEY (`assignedUserId`) REFERENCES `bychat_users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `bychat_activities` ADD CONSTRAINT `bychat_activities_assignedTeamId_fkey` FOREIGN KEY (`assignedTeamId`) REFERENCES `bychat_teams`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
