-- Índice na coluna que todo webhook de WhatsApp consulta para resolver o lead.
-- Sem ele a busca fazia varredura completa da tabela (EXPLAIN: type=ALL, key=NULL),
-- o que só não doía porque as bases ainda são pequenas — há tenant com 109 mil leads.
CREATE INDEX `bychat_leads_whatsapp_idx` ON `bychat_leads`(`whatsapp`);

-- Reservas ficavam apontando para leads já apagados (25 no beyond), inflando
-- relatório de agendamento com reunião de gente que não existe mais.
-- Os ponteiros quebrados são zerados ANTES da FK, senão ela não sobe.
UPDATE `bychat_bookings` b
  LEFT JOIN `bychat_leads` l ON l.id = b.leadId
  SET b.leadId = NULL
  WHERE b.leadId IS NOT NULL AND l.id IS NULL;

-- SET NULL (e não CASCADE): apagar o lead não deve apagar o histórico da agenda.
ALTER TABLE `bychat_bookings`
  ADD CONSTRAINT `bychat_bookings_leadId_fkey`
  FOREIGN KEY (`leadId`) REFERENCES `bychat_leads`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
