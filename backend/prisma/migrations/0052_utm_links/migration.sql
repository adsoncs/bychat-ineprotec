-- Ferramenta UTM Builder: biblioteca de URLs taggeadas reaproveitáveis.

CREATE TABLE `bychat_utm_links` (
  `id`           INT          NOT NULL AUTO_INCREMENT,
  `name`         VARCHAR(191) NOT NULL,
  `baseUrl`      VARCHAR(2048) NOT NULL,
  `utmSource`    VARCHAR(100) NOT NULL,
  `utmMedium`    VARCHAR(100) NOT NULL,
  `utmCampaign`  VARCHAR(191) NOT NULL,
  `utmTerm`      VARCHAR(191) NULL,
  `utmContent`   VARCHAR(191) NULL,
  `utmId`        VARCHAR(191) NULL,
  `fullUrl`      TEXT         NOT NULL,
  `notes`        TEXT         NULL,
  `tags`         JSON         NULL,
  `active`       BOOLEAN      NOT NULL DEFAULT TRUE,
  `archived`     BOOLEAN      NOT NULL DEFAULT FALSE,
  `createdById`  INT          NULL,
  `createdAt`    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `idx_campaign` (`utmCampaign`),
  INDEX `idx_source_medium` (`utmSource`, `utmMedium`),
  INDEX `idx_active_archived` (`active`, `archived`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;
