-- Integração Moodle: acesso do aluno por inscrição do portal (libera com
-- pagamento confirmado + contrato aceito; suspensão só pelo agente).
CREATE TABLE `bychat_moodle_acessos` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `registrationId` INTEGER NOT NULL,
  `leadId` INTEGER NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'PENDENTE',
  `origem` VARCHAR(20) NOT NULL DEFAULT 'automatico',
  `moodleUserId` INTEGER NULL,
  `username` VARCHAR(100) NULL,
  `moodleCourseId` INTEGER NULL,
  `cursoNome` VARCHAR(255) NULL,
  `cursoEscolhido` BOOLEAN NOT NULL DEFAULT false,
  `usuarioCriado` BOOLEAN NOT NULL DEFAULT false,
  `cursosAnteriores` JSON NULL,
  `tentativas` INTEGER NOT NULL DEFAULT 0,
  `proximaTentativaEm` DATETIME(3) NULL,
  `ultimoErro` TEXT NULL,
  `liberadoEm` DATETIME(3) NULL,
  `liberadoPorId` INTEGER NULL,
  `suspensoEm` DATETIME(3) NULL,
  `suspensoPorId` INTEGER NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `bychat_moodle_acessos_registrationId_key`(`registrationId`),
  INDEX `bychat_moodle_acessos_status_proximaTentativaEm_idx`(`status`, `proximaTentativaEm`),
  INDEX `bychat_moodle_acessos_leadId_idx`(`leadId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
