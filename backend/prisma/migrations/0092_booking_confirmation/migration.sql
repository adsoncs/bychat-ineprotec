-- Confirmação do lead no agendamento (status scheduled→confirmed).
-- confirmRequestedAt: quando o pedido de confirmação (HSM) foi enviado (escopo do auto-cancelamento 3h antes).
-- confirmedAt: quando o lead confirmou (clique no botão / resposta afirmativa).
ALTER TABLE `bychat_bookings`
  ADD COLUMN `confirmRequestedAt` DATETIME(3) NULL,
  ADD COLUMN `confirmedAt` DATETIME(3) NULL;
