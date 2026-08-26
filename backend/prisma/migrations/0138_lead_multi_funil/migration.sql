-- Um lead DENTRO de um funil.
--
-- `Lead.funnelId`/`Lead.status` continuam sendo o funil PRINCIPAL (é o que o
-- Kanban, o Relatório de Funil, as metas e as condições de workflow leem).
-- Esta tabela acrescenta os demais vínculos sem exigir que tudo migre de uma
-- vez, e guarda a etapa e o desfecho POR funil.
CREATE TABLE `bychat_lead_funnels` (
  `id`        INT NOT NULL AUTO_INCREMENT,
  `leadId`    INT NOT NULL,
  `funnelId`  INT NOT NULL,
  `stageKey`  VARCHAR(80) NULL,
  `principal` TINYINT(1) NOT NULL DEFAULT 0,
  `entrouEm`  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `saiuEm`    DATETIME(3) NULL,
  `outcome`   VARCHAR(10) NULL,
  `outcomeAt` DATETIME(3) NULL,
  `origem`    VARCHAR(30) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  UNIQUE INDEX `bychat_lead_funnels_leadId_funnelId_key` (`leadId`, `funnelId`),
  INDEX `bychat_lead_funnels_funnelId_stageKey_idx` (`funnelId`, `stageKey`),
  INDEX `bychat_lead_funnels_leadId_saiuEm_idx` (`leadId`, `saiuEm`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4;

ALTER TABLE `bychat_lead_funnels`
  ADD CONSTRAINT `bychat_lead_funnels_leadId_fkey`
  FOREIGN KEY (`leadId`) REFERENCES `bychat_leads`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `bychat_lead_funnels`
  ADD CONSTRAINT `bychat_lead_funnels_funnelId_fkey`
  FOREIGN KEY (`funnelId`) REFERENCES `bychat_funnels`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- Sem backfill, de propósito.
--
-- A primeira versão desta migration copiava para cá o funil que está no Lead,
-- marcando a linha como `principal`. O desenho mudou antes de ir para produção:
-- o funil principal é DERIVADO do Lead na leitura, nunca espelhado — porque são
-- doze os pontos do código que gravam `funnelId` direto no Lead, e espelhar
-- todos seria garantir divergência um dia. Ver services/leadFunnels.ts.
--
-- Esta tabela guarda só os vínculos ADICIONAIS, que nascem por ação explícita.
-- Um backfill aqui criaria linhas que ninguém lê e que reapareceriam como
-- "funil adicional" duplicando o principal na tela.
