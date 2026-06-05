-- Chatbot determinístico ("scripted"): roda a jornada de um formulário vinculado.
--   mode   → 'ai' (motor LLM + scoring, padrão) | 'scripted' (jornada do form)
--   formId → form de origem das perguntas/qualificação quando mode='scripted'
ALTER TABLE `bychat_chatbots`
  ADD COLUMN `mode` VARCHAR(20) NOT NULL DEFAULT 'ai',
  ADD COLUMN `formId` INT NULL,
  ADD INDEX `bychat_chatbots_formId_idx` (`formId`),
  ADD CONSTRAINT `bychat_chatbots_formId_fkey` FOREIGN KEY (`formId`) REFERENCES `bychat_forms`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
