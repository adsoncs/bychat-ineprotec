-- Quem enxerga as conversas de cada número.
--
-- Até aqui a visibilidade era só do LEAD: quem tem o lead, ou o setor dele, vê
-- a conversa — não importa por qual número ela aconteceu. Ao conectar uma linha
-- PESSOAL ao painel, todo o histórico dela caiu na mesma vala: no kobogo foram
-- 11.195 mensagens de 210 contatos visíveis para a gerência inteira, porque os
-- leads ficaram sem dono num setor compartilhado.
--
-- Agora cada número declara se é aberto (`all`, o padrão — nada muda para quem
-- já usa) ou reservado (`restricted`), e nesse caso só quem estiver na lista de
-- observadores enxerga as conversas dele. Superadmin e o agente dono do número
-- entram sempre, sem precisar de linha na tabela.

ALTER TABLE `bychat_whatsapp_instances`
  ADD COLUMN `visibility` VARCHAR(12) NOT NULL DEFAULT 'all' AFTER `ownerUserId`;

ALTER TABLE `bychat_cloud_api_connections`
  ADD COLUMN `visibility` VARCHAR(12) NOT NULL DEFAULT 'all' AFTER `ownerUserId`;

CREATE TABLE `bychat_whatsapp_instance_viewers` (
  `id`         INT NOT NULL AUTO_INCREMENT,
  `instanceId` INT NOT NULL,
  `userId`     INT NOT NULL,
  `createdAt`  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `bychat_wa_instance_viewers_instanceId_userId_key` (`instanceId`, `userId`),
  KEY `bychat_wa_instance_viewers_userId_idx` (`userId`),
  CONSTRAINT `bychat_wa_instance_viewers_instanceId_fkey` FOREIGN KEY (`instanceId`) REFERENCES `bychat_whatsapp_instances` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `bychat_wa_instance_viewers_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `bychat_users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `bychat_cloud_api_connection_viewers` (
  `id`           INT NOT NULL AUTO_INCREMENT,
  `connectionId` INT NOT NULL,
  `userId`       INT NOT NULL,
  `createdAt`    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `bychat_cloud_conn_viewers_connectionId_userId_key` (`connectionId`, `userId`),
  KEY `bychat_cloud_conn_viewers_userId_idx` (`userId`),
  CONSTRAINT `bychat_cloud_conn_viewers_connectionId_fkey` FOREIGN KEY (`connectionId`) REFERENCES `bychat_cloud_api_connections` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `bychat_cloud_conn_viewers_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `bychat_users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
