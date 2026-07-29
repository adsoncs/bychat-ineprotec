-- Certificação intermediária: módulo da matriz com terminalidade (fase T2).
--
-- Res. CNE/CP 1/2021, art. 15, II: a qualificação profissional técnica é "etapa
-- com terminalidade de curso técnico". Art. 49, §2º: ao concluir a etapa com
-- terminalidade, "SERÁ conferido certificado de qualificação profissional", com
-- título e carga horária explicitados. É direito do aluno, mesmo que ele
-- abandone o curso depois — e era impossível no sistema, porque a emissão de
-- certificado exigia a matrícula inteira concluída.
--
-- O perfil profissional de conclusão entra no curso porque o §4º do mesmo artigo
-- exige que o histórico que acompanha certificados e diplomas o explicite.
CREATE TABLE `bychat_aca_matriz_modulos` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `matrizId` INT NOT NULL,
  `numero` INT NOT NULL,
  `nome` VARCHAR(191) NOT NULL,
  `tituloQualificacao` VARCHAR(191) NULL,
  `codigoCbo` VARCHAR(20) NULL,
  `cargaHoraria` INT NULL,
  `descricao` TEXT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `bychat_aca_matriz_modulos_matrizId_numero_key`(`matrizId`, `numero`),
  INDEX `bychat_aca_matriz_modulos_matrizId_idx`(`matrizId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4;

ALTER TABLE `bychat_aca_matriz_modulos`
  ADD CONSTRAINT `bychat_aca_matriz_modulos_matrizId_fkey`
  FOREIGN KEY (`matrizId`) REFERENCES `bychat_aca_matrizes`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `bychat_aca_componentes` ADD COLUMN `moduloId` INT NULL;
ALTER TABLE `bychat_aca_componentes`
  ADD CONSTRAINT `bychat_aca_componentes_moduloId_fkey`
  FOREIGN KEY (`moduloId`) REFERENCES `bychat_aca_matriz_modulos`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `bychat_edu_courses` ADD COLUMN `perfilConclusao` TEXT NULL;
