-- Fase 28-B: Google Ads agora mapeia 1 Conversion Action por trigger interno (em vez
-- de 1 CA global mandando sempre "Purchase"). Cada row liga (config, trigger) → CA.
-- A coluna GoogleAdsConfig.conversionAction é mantida em DEPRECATED para rollback.

CREATE TABLE `bychat_google_ads_conversion_map` (
  `id`               INT          NOT NULL AUTO_INCREMENT,
  `configId`         INT          NOT NULL,
  `trigger`          VARCHAR(60)  NOT NULL,
  `conversionAction` VARCHAR(191) NOT NULL,
  `valueSource`      VARCHAR(20)  NOT NULL DEFAULT 'zero',
  `fixedValue`       DOUBLE       NULL,
  `isPrimary`        BOOLEAN      NOT NULL DEFAULT FALSE,
  `enabled`          BOOLEAN      NOT NULL DEFAULT TRUE,
  `totalSent`        INT          NOT NULL DEFAULT 0,
  `totalFailed`      INT          NOT NULL DEFAULT 0,
  `lastSentAt`       DATETIME(3)  NULL,
  `createdAt`        DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`        DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_config_trigger` (`configId`, `trigger`),
  INDEX `idx_config` (`configId`),
  CONSTRAINT `fk_gads_conversion_map_config`
    FOREIGN KEY (`configId`)
    REFERENCES `bychat_google_ads_configs` (`id`)
    ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- Backfill: cada config com conversionAction setada vira o mapping default de "lead.won"
-- com valueSource = sale_value (mantém comportamento atual: manda saleValue como Purchase).
INSERT INTO `bychat_google_ads_conversion_map`
  (`configId`, `trigger`, `conversionAction`, `valueSource`, `isPrimary`, `enabled`)
SELECT
  `id`,
  'lead.won',
  `conversionAction`,
  'sale_value',
  TRUE,
  TRUE
FROM `bychat_google_ads_configs`
WHERE `conversionAction` IS NOT NULL AND `conversionAction` <> '';
