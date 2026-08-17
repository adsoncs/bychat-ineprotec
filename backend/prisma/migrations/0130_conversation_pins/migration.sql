-- Conversas fixadas no topo da lista, POR OPERADOR.
--
-- Fixar é uma marcação de trabalho pessoal ("estou acompanhando esta hoje"),
-- não um atributo do lead: se valesse para todos, um operador reorganizaria a
-- fila dos colegas. Por isso a chave é (userId, leadId).

CREATE TABLE `bychat_conversation_pins` (
  `id`        INT NOT NULL AUTO_INCREMENT,
  `userId`    INT NOT NULL,
  `leadId`    INT NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `bychat_conversation_pins_userId_leadId_key` (`userId`, `leadId`),
  KEY `bychat_conversation_pins_userId_createdAt_idx` (`userId`, `createdAt`),
  CONSTRAINT `bychat_conversation_pins_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `bychat_users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `bychat_conversation_pins_leadId_fkey` FOREIGN KEY (`leadId`) REFERENCES `bychat_leads` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
