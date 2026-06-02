-- ═══════════════════════════════════════════════════════════════════
-- Modos de Ingresso (EntryMode) + Tipos de Documento (DocumentType)
-- F1.1 — Fundação da feature "Modos de Ingresso"
-- ═══════════════════════════════════════════════════════════════════

-- Catálogo de modos de ingresso (vestibular, ENEM, transferência, pós, extensão, etc.)
CREATE TABLE `bychat_edu_entry_modes` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `code` VARCHAR(40) NOT NULL,
  `name` VARCHAR(100) NOT NULL,
  `description` TEXT NULL,
  `icon` VARCHAR(10) NULL,
  `evaluationType` VARCHAR(30) NOT NULL DEFAULT 'docs',
  `requiresPayment` BOOLEAN NOT NULL DEFAULT FALSE,
  `requiresClassification` BOOLEAN NOT NULL DEFAULT FALSE,
  `defaultFormExtras` JSON NULL,
  `ordem` INT NOT NULL DEFAULT 0,
  `active` BOOLEAN NOT NULL DEFAULT TRUE,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `bychat_edu_entry_modes_code_uniq` (`code`),
  KEY `bychat_edu_entry_modes_code_idx` (`code`),
  KEY `bychat_edu_entry_modes_active_ordem_idx` (`active`, `ordem`)
) ENGINE=InnoDB;

-- Catálogo master de tipos de documento (RG, CPF, Histórico, Boletim ENEM, Diploma, etc.)
CREATE TABLE `bychat_edu_document_types` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `code` VARCHAR(40) NOT NULL,
  `name` VARCHAR(100) NOT NULL,
  `description` TEXT NULL,
  `category` VARCHAR(30) NOT NULL DEFAULT 'other',
  `aiAnalysisTemplate` VARCHAR(50) NULL,
  `ordem` INT NOT NULL DEFAULT 0,
  `active` BOOLEAN NOT NULL DEFAULT TRUE,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `bychat_edu_document_types_code_uniq` (`code`),
  KEY `bychat_edu_document_types_category_ordem_idx` (`category`, `ordem`)
) ENGINE=InnoDB;

-- Junção N×N: quais documentos cada modo exige
CREATE TABLE `bychat_edu_entry_mode_doc_requirements` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `entryModeId` INT NOT NULL,
  `documentTypeId` INT NOT NULL,
  `required` BOOLEAN NOT NULL DEFAULT TRUE,
  `ordem` INT NOT NULL DEFAULT 0,
  `helpText` TEXT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `bychat_edu_entry_mode_doc_req_uniq` (`entryModeId`, `documentTypeId`),
  KEY `bychat_edu_entry_mode_doc_req_mode_idx` (`entryModeId`, `ordem`),
  KEY `bychat_edu_entry_mode_doc_req_doc_idx` (`documentTypeId`),
  CONSTRAINT `bychat_edu_entry_mode_doc_req_mode_fk`
    FOREIGN KEY (`entryModeId`) REFERENCES `bychat_edu_entry_modes`(`id`) ON DELETE CASCADE,
  CONSTRAINT `bychat_edu_entry_mode_doc_req_doc_fk`
    FOREIGN KEY (`documentTypeId`) REFERENCES `bychat_edu_document_types`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Liga SelectionProcess a um EntryMode (nullable durante migração)
-- + campo notaCorte para regras de classificação (ENEM, provas futuras)
ALTER TABLE `bychat_edu_selection_processes`
  ADD COLUMN `entryModeId` INT NULL,
  ADD COLUMN `notaCorte` DOUBLE NULL,
  ADD INDEX `bychat_edu_selection_processes_entryModeId_idx` (`entryModeId`),
  ADD CONSTRAINT `bychat_edu_selection_processes_entry_mode_fk`
    FOREIGN KEY (`entryModeId`) REFERENCES `bychat_edu_entry_modes`(`id`) ON DELETE SET NULL;
