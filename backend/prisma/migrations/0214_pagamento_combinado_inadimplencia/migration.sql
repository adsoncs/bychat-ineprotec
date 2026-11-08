-- Pagamento combinado e inadimplência (06/11/2026).
CREATE TABLE `bychat_enrollment_titulos` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `registrationId` INTEGER NOT NULL,
  `origem` VARCHAR(12) NOT NULL DEFAULT 'combinado',
  `acordoId` INTEGER NULL,
  `ordem` INTEGER NOT NULL,
  `meio` VARCHAR(20) NOT NULL,
  `parcelasCartao` INTEGER NOT NULL DEFAULT 1,
  `valorCentavos` INTEGER NOT NULL,
  `valorPagoCentavos` INTEGER NOT NULL DEFAULT 0,
  `vencimento` VARCHAR(10) NOT NULL,
  `status` VARCHAR(14) NOT NULL DEFAULT 'prevista',
  `provider` VARCHAR(20) NULL,
  `externalId` VARCHAR(191) NULL,
  `installmentId` VARCHAR(191) NULL,
  `invoiceUrl` TEXT NULL,
  `boletoPdfUrl` TEXT NULL,
  `boletoLinha` VARCHAR(60) NULL,
  `pixCopiaCola` TEXT NULL,
  `descontoPct` DECIMAL(5, 2) NULL,
  `baixaManual` TEXT NULL,
  `lastError` TEXT NULL,
  `paidAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  INDEX `bychat_enrollment_titulos_registrationId_idx` (`registrationId`),
  INDEX `bychat_enrollment_titulos_status_vencimento_idx` (`status`, `vencimento`),
  INDEX `bychat_enrollment_titulos_externalId_idx` (`externalId`),
  INDEX `bychat_enrollment_titulos_acordoId_idx` (`acordoId`),
  PRIMARY KEY (`id`),
  CONSTRAINT `bychat_enrollment_titulos_registrationId_fkey` FOREIGN KEY (`registrationId`) REFERENCES `bychat_enrollment_registrations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `bychat_enrollment_acordos` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `registrationId` INTEGER NOT NULL,
  `leadId` INTEGER NULL,
  `valorOriginalCentavos` INTEGER NOT NULL,
  `encargosCentavos` INTEGER NOT NULL DEFAULT 0,
  `descontoCentavos` INTEGER NOT NULL DEFAULT 0,
  `valorTotalCentavos` INTEGER NOT NULL,
  `entradaCentavos` INTEGER NOT NULL DEFAULT 0,
  `numParcelas` INTEGER NOT NULL,
  `status` VARCHAR(12) NOT NULL DEFAULT 'ATIVO',
  `itens` JSON NOT NULL,
  `observacao` TEXT NULL,
  `criadoPorUserId` INTEGER NULL,
  `criadoPorNome` VARCHAR(191) NULL,
  `canceladoEm` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  INDEX `bychat_enrollment_acordos_registrationId_idx` (`registrationId`),
  INDEX `bychat_enrollment_acordos_leadId_idx` (`leadId`),
  INDEX `bychat_enrollment_acordos_status_idx` (`status`),
  PRIMARY KEY (`id`),
  CONSTRAINT `bychat_enrollment_acordos_registrationId_fkey` FOREIGN KEY (`registrationId`) REFERENCES `bychat_enrollment_registrations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `bychat_cobranca_contatos` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `leadId` INTEGER NOT NULL,
  `canal` VARCHAR(20) NOT NULL,
  `resultado` VARCHAR(30) NOT NULL,
  `promessaPara` VARCHAR(10) NULL,
  `nota` TEXT NULL,
  `userId` INTEGER NULL,
  `userNome` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `bychat_cobranca_contatos_leadId_createdAt_idx` (`leadId`, `createdAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- No motor de papéis uma tela nova nasce vazia, até para administrador.
INSERT INTO `bychat_papel_capacidades` (`papelId`, `capacidade`, `separacao`)
SELECT p.`id`, t.`cap`, false
FROM `bychat_papeis` p
JOIN (
  SELECT 'edu_inadimplencia.view' AS `cap`
  UNION ALL SELECT 'edu_inadimplencia.edit'
) t
WHERE p.`papelBase` IN ('ADMIN', 'SUPERADMIN')
  AND NOT EXISTS (
    SELECT 1 FROM `bychat_papel_capacidades` x
    WHERE x.`papelId` = p.`id` AND x.`capacidade` = t.`cap`
  );
