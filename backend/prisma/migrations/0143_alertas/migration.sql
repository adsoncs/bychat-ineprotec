-- Alertas — a caixa que o sistema nunca teve.
--
-- Hoje a vigilância existe e o aviso não: o scheduler de atividades marca
-- `overdue` e não conta a ninguém (18 linhas assim), o SLA do helpdesk grava no
-- banco e para por aí, e 29 arquivos sabem reconhecer um token morto sem que
-- nenhum deles avise alguém. Faltava o lugar onde essas condições viram algo
-- que uma pessoa vê.
--
-- Duas escolhas explicam o formato:
--
-- 1. `dedupeKey` é UNIQUE porque alerta é ESTADO, não evento. O produtor chama
--    `raiseAlert` a cada volta do relógio; a condição que continua de pé
--    atualiza a linha (lastSeenAt, occurrences) em vez de criar outra. Sem
--    isso, uma negociação parada há 31 dias viraria 31 avisos.
--
-- 2. A caixa é de cada pessoa (bychat_alert_recipients), mas a condição é do
--    mundo (bychat_alerts). Alguém marcar como lido não pode apagar o aviso dos
--    outros; o token voltar a funcionar fecha o alerta para todos de uma vez.
--
-- Regra de quem recebe, decidida com o produto: `audience = 'management'` vai
-- só para a gestão; `audience = 'owner'` vai para o dono do item E para a
-- gestão. Quem resolve isso é o alertService — aqui só ficam as colunas.
CREATE TABLE `bychat_alerts` (
  `id`          INTEGER      NOT NULL AUTO_INCREMENT,
  `dedupeKey`   VARCHAR(191) NOT NULL,
  `kind`        VARCHAR(60)  NOT NULL,
  `severity`    VARCHAR(10)  NOT NULL DEFAULT 'warning',
  `audience`    VARCHAR(20)  NOT NULL DEFAULT 'management',
  `title`       VARCHAR(191) NOT NULL,
  `body`        TEXT         NULL,
  `entityType`  VARCHAR(40)  NULL,
  `entityId`    INTEGER      NULL,
  `ownerUserId` INTEGER      NULL,
  `teamId`      INTEGER      NULL,
  `metadata`    JSON         NULL,
  `status`      VARCHAR(12)  NOT NULL DEFAULT 'open',
  `firstSeenAt` DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `lastSeenAt`  DATETIME(3)  NOT NULL,
  `resolvedAt`  DATETIME(3)  NULL,
  `occurrences` INTEGER      NOT NULL DEFAULT 1,
  `notifiedAt`  DATETIME(3)  NULL,
  `notifyCount` INTEGER      NOT NULL DEFAULT 0,
  `createdAt`   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`   DATETIME(3)  NOT NULL,

  UNIQUE INDEX `bychat_alerts_dedupeKey_key`(`dedupeKey`),
  INDEX `bychat_alerts_status_severity_idx`(`status`, `severity`),
  INDEX `bychat_alerts_kind_idx`(`kind`),
  INDEX `bychat_alerts_ownerUserId_idx`(`ownerUserId`),
  INDEX `bychat_alerts_entityType_entityId_idx`(`entityType`, `entityId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `bychat_alert_recipients` (
  `id`          INTEGER     NOT NULL AUTO_INCREMENT,
  `alertId`     INTEGER     NOT NULL,
  `userId`      INTEGER     NOT NULL,
  `readAt`      DATETIME(3) NULL,
  `dismissedAt` DATETIME(3) NULL,
  `createdAt`   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `bychat_alert_recipients_alertId_userId_key`(`alertId`, `userId`),
  INDEX `bychat_alert_recipients_userId_readAt_idx`(`userId`, `readAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- O alerta some junto com a pessoa/equipe só onde faz sentido: apagar um
-- usuário não pode levar o alerta de gestão embora (SET NULL no dono), mas a
-- caixa pessoal dele deixa de existir (CASCADE no destinatário).
ALTER TABLE `bychat_alerts`
  ADD CONSTRAINT `bychat_alerts_ownerUserId_fkey`
  FOREIGN KEY (`ownerUserId`) REFERENCES `bychat_users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `bychat_alerts`
  ADD CONSTRAINT `bychat_alerts_teamId_fkey`
  FOREIGN KEY (`teamId`) REFERENCES `bychat_teams`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `bychat_alert_recipients`
  ADD CONSTRAINT `bychat_alert_recipients_alertId_fkey`
  FOREIGN KEY (`alertId`) REFERENCES `bychat_alerts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `bychat_alert_recipients`
  ADD CONSTRAINT `bychat_alert_recipients_userId_fkey`
  FOREIGN KEY (`userId`) REFERENCES `bychat_users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
