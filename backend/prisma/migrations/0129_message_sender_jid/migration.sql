-- `participant` da mensagem em conversa de grupo.
--
-- Para reagir ou apagar a mensagem de OUTRA pessoa dentro de um grupo, o
-- WhatsApp exige saber quem a enviou — o id sozinho não identifica a mensagem
-- ali dentro. Em conversa individual o campo fica nulo.

ALTER TABLE `bychat_messages`
  ADD COLUMN `senderJid` VARCHAR(100) NULL;
