-- Templates de email do sistema (substituível pelo painel de Configurações > Emails do Sistema)
-- Cada template é identificado por uma `key` única que o código referencia.

CREATE TABLE `bychat_system_email_templates` (
  `id`           INT NOT NULL AUTO_INCREMENT,
  `key`          VARCHAR(80)  NOT NULL,
  `name`         VARCHAR(150) NOT NULL,
  `description`  TEXT NULL,
  `subject`      VARCHAR(255) NOT NULL,
  `htmlBody`     MEDIUMTEXT   NOT NULL,
  `enabled`      BOOLEAN      NOT NULL DEFAULT TRUE,
  `variables`    JSON         NULL,    -- lista informativa de variáveis disponíveis (ex: [{"name":"lead.nome","desc":"..."}])
  `category`     VARCHAR(40)  NOT NULL DEFAULT 'system',
  `updatedById`  INT          NULL,
  `createdAt`    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_key` (`key`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;
