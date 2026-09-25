-- Checkout do portal: o que se cobra e as regras de cada meio de pagamento
-- (parcelas, juros, desconto à vista, prazo).
ALTER TABLE `bychat_enrollment_portals`
  ADD COLUMN `paymentScope` VARCHAR(20) NULL,
  ADD COLUMN `paymentMethodsConfig` JSON NULL;
