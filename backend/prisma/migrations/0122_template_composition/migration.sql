-- Composição da mensagem nos modelos comuns: cabeçalho, rodapé e opções.
-- As opções viram lista numerada no envio; botão nativo é exclusivo da Cloud API.
ALTER TABLE `bychat_message_templates`
  ADD COLUMN `header` VARCHAR(120) NULL,
  ADD COLUMN `footer` VARCHAR(120) NULL,
  ADD COLUMN `options` JSON NULL;
