-- 0044_campaign_cost_link_clicks
-- Captura `inline_link_clicks` e `inline_link_click_ctr` da Meta Insights API
-- para que o painel exiba a mesma métrica de "CTR" que aparece no Meta Ads
-- Manager (link clicks / impressions), em paralelo com o `clicks` (todos) e
-- `ctr` (broad) que já capturamos. Sem isso, nosso CTR diverge do Meta UI.

ALTER TABLE `bychat_campaign_costs`
  ADD COLUMN `inlineLinkClicks` INT NULL,
  ADD COLUMN `inlineLinkClickCtr` DECIMAL(8,4) NULL;
