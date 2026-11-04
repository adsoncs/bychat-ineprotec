-- Matrícula interna pelo painel (04/11/2026): VALOR PERSONALIZADO.
--  • bychat_enrollment_registrations.condicaoNegociada: matrícula e mensalidade
--    combinadas pelo agente no atendimento; vale na tela, na cobrança, no
--    contrato e nas parcelas (services/planoFinanceiro);
--  • tela "Valor personalizado": no motor de papéis nasce só nos papéis de base
--    Administrador/Superadmin.
-- Idempotente.
SET @tem := (SELECT COUNT(*) FROM information_schema.columns
             WHERE table_schema = DATABASE() AND table_name = 'bychat_enrollment_registrations' AND column_name = 'condicaoNegociada');
SET @sql := IF(@tem = 0, 'ALTER TABLE `bychat_enrollment_registrations` ADD COLUMN `condicaoNegociada` JSON NULL', 'SELECT 1');
PREPARE passo FROM @sql;
EXECUTE passo;
DEALLOCATE PREPARE passo;

INSERT INTO `bychat_papel_capacidades` (`papelId`, `capacidade`, `separacao`)
SELECT p.`id`, t.`cap`, false
FROM `bychat_papeis` p
JOIN (
  SELECT 'edu_valor_personalizado.view' AS `cap`
  UNION ALL SELECT 'edu_valor_personalizado.edit'
) t
WHERE p.`papelBase` IN ('ADMIN', 'SUPERADMIN')
  AND NOT EXISTS (
    SELECT 1 FROM `bychat_papel_capacidades` x
    WHERE x.`papelId` = p.`id` AND x.`capacidade` = t.`cap`
  );
