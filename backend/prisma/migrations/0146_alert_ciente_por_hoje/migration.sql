-- "Tirar da minha caixa" era PARA SEMPRE — e ninguém sabia.
--
-- `dismissedAt` sumia com o alerta da caixa daquela pessoa e nada o trazia de
-- volta: `reconciliarDestinatarios` recria destinatário que falta, mas nunca
-- limpou o descarte. Resultado: uma pessoa enterrava um crítico para si, em
-- silêncio, e a condição podia seguir de pé por meses sem que ela visse de
-- novo. Pior, o alerta que resolvia e REABRIA também não voltava.
--
-- No lugar entra um PRAZO. "Ciente por hoje" tira da caixa agora e devolve na
-- próxima varredura depois do prazo, se o problema persistir. Não mente
-- dizendo que resolveu, e não esconde para sempre.
--
-- Os descartes que já existem viram prazos VENCIDOS (mesma data): esses
-- alertas voltam para a caixa de quem os descartou, que é justamente o
-- conserto. São poucos — 1 a 23 por instalação na medição de 04/09.
ALTER TABLE `bychat_alert_recipients`
  ADD COLUMN `snoozedUntil` DATETIME(3) NULL;

UPDATE `bychat_alert_recipients`
   SET `snoozedUntil` = `dismissedAt`
 WHERE `dismissedAt` IS NOT NULL;

-- O índice da caixa passa a considerar o prazo: a consulta do sino filtra por
-- usuário, leitura e adiamento a cada abertura da gaveta.
CREATE INDEX `bychat_alert_recipients_userId_snoozedUntil_idx`
  ON `bychat_alert_recipients`(`userId`, `snoozedUntil`);

ALTER TABLE `bychat_alert_recipients`
  DROP COLUMN `dismissedAt`;
