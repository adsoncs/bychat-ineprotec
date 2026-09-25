-- Liga a matrícula à inscrição do portal que a originou. Sem esse vínculo, o
-- financeiro não tem como saber o que a pessoa escolheu no checkout e acaba
-- aplicando o plano padrão da oferta a quem já pagou de outro jeito.
ALTER TABLE `bychat_aca_matriculas` ADD COLUMN `enrollmentRegistrationId` INT NULL;
CREATE INDEX `bychat_aca_matriculas_enrollmentRegistrationId_idx`
  ON `bychat_aca_matriculas`(`enrollmentRegistrationId`);
