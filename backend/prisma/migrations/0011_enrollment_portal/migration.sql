-- Portal de Matrículas (Fase A — MVP)

CREATE TABLE `bychat_enrollment_portals` (
  `id`                  INT NOT NULL AUTO_INCREMENT,
  `slug`                VARCHAR(100) NOT NULL,
  `nome`                VARCHAR(191) NOT NULL,
  `unitId`              INT NOT NULL,
  `selectionProcessIds` JSON NOT NULL,
  `landingPageId`       INT NULL,
  `formConfig`          JSON NOT NULL,

  `alwaysCreateNew`     TINYINT(1) NOT NULL DEFAULT 0,
  `ctaBehavior`         VARCHAR(20) NOT NULL DEFAULT 'message',
  `ctaTarget`           VARCHAR(500) NULL,
  `ctaMessage`          TEXT NULL,

  `captchaType`         VARCHAR(20) NULL,
  `captchaSiteKey`      VARCHAR(100) NULL,
  `captchaSecret`       VARCHAR(255) NULL,

  `allowedLevelIds`     JSON NULL,
  `allowedCourseIds`    JSON NULL,
  `allowedCampusIds`    JSON NULL,
  `allowedModalityIds`  JSON NULL,

  `paymentProvider`     VARCHAR(30) NULL,
  `paymentConfig`       JSON NULL,
  `requirePayment`      TINYINT(1) NOT NULL DEFAULT 0,
  `paymentAmount`       DECIMAL(12,2) NULL,
  `paymentDeadlineHours` INT NOT NULL DEFAULT 48,

  `customDomain`        VARCHAR(191) NULL,
  `sslStatus`           VARCHAR(20) NULL,
  `metaTitle`           VARCHAR(191) NULL,
  `metaDescription`     VARCHAR(500) NULL,
  `ogImageUrl`          TEXT NULL,

  `customCss`           LONGTEXT NULL,
  `customHeadJs`        LONGTEXT NULL,
  `customBodyJs`        LONGTEXT NULL,
  `pixelConfig`         JSON NULL,

  `teamId`              INT NULL,

  `codePrefix`          VARCHAR(10) NOT NULL DEFAULT 'MAT',
  `codeSequence`        INT NOT NULL DEFAULT 0,

  `active`              TINYINT(1) NOT NULL DEFAULT 1,
  `publishedAt`         DATETIME(3) NULL,

  `views`               INT NOT NULL DEFAULT 0,
  `submissions`         INT NOT NULL DEFAULT 0,
  `conversions`         INT NOT NULL DEFAULT 0,

  `createdBy`           INT NULL,
  `createdAt`           DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`           DATETIME(3) NOT NULL,

  PRIMARY KEY (`id`),
  UNIQUE INDEX `bychat_enrollment_portals_slug_key` (`slug`),
  UNIQUE INDEX `bychat_enrollment_portals_landingPageId_key` (`landingPageId`),
  INDEX `bychat_enrollment_portals_unitId_idx` (`unitId`),
  INDEX `bychat_enrollment_portals_active_idx` (`active`),
  INDEX `bychat_enrollment_portals_teamId_idx` (`teamId`),
  INDEX `bychat_enrollment_portals_customDomain_idx` (`customDomain`),

  CONSTRAINT `bychat_enrollment_portals_unitId_fkey`
    FOREIGN KEY (`unitId`) REFERENCES `bychat_edu_units`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `bychat_enrollment_portals_landingPageId_fkey`
    FOREIGN KEY (`landingPageId`) REFERENCES `bychat_landing_pages`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `bychat_enrollment_portals_teamId_fkey`
    FOREIGN KEY (`teamId`) REFERENCES `bychat_teams`(`id`) ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `bychat_enrollment_registrations` (
  `id`                    INT NOT NULL AUTO_INCREMENT,
  `portalId`              INT NOT NULL,
  `processRegistrationId` INT NULL,
  `candidateCode`         VARCHAR(30) NOT NULL,

  `status`                VARCHAR(30) NOT NULL DEFAULT 'pending',
  `formData`              JSON NOT NULL,

  `paymentId`             VARCHAR(191) NULL,
  `paymentStatus`         VARCHAR(20) NULL,
  `paymentUrl`            TEXT NULL,
  `paymentAmount`         DECIMAL(12,2) NULL,
  `paymentMethod`         VARCHAR(30) NULL,
  `paymentPaidAt`         DATETIME(3) NULL,
  `paymentExpiresAt`      DATETIME(3) NULL,

  `leadId`                INT NULL,

  `ipAddress`             VARCHAR(45) NULL,
  `userAgent`             TEXT NULL,
  `utmSource`             VARCHAR(100) NULL,
  `utmMedium`             VARCHAR(100) NULL,
  `utmCampaign`           VARCHAR(191) NULL,
  `fbclid`                VARCHAR(191) NULL,
  `gclid`                 VARCHAR(191) NULL,
  `referrer`              TEXT NULL,

  `accessHash`            VARCHAR(64) NULL,

  `createdAt`             DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`             DATETIME(3) NOT NULL,

  PRIMARY KEY (`id`),
  UNIQUE INDEX `bychat_enrollment_registrations_candidateCode_key` (`candidateCode`),
  UNIQUE INDEX `bychat_enrollment_registrations_processRegistrationId_key` (`processRegistrationId`),
  INDEX `bychat_enrollment_registrations_portalId_idx` (`portalId`),
  INDEX `bychat_enrollment_registrations_status_idx` (`status`),
  INDEX `bychat_enrollment_registrations_paymentStatus_idx` (`paymentStatus`),
  INDEX `bychat_enrollment_registrations_leadId_idx` (`leadId`),
  INDEX `bychat_enrollment_registrations_createdAt_idx` (`createdAt`),

  CONSTRAINT `bychat_enrollment_registrations_portalId_fkey`
    FOREIGN KEY (`portalId`) REFERENCES `bychat_enrollment_portals`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `bychat_enrollment_registrations_processRegistrationId_fkey`
    FOREIGN KEY (`processRegistrationId`) REFERENCES `bychat_edu_process_registrations`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `bychat_enrollment_registrations_leadId_fkey`
    FOREIGN KEY (`leadId`) REFERENCES `bychat_leads`(`id`) ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `bychat_enrollment_documents` (
  `id`             INT NOT NULL AUTO_INCREMENT,
  `registrationId` INT NOT NULL,
  `type`           VARCHAR(30) NOT NULL,
  `label`          VARCHAR(100) NOT NULL,
  `fileUrl`        TEXT NOT NULL,
  `fileName`       VARCHAR(191) NOT NULL,
  `mimeType`       VARCHAR(50) NOT NULL,
  `sizeBytes`      INT NOT NULL,

  `status`         VARCHAR(20) NOT NULL DEFAULT 'pending',
  `reviewNote`     TEXT NULL,
  `reviewedBy`     INT NULL,
  `reviewedAt`     DATETIME(3) NULL,

  `uploadedAt`     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`),
  INDEX `bychat_enrollment_documents_registrationId_idx` (`registrationId`),
  INDEX `bychat_enrollment_documents_status_idx` (`status`),

  CONSTRAINT `bychat_enrollment_documents_registrationId_fkey`
    FOREIGN KEY (`registrationId`) REFERENCES `bychat_enrollment_registrations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
