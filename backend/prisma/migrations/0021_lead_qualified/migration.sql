-- Lead qualification: separa "lead real" de "apenas conversa".
-- qualifiedAt null = só conversa (ex: WhatsApp ad-hoc sem origem qualificada).
-- qualifiedAt preenchido = lead qualificado (form, portal, ads, manual, chatbot completo).

ALTER TABLE `bychat_leads`
  ADD COLUMN `qualifiedAt` DATETIME(3) NULL,
  ADD COLUMN `qualificationSource` VARCHAR(40) NULL;

CREATE INDEX `bychat_leads_qualifiedAt_idx` ON `bychat_leads`(`qualifiedAt`);
