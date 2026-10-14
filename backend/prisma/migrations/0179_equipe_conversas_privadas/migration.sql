-- Conversas privadas por equipe (lib/teamAccess.ts): ligado, cada membro só vê
-- as próprias conversas e a fila sem dono do setor; o líder vê todas.
ALTER TABLE `bychat_teams` ADD COLUMN `conversasPrivadas` BOOLEAN NOT NULL DEFAULT false;
