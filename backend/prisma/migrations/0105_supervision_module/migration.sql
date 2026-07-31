-- Módulo Supervisão — painel gerencial do Conversas (routes/supervision.ts).
--
-- Não cria tabela: a "conversa" continua sendo o Lead. O que entra aqui é o
-- registro do módulo (para ele existir no gerenciador e na sidebar) e as
-- permissões por papel.
--
-- isCore = TRUE porque o módulo vive colado no Conversas (também core): nasce
-- ligado junto com ele e não é desativável isoladamente. O recorte de acesso é
-- por PAPEL, não por ativação: só gestão vê. VIEWER e AGENT ficam com canView
-- em 0, e o backend ainda exige SUPERADMIN/ADMIN/MANAGER em toda rota.
-- `updatedAt` explícito: em parte das instalações a coluna é NOT NULL sem
-- default (o Prisma preenche pela aplicação), e o INSERT cru falharia com
-- "Field 'updatedAt' doesn't have a default value".
INSERT INTO `bychat_modules` (`id`, `name`, `category`, `active`, `isCore`, `createdAt`, `updatedAt`)
VALUES ('supervision', 'Supervisão', 'crm', TRUE, TRUE, NOW(3), NOW(3))
ON DUPLICATE KEY UPDATE `name` = VALUES(`name`), `active` = TRUE, `isCore` = TRUE, `updatedAt` = NOW(3);

-- scope='all' nos papéis de gestão: o painel mostra as conversas de todos os
-- operadores, que é justamente o que o Conversas (escopado) não faz.
INSERT INTO `bychat_module_permissions`
  (`moduleId`, `role`, `canView`, `canCreate`, `canEdit`, `canDelete`, `scope`, `updatedAt`)
VALUES
  ('supervision', 'SUPERADMIN', 1, 0, 1, 0, 'all',  NOW(3)),
  ('supervision', 'ADMIN',      1, 0, 1, 0, 'all',  NOW(3)),
  ('supervision', 'MANAGER',    1, 0, 1, 0, 'all',  NOW(3)),
  ('supervision', 'AGENT',      0, 0, 0, 0, 'own',  NOW(3)),
  ('supervision', 'VIEWER',     0, 0, 0, 0, 'team', NOW(3))
ON DUPLICATE KEY UPDATE `updatedAt` = NOW(3);
