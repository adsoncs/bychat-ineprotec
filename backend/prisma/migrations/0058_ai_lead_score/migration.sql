-- Lead Score preditivo por IA.
-- Adiciona em bychat_leads o score (0-100) calculado por IA na entrada do
-- lead e refinado pós-enriquecimento, com rótulo (hot/warm/cold) e o
-- rationale/sinais em JSON. Índice em aiScore para filtro/ordenação.

ALTER TABLE `bychat_leads`
  ADD COLUMN `aiScore`       INT          NULL,
  ADD COLUMN `aiScoreLabel`  VARCHAR(10)  NULL,
  ADD COLUMN `aiScoreReason` JSON         NULL,
  ADD COLUMN `aiScoredAt`    DATETIME(3)  NULL;

CREATE INDEX `bychat_leads_aiScore_idx` ON `bychat_leads` (`aiScore`);
