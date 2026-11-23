-- Documentos físicos (entregas em papel que a secretaria confere) e dados internos da oferta.

-- O que cada modo de ingresso pede em papel. `condicao` = { campo, valores[] } sobre o
-- formulário da inscrição (ex.: { campo: 'campusId', valores: ['4'] } = só polo ENSA).
CREATE TABLE `bychat_edu_entry_mode_physical_docs` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `entryModeId` INT NOT NULL,
  `nome` VARCHAR(191) NOT NULL,
  `ordem` INT NOT NULL DEFAULT 0,
  `condicao` JSON NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  INDEX `bychat_edu_entry_mode_physical_docs_entryModeId_idx`(`entryModeId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Recebimento de cada documento físico por inscrição.
CREATE TABLE `bychat_enrollment_physical_docs` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `registrationId` INT NOT NULL,
  `requisitoId` INT NOT NULL,
  `recebidoEm` DATETIME(3) NOT NULL,
  `recebidoPorId` INT NULL,
  `recebidoPorNome` VARCHAR(191) NULL,
  `observacao` TEXT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `bychat_enrollment_physical_docs_registrationId_requisitoId_key`(`registrationId`, `requisitoId`),
  INDEX `bychat_enrollment_physical_docs_requisitoId_idx`(`requisitoId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Dados internos da oferta (nunca vão ao portal, à IA nem ao contrato): prazo de conclusão.
CREATE TABLE `bychat_edu_offering_internos` (
  `offeringId` INT NOT NULL,
  `prazoConclusao` VARCHAR(200) NULL,
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`offeringId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
