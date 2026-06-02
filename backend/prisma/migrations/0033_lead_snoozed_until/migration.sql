-- Snooze: adiar atendimento de um lead até uma hora futura.
-- snoozedUntil = NULL → ativo (lista normalmente).
-- snoozedUntil > NOW() → adormecido (oculto da inbox/raw, aparece na bucket "Aguardando").
-- snoozedUntil <= NOW() → snooze expirou; lead volta automaticamente à inbox.
--
-- O filtro é lazy: nenhuma cron job re-publica o lead. As listas comparam
-- contra NOW() na query, e o operador limpa explicitamente via /unsnooze
-- (ou implicitamente quando o cliente envia mensagem nova — ensureConversationOpen).

ALTER TABLE `bychat_leads`
  ADD COLUMN `snoozedUntil` DATETIME(3) NULL;

CREATE INDEX `bychat_leads_snoozedUntil_idx` ON `bychat_leads` (`snoozedUntil`);
