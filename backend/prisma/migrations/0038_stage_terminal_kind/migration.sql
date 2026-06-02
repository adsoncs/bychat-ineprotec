-- 0038_stage_terminal_kind
-- Fase 23-F: Stage ganha flag opcional terminalKind ('won'|'lost'|null) para auto-move.

ALTER TABLE `bychat_stages`
  ADD COLUMN `terminalKind` VARCHAR(10) NULL;
