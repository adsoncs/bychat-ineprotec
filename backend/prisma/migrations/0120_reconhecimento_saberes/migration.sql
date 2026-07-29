-- Reconhecimento de saberes e competências (fase T4).
--
-- LDB art. 41: "O conhecimento adquirido na educação profissional e tecnológica,
-- inclusive no trabalho, poderá ser objeto de avaliação, reconhecimento e
-- certificação para prosseguimento ou conclusão de estudos."
--
-- Res. CNE/CP 1/2021, art. 47, §2º: o processo formal "deve ser precedido de
-- autorização pelo respectivo sistema de ensino", tendo como referência o PPCP —
-- Projeto Pedagógico de Certificação Profissional. É a trava que costuma ser
-- ignorada: a escola NÃO pode aplicar uma prova e dispensar o aluno. Sem PPCP
-- autorizado e vigente o processo não roda, e é o registro do PPCP que sustenta
-- o ato numa fiscalização.
CREATE TABLE `bychat_aca_ppcp` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `courseId` INT NOT NULL,
  `nome` VARCHAR(191) NOT NULL,
  `metodologia` TEXT NULL,
  `status` ENUM('RASCUNHO','AUTORIZADO','SUSPENSO','ENCERRADO') NOT NULL DEFAULT 'RASCUNHO',
  `atoAutorizacao` VARCHAR(191) NULL,
  `orgaoAutorizador` VARCHAR(191) NULL,
  `autorizadoEm` DATETIME(3) NULL,
  `vigenciaAte` DATETIME(3) NULL,
  `observacao` TEXT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  INDEX `bychat_aca_ppcp_courseId_status_idx`(`courseId`, `status`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4;

CREATE TABLE `bychat_aca_certificacao_processos` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `ppcpId` INT NOT NULL,
  `alunoId` INT NOT NULL,
  `matriculaId` INT NULL,
  `protocolo` VARCHAR(40) NOT NULL,
  `status` ENUM('ABERTO','EM_AVALIACAO','DEFERIDO','INDEFERIDO','CANCELADO') NOT NULL DEFAULT 'ABERTO',
  `itinerario` TEXT NULL,
  `banca` TEXT NULL,
  `parecerFinal` TEXT NULL,
  `decididoPor` INT NULL,
  `decididoEm` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `bychat_aca_certificacao_processos_protocolo_key`(`protocolo`),
  INDEX `bychat_aca_certificacao_processos_alunoId_status_idx`(`alunoId`, `status`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4;

CREATE TABLE `bychat_aca_certificacao_avaliacoes` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `processoId` INT NOT NULL,
  `componenteId` INT NOT NULL,
  `instrumento` VARCHAR(191) NOT NULL,
  `resultado` ENUM('RECONHECIDO','NAO_RECONHECIDO') NOT NULL,
  `parecer` TEXT NULL,
  `avaliadoEm` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `avaliadorNome` VARCHAR(191) NULL,
  `aproveitamentoId` INT NULL,
  UNIQUE INDEX `bychat_aca_certificacao_avaliacoes_processoId_componenteId_key`(`processoId`, `componenteId`),
  INDEX `bychat_aca_certificacao_avaliacoes_processoId_idx`(`processoId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4;

ALTER TABLE `bychat_aca_certificacao_processos`
  ADD CONSTRAINT `bychat_aca_certificacao_processos_ppcpId_fkey`
  FOREIGN KEY (`ppcpId`) REFERENCES `bychat_aca_ppcp`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `bychat_aca_certificacao_avaliacoes`
  ADD CONSTRAINT `bychat_aca_certificacao_avaliacoes_processoId_fkey`
  FOREIGN KEY (`processoId`) REFERENCES `bychat_aca_certificacao_processos`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
