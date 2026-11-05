-- "Meu Portal" passa a ligar por portal, na aba Configuração do painel.
-- Antes era a Setting interna `portal_area_aluno` (valia para a instituição
-- inteira): quem já estava ligado continua ligado em todos os portais.
ALTER TABLE `bychat_enrollment_portals` ADD COLUMN `areaDoAluno` BOOLEAN NOT NULL DEFAULT false;

UPDATE `bychat_enrollment_portals` SET `areaDoAluno` = true
WHERE EXISTS (
  SELECT 1 FROM `bychat_settings` WHERE `key` = 'portal_area_aluno' AND (`value` = CAST('true' AS JSON) OR JSON_UNQUOTE(`value`) = 'true')
);

DELETE FROM `bychat_settings` WHERE `key` = 'portal_area_aluno';
