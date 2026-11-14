-- Identidade da empresa por unidade (duas empresas no mesmo ambiente).
ALTER TABLE `bychat_edu_units` ADD COLUMN `identidade` JSON NULL;
