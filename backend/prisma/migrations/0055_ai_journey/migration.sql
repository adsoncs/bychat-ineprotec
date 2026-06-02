-- Fase 9 — Jornada Automática por IA.
-- 1) Adiciona campos de configuração no Funnel.
-- 2) Cria tabela de sugestões de etapa (auto-aplicadas ou pendentes).

ALTER TABLE `bychat_funnels`
  ADD COLUMN `aiStageEnabled`   BOOLEAN  NOT NULL DEFAULT FALSE,
  ADD COLUMN `aiStageAutoApply` BOOLEAN  NOT NULL DEFAULT FALSE,
  ADD COLUMN `aiStageThreshold` SMALLINT NOT NULL DEFAULT 80,
  ADD COLUMN `aiStagePrompt`    TEXT     NULL;

CREATE TABLE `bychat_lead_stage_suggestions` (
  `id`                INT          NOT NULL AUTO_INCREMENT,
  `leadId`            INT          NOT NULL,
  `funnelId`          INT          NOT NULL,
  `fromStageKey`      VARCHAR(50)  NULL,
  `suggestedStageKey` VARCHAR(50)  NOT NULL,
  `confidence`        SMALLINT     NOT NULL,
  `reasoning`         TEXT         NULL,
  `modelUsed`         VARCHAR(50)  NULL,
  `status`            VARCHAR(20)  NOT NULL DEFAULT 'pending',
  `appliedAt`         DATETIME(3)  NULL,
  `decidedById`       INT          NULL,
  `decidedAt`         DATETIME(3)  NULL,
  `decisionNote`      TEXT         NULL,
  `createdAt`         DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `idx_lead_status` (`leadId`, `status`),
  INDEX `idx_funnel_status_created` (`funnelId`, `status`, `createdAt`),
  INDEX `idx_status` (`status`),
  CONSTRAINT `fk_lss_lead`   FOREIGN KEY (`leadId`)   REFERENCES `bychat_leads`   (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_lss_funnel` FOREIGN KEY (`funnelId`) REFERENCES `bychat_funnels` (`id`) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;
