-- Matrícula interna (05/11/2026): tela "Dispensar etapas e documentos".
-- No motor de papéis uma tela nova nasce vazia, até para administrador.
-- Idempotente.
INSERT INTO `bychat_papel_capacidades` (`papelId`, `capacidade`, `separacao`)
SELECT p.`id`, t.`cap`, false
FROM `bychat_papeis` p
JOIN (
  SELECT 'edu_dispensa_etapas.view' AS `cap`
  UNION ALL SELECT 'edu_dispensa_etapas.edit'
) t
WHERE p.`papelBase` IN ('ADMIN', 'SUPERADMIN')
  AND NOT EXISTS (
    SELECT 1 FROM `bychat_papel_capacidades` x
    WHERE x.`papelId` = p.`id` AND x.`capacidade` = t.`cap`
  );
