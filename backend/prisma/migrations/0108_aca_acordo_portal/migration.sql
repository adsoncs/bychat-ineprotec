-- AlterTable
ALTER TABLE `bychat_aca_acordos` ADD COLUMN `aceiteDocumento` VARCHAR(30) NULL,
    ADD COLUMN `aceiteEm` DATETIME(3) NULL,
    ADD COLUMN `aceiteIp` VARCHAR(45) NULL,
    ADD COLUMN `aceiteNome` VARCHAR(191) NULL,
    ADD COLUMN `aceiteUserAgent` TEXT NULL,
    ADD COLUMN `descontoEncargosCentavos` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `origem` VARCHAR(24) NOT NULL DEFAULT 'SECRETARIA';

