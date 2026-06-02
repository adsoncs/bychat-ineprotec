-- Conector de Banco de Dados externo: importa leads de MySQL/Postgres
-- via query SQL com mapping configurável. Padrão genérico, usável por
-- qualquer LP/CRM externo. Inspirado em InboundWebhooks + Meta Forms.
--
-- Decisão: campos "tipo enum" estão como VARCHAR(20) em vez de ENUM SQL.
-- Prisma 5 + ENUM MySQL dá P2032 "Error converting field of expected
-- non-nullable type String, found incompatible value" ao gravar a partir
-- do client. VARCHAR mantém validação no app (TS) sem o conflito.

CREATE TABLE `bychat_db_connectors` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(120) NOT NULL,
  `description` VARCHAR(255) NULL,
  `dbType` VARCHAR(20) NOT NULL,
  `host` VARCHAR(255) NOT NULL,
  `port` INT NOT NULL,
  `dbName` VARCHAR(120) NOT NULL,
  `dbUser` VARCHAR(120) NOT NULL,
  `passwordEnc` TEXT NOT NULL,
  `useTLS` TINYINT(1) NOT NULL DEFAULT 0,
  `caCert` TEXT NULL,
  `query` TEXT NOT NULL,
  `mapping` JSON NOT NULL,
  `deltaStrategy` VARCHAR(20) NOT NULL DEFAULT 'id',
  `deltaColumn` VARCHAR(120) NULL,
  `lastSyncCursor` VARCHAR(255) NULL,
  `intervalMinutes` INT NOT NULL DEFAULT 5,
  `active` TINYINT(1) NOT NULL DEFAULT 1,
  `lastRunAt` DATETIME(3) NULL,
  `lastRunStatus` VARCHAR(20) NULL,
  `lastError` TEXT NULL,
  `totalImported` INT NOT NULL DEFAULT 0,
  `defaultTeamId` INT NULL,
  `defaultFunnelId` INT NULL,
  `defaultStageKey` VARCHAR(60) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_active` (`active`),
  KEY `idx_last_run` (`lastRunAt`),
  CONSTRAINT `fk_dbcon_team` FOREIGN KEY (`defaultTeamId`) REFERENCES `bychat_teams` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_dbcon_funnel` FOREIGN KEY (`defaultFunnelId`) REFERENCES `bychat_funnels` (`id`) ON DELETE SET NULL
);

CREATE TABLE `bychat_db_connector_runs` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `connectorId` INT NOT NULL,
  `startedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `finishedAt` DATETIME(3) NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'running',
  `rowsRead` INT NOT NULL DEFAULT 0,
  `leadsCreated` INT NOT NULL DEFAULT 0,
  `leadsSkipped` INT NOT NULL DEFAULT 0,
  `errorCount` INT NOT NULL DEFAULT 0,
  `cursorBefore` VARCHAR(255) NULL,
  `cursorAfter` VARCHAR(255) NULL,
  `error` TEXT NULL,
  `triggeredBy` VARCHAR(20) NOT NULL DEFAULT 'cron',
  `triggeredByUserId` INT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_connector_started` (`connectorId`, `startedAt` DESC),
  CONSTRAINT `fk_dbcon_run_connector` FOREIGN KEY (`connectorId`) REFERENCES `bychat_db_connectors` (`id`) ON DELETE CASCADE
);
