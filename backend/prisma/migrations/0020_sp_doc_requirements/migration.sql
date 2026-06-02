-- Override por SelectionProcess da matriz de documentos exigidos.
-- Quando SP.useCustomDocuments = false (default), painel do candidato herda
-- requirements do EntryMode. Quando true, usa requirements desta tabela.

ALTER TABLE `bychat_edu_selection_processes`
  ADD COLUMN `useCustomDocuments` TINYINT(1) NOT NULL DEFAULT 0;

CREATE TABLE `bychat_edu_sp_doc_requirements` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `selectionProcessId` INT NOT NULL,
  `documentTypeId` INT NOT NULL,
  `required` TINYINT(1) NOT NULL DEFAULT 1,
  `ordem` INT NOT NULL DEFAULT 0,
  `helpText` TEXT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`),
  UNIQUE KEY `bychat_edu_sp_doc_req_sp_dt_uniq` (`selectionProcessId`, `documentTypeId`),
  KEY `bychat_edu_sp_doc_req_sp_ordem_idx` (`selectionProcessId`, `ordem`),
  KEY `bychat_edu_sp_doc_req_dt_fk` (`documentTypeId`),

  CONSTRAINT `bychat_edu_sp_doc_req_sp_fk` FOREIGN KEY (`selectionProcessId`)
    REFERENCES `bychat_edu_selection_processes`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `bychat_edu_sp_doc_req_dt_fk_c` FOREIGN KEY (`documentTypeId`)
    REFERENCES `bychat_edu_document_types`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
