-- Integração SEI (ERP acadêmico): envios, log de chamadas e de-para.
CREATE TABLE `bychat_sei_envios` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `registrationId` INTEGER NOT NULL,
  `matriculaId` INTEGER NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'PENDENTE',
  `etapa` VARCHAR(20) NOT NULL DEFAULT 'pessoa',
  `origem` VARCHAR(20) NOT NULL DEFAULT 'manual',
  `codigoPessoa` VARCHAR(40) NULL,
  `matricula` VARCHAR(40) NULL,
  `codigoMatriculaPeriodo` VARCHAR(40) NULL,
  `dadosMatricula` JSON NULL,
  `simulacaoPlano` JSON NULL,
  `documentosEnviados` JSON NULL,
  `avisos` JSON NULL,
  `tentativas` INTEGER NOT NULL DEFAULT 0,
  `proximaTentativaEm` DATETIME(3) NULL,
  `ultimoErro` TEXT NULL,
  `criadoPorId` INTEGER NULL,
  `concluidoEm` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `bychat_sei_envios_registrationId_key`(`registrationId`),
  INDEX `bychat_sei_envios_status_proximaTentativaEm_idx`(`status`, `proximaTentativaEm`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `bychat_sei_chamadas` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `envioId` INTEGER NULL,
  `servico` VARCHAR(60) NOT NULL,
  `metodo` VARCHAR(8) NOT NULL,
  `caminho` VARCHAR(500) NOT NULL,
  `httpStatus` INTEGER NULL,
  `duracaoMs` INTEGER NULL,
  `ok` BOOLEAN NOT NULL DEFAULT false,
  `request` JSON NULL,
  `response` JSON NULL,
  `erro` TEXT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `bychat_sei_chamadas_envioId_idx`(`envioId`),
  INDEX `bychat_sei_chamadas_createdAt_idx`(`createdAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `bychat_sei_mapeamentos` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `tipo` VARCHAR(20) NOT NULL,
  `localId` INTEGER NOT NULL,
  `dados` JSON NOT NULL,
  `updatedAt` DATETIME(3) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `bychat_sei_mapeamentos_tipo_localId_key`(`tipo`, `localId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
