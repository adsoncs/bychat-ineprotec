-- G6: notificações push do portal do aluno.
-- A chave única é o endpoint, não o aluno: o mesmo estudante assina do celular
-- e do computador, e cada navegador é uma assinatura diferente.
CREATE TABLE `bychat_aca_push_inscricoes` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `alunoId` INT NOT NULL,
  `endpoint` VARCHAR(500) NOT NULL,
  `p256dh` VARCHAR(255) NOT NULL,
  `auth` VARCHAR(255) NOT NULL,
  `userAgent` VARCHAR(255) NULL,
  `ativa` BOOLEAN NOT NULL DEFAULT true,
  `ultimoErro` VARCHAR(255) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `bychat_aca_push_inscricoes_endpoint_key`(`endpoint`),
  INDEX `bychat_aca_push_inscricoes_alunoId_ativa_idx`(`alunoId`, `ativa`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4;
