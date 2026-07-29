-- G1: segunda chamada deixa de ser campo morto no esquema de avaliação.
-- A nota reposta precisa se identificar como tal — média igual com origem
-- diferente é a informação que sustenta a decisão numa revisão de nota.
ALTER TABLE `bychat_aca_notas`
  ADD COLUMN `origem` VARCHAR(20) NOT NULL DEFAULT 'NORMAL',
  ADD COLUMN `origemObs` TEXT NULL,
  ADD COLUMN `origemEm` DATETIME(3) NULL;
