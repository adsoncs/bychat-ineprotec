-- Inscrição assistida (03/11/2026): o atendente faz a inscrição/matrícula pelo
-- portal com o candidato, com rastreio de quem fez cada passo.
--   origem            : portal | assistida | formulario | link | administrativa (NULL = antes disto)
--   criadoPorUserId   : quem abriu a inscrição (só quando foi a equipe)
--   atendidoPorUserId : atendente que conduziu (última sessão assistida)
-- + histórico por inscrição (bychat_enrollment_registration_events).
-- Idempotente.

SET @tem := (SELECT COUNT(*) FROM information_schema.columns
             WHERE table_schema = DATABASE() AND table_name = 'bychat_enrollment_registrations' AND column_name = 'origem');
SET @sql := IF(@tem = 0, 'ALTER TABLE `bychat_enrollment_registrations` ADD COLUMN `origem` VARCHAR(30) NULL, ADD COLUMN `criadoPorUserId` INT NULL, ADD COLUMN `atendidoPorUserId` INT NULL, ADD INDEX `bychat_enrollment_registrations_atendidoPorUserId_idx` (`atendidoPorUserId`), ADD INDEX `bychat_enrollment_registrations_origem_idx` (`origem`)', 'SELECT 1');
PREPARE passo FROM @sql;
EXECUTE passo;
DEALLOCATE PREPARE passo;

CREATE TABLE IF NOT EXISTS `bychat_enrollment_registration_events` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `registrationId` INT NOT NULL,
  `etapa` VARCHAR(30) NOT NULL,
  `acao` VARCHAR(60) NOT NULL,
  `ator` VARCHAR(20) NOT NULL,
  `userId` INT NULL,
  `userName` VARCHAR(191) NULL,
  `ip` VARCHAR(45) NULL,
  `userAgent` VARCHAR(500) NULL,
  `dados` JSON NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `bychat_enrollment_registration_events_registrationId_idx` (`registrationId`),
  INDEX `bychat_enrollment_registration_events_userId_idx` (`userId`),
  CONSTRAINT `bychat_enrollment_registration_events_registrationId_fkey` FOREIGN KEY (`registrationId`) REFERENCES `bychat_enrollment_registrations` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
