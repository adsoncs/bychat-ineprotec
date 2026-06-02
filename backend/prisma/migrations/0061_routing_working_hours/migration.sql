-- 0061_routing_working_hours
-- Fase 2 do módulo Lead Routing — horários de trabalho do agente e do setor.
--
-- Tabelas:
--   bychat_agent_working_hours: 1 linha por (userId, weekday). 0=domingo .. 6=sábado.
--                               Sem linha em um dia = agente NÃO trabalha nesse dia.
--   bychat_team_working_hours:  análogo para setores. Só consultado quando
--                               Team.workingHoursEnabled = true.
--
-- Campos:
--   startTime / endTime: "HH:MM" 24h (string p/ simplicidade — comparação lexicográfica funciona)
--   timezone: IANA TZ name, default America/Sao_Paulo
--
-- Setting routing.out_of_hours_team_id: fallback opcional quando ninguém disponível
-- no setor original por causa do horário. Picker continua retornando null se
-- não encontrar (caller decide se usa fallback).

-- 1) Working hours por agente
CREATE TABLE `bychat_agent_working_hours` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `userId` INT NOT NULL,
  `weekday` TINYINT NOT NULL,
  `startTime` VARCHAR(5) NOT NULL,
  `endTime` VARCHAR(5) NOT NULL,
  `timezone` VARCHAR(64) NOT NULL DEFAULT 'America/Sao_Paulo',
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `bychat_agent_working_hours_userId_weekday_key` (`userId`, `weekday`),
  KEY `bychat_agent_working_hours_userId_idx` (`userId`),
  CONSTRAINT `bychat_agent_working_hours_userId_fkey`
    FOREIGN KEY (`userId`) REFERENCES `bychat_users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 2) Working hours por setor (Team)
CREATE TABLE `bychat_team_working_hours` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `teamId` INT NOT NULL,
  `weekday` TINYINT NOT NULL,
  `startTime` VARCHAR(5) NOT NULL,
  `endTime` VARCHAR(5) NOT NULL,
  `timezone` VARCHAR(64) NOT NULL DEFAULT 'America/Sao_Paulo',
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `bychat_team_working_hours_teamId_weekday_key` (`teamId`, `weekday`),
  KEY `bychat_team_working_hours_teamId_idx` (`teamId`),
  CONSTRAINT `bychat_team_working_hours_teamId_fkey`
    FOREIGN KEY (`teamId`) REFERENCES `bychat_teams`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 3) Flag no Team: habilita filtro de horário do setor.
--    Default false: setores existentes continuam recebendo 24/7.
ALTER TABLE `bychat_teams`
  ADD COLUMN `workingHoursEnabled` BOOLEAN NOT NULL DEFAULT FALSE;

-- 4) Setting fallback fora de horário (default null).
--    Quando preenchido, o caller pode redirecionar pra esse team se o picker
--    retornar null por motivo de horário. Validação via UI (precisa ser ID
--    de Team válido e ativo) — não criamos FK porque settings.value é Json.
INSERT INTO `bychat_settings` (`key`, `value`, `label`, `grp`, `fieldType`, `createdAt`, `updatedAt`)
  VALUES (
    'routing.out_of_hours_team_id',
    CAST('null' AS JSON),
    'Setor de plantão fora do horário',
    'routing',
    'team',
    CURRENT_TIMESTAMP(3),
    CURRENT_TIMESTAMP(3)
  )
  ON DUPLICATE KEY UPDATE `updatedAt` = CURRENT_TIMESTAMP(3);
