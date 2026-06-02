-- 0041_lead_stage_movement
-- Histórico append-only de transições de stage/funil do lead.
-- Alimenta o Relatório de Funil (volume por etapa, taxa de conversão por
-- período, custo por etapa, drill-down). Cada chamada do helper
-- recordLeadStageMovement insere um registro novo; quando from === to o
-- helper faz no-op e nada é gravado.
--
-- Movimento inicial (criação do lead já em uma stage) registra com
-- fromFunnelId=NULL, fromStageKey=NULL.

CREATE TABLE `bychat_lead_stage_movements` (
  `id`            INT NOT NULL AUTO_INCREMENT,
  `leadId`        INT NOT NULL,

  `fromFunnelId`  INT NULL,
  `toFunnelId`    INT NULL,
  `fromStageKey`  VARCHAR(50) NULL,
  `toStageKey`    VARCHAR(50) NULL,

  `movedAt`       DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `movedByUserId` INT NULL,

  `source`        VARCHAR(30) NULL,
  `reason`        VARCHAR(255) NULL,
  `metadata`      JSON NULL,

  `createdAt`     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`),
  INDEX `bychat_lead_stage_movements_leadId_movedAt_idx` (`leadId`, `movedAt`),
  INDEX `bychat_lead_stage_movements_toStageKey_movedAt_idx` (`toStageKey`, `movedAt`),
  INDEX `bychat_lead_stage_movements_toFunnelId_movedAt_idx` (`toFunnelId`, `movedAt`),
  INDEX `bychat_lead_stage_movements_movedAt_idx` (`movedAt`),

  CONSTRAINT `bychat_lead_stage_movements_leadId_fkey`
    FOREIGN KEY (`leadId`) REFERENCES `bychat_leads`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `bychat_lead_stage_movements_movedByUserId_fkey`
    FOREIGN KEY (`movedByUserId`) REFERENCES `bychat_users`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
