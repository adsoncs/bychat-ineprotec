-- Por pessoa, em cada equipe: entra ou não no rodízio (03/11/2026, pedido da
-- fabad — gestores que ficam na equipe para ver e gerir, mas não atendem).
-- Padrão = entra (comportamento de antes). Idempotente.

SET @tem := (SELECT COUNT(*) FROM information_schema.columns
             WHERE table_schema = DATABASE() AND table_name = 'bychat_team_members' AND column_name = 'participaRodizio');
SET @sql := IF(@tem = 0, 'ALTER TABLE `bychat_team_members` ADD COLUMN `participaRodizio` BOOLEAN NOT NULL DEFAULT true', 'SELECT 1');
PREPARE passo FROM @sql;
EXECUTE passo;
DEALLOCATE PREPARE passo;
