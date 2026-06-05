-- Mensagens editáveis do chatbot scripted + número de WhatsApp do operador p/ avisos.
--   bychat_chatbots.scriptedMessages → overrides por chave das mensagens interativas
--   bychat_users.notifyWhatsapp      → número que recebe avisos internos (ex.: novo lead)
ALTER TABLE `bychat_chatbots`
  ADD COLUMN `scriptedMessages` JSON NULL;
ALTER TABLE `bychat_users`
  ADD COLUMN `notifyWhatsapp` VARCHAR(30) NULL;
