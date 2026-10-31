-- Lista de bloqueio na entrada de leads (spam, concorrente, contato abusivo).
--
-- Uma regra guarda os dados do contato e barra quando QUALQUER critério casa —
-- quem abusa troca um dado e mantém o outro. `hits`/`lastHitAt` mostram que a
-- regra está trabalhando; sem isso não dá para saber se ela ainda faz sentido.

CREATE TABLE `bychat_lead_block_rules` (
  `id`          INT NOT NULL AUTO_INCREMENT,
  `label`       VARCHAR(191) NULL,
  `emailKey`    VARCHAR(191) NULL,
  `emailDomain` VARCHAR(120) NULL,
  `phoneKey`    VARCHAR(30) NULL,
  `ip`          VARCHAR(45) NULL,
  `reason`      TEXT NULL,
  `active`      BOOLEAN NOT NULL DEFAULT true,
  `hits`        INT NOT NULL DEFAULT 0,
  `lastHitAt`   DATETIME(3) NULL,
  `createdBy`   VARCHAR(191) NULL,
  `createdAt`   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`   DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  INDEX `bychat_lead_block_rules_active_idx` (`active`),
  INDEX `bychat_lead_block_rules_emailKey_idx` (`emailKey`),
  INDEX `bychat_lead_block_rules_phoneKey_idx` (`phoneKey`),
  INDEX `bychat_lead_block_rules_ip_idx` (`ip`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
