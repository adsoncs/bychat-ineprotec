-- Remove o "Período liberado" do tipo de reunião. A restrição de horários
-- volta a depender exclusivamente da disponibilidade da agenda (regras +
-- exceções), como era antes da migration 0080.
ALTER TABLE `bychat_meeting_types`
  DROP COLUMN `availabilityPeriod`;
