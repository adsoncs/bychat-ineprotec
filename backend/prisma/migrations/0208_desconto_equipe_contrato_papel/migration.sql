-- Matrícula interna pelo painel, etapa 3 (04/11/2026):
--  • cupom "só a equipe" (bychat_coupons.somenteEquipe): só vale aplicado pelo
--    agente no atendimento pelo painel, por quem tem "Desconto da equipe";
--  • telas "Contrato assinado no papel" e "Desconto da equipe": no motor de
--    papéis nascem só nos papéis de base Administrador/Superadmin.
-- Idempotente.
SET @tem := (SELECT COUNT(*) FROM information_schema.columns
             WHERE table_schema = DATABASE() AND table_name = 'bychat_coupons' AND column_name = 'somenteEquipe');
SET @sql := IF(@tem = 0, 'ALTER TABLE `bychat_coupons` ADD COLUMN `somenteEquipe` BOOLEAN NOT NULL DEFAULT false', 'SELECT 1');
PREPARE passo FROM @sql;
EXECUTE passo;
DEALLOCATE PREPARE passo;

INSERT INTO `bychat_papel_capacidades` (`papelId`, `capacidade`, `separacao`)
SELECT p.`id`, t.`cap`, false
FROM `bychat_papeis` p
JOIN (
  SELECT 'edu_contrato_presencial.view' AS `cap`
  UNION ALL SELECT 'edu_contrato_presencial.edit'
  UNION ALL SELECT 'edu_desconto_equipe.view'
  UNION ALL SELECT 'edu_desconto_equipe.edit'
) t
WHERE p.`papelBase` IN ('ADMIN', 'SUPERADMIN')
  AND NOT EXISTS (
    SELECT 1 FROM `bychat_papel_capacidades` x
    WHERE x.`papelId` = p.`id` AND x.`capacidade` = t.`cap`
  );
