-- Como o título foi pago de fato (boleto pago pelo Pix do próprio boleto = pix).
ALTER TABLE `bychat_enrollment_titulos` ADD COLUMN `pagoComo` VARCHAR(20) NULL;
