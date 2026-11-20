-- Uso de IA por chave: impressão digital (sha256) e final da chave usada em cada chamada.
ALTER TABLE `bychat_consumo` ADD COLUMN `chave` VARCHAR(60) NULL, ADD COLUMN `chaveFinal` VARCHAR(12) NULL;
CREATE INDEX `bychat_consumo_fonte_chave_createdAt_idx` ON `bychat_consumo`(`fonte`, `chave`, `createdAt`);
