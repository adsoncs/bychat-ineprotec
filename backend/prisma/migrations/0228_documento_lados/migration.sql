-- Revisão por lado do documento frente e verso: cada face com status, motivo e quem revisou.
-- { "frente": { "status": "approved"|"rejected"|"pending", "nota": ..., "por": userId, "em": ISO },
--   "verso":  { ... } }. Só preenchido quando há verso; o `status` do documento segue sendo o geral.
ALTER TABLE `bychat_enrollment_documents` ADD COLUMN `lados` JSON NULL;
