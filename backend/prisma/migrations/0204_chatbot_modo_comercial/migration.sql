-- Modo comercial da jornada de IA (FABI/fabad, 01/11/2026): o chatbot pode
-- atender 100% do tempo (padrão, null) ou só qualificar e passar para a equipe
-- comercial enquanto ela está no horário e com alguém online.
-- Idempotente.

SET @tem := (SELECT COUNT(*) FROM information_schema.columns
             WHERE table_schema = DATABASE() AND table_name = 'bychat_chatbots' AND column_name = 'modoComercial');
SET @sql := IF(@tem = 0, 'ALTER TABLE `bychat_chatbots` ADD COLUMN `modoComercial` JSON NULL', 'SELECT 1');
PREPARE passo FROM @sql;
EXECUTE passo;
DEALLOCATE PREPARE passo;
