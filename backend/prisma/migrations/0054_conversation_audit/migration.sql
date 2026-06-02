-- Auditoria automática de conversas por IA (Fase 9 — qualidade de atendimento).
-- Roda assíncrono em background; cada lead pode acumular múltiplas auditorias
-- ao longo do tempo para visualizar evolução do score.

CREATE TABLE `bychat_conversation_audits` (
  `id`                  INT          NOT NULL AUTO_INCREMENT,
  `leadId`              INT          NOT NULL,
  `operatorId`          INT          NULL,
  `operatorName`        VARCHAR(100) NULL,
  `periodFrom`          DATETIME(3)  NULL,
  `periodTo`            DATETIME(3)  NULL,
  `messageCount`        INT          NOT NULL DEFAULT 0,
  `score`               SMALLINT     NULL,
  `tone`                VARCHAR(20)  NULL,
  `responseTimeAvgSec`  INT          NULL,
  `responseTimeP95Sec`  INT          NULL,
  `strengths`           JSON         NULL,
  `weaknesses`          JSON         NULL,
  `missedOpportunities` JSON         NULL,
  `scriptAdherence`     SMALLINT     NULL,
  `summary`             TEXT         NULL,
  `modelUsed`           VARCHAR(50)  NULL,
  `status`              VARCHAR(20)  NOT NULL DEFAULT 'done',
  `errorMessage`        TEXT         NULL,
  `triggeredBy`         VARCHAR(20)  NULL,
  `triggeredById`       INT          NULL,
  `createdAt`           DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `idx_lead_created` (`leadId`, `createdAt`),
  INDEX `idx_operator_created` (`operatorId`, `createdAt`),
  INDEX `idx_score` (`score`),
  CONSTRAINT `fk_conv_audit_lead`
    FOREIGN KEY (`leadId`)
    REFERENCES `bychat_leads` (`id`)
    ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;
