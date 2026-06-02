-- 0078 — Log de disparos WhatsApp Cloud API (painel de acompanhamento + custo)
-- Captura categoria/cobrança/status que a Meta envia no webhook de status
-- (statuses[].pricing e .conversation), antes descartados.

CREATE TABLE IF NOT EXISTS `bychat_cloud_api_message_logs` (
  `id`                   INT NOT NULL AUTO_INCREMENT,
  `cloudApiConnectionId` INT NULL,
  `leadId`               INT NULL,
  `wamid`                VARCHAR(191) NOT NULL,
  `direction`            VARCHAR(12) NOT NULL DEFAULT 'outbound',
  `category`             VARCHAR(30) NULL,
  `pricingModel`         VARCHAR(24) NULL,
  `billable`             TINYINT(1) NOT NULL DEFAULT 0,
  `status`               VARCHAR(20) NOT NULL DEFAULT 'sent',
  `templateName`         VARCHAR(191) NULL,
  `errorCode`            VARCHAR(20) NULL,
  `errorTitle`           VARCHAR(255) NULL,
  `createdAt`            DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`            DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `bychat_cloud_api_message_logs_wamid_key` (`wamid`),
  KEY `bychat_cloud_api_message_logs_cloudApiConnectionId_idx` (`cloudApiConnectionId`),
  KEY `bychat_cloud_api_message_logs_category_idx` (`category`),
  KEY `bychat_cloud_api_message_logs_status_idx` (`status`),
  KEY `bychat_cloud_api_message_logs_createdAt_idx` (`createdAt`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
