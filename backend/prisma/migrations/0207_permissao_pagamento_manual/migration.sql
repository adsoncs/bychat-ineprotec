-- Tela "Pagamento manual" (lib/eduTelas.ts, 03/11/2026): marcar uma inscrição
-- como paga FORA do gateway, com comprovante. Ação sensível: no motor de papéis
-- nasce só nos papéis de base Administrador/Superadmin — os demais recebem
-- pela tela de Papéis, quando a instituição decidir. Só dados; idempotente.
INSERT INTO `bychat_papel_capacidades` (`papelId`, `capacidade`, `separacao`)
SELECT p.`id`, t.`cap`, false
FROM `bychat_papeis` p
JOIN (
  SELECT 'edu_pagamento_manual.view' AS `cap`
  UNION ALL SELECT 'edu_pagamento_manual.edit'
) t
WHERE p.`papelBase` IN ('ADMIN', 'SUPERADMIN')
  AND NOT EXISTS (
    SELECT 1 FROM `bychat_papel_capacidades` x
    WHERE x.`papelId` = p.`id` AND x.`capacidade` = t.`cap`
  );
