-- Campo personalizado visível (e editável) no painel Informações da conversa.
-- Nasce desligado: nenhum tenant muda de comportamento até marcarem o checkbox
-- em Cadastros › Campos personalizados › Visibilidade.
ALTER TABLE `bychat_custom_fields`
  ADD COLUMN `showInConversation` BOOLEAN NOT NULL DEFAULT false;
