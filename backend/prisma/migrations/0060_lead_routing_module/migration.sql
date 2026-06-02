-- 0060_lead_routing_module
-- Fase 1 do módulo de Roteamento de Leads.
-- Foundation: flag isAgent ortogonal ao role + AgentProfile + Setting routing.v2.enabled.
-- Backfill: ADMIN e MANAGER existentes viram agentes (decisão do admin no /var/www/bychat-terram).
-- Não destrutivo. Compatível com motor atual (filtro só aplica quando routing.v2.enabled=true).

-- 1) Flag isAgent em User
ALTER TABLE `bychat_users`
  ADD COLUMN `isAgent` BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX `bychat_users_isAgent_idx` ON `bychat_users`(`isAgent`);

-- 2) Perfil do agente (1:1 com User). Campos opcionais que serão usados em F2+.
CREATE TABLE `bychat_agent_profiles` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `userId` INT NOT NULL,
  `active` BOOLEAN NOT NULL DEFAULT TRUE,
  `weight` INT NOT NULL DEFAULT 1,
  `maxDailyLeads` INT NULL,
  `vacationUntil` DATETIME(3) NULL,
  `notes` VARCHAR(255) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `bychat_agent_profiles_userId_key` (`userId`),
  CONSTRAINT `bychat_agent_profiles_userId_fkey`
    FOREIGN KEY (`userId`) REFERENCES `bychat_users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 3) Backfill: ADMIN e MANAGER ativos viram agentes por padrão.
--    SUPERADMIN não recebe lead automaticamente (papel de orquestração);
--    VIEWER continua só leitura.
UPDATE `bychat_users`
  SET `isAgent` = TRUE
  WHERE `role` IN ('ADMIN', 'MANAGER')
    AND `active` = TRUE;

-- 4) Cria AgentProfile para cada user que virou agente, com defaults seguros.
INSERT INTO `bychat_agent_profiles` (`userId`, `active`, `weight`)
  SELECT `id`, TRUE, 1
  FROM `bychat_users`
  WHERE `isAgent` = TRUE;

-- 5) Feature flag global. Default false: motor novo está pronto mas inerte até admin ligar.
INSERT INTO `bychat_settings` (`key`, `value`, `label`, `grp`, `fieldType`, `createdAt`, `updatedAt`)
  VALUES (
    'routing.v2.enabled',
    CAST('false' AS JSON),
    'Roteamento V2 (filtro por agente)',
    'routing',
    'boolean',
    CURRENT_TIMESTAMP(3),
    CURRENT_TIMESTAMP(3)
  )
  ON DUPLICATE KEY UPDATE `updatedAt` = CURRENT_TIMESTAMP(3);
