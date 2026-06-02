-- 0042_campaign_cost_level
-- Adiciona suporte a custos por nível adset/ad em bychat_campaign_costs.
-- - costKey: chave única gerada (campaign:CID:DATE | adset:CID:ASID:DATE | ad:CID:ASID:ADID:DATE)
-- - level: 'campaign' | 'adset' | 'ad'
-- - adsetId/adsetName/adId/adName opcionais
-- Backfill: registros existentes ficam level='campaign' e costKey='campaign:CID:DATE'.
-- Remove o UNIQUE antigo (campaignId, date) — substituído por costKey UNIQUE.

ALTER TABLE `bychat_campaign_costs`
  ADD COLUMN `costKey`   VARCHAR(255) NULL,
  ADD COLUMN `level`     VARCHAR(10)  NOT NULL DEFAULT 'campaign',
  ADD COLUMN `adsetId`   VARCHAR(191) NULL,
  ADD COLUMN `adsetName` VARCHAR(191) NULL,
  ADD COLUMN `adId`      VARCHAR(191) NULL,
  ADD COLUMN `adName`    VARCHAR(191) NULL;

-- Backfill costKey para registros existentes
UPDATE `bychat_campaign_costs`
   SET `costKey` = CONCAT('campaign:', `campaignId`, ':', DATE_FORMAT(`date`, '%Y-%m-%d'))
 WHERE `costKey` IS NULL;

-- Tornar NOT NULL e único
ALTER TABLE `bychat_campaign_costs`
  MODIFY COLUMN `costKey` VARCHAR(255) NOT NULL,
  ADD UNIQUE INDEX `bychat_campaign_costs_costKey_key` (`costKey`);

-- Drop unique antigo (campaignId, date)
ALTER TABLE `bychat_campaign_costs`
  DROP INDEX `bychat_campaign_costs_campaignId_date_key`;

-- Novos índices
CREATE INDEX `bychat_campaign_costs_campaignId_date_idx` ON `bychat_campaign_costs` (`campaignId`, `date`);
CREATE INDEX `bychat_campaign_costs_adsetId_date_idx`    ON `bychat_campaign_costs` (`adsetId`, `date`);
CREATE INDEX `bychat_campaign_costs_adId_date_idx`       ON `bychat_campaign_costs` (`adId`, `date`);
CREATE INDEX `bychat_campaign_costs_level_idx`           ON `bychat_campaign_costs` (`level`);

-- Drop índice simples antigo (campaignId) — coberto pelo composto novo
ALTER TABLE `bychat_campaign_costs`
  DROP INDEX `bychat_campaign_costs_campaignId_idx`;
