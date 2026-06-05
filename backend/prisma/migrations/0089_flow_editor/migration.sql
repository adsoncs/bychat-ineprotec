-- Editor visual do WhatsApp Flow: config editável (desacoplada do form) no CloudApiFlow.
--   cta/bodyText/screenTitle/fieldConfig. Vazio = defaults atuais. Aditivo.

ALTER TABLE `bychat_cloud_api_flows`
  ADD COLUMN `cta` VARCHAR(40) NULL,
  ADD COLUMN `bodyText` TEXT NULL,
  ADD COLUMN `screenTitle` VARCHAR(60) NULL,
  ADD COLUMN `fieldConfig` JSON NULL;
