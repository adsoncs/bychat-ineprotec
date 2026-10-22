-- Integração Negociações/Metas/Comissões × Educacional — Fase 3:
-- regra de comissão por portal e/ou curso (null = qualquer). Aditivo.
ALTER TABLE `bychat_commission_rules` ADD COLUMN `portalId` INTEGER NULL, ADD COLUMN `courseId` INTEGER NULL;
