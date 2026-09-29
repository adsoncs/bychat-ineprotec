-- Tabela de preços do checkout do portal por meio de pagamento (à vista, cartão, boleto parcelado).
ALTER TABLE `bychat_edu_offerings` ADD COLUMN `tabelaPrecos` JSON NULL;
