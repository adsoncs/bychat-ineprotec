-- Identidade do portal no painel (só para a equipe): ícone, cor, empresa,
-- descrição interna e ordem. Não muda nada na página pública.
ALTER TABLE `bychat_enrollment_portals` ADD COLUMN `identidadePainel` JSON NULL;
