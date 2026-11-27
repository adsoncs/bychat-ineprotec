-- Responsável financeiro pessoa jurídica: representante legal (quem assina).
ALTER TABLE `bychat_aca_responsaveis`
  ADD COLUMN `representanteNome` VARCHAR(191) NULL,
  ADD COLUMN `representanteCpf` VARCHAR(20) NULL,
  ADD COLUMN `representanteEmail` VARCHAR(191) NULL;
