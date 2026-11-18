-- Google: clique vindo de iOS (gbraid, app→web) e de web→app (wbraid) não traz gclid.
-- Sem estas colunas a conversão offline desses leads nunca era enviada.
ALTER TABLE `bychat_leads` ADD COLUMN `gbraid` VARCHAR(191) NULL, ADD COLUMN `wbraid` VARCHAR(191) NULL;
