-- Índice de consulta da importação de conversas do celular.
--
-- A tela de importar passou a mostrar, chat a chat, se ele já foi sincronizado
-- e quando. Isso significa cruzar a lista vinda do aparelho (centenas a
-- milhares de JIDs) com o histórico de jobs a cada abertura da tela — e o
-- enfileiramento também procura, pelo par (instância, JID), se já existe job em
-- aberto. Sem este índice, os dois viram varredura da tabela inteira.

CREATE INDEX `bychat_chat_import_jobs_instanceName_remoteJid_idx`
  ON `bychat_chat_import_jobs` (`instanceName`, `remoteJid`);
