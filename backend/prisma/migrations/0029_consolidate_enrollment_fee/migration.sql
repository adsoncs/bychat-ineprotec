-- Consolidação da Taxa de Inscrição numa única casa.
--
-- Antes: o valor da taxa podia ser configurado em 2 lugares concorrentes:
--   • SelectionProcess.taxaInscricao  (módulo Educacional, exibido no portal público)
--   • EnrollmentPortal.paymentAmount  (config do Portal, valor cobrado de fato no Asaas)
-- Mais um boolean redundante:
--   • EntryMode.requiresPayment       (badge cosmético, separado do EnrollmentPortal.requirePayment)
--
-- Depois: SelectionProcess.taxaInscricao é a ÚNICA fonte de verdade para o valor.
-- O Portal mantém só a config de COBRANÇA (requirePayment / provider / config / deadline).
-- EnrollmentRegistration.paymentAmount permanece — é snapshot histórico, não config.

-- ── Backfill antes do drop ──
-- Para cada portal com paymentAmount preenchido, copia o valor para os
-- selectionProcesses vinculados (via portal.selectionProcessIds JSON) que
-- estejam com taxaInscricao=NULL. Não sobrescreve valores já configurados.
UPDATE `bychat_edu_selection_processes` sp
JOIN `bychat_enrollment_portals` p
  ON JSON_CONTAINS(p.selectionProcessIds, CAST(sp.id AS JSON))
SET sp.taxaInscricao = p.paymentAmount
WHERE sp.taxaInscricao IS NULL
  AND p.paymentAmount IS NOT NULL;

-- ── Drop do valor duplicado no Portal ──
ALTER TABLE `bychat_enrollment_portals`
  DROP COLUMN `paymentAmount`;

-- ── Drop do boolean redundante no EntryMode ──
-- Quem decide cobrar é o portal (EnrollmentPortal.requirePayment); o EntryMode
-- é só categoria de avaliação (none/docs/enem/exam_*).
ALTER TABLE `bychat_edu_entry_modes`
  DROP COLUMN `requiresPayment`;
