-- Sales Engagement: Cadências outbound (Fase 9 — A1)
-- Plano: docs/sales_engagement_core.md + memória project_bychatbeyond_sales_engagement
-- Decisões: motor próprio (cadenceScheduler), reusa só dispatchAction.

CREATE TABLE `bychat_sales_cadences` (
  `id`               INT NOT NULL AUTO_INCREMENT,
  `name`             VARCHAR(191) NOT NULL,
  `description`      TEXT NULL,
  `ownerId`          INT NULL,
  `teamId`           INT NULL,
  `status`           VARCHAR(20) NOT NULL DEFAULT 'draft',
  `triggerMode`      VARCHAR(20) NOT NULL DEFAULT 'manual',
  `filterJson`       JSON NULL,
  `pauseOnReply`     TINYINT(1) NOT NULL DEFAULT 1,
  `exitOnConversion` TINYINT(1) NOT NULL DEFAULT 1,
  `createdAt`        DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`        DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  INDEX `bychat_sales_cadences_status_idx` (`status`),
  INDEX `bychat_sales_cadences_teamId_idx` (`teamId`),
  INDEX `bychat_sales_cadences_ownerId_idx` (`ownerId`),
  CONSTRAINT `bychat_sales_cadences_ownerId_fkey`
    FOREIGN KEY (`ownerId`) REFERENCES `bychat_users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `bychat_sales_cadences_teamId_fkey`
    FOREIGN KEY (`teamId`) REFERENCES `bychat_teams`(`id`) ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `bychat_cadence_steps` (
  `id`            INT NOT NULL AUTO_INCREMENT,
  `cadenceId`     INT NOT NULL,
  `order`         INT NOT NULL,
  `dayOffset`     INT NOT NULL DEFAULT 0,
  `hourOffset`    INT NOT NULL DEFAULT 0,
  `channel`       VARCHAR(20) NOT NULL,
  `templateId`    INT NULL,
  `isManual`      TINYINT(1) NOT NULL DEFAULT 0,
  `isBreakUp`     TINYINT(1) NOT NULL DEFAULT 0,
  `conditionJson` JSON NULL,
  `createdAt`     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`     DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `bychat_cadence_steps_cadenceId_order_key` (`cadenceId`, `order`),
  INDEX `bychat_cadence_steps_cadenceId_idx` (`cadenceId`),
  INDEX `bychat_cadence_steps_templateId_idx` (`templateId`),
  CONSTRAINT `bychat_cadence_steps_cadenceId_fkey`
    FOREIGN KEY (`cadenceId`) REFERENCES `bychat_sales_cadences`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `bychat_cadence_steps_templateId_fkey`
    FOREIGN KEY (`templateId`) REFERENCES `bychat_message_templates`(`id`) ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `bychat_cadence_enrollments` (
  `id`             INT NOT NULL AUTO_INCREMENT,
  `cadenceId`      INT NOT NULL,
  `leadId`         INT NOT NULL,
  `enrolledAt`     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `currentStep`    INT NOT NULL DEFAULT 0,
  `nextActionAt`   DATETIME(3) NULL,
  `status`         VARCHAR(20) NOT NULL DEFAULT 'active',
  `exitReason`     VARCHAR(50) NULL,
  `pauseReason`    VARCHAR(50) NULL,
  `lastReplyClass` VARCHAR(30) NULL,
  `lastActionAt`   DATETIME(3) NULL,
  `createdAt`      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`      DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `bychat_cadence_enrollments_cadenceId_leadId_key` (`cadenceId`, `leadId`),
  INDEX `bychat_cadence_enrollments_status_nextActionAt_idx` (`status`, `nextActionAt`),
  INDEX `bychat_cadence_enrollments_leadId_idx` (`leadId`),
  CONSTRAINT `bychat_cadence_enrollments_cadenceId_fkey`
    FOREIGN KEY (`cadenceId`) REFERENCES `bychat_sales_cadences`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `bychat_cadence_enrollments_leadId_fkey`
    FOREIGN KEY (`leadId`) REFERENCES `bychat_leads`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
