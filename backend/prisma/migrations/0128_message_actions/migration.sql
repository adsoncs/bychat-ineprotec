-- Editar, apagar (para mim / para todos), encaminhar e reagir no Conversas.
--
-- `isDeleted` já existia e passa a significar SÓ "apagar para mim" (some da
-- nossa tela; o contato continua com a mensagem). O apagar para todos, que sai
-- para o WhatsApp do contato, é o `deletedForAll`.

ALTER TABLE `bychat_messages`
  ADD COLUMN `editedAt` DATETIME(3) NULL,
  ADD COLUMN `originalBody` LONGTEXT NULL,
  ADD COLUMN `deletedForAll` TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN `deletedAt` DATETIME(3) NULL,
  ADD COLUMN `deletedByUserId` INT NULL,
  ADD COLUMN `isForwarded` TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN `reactions` JSON NULL;
