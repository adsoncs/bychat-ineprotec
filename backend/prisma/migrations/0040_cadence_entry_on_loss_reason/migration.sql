-- 0040_cadence_entry_on_loss_reason
-- Fase 23.1: cadência pode auto-inscrever leads perdidos por objeção específica.

ALTER TABLE `bychat_sales_cadences`
  ADD COLUMN `entryOnLossReasonIds` JSON NULL;
