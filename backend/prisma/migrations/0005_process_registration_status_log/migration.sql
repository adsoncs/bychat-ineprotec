-- Histórico de mudanças de status de inscrições educacionais

CREATE TABLE `bychat_edu_process_registration_status_logs` (
  `id`             INT NOT NULL AUTO_INCREMENT,
  `registrationId` INT NOT NULL,
  `fromStatus`     VARCHAR(30) NULL,
  `toStatus`       VARCHAR(30) NOT NULL,
  `actorId`        INT NULL,
  `actorName`      VARCHAR(191) NULL,
  `observacao`     TEXT NULL,
  `createdAt`      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `bychat_edu_prsl_reg_created_idx` (`registrationId`, `createdAt`),
  CONSTRAINT `bychat_edu_prsl_registrationId_fkey`
    FOREIGN KEY (`registrationId`)
    REFERENCES `bychat_edu_process_registrations`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
