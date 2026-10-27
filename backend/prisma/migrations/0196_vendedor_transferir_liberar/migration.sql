-- Vendedor congelado no Ganho, permissões de transferir/pegar por equipe e
-- membro, e conversa liberada ao resolver. Só colunas novas e opcionais.

-- AlterTable
ALTER TABLE `bychat_leads` ADD COLUMN `vendedorUserId` INTEGER NULL,
    ADD COLUMN `vendedorEm` DATETIME(3) NULL,
    ADD COLUMN `conversaLiberadaEm` DATETIME(3) NULL;

-- CreateIndex
CREATE INDEX `bychat_leads_vendedorUserId_idx` ON `bychat_leads`(`vendedorUserId`);
CREATE INDEX `bychat_leads_conversaLiberadaEm_idx` ON `bychat_leads`(`conversaLiberadaEm`);

-- AlterTable
ALTER TABLE `bychat_teams` ADD COLUMN `podeTransferir` BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN `podePegarDeOutros` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `liberarAoResolver` BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE `bychat_team_members` ADD COLUMN `podeTransferir` BOOLEAN NULL,
    ADD COLUMN `podePegarDeOutros` BOOLEAN NULL;
