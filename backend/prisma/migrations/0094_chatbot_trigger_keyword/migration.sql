-- Ativação do chatbot por palavra-chave (gate do fluxo).
ALTER TABLE `bychat_chatbots`
  ADD COLUMN `triggerMode` VARCHAR(20) NOT NULL DEFAULT 'always',
  ADD COLUMN `triggerKeywords` JSON NULL;
