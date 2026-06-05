-- Campos dedicados de campanha no lead:
--   utmId  → utm_id da URL (ID da campanha Meta/Google, p/ cruzar com a API)
--   fbclid → Meta Click ID capturado em landing/site (fora do click-to-WhatsApp)
-- Antes ficavam só na timeline (tracking); agora viram colunas estruturadas.
ALTER TABLE `bychat_leads`
  ADD COLUMN `utmId` VARCHAR(191) NULL,
  ADD COLUMN `fbclid` VARCHAR(255) NULL;
