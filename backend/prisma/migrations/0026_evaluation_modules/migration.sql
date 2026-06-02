-- Módulos de avaliação por modo de ingresso:
--   • PresencialExam (exam_presencial) — agendamento + nota + veredito comercial
--   • EssaySubmission (vestibular_online) — redação cronometrada com IA + revisão humana
--   • Configurações de redação no SelectionProcess (tema, prazo, tentativas, anti-fraude, IA)
--   • Cutoffs específicos por oferta (essay/presencial)
--   • finalApprovalStageKey no portal — auto-avanço quando docs+avaliação OK

-- 1. Portal: stage de aprovação final
ALTER TABLE `bychat_enrollment_portals`
  ADD COLUMN `finalApprovalStageKey` VARCHAR(50) NULL;

-- 2. SelectionProcess: configs de redação + cutoff presencial
ALTER TABLE `bychat_edu_selection_processes`
  ADD COLUMN `essayPrompt`          TEXT          NULL,
  ADD COLUMN `essayDurationMinutes` INT           NULL,
  ADD COLUMN `essayMaxAttempts`     INT           NOT NULL DEFAULT 1,
  ADD COLUMN `essayMinWords`        INT           NULL,
  ADD COLUMN `essayMaxWords`        INT           NULL,
  ADD COLUMN `essayPasteBlocked`    BOOLEAN       NOT NULL DEFAULT TRUE,
  ADD COLUMN `essayAiEnabled`       BOOLEAN       NOT NULL DEFAULT TRUE,
  ADD COLUMN `essayCutoff`          DOUBLE        NULL,
  ADD COLUMN `essayAiCriteria`      JSON          NULL,
  ADD COLUMN `presencialCutoff`     DOUBLE        NULL;

-- 3. CourseOffering: overrides de cutoff por oferta
ALTER TABLE `bychat_edu_offerings`
  ADD COLUMN `essayCutoff`      DOUBLE NULL,
  ADD COLUMN `presencialCutoff` DOUBLE NULL;

-- 4. Tabela PresencialExam
CREATE TABLE `bychat_edu_presencial_exams` (
  `id`                INT          NOT NULL AUTO_INCREMENT,
  `registrationId`    INT          NOT NULL,
  `scheduledAt`       DATETIME(3)  NULL,
  `location`          VARCHAR(255) NULL,
  `room`              VARCHAR(50)  NULL,
  `seatNumber`        VARCHAR(20)  NULL,
  `attendanceStatus`  VARCHAR(20)  NOT NULL DEFAULT 'scheduled',
  `score`             DOUBLE       NULL,
  `maxScore`          DOUBLE       NULL,
  `examNote`          TEXT         NULL,
  `verdict`           VARCHAR(20)  NOT NULL DEFAULT 'pending',
  `verdictBy`         INT          NULL,
  `verdictAt`         DATETIME(3)  NULL,
  `verdictReason`     TEXT         NULL,
  `passed`            BOOLEAN      NULL,
  `cutoffApplied`     DOUBLE       NULL,
  `createdAt`         DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`         DATETIME(3)  NOT NULL,
  PRIMARY KEY (`id`),
  KEY `bychat_edu_presencial_exams_registrationId_idx` (`registrationId`),
  KEY `bychat_edu_presencial_exams_scheduledAt_idx` (`scheduledAt`),
  KEY `bychat_edu_presencial_exams_verdict_idx` (`verdict`),
  CONSTRAINT `bychat_edu_presencial_exams_registrationId_fkey`
    FOREIGN KEY (`registrationId`) REFERENCES `bychat_enrollment_registrations` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 5. Tabela EssaySubmission
CREATE TABLE `bychat_edu_essay_submissions` (
  `id`                INT          NOT NULL AUTO_INCREMENT,
  `registrationId`    INT          NOT NULL,
  `prompt`            TEXT         NULL,
  `attemptNumber`     INT          NOT NULL DEFAULT 1,
  `essayText`         LONGTEXT     NULL,
  `wordCount`         INT          NOT NULL DEFAULT 0,
  `status`            VARCHAR(20)  NOT NULL DEFAULT 'draft',
  `startedAt`         DATETIME(3)  NULL,
  `expiresAt`         DATETIME(3)  NULL,
  `submittedAt`       DATETIME(3)  NULL,
  `aiScore`           DOUBLE       NULL,
  `aiAnalysis`        JSON         NULL,
  `aiConfidence`      DOUBLE       NULL,
  `aiProcessedAt`     DATETIME(3)  NULL,
  `aiCostUsd`         DOUBLE       NULL,
  `humanScore`        DOUBLE       NULL,
  `humanNote`         TEXT         NULL,
  `reviewedBy`        INT          NULL,
  `reviewedAt`        DATETIME(3)  NULL,
  `finalScore`        DOUBLE       NULL,
  `passed`            BOOLEAN      NULL,
  `cutoffApplied`     DOUBLE       NULL,
  `pasteAttempts`     INT          NOT NULL DEFAULT 0,
  `visibilityChanges` INT          NOT NULL DEFAULT 0,
  `createdAt`         DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`         DATETIME(3)  NOT NULL,
  PRIMARY KEY (`id`),
  KEY `bychat_edu_essay_submissions_registrationId_idx` (`registrationId`),
  KEY `bychat_edu_essay_submissions_status_idx` (`status`),
  KEY `bychat_edu_essay_submissions_submittedAt_idx` (`submittedAt`),
  CONSTRAINT `bychat_edu_essay_submissions_registrationId_fkey`
    FOREIGN KEY (`registrationId`) REFERENCES `bychat_enrollment_registrations` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
