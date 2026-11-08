-- Alterar forma de pagamento (06/11/2026).
CREATE TABLE `bychat_enrollment_trocas` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `registrationId` INTEGER NOT NULL,
  `leadId` INTEGER NULL,
  `status` VARCHAR(12) NOT NULL DEFAULT 'PENDENTE',
  `saldoCentavos` INTEGER NOT NULL,
  `novoTotalCentavos` INTEGER NOT NULL,
  `motivo` TEXT NOT NULL,
  `antes` JSON NOT NULL,
  `depois` JSON NOT NULL,
  `expiraEm` VARCHAR(10) NULL,
  `criadoPorUserId` INTEGER NULL,
  `criadoPorNome` VARCHAR(191) NULL,
  `encerradaEm` DATETIME(3) NULL,
  `notaEncerramento` TEXT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  INDEX `bychat_enrollment_trocas_registrationId_idx` (`registrationId`),
  INDEX `bychat_enrollment_trocas_status_expiraEm_idx` (`status`, `expiraEm`),
  PRIMARY KEY (`id`),
  CONSTRAINT `bychat_enrollment_trocas_registrationId_fkey` FOREIGN KEY (`registrationId`) REFERENCES `bychat_enrollment_registrations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `bychat_enrollment_titulos`
  ADD COLUMN `trocaId` INTEGER NULL,
  ADD COLUMN `conferirEm` DATETIME(3) NULL,
  ADD COLUMN `conferidoEm` DATETIME(3) NULL,
  ADD COLUMN `conferidoNota` TEXT NULL,
  ADD INDEX `bychat_enrollment_titulos_trocaId_idx` (`trocaId`),
  ADD INDEX `bychat_enrollment_titulos_conferirEm_idx` (`conferirEm`);

-- No motor de papéis uma tela nova nasce vazia, até para administrador.
INSERT INTO `bychat_papel_capacidades` (`papelId`, `capacidade`, `separacao`)
SELECT p.`id`, t.`cap`, false
FROM `bychat_papeis` p
JOIN (
  SELECT 'edu_alterar_pagamento.view' AS `cap`
  UNION ALL SELECT 'edu_alterar_pagamento.edit'
) t
WHERE p.`papelBase` IN ('ADMIN', 'SUPERADMIN')
  AND NOT EXISTS (
    SELECT 1 FROM `bychat_papel_capacidades` x
    WHERE x.`papelId` = p.`id` AND x.`capacidade` = t.`cap`
  );
