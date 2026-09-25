-- AlterTable
ALTER TABLE `bychat_portal_accounts` ADD COLUMN `cpf` VARCHAR(14) NULL;

-- CreateIndex
CREATE INDEX `bychat_portal_accounts_cpf_idx` ON `bychat_portal_accounts`(`cpf`);

