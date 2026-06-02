-- Webhooks de Entrada: endpoint público recebe payload arbitrário e mapeia
-- para Lead (campos nativos e custom fields) via JSONPath configurado.
-- Cada hit é persistido pra debug/auditoria. lastPayload guarda o último
-- corpo recebido (usado pela UI pra ajudar o admin a montar o mapping).

CREATE TABLE `bychat_inbound_webhooks` (
  `id`              INT          NOT NULL AUTO_INCREMENT,
  `token`           VARCHAR(64)  NOT NULL,
  `name`            VARCHAR(191) NOT NULL,
  `description`     TEXT         NULL,
  `active`          BOOLEAN      NOT NULL DEFAULT TRUE,
  `defaultFunnelId` INT          NULL,
  `defaultStageKey` VARCHAR(50)  NULL,
  `defaultTeamId`   INT          NULL,
  `defaultSource`   VARCHAR(50)  NULL,
  `mapping`         JSON         NOT NULL,
  `totalReceived`   INT          NOT NULL DEFAULT 0,
  `totalErrors`     INT          NOT NULL DEFAULT 0,
  `lastReceivedAt`  DATETIME(3)  NULL,
  `lastError`       TEXT         NULL,
  `lastPayload`     JSON         NULL,
  `createdBy`       INT          NULL,
  `createdAt`       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`       DATETIME(3)  NOT NULL,

  PRIMARY KEY (`id`),
  UNIQUE INDEX `bychat_inbound_webhooks_token_key` (`token`),
  INDEX `bychat_inbound_webhooks_active_idx` (`active`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `bychat_inbound_webhook_hits` (
  `id`         INT          NOT NULL AUTO_INCREMENT,
  `webhookId`  INT          NOT NULL,
  `receivedAt` DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `ip`         VARCHAR(45)  NULL,
  `userAgent`  VARCHAR(500) NULL,
  `payload`    JSON         NULL,
  `mappedData` JSON         NULL,
  `success`    BOOLEAN      NOT NULL DEFAULT FALSE,
  `leadId`     INT          NULL,
  `error`      TEXT         NULL,

  PRIMARY KEY (`id`),
  INDEX `bychat_inbound_webhook_hits_webhookId_receivedAt_idx` (`webhookId`, `receivedAt`),
  INDEX `bychat_inbound_webhook_hits_receivedAt_idx` (`receivedAt`),

  CONSTRAINT `bychat_inbound_webhook_hits_webhookId_fkey`
    FOREIGN KEY (`webhookId`) REFERENCES `bychat_inbound_webhooks`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
