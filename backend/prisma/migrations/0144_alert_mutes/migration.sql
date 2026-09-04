-- Silêncio de alerta, por pessoa.
--
-- A válvula que protege a confiança no sino. Sem ela, o primeiro alerta que
-- alguém considera irrelevante contamina o hábito de abrir a caixa — e o
-- "tirar da minha caixa" que já existia não resolve, porque a próxima volta do
-- relógio traz a condição de volta e o aviso reaparece.
--
-- Sempre por PESSOA: cada um decide o que quer ver. Silenciar um tipo para toda
-- a empresa é decisão de configuração e mora em Setting, não aqui.
--
-- Os dois índices únicos são parciais por natureza do dado: uma linha tem `kind`
-- OU `dedupeKey`, nunca os dois, e o MySQL trata NULL como distinto em índice
-- único — então (userId, kind) não colide com as linhas de item, e vice-versa.
-- É o que permite os dois tipos de silêncio na mesma tabela sem uma coluna de
-- discriminador que ninguém leria.
CREATE TABLE `bychat_alert_mutes` (
  `id`        INTEGER      NOT NULL AUTO_INCREMENT,
  `userId`    INTEGER      NOT NULL,
  `kind`      VARCHAR(60)  NULL,
  `dedupeKey` VARCHAR(191) NULL,
  `until`     DATETIME(3)  NULL,
  `createdAt` DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `bychat_alert_mutes_userId_kind_key`(`userId`, `kind`),
  UNIQUE INDEX `bychat_alert_mutes_userId_dedupeKey_key`(`userId`, `dedupeKey`),
  INDEX `bychat_alert_mutes_userId_idx`(`userId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `bychat_alert_mutes`
  ADD CONSTRAINT `bychat_alert_mutes_userId_fkey`
  FOREIGN KEY (`userId`) REFERENCES `bychat_users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
