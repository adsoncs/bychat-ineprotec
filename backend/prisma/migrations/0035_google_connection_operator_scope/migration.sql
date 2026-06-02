-- 0035_google_connection_operator_scope
-- Híbrido B: GoogleConnection ganha kind (COMPANY|OPERATOR) e userId para vincular operador.
-- Conexões existentes ficam como COMPANY (preservando comportamento atual: Drive/Sheets centralizado).

ALTER TABLE `bychat_google_connections`
  ADD COLUMN `kind` VARCHAR(16) NOT NULL DEFAULT 'OPERATOR',
  ADD COLUMN `userId` INT NULL;

-- Backfill: tudo que já existia é da empresa
UPDATE `bychat_google_connections` SET `kind` = 'COMPANY' WHERE `kind` = 'OPERATOR';

ALTER TABLE `bychat_google_connections`
  ADD UNIQUE INDEX `bychat_google_connections_userId_key` (`userId`),
  ADD INDEX `bychat_google_connections_kind_active_idx` (`kind`, `active`);
