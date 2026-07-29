-- G16: segundo fator por TOTP para operadores.
-- O segredo é gravado no início do cadastro, mas só passa a valer quando o
-- usuário confirma um código — daí `twoFactorEnabled` ser campo separado.
ALTER TABLE `bychat_users`
  ADD COLUMN `twoFactorSecret` VARCHAR(64) NULL,
  ADD COLUMN `twoFactorEnabled` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `twoFactorConfirmedAt` DATETIME(3) NULL,
  ADD COLUMN `twoFactorBackupCodes` TEXT NULL;
