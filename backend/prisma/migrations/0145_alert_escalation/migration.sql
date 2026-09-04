-- Escalonamento unitário: o crítico que ninguém viu.
--
-- Duas colunas em vez de reaproveitar `notifiedAt`/`notifyCount`, que já
-- existem, porque elas passaram a significar outra coisa: o resumo diário
-- carimba TODOS os alertas abertos a cada envio. Contar por ali faria o
-- escalonamento achar que já avisou de um crítico que nasceu ontem só porque o
-- resumo da manhã o incluiu numa lista — e, do outro lado, o teto de dois
-- avisos estouraria em dois dias de resumo, calando justamente o que precisava
-- interromper alguém.
--
-- São coisas diferentes e por isso contam separado:
--   notifiedAt / notifyCount   — o alerta apareceu num RESUMO (rotina, coletivo)
--   escalatedAt / escalationCount — o alerta INTERROMPEU alguém (exceção, unitário)
ALTER TABLE `bychat_alerts`
  ADD COLUMN `escalatedAt`     DATETIME(3) NULL,
  ADD COLUMN `escalationCount` INTEGER     NOT NULL DEFAULT 0;

-- O vigilante procura crítico aberto e nunca escalado. Sem índice, é varredura
-- de tabela a cada volta do relógio.
CREATE INDEX `bychat_alerts_status_severity_escalatedAt_idx`
  ON `bychat_alerts`(`status`, `severity`, `escalatedAt`);
