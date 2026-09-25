-- Cupom com travas: onde vale (curso, oferta, processo, nível, modalidade),
-- como vale (meios de pagamento, taxa × curso, parcelas), para quem (CPFs,
-- domínios de e-mail) e organização (campanha, lote, notas, arquivo).
-- Tudo nulo por padrão: cupom existente continua valendo como antes.
ALTER TABLE `bychat_coupons`
  ADD COLUMN `courseIds` JSON NULL,
  ADD COLUMN `offeringIds` JSON NULL,
  ADD COLUMN `processIds` JSON NULL,
  ADD COLUMN `levelIds` JSON NULL,
  ADD COLUMN `modalityIds` JSON NULL,
  ADD COLUMN `paymentMethods` JSON NULL,
  ADD COLUMN `scope` VARCHAR(10) NULL,
  ADD COLUMN `allowedCpfs` JSON NULL,
  ADD COLUMN `emailDomains` JSON NULL,
  ADD COLUMN `stackWithPix` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `maxInstallments` INT NULL,
  ADD COLUMN `campaign` VARCHAR(100) NULL,
  ADD COLUMN `batch` VARCHAR(60) NULL,
  ADD COLUMN `notes` TEXT NULL,
  ADD COLUMN `archivedAt` DATETIME(3) NULL;

CREATE INDEX `bychat_coupons_campaign_idx` ON `bychat_coupons`(`campaign`);
CREATE INDEX `bychat_coupons_batch_idx` ON `bychat_coupons`(`batch`);
