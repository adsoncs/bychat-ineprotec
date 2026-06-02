-- Fase 28-B: Painel de relatórios Google Ads espelhando Meta Ads.
-- Armazena custos + métricas (impressions, clicks, conversions, cost) por dia
-- e nível (campaign | ad_group | ad), sincronizados via GAQL.

CREATE TABLE `bychat_google_ads_campaign_costs` (
  `id`              INT          NOT NULL AUTO_INCREMENT,
  `costKey`         VARCHAR(255) NOT NULL,
  `level`           VARCHAR(10)  NOT NULL DEFAULT 'campaign',
  `customerId`      VARCHAR(30)  NOT NULL,
  `campaignId`      VARCHAR(191) NOT NULL,
  `campaignName`    VARCHAR(191) NOT NULL,
  `adGroupId`       VARCHAR(191) NULL,
  `adGroupName`     VARCHAR(191) NULL,
  `adId`            VARCHAR(191) NULL,
  `adName`          VARCHAR(191) NULL,
  `date`            DATE         NOT NULL,
  `spend`           DECIMAL(12,2) NOT NULL,
  `impressions`     INT          NULL,
  `clicks`          INT          NULL,
  `conversions`     DECIMAL(12,4) NULL,
  `conversionValue` DECIMAL(12,2) NULL,
  `cpc`             DECIMAL(10,4) NULL,
  `cpm`             DECIMAL(10,4) NULL,
  `ctr`             DECIMAL(8,4)  NULL,
  `avgPosition`     DECIMAL(8,4)  NULL,
  `source`          VARCHAR(30)  NOT NULL DEFAULT 'google_ads_api',
  `raw`             JSON         NULL,
  `createdAt`       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_cost_key` (`costKey`),
  INDEX `idx_customer_date` (`customerId`, `date`),
  INDEX `idx_campaign_date` (`campaignId`, `date`),
  INDEX `idx_adgroup_date` (`adGroupId`, `date`),
  INDEX `idx_ad_date` (`adId`, `date`),
  INDEX `idx_level` (`level`),
  INDEX `idx_date` (`date`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;
