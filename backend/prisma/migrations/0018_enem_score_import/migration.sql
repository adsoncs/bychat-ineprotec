-- ═══════════════════════════════════════════════════════════════════
-- F3.1 — EnemScoreImport: auditoria e classificação de notas ENEM
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE `bychat_edu_enem_score_imports` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `registrationId` INT NOT NULL,
  `documentId` INT NULL,

  `nome`      VARCHAR(191) NULL,
  `inscricao` VARCHAR(30) NULL,
  `ano`       INT NULL,
  `treineiro` BOOLEAN NOT NULL DEFAULT FALSE,

  `cienciasHumanas`  DOUBLE NULL,
  `cienciasNatureza` DOUBLE NULL,
  `linguagens`       DOUBLE NULL,
  `matematica`       DOUBLE NULL,
  `redacao`          DOUBLE NULL,

  `mediaSimples`   DOUBLE NULL,
  `mediaPonderada` DOUBLE NULL,

  `nomeBateComForm`      BOOLEAN NULL,
  `inscricaoBateComForm` BOOLEAN NULL,
  `anoBateComForm`       BOOLEAN NULL,

  `cutoffScore` DOUBLE NULL,
  `passed`      BOOLEAN NULL,

  `source`       VARCHAR(20) NOT NULL DEFAULT 'ai',
  `aiConfidence` DOUBLE NULL,
  `rawAnalysis`  JSON NULL,

  `validatedBy`    INT NULL,
  `validatedAt`    DATETIME(3) NULL,
  `validationNote` TEXT NULL,

  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  PRIMARY KEY (`id`),
  UNIQUE KEY `bychat_edu_enem_score_imports_documentId_uniq` (`documentId`),
  KEY `bychat_edu_enem_score_imports_registrationId_idx` (`registrationId`),
  KEY `bychat_edu_enem_score_imports_inscricao_idx` (`inscricao`),
  KEY `bychat_edu_enem_score_imports_ano_idx` (`ano`),
  KEY `bychat_edu_enem_score_imports_passed_idx` (`passed`),

  CONSTRAINT `bychat_edu_enem_score_imports_registration_fk`
    FOREIGN KEY (`registrationId`) REFERENCES `bychat_enrollment_registrations`(`id`) ON DELETE CASCADE,
  CONSTRAINT `bychat_edu_enem_score_imports_document_fk`
    FOREIGN KEY (`documentId`) REFERENCES `bychat_enrollment_documents`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB;
