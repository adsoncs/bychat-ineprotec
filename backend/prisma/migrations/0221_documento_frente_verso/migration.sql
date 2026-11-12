-- Documentos com frente e verso: o requisito pede dois arquivos e o documento
-- enviado guarda o verso ao lado da frente. O tipo só sugere o padrão.
ALTER TABLE `bychat_edu_document_types`
  ADD COLUMN `frenteVerso` BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE `bychat_edu_entry_mode_doc_requirements`
  ADD COLUMN `frenteVerso` BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE `bychat_edu_sp_doc_requirements`
  ADD COLUMN `frenteVerso` BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE `bychat_enrollment_documents`
  ADD COLUMN `versoFileUrl` TEXT NULL,
  ADD COLUMN `versoFileName` VARCHAR(191) NULL,
  ADD COLUMN `versoMimeType` VARCHAR(50) NULL,
  ADD COLUMN `versoSizeBytes` INTEGER NULL;

-- Sugestão de fábrica: documentos que costumam ter as duas faces.
UPDATE `bychat_edu_document_types` SET `frenteVerso` = true
  WHERE `code` IN ('rg', 'titulo_eleitor', 'reservista', 'cnh', 'rne', 'cie', 'rnm');
