-- Arquivar modelo da Cloud API sem excluir na Meta: some da tela e dos
-- seletores, mas continua existindo lá (excluir é irreversível e trava o nome
-- por 30 dias). Quem já o usa (fluxo, outro sistema no mesmo número) não quebra.
ALTER TABLE `bychat_cloud_api_templates`
  ADD COLUMN `archivedAt` DATETIME(3) NULL,
  ADD COLUMN `archivedById` INTEGER NULL,
  ADD COLUMN `archivedNote` VARCHAR(255) NULL,
  ADD COLUMN `replacedById` INTEGER NULL;
