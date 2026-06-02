-- Sales Engagement C1: priority score do lead (0-100, fit+intent+urgency).
-- Recalculado por cron 5min (C2) ou on-event. NULL = nunca calculado.
-- Index pra ordenar fila do operador (ASC desc por priorityScore).

ALTER TABLE `bychat_leads`
    ADD COLUMN `priorityScore` DOUBLE NULL,
    ADD COLUMN `priorityScoreAt` DATETIME(3) NULL;

CREATE INDEX `bychat_leads_priorityScore_idx` ON `bychat_leads`(`priorityScore`);
