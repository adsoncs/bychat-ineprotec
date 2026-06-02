-- 0046_operator_status_routing
-- Status de trabalho do operador (S10) + capacidade individual (S11) +
-- modo de roteamento por setor (S11). Tudo nullable/default — operadores
-- existentes ficam offline com capacity 5; setores ficam em manual.

ALTER TABLE `bychat_users`
  ADD COLUMN `workStatus` VARCHAR(20) NOT NULL DEFAULT 'offline',
  ADD COLUMN `workStatusUpdatedAt` DATETIME(3) NULL,
  ADD COLUMN `capacity` INT NOT NULL DEFAULT 5;

ALTER TABLE `bychat_teams`
  ADD COLUMN `routingMode` VARCHAR(20) NOT NULL DEFAULT 'manual';
