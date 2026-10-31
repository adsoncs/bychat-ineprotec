-- Disparo Inteligente: travas viram escolhas do operador.
ALTER TABLE `bychat_smart_campaigns`
  ADD COLUMN `skipNumberCheck` TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN `guardConfig` JSON NULL;
