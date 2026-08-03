-- Módulo Negociação: separar mensalidade (MRR) de pagamento único.
--
-- `cobranca` no item classifica cada linha da proposta; `parcelas` permite
-- parcelar um item único de valor alto (implantação em 6x) sem mexer no
-- parcelamento global da negociação; `recorrenciaMeses` guarda o prazo do
-- contrato do item recorrente (opcional).
--
-- Os agregados `valorRecorrente`/`valorUnico` ficam desnormalizados na
-- negociação para os KPIs da Visão Geral somarem sem JOIN por item.
--
-- Default `unico` em tudo: negociações antigas continuam valendo exatamente o
-- que valiam (valorFinal inalterado) e nenhum MRR é inventado retroativamente.

ALTER TABLE `bychat_negotiation_items`
  ADD COLUMN `cobranca` VARCHAR(12) NOT NULL DEFAULT 'unico',
  ADD COLUMN `parcelas` INT NULL,
  ADD COLUMN `recorrenciaMeses` INT NULL;

ALTER TABLE `bychat_negotiations`
  ADD COLUMN `valorRecorrente` DECIMAL(12, 2) NULL,
  ADD COLUMN `valorUnico` DECIMAL(12, 2) NULL;

ALTER TABLE `bychat_products`
  ADD COLUMN `cobranca` VARCHAR(12) NOT NULL DEFAULT 'unico';

-- Backfill: sem itens classificados, tudo o que já existe é pagamento único —
-- é o que os cards mostravam até aqui. Quem tiver mensalidade no histórico
-- reclassifica o item na aba Negociação e os agregados se refazem no salvar.
UPDATE `bychat_negotiations`
   SET `valorUnico` = `valorFinal`, `valorRecorrente` = 0
 WHERE `valorUnico` IS NULL;
