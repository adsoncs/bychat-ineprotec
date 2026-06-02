-- Persona/ICP builder: perfil estruturado do cliente ideal. Vira contexto
-- consistente pra chatbot, Sales AI e cadências.

CREATE TABLE `bychat_personas` (
  `id`             INT          NOT NULL AUTO_INCREMENT,
  `name`           VARCHAR(191) NOT NULL,
  `description`    TEXT         NULL,
  `ageRange`       VARCHAR(60)  NULL,
  `genderHint`     VARCHAR(40)  NULL,
  `location`       VARCHAR(191) NULL,
  `occupation`     VARCHAR(191) NULL,
  `income`         VARCHAR(60)  NULL,
  `painPoints`     JSON         NULL,
  `objections`     JSON         NULL,
  `triggers`       JSON         NULL,
  `channels`       JSON         NULL,
  `voiceTone`      TEXT         NULL,
  `examplePhrases` JSON         NULL,
  `goals`          JSON         NULL,
  `active`         BOOLEAN      NOT NULL DEFAULT TRUE,
  `isDefault`      BOOLEAN      NOT NULL DEFAULT FALSE,
  `createdById`    INT          NULL,
  `createdAt`      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `idx_active_default` (`active`, `isDefault`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;
