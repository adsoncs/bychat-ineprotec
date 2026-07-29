-- Avaliação por competências (fase T3), no modelo da Metodologia SENAI.
--
-- Na educação profissional a unidade curricular não "vale nota": ela desenvolve
-- CAPACIDADES (técnicas, sociais, organizativas, metodológicas), e o aluno
-- demonstra domínio delas contra CRITÉRIOS de avaliação.
--
-- A decisão de aptidão vem do atendimento aos critérios CRÍTICOS, não da média:
-- um aluno pode somar pontos suficientes e não estar apto porque falhou num
-- crítico. É esse o ponto que um ERP de graduação erra ao atender escola técnica.
--
-- A aferição guarda a TENTATIVA porque reapresentação é da natureza do modelo —
-- quando o aluno não atende, o docente retoma a capacidade em vez de aplicar
-- prova de recuperação no fim do período.
CREATE TABLE `bychat_aca_capacidades` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `componenteId` INT NOT NULL,
  `tipo` ENUM('TECNICA','SOCIAL','ORGANIZATIVA','METODOLOGICA') NOT NULL DEFAULT 'TECNICA',
  `descricao` TEXT NOT NULL,
  `ordem` INT NOT NULL DEFAULT 0,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  INDEX `bychat_aca_capacidades_componenteId_idx`(`componenteId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4;

CREATE TABLE `bychat_aca_criterios` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `capacidadeId` INT NOT NULL,
  `descricao` TEXT NOT NULL,
  `evidencia` TEXT NULL,
  `peso` ENUM('CRITICO','DESEJAVEL') NOT NULL DEFAULT 'DESEJAVEL',
  `ordem` INT NOT NULL DEFAULT 0,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `bychat_aca_criterios_capacidadeId_idx`(`capacidadeId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4;

CREATE TABLE `bychat_aca_afericoes` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `criterioId` INT NOT NULL,
  `matriculaId` INT NOT NULL,
  `resultado` ENUM('ATENDE','EM_DESENVOLVIMENTO','NAO_ATENDE') NOT NULL,
  `observacao` TEXT NULL,
  `tentativa` INT NOT NULL DEFAULT 1,
  `afericaoEm` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `docenteUserId` INT NULL,
  UNIQUE INDEX `bychat_aca_afericoes_criterioId_matriculaId_tentativa_key`(`criterioId`, `matriculaId`, `tentativa`),
  INDEX `bychat_aca_afericoes_matriculaId_idx`(`matriculaId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4;

ALTER TABLE `bychat_aca_capacidades`
  ADD CONSTRAINT `bychat_aca_capacidades_componenteId_fkey`
  FOREIGN KEY (`componenteId`) REFERENCES `bychat_aca_componentes`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `bychat_aca_criterios`
  ADD CONSTRAINT `bychat_aca_criterios_capacidadeId_fkey`
  FOREIGN KEY (`capacidadeId`) REFERENCES `bychat_aca_capacidades`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `bychat_aca_afericoes`
  ADD CONSTRAINT `bychat_aca_afericoes_criterioId_fkey`
  FOREIGN KEY (`criterioId`) REFERENCES `bychat_aca_criterios`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `bychat_aca_esquemas_avaliacao`
  ADD COLUMN `avaliacaoPorCompetencia` BOOLEAN NOT NULL DEFAULT false;
