-- Desconto e forma de pagamento passam a ser POR BLOCO de cobrança.
--
-- Antes havia um desconto só, rateado entre pagamento único e mensalidade na
-- proporção do subtotal de cada um. Mas desconto na implantação e desconto na
-- mensalidade são negociações diferentes: dá para ceder R$ 1.000 na implantação
-- sem tocar no valor que se repete todo mês — e o contrário também.
--
-- `descontoTipo`/`descontoValor`/`frete`/`pagamentoForma`/`entrada`/`parcelas`
-- passam a valer só para o pagamento ÚNICO; os campos novos abaixo cuidam da
-- mensalidade.

ALTER TABLE `bychat_negotiations`
  ADD COLUMN `descontoRecTipo` VARCHAR(10) NULL,
  ADD COLUMN `descontoRecValor` DECIMAL(12, 2) NULL,
  ADD COLUMN `pagamentoFormaRec` VARCHAR(20) NULL,
  ADD COLUMN `vencimentoDiaRec` INT NULL;

-- Migração dos descontos já existentes, de forma que nenhum total mude.
--
-- Percentual: o mesmo % nos dois blocos produz exatamente o rateio anterior
-- (10% de um todo dividido em duas partes é 10% de cada parte).
UPDATE `bychat_negotiations`
   SET `descontoRecTipo` = 'percent', `descontoRecValor` = `descontoValor`
 WHERE `descontoTipo` = 'percent' AND `descontoValor` > 0;

-- Valor fixo: divide na mesma proporção que o cálculo antigo aplicava, para a
-- proposta continuar valendo o que vale hoje.
UPDATE `bychat_negotiations` n
  JOIN (
    SELECT i.negotiationId,
           SUM(CASE WHEN i.cobranca = 'recorrente' THEN i.subtotal ELSE 0 END) AS subRec,
           SUM(i.subtotal) AS subTot
      FROM `bychat_negotiation_items` i
     GROUP BY i.negotiationId
  ) s ON s.negotiationId = n.id
   SET n.`descontoRecTipo`  = 'valor',
       n.`descontoRecValor` = ROUND(n.`descontoValor` * s.subRec / s.subTot, 2),
       n.`descontoValor`    = ROUND(n.`descontoValor` - ROUND(n.`descontoValor` * s.subRec / s.subTot, 2), 2)
 WHERE n.`descontoTipo` = 'valor' AND n.`descontoValor` > 0
   AND s.subTot > 0 AND s.subRec > 0;
