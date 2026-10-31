-- Vários setores donos do mesmo número (Evolution e Cloud API).
--
-- Um número de recepção costuma ser atendido por mais de um setor, mas o campo
-- único `defaultTeamId` obrigava a escolher um: os demais setores não podiam
-- responder por aquela linha nem apareciam como donos.
--
-- Convenção que mantém todo o roteamento existente funcionando sem alteração:
-- `defaultTeamId` continua sendo o setor ÚNICO — preenchido quando há
-- exatamente um setor dono, nulo quando há vários. Com vários, o lead entra sem
-- setor e quem decide é o chatbot/menu, que foi a regra combinada.

CREATE TABLE `bychat_whatsapp_instance_teams` (
  `id`         INT NOT NULL AUTO_INCREMENT,
  `instanceId` INT NOT NULL,
  `teamId`     INT NOT NULL,
  `createdAt`  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `bychat_whatsapp_instance_teams_instanceId_teamId_key` (`instanceId`, `teamId`),
  INDEX `bychat_whatsapp_instance_teams_teamId_idx` (`teamId`),
  CONSTRAINT `bychat_whatsapp_instance_teams_instanceId_fkey`
    FOREIGN KEY (`instanceId`) REFERENCES `bychat_whatsapp_instances`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `bychat_whatsapp_instance_teams_teamId_fkey`
    FOREIGN KEY (`teamId`) REFERENCES `bychat_teams`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `bychat_cloud_api_connection_teams` (
  `id`           INT NOT NULL AUTO_INCREMENT,
  `connectionId` INT NOT NULL,
  `teamId`       INT NOT NULL,
  `createdAt`    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `bychat_cloud_api_connection_teams_connectionId_teamId_key` (`connectionId`, `teamId`),
  INDEX `bychat_cloud_api_connection_teams_teamId_idx` (`teamId`),
  CONSTRAINT `bychat_cloud_api_connection_teams_connectionId_fkey`
    FOREIGN KEY (`connectionId`) REFERENCES `bychat_cloud_api_connections`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `bychat_cloud_api_connection_teams_teamId_fkey`
    FOREIGN KEY (`teamId`) REFERENCES `bychat_teams`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Quem já tinha um setor dono passa a tê-lo também na lista, sem mudar nada de
-- comportamento.
INSERT INTO `bychat_whatsapp_instance_teams` (`instanceId`, `teamId`)
SELECT i.`id`, i.`defaultTeamId` FROM `bychat_whatsapp_instances` i
 WHERE i.`defaultTeamId` IS NOT NULL;

INSERT INTO `bychat_cloud_api_connection_teams` (`connectionId`, `teamId`)
SELECT c.`id`, c.`defaultTeamId` FROM `bychat_cloud_api_connections` c
 WHERE c.`defaultTeamId` IS NOT NULL;
