-- Acabamento visual do portal público: controles que faltavam para chegar ao
-- padrão de um checkout de mercado sem CSS próprio por instituição.
ALTER TABLE `bychat_enrollment_portals`
  ADD COLUMN `brandHeaderStyle` VARCHAR(20) NULL,
  ADD COLUMN `brandStepStyle` VARCHAR(20) NULL,
  ADD COLUMN `brandBackdropFrom` VARCHAR(20) NULL,
  ADD COLUMN `brandBackdropTo` VARCHAR(20) NULL,
  ADD COLUMN `brandButtonShape` VARCHAR(20) NULL,
  ADD COLUMN `brandButtonUppercase` BOOLEAN NULL,
  ADD COLUMN `brandSecurityNote` VARCHAR(120) NULL,
  ADD COLUMN `brandSummaryAlways` BOOLEAN NULL;
