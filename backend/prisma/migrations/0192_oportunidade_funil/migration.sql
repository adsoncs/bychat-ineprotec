-- Oportunidade em outro funil + funil de entrada. Aditivo.
--
-- LeadFunnel (funil adicional do lead) ganha setor, responsável e motivo de
-- perda PRÓPRIOS: o aluno ganho em Vendas que é atendido pela Secretaria tem um
-- card no funil da Secretaria, com dono e desfecho daquele processo, sem virar
-- outra ficha (que contaria de novo nos relatórios de marketing).
ALTER TABLE `bychat_lead_funnels`
  ADD COLUMN `teamId` INTEGER NULL,
  ADD COLUMN `assignedUserId` INTEGER NULL,
  ADD COLUMN `lostReasonId` INTEGER NULL;
CREATE INDEX `bychat_lead_funnels_teamId_idx` ON `bychat_lead_funnels`(`teamId`);
CREATE INDEX `bychat_lead_funnels_assignedUserId_idx` ON `bychat_lead_funnels`(`assignedUserId`);

-- Abertura automática, por equipe e desligada por padrão: lead GANHO que passa
-- para esta equipe ganha um card neste funil/etapa.
ALTER TABLE `bychat_teams`
  ADD COLUMN `oportunidadeFunnelId` INTEGER NULL,
  ADD COLUMN `oportunidadeStageKey` VARCHAR(80) NULL;

-- Funil em que o lead ENTROU. Relatório de aquisição filtra por ele: mover o
-- lead de funil depois não tira o lead do resultado da campanha que o trouxe.
ALTER TABLE `bychat_leads` ADD COLUMN `funnelEntradaId` INTEGER NULL;
CREATE INDEX `bychat_leads_funnelEntradaId_idx` ON `bychat_leads`(`funnelEntradaId`);

-- Backfill: o funil de onde saiu na 1ª troca registrada; sem troca, o atual.
UPDATE `bychat_leads` l
  JOIN (
    SELECT m.leadId, m.fromFunnelId
    FROM `bychat_lead_stage_movements` m
    JOIN (
      SELECT leadId, MIN(movedAt) AS primeira
      FROM `bychat_lead_stage_movements`
      WHERE fromFunnelId IS NOT NULL AND toFunnelId IS NOT NULL AND fromFunnelId <> toFunnelId
      GROUP BY leadId
    ) p ON p.leadId = m.leadId AND p.primeira = m.movedAt
    WHERE m.fromFunnelId IS NOT NULL AND m.toFunnelId IS NOT NULL AND m.fromFunnelId <> m.toFunnelId
  ) t ON t.leadId = l.id
  SET l.funnelEntradaId = t.fromFunnelId
  WHERE l.funnelEntradaId IS NULL;
UPDATE `bychat_leads` SET `funnelEntradaId` = `funnelId` WHERE `funnelEntradaId` IS NULL AND `funnelId` IS NOT NULL;

-- Opções da transferência: os papéis de GESTOR já começam com elas (os de
-- administrador têm todas por regra; agente começa sem). Cada empresa ajusta em
-- Configurações › Papéis e acessos.
INSERT IGNORE INTO `bychat_papel_capacidades` (`papelId`, `capacidade`, `separacao`)
  SELECT `id`, 'transferencia.mover_funil', false FROM `bychat_papeis` WHERE `papelBase` = 'MANAGER';
INSERT IGNORE INTO `bychat_papel_capacidades` (`papelId`, `capacidade`, `separacao`)
  SELECT `id`, 'transferencia.abrir_outro_funil', false FROM `bychat_papeis` WHERE `papelBase` = 'MANAGER';
