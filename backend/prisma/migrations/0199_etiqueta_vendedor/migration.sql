-- Etiqueta automática com o nome do vendedor (por equipe comercial). Só
-- colunas novas e opcionais.

-- AlterTable
ALTER TABLE `bychat_teams` ADD COLUMN `etiquetaVendedor` BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE `bychat_tags` ADD COLUMN `vendedorUserId` INTEGER NULL;

-- CreateIndex
CREATE UNIQUE INDEX `bychat_tags_vendedorUserId_key` ON `bychat_tags`(`vendedorUserId`);
