-- Sales Engagement E4 (final): tabela de execuções de step.
-- Cobre: envios automáticos, activities manuais, bloqueios de governança e falhas.
-- Permite drill-down completo no dashboard (canal, operador, status, conversão).

CREATE TABLE `bychat_cadence_step_executions` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `enrollmentId` INTEGER NOT NULL,
    `stepId` INTEGER NOT NULL,
    `leadId` INTEGER NOT NULL,
    `cadenceId` INTEGER NOT NULL,
    `channel` VARCHAR(20) NOT NULL,
    `status` VARCHAR(40) NOT NULL,
    `activityId` INTEGER NULL,
    `operatorUserId` INTEGER NULL,
    `completedAt` DATETIME(3) NULL,
    `errorMessage` TEXT NULL,
    `jobId` VARCHAR(100) NULL,
    `executedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `bychat_cadence_step_executions_cadenceId_executedAt_idx`(`cadenceId`, `executedAt`),
    INDEX `bychat_cadence_step_executions_enrollmentId_idx`(`enrollmentId`),
    INDEX `bychat_cadence_step_executions_leadId_idx`(`leadId`),
    INDEX `bychat_cadence_step_executions_channel_executedAt_idx`(`channel`, `executedAt`),
    INDEX `bychat_cadence_step_executions_operatorUserId_idx`(`operatorUserId`),
    INDEX `bychat_cadence_step_executions_activityId_idx`(`activityId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `bychat_cadence_step_executions`
    ADD CONSTRAINT `bychat_cadence_step_executions_enrollmentId_fkey`
    FOREIGN KEY (`enrollmentId`) REFERENCES `bychat_cadence_enrollments`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `bychat_cadence_step_executions`
    ADD CONSTRAINT `bychat_cadence_step_executions_stepId_fkey`
    FOREIGN KEY (`stepId`) REFERENCES `bychat_cadence_steps`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `bychat_cadence_step_executions`
    ADD CONSTRAINT `bychat_cadence_step_executions_operatorUserId_fkey`
    FOREIGN KEY (`operatorUserId`) REFERENCES `bychat_users`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE;
