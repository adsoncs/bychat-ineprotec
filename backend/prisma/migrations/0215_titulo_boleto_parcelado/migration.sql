-- Boleto parcelado no pagamento combinado: cada parcela é um título.
ALTER TABLE `bychat_enrollment_titulos` ADD COLUMN `parcelaDoGrupo` INTEGER NULL, ADD COLUMN `totalDoGrupo` INTEGER NULL;
