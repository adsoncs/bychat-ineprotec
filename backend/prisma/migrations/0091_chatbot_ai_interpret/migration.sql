-- Interpretação por IA das respostas no chatbot scripted: quando ligado e a
-- resposta a um select não casa de forma determinística, a IA mapeia o texto
-- livre para a opção mais próxima (ou 'unclear' → reask). A IA só interpreta;
-- o roteamento de etapa continua determinístico.
ALTER TABLE `bychat_chatbots`
  ADD COLUMN `aiInterpret` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `interpretPrompt` TEXT NULL;
