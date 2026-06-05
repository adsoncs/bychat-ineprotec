-- Atendimento por IA após o roteiro encerrar (scripted): quando o lead já concluiu
-- ou foi desqualificado e volta a falar, a IA responde com contexto do desfecho.
ALTER TABLE `bychat_chatbots`
  ADD COLUMN `postChatAi` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `postChatPrompt` TEXT NULL;
