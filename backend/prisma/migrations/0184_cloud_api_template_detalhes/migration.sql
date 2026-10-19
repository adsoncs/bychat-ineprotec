-- Modelos da Cloud API: o que a Meta informa além de nome/categoria/status.
-- A Meta NÃO devolve data de criação; `metaUpdatedAt` (last_updated_time) é a
-- última edição lá, e é o que limita a data de criação de um modelo que já
-- existia antes de a conta ser conectada aqui.
ALTER TABLE `bychat_cloud_api_templates`
  ADD COLUMN `metaUpdatedAt` DATETIME(3) NULL,
  ADD COLUMN `qualityScoreAt` DATETIME(3) NULL,
  ADD COLUMN `parameterFormat` VARCHAR(20) NULL,
  ADD COLUMN `previousCategory` VARCHAR(30) NULL,
  ADD COLUMN `subCategory` VARCHAR(40) NULL,
  ADD COLUMN `messageSendTtlSeconds` INTEGER NULL,
  ADD COLUMN `libraryTemplateName` VARCHAR(191) NULL;

-- Uso por modelo na lista (enviadas/entregues/lidas): agrupa o log pelo nome.
CREATE INDEX `bychat_cloud_api_message_logs_templateName_idx` ON `bychat_cloud_api_message_logs`(`templateName`);
