-- Transferência de curso: inscrição paga que muda de curso.
CREATE TABLE `bychat_enrollment_transferencias` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `deRegistrationId` INTEGER NOT NULL,
  `paraRegistrationId` INTEGER NOT NULL,
  `leadId` INTEGER NULL,
  `recebidoCentavos` INTEGER NOT NULL,
  `creditoCentavos` INTEGER NOT NULL,
  `entradaCentavos` INTEGER NOT NULL DEFAULT 0,
  `parcelasQuitadas` INTEGER NOT NULL DEFAULT 0,
  `sobraCentavos` INTEGER NOT NULL DEFAULT 0,
  `motivo` TEXT NOT NULL,
  `detalhes` JSON NOT NULL,
  `criadoPorUserId` INTEGER NULL,
  `criadoPorNome` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `bychat_enrollment_transferencias_deRegistrationId_idx`(`deRegistrationId`),
  INDEX `bychat_enrollment_transferencias_paraRegistrationId_idx`(`paraRegistrationId`),
  INDEX `bychat_enrollment_transferencias_leadId_idx`(`leadId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- No motor de papéis uma tela nova nasce vazia, até para administrador.
INSERT INTO `bychat_papel_capacidades` (`papelId`, `capacidade`, `separacao`)
SELECT p.`id`, t.`cap`, false
FROM `bychat_papeis` p
JOIN (
  SELECT 'edu_transferir_curso.view' AS `cap`
  UNION ALL SELECT 'edu_transferir_curso.edit'
) t
WHERE p.`papelBase` IN ('ADMIN', 'SUPERADMIN')
  AND NOT EXISTS (
    SELECT 1 FROM `bychat_papel_capacidades` x
    WHERE x.`papelId` = p.`id` AND x.`capacidade` = t.`cap`
  );
