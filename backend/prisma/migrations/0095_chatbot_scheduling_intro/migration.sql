-- Mensagem de boas-vindas ao iniciar o agendamento (configurável por chatbot).
ALTER TABLE `bychat_chatbots` ADD COLUMN `schedulingIntro` TEXT NULL;
