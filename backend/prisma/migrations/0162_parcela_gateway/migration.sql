-- Mensalidades do ERP passam a poder ser cobradas por mais de um gateway.
-- `asaasChargeId` continua guardando o id da cobrança (nome histórico); o
-- gateway que a emitiu vai em `gatewayProvider`. Linhas antigas ficam NULL e
-- são tratadas como Asaas, que era o único possível até aqui.
ALTER TABLE `bychat_aca_parcelas`
  ADD COLUMN `gatewayProvider` VARCHAR(20) NULL,
  ADD COLUMN `gatewaySyncAt` DATETIME(3) NULL;

CREATE INDEX `bychat_aca_parcelas_gatewayProvider_situacao_idx` ON `bychat_aca_parcelas`(`gatewayProvider`, `situacao`);
