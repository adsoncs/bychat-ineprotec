-- Telas do CRM com permissão própria: Duplicados, Modelos e Objeções
-- dividiam a permissão de Leads (lib/eduTelas.ts, pai 'leads'). Quem já via
-- Leads continua vendo as três — o papel que não deve, desmarca na tela de
-- Papéis. Só dados: nenhuma coluna nova.
INSERT INTO `bychat_papel_capacidades` (`papelId`, `capacidade`, `separacao`)
SELECT pc.`papelId`, t.`cap`, false
FROM `bychat_papel_capacidades` pc
JOIN (
  SELECT 'crm_duplicados.view' AS `cap`
  UNION ALL SELECT 'crm_modelos.view'
  UNION ALL SELECT 'crm_objecoes.view'
) t
WHERE pc.`capacidade` = 'leads.view'
  AND NOT EXISTS (
    SELECT 1 FROM `bychat_papel_capacidades` x
    WHERE x.`papelId` = pc.`papelId` AND x.`capacidade` = t.`cap`
  );

-- Pacotes que dão Leads dão também as três telas.
INSERT INTO `bychat_pacote_capacidades` (`pacoteId`, `capacidade`)
SELECT pc.`pacoteId`, t.`cap`
FROM `bychat_pacote_capacidades` pc
JOIN (
  SELECT 'crm_duplicados.view' AS `cap`
  UNION ALL SELECT 'crm_modelos.view'
  UNION ALL SELECT 'crm_objecoes.view'
) t
WHERE pc.`capacidade` = 'leads.view'
  AND NOT EXISTS (
    SELECT 1 FROM `bychat_pacote_capacidades` x
    WHERE x.`pacoteId` = pc.`pacoteId` AND x.`capacidade` = t.`cap`
  );
