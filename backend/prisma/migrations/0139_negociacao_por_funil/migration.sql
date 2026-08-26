-- Em qual funil a venda acontece.
--
-- A comissão derivava o funil do LEAD. Isso deixou de bastar quando o lead
-- passou a poder estar em mais de um funil: a venda negociada num processo
-- adicional não era vista pela meta daquele funil, e contá-la em TODOS os
-- funis do lead inflaria receita e comissão — o mesmo dinheiro pago duas vezes.
--
-- Uma negociação, um funil.
ALTER TABLE `bychat_negotiations` ADD COLUMN `funnelId` INT NULL;

CREATE INDEX `bychat_negotiations_funnelId_idx` ON `bychat_negotiations`(`funnelId`);

ALTER TABLE `bychat_negotiations`
  ADD CONSTRAINT `bychat_negotiations_funnelId_fkey`
  FOREIGN KEY (`funnelId`) REFERENCES `bychat_funnels`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill com o funil ATUAL do lead: é exatamente o que a comissão já lia, de
-- modo que nenhum número histórico muda ao ligar esta coluna. Sem isto, toda
-- meta por funil zeraria de uma vez.
UPDATE `bychat_negotiations` n
  JOIN `bychat_leads` l ON l.`id` = n.`leadId`
  SET n.`funnelId` = l.`funnelId`
WHERE l.`funnelId` IS NOT NULL;
