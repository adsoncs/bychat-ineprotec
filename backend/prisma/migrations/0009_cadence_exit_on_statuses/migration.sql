-- Sales Engagement B4: critério de saída por status do lead.
-- Lista opcional de Lead.status que removem o lead da cadência (ex: ["GANHO","PERDIDO"]).

ALTER TABLE `bychat_sales_cadences`
    ADD COLUMN `exitOnStatuses` JSON NULL;
