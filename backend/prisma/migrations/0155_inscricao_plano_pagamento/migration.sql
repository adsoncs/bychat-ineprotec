-- O plano escolhido no checkout (meio, parcelas, entrada). Vira contrato e
-- parcelas do ERP só na efetivação da matrícula.
ALTER TABLE `bychat_enrollment_registrations` ADD COLUMN `paymentPlan` JSON NULL;
