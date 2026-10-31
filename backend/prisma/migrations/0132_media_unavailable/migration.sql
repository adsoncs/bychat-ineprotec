-- Mídia que o WhatsApp não entrega mais.
--
-- A mídia importada do aparelho vem sem arquivo e é baixada sob demanda. Só que
-- o WhatsApp expira o arquivo no CDN (a URL traz `oe=<validade>`): passado o
-- prazo, toda tentativa devolve "Failed to fetch stream" — e cada tentativa
-- custa ~5s contra a Evolution.
--
-- Sem registrar isso, a conversa ficava com um contador de pendências que nunca
-- baixava e um botão que gastava meio minuto para não trazer nada, toda vez.

ALTER TABLE `bychat_messages`
  ADD COLUMN `mediaUnavailableAt` DATETIME(3) NULL AFTER `mediaName`;
