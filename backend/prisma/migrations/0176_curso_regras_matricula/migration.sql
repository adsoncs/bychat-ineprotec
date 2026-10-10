-- Regras de matrícula por curso: exigir contrato e enviar ao SEI (valem junto com as do portal).
ALTER TABLE `bychat_edu_courses` ADD COLUMN `exigeContrato` BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE `bychat_edu_courses` ADD COLUMN `enviarSei` BOOLEAN NOT NULL DEFAULT true;
