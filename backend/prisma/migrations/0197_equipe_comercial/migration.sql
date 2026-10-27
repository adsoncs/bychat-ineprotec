-- Equipe comercial (as vendas contam para ela) e a última pessoa de equipe
-- comercial que esteve com o lead. Só colunas novas e opcionais.

-- AlterTable
ALTER TABLE `bychat_teams` ADD COLUMN `equipeComercial` BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE `bychat_leads` ADD COLUMN `ultimoComercialUserId` INTEGER NULL;
