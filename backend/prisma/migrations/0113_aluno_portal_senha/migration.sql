-- G6: portal do aluno com login próprio (CPF ou RA + senha).
-- O acesso por link continua valendo — quem nunca definiu senha não fica de
-- fora, e o link é justamente o caminho de definir a primeira.
ALTER TABLE `bychat_aca_alunos`
  ADD COLUMN `portalSenhaHash` VARCHAR(255) NULL,
  ADD COLUMN `portalSenhaDefinidaEm` DATETIME(3) NULL,
  ADD COLUMN `portalUltimoLoginEm` DATETIME(3) NULL,
  ADD COLUMN `portalTentativas` INT NOT NULL DEFAULT 0,
  ADD COLUMN `portalBloqueadoAte` DATETIME(3) NULL;
