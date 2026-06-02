-- 0065_roles_reform_and_modules
-- Reforma de roles (Fase 1 do plano de melhoria de WhatsApp/Permissões).
--
-- Mudanças:
--   1. AGENT no enum UserRole (5 roles: SUPERADMIN, ADMIN, MANAGER, AGENT, VIEWER)
--   2. ModulePermission.scope ('own' | 'team' | 'all') — granularidade do "ver"
--   3. Tabela bychat_modules (catálogo + toggle global active=on/off)
--   4. Promove MANAGERs atuais a ADMIN (preserva acesso; MANAGERs futuros nascem com scope=team)
--   5. User.signature — assinatura personalizada na mensagem outbound (quick win F1.6)
--
-- NÃO INCLUI: drop de User.isAgent. Coluna fica deprecated até F1.4 refatorar todos os usos.
-- Backups das tabelas afetadas em /var/backups/bychat-routes-reform/ (executados antes desta migration).

-- 1) Adiciona AGENT ao enum UserRole (ordem preservada — VIEWER fica por último)
ALTER TABLE `bychat_users`
  MODIFY `role` ENUM('SUPERADMIN','ADMIN','MANAGER','AGENT','VIEWER') NOT NULL DEFAULT 'VIEWER';

-- 2) Adiciona campo scope em ModulePermission com default 'team' e backfill por role
ALTER TABLE `bychat_module_permissions`
  ADD COLUMN `scope` VARCHAR(10) NOT NULL DEFAULT 'team';

UPDATE `bychat_module_permissions` SET `scope` = 'all'  WHERE `role` IN ('SUPERADMIN', 'ADMIN');
UPDATE `bychat_module_permissions` SET `scope` = 'team' WHERE `role` = 'MANAGER';
UPDATE `bychat_module_permissions` SET `scope` = 'team' WHERE `role` = 'VIEWER';
-- AGENT terá scope='own' nas linhas criadas via seed/admin (default 'team' protege se admin esquecer).

-- 3) Tabela Module — catálogo + toggle global
CREATE TABLE `bychat_modules` (
  `id` VARCHAR(50) NOT NULL,
  `name` VARCHAR(100) NOT NULL,
  `category` VARCHAR(30) NOT NULL,
  `active` BOOLEAN NOT NULL DEFAULT TRUE,
  `isCore` BOOLEAN NOT NULL DEFAULT FALSE,
  `disabledAt` DATETIME(3) NULL,
  `disabledByUserId` INT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `bychat_modules_active_idx` (`active`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Seed dos 24 módulos do registry (fonte: backend/src/lib/moduleRegistry.ts).
-- isCore=true → admin não pode desabilitar via UI (proteção contra tijolada).
INSERT INTO `bychat_modules` (`id`, `name`, `category`, `active`, `isCore`) VALUES
  ('dashboard',          'Dashboard',                 'overview',     TRUE, TRUE),
  ('atendimento',        'Conversas',                 'crm',          TRUE, TRUE),
  ('leads',              'Leads',                     'crm',          TRUE, TRUE),
  ('intelligence',       'Inteligência',              'crm',          TRUE, FALSE),
  ('kanban',             'Kanban',                    'crm',          TRUE, TRUE),
  ('funnels',            'Funis',                     'crm',          TRUE, TRUE),
  ('activities',         'Atividades',                'crm',          TRUE, FALSE),
  ('tags',               'Tags',                      'crm',          TRUE, FALSE),
  ('workflows',          'Automação',                 'automacao',    TRUE, FALSE),
  ('sales_engagement',   'Cadências de Vendas',       'automacao',    TRUE, FALSE),
  ('captacao',           'Captação',                  'captacao',     TRUE, FALSE),
  ('marketing',          'Marketing',                 'marketing',    TRUE, FALSE),
  ('vendas',             'Vendas & Anúncios',         'vendas',       TRUE, FALSE),
  ('whatsapp',           'WhatsApp',                  'canais',       TRUE, FALSE),
  ('google',             'Google',                    'integracoes',  TRUE, FALSE),
  ('educacional',        'Educacional',               'educacional',  TRUE, FALSE),
  ('settings',           'Configurações',             'config',       TRUE, TRUE),
  ('users',              'Usuários',                  'config',       TRUE, TRUE),
  ('teams',              'Equipes',                   'config',       TRUE, TRUE),
  ('enrollment_portals', 'Portal de Matrículas',      'educacional',  TRUE, FALSE),
  ('security',           'Segurança',                 'config',       TRUE, FALSE),
  ('apikeys',            'API & Webhooks',            'config',       TRUE, FALSE),
  ('installations',      'Instalações',               'admin',        TRUE, TRUE),
  ('tools',              'Ferramentas',               'ferramentas',  TRUE, FALSE);

-- 4) Promove MANAGERs atuais a ADMIN — decisão registrada em
-- /root/.claude/projects/-root/memory/project_bychatbeyond_roles_reform.md
-- Preserva acesso de quem hoje precisa ver tudo. MANAGERs criados a partir de
-- agora nascem com scope='team' (defaults novos via UI/seed).
UPDATE `bychat_users` SET `role` = 'ADMIN' WHERE `role` = 'MANAGER';

-- 5) User.signature — assinatura personalizada (quick win F1.6)
ALTER TABLE `bychat_users` ADD COLUMN `signature` VARCHAR(255) NULL;
