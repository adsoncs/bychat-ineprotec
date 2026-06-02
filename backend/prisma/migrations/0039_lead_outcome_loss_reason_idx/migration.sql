-- 0039_lead_outcome_loss_reason_idx
-- Fase 23.1: index composto para queries de relatório agregado por objeção.

CREATE INDEX `bychat_leads_outcome_lostReasonId_outcomeAt_idx`
  ON `bychat_leads` (`outcome`, `lostReasonId`, `outcomeAt`);
