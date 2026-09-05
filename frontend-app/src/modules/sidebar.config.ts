/**
 * Sidebar — fonte única de verdade dos itens de navegação.
 *
 * Organização (vs legado de 8 grupos / 45+ itens):
 *   - 3 itens top-level acima dos grupos: acesso rápido às telas mais usadas
 *   - 4 grupos colapsáveis cobrindo CRM, Marketing, Vendas & Automação, Canais
 *   - Configurações como item solto no rodapé
 *
 * Itens raros saem do menu e ficam só no Cmd+K — não tudo precisa estar
 * visível ao mesmo tempo. Este é o ponto onde a IA do menu fica enxuta.
 */

/** Nome do ícone — resolvido pelo registry em `components/ui/icons.ts`. */
// O tipo vem do registry de ícones (`components/ui/icons.ts`): assim um nome
// usado aqui e ausente lá vira erro de tipo, em vez de círculo vazio na tela.
export type { IconName } from '@/components/ui/icons'
import type { IconName } from '@/components/ui/icons'

export interface SidebarItem {
  id: string
  label: string
  href: string
  icon: IconName
  /** badge numérico/texto curto */
  badge?: string | number
  /** chave de permissão; undefined = sempre visível */
  permission?: string
}

export interface SidebarGroup {
  id: string
  label: string
  items: SidebarItem[]
  /** se true, começa colapsado em modo expanded */
  initiallyCollapsed?: boolean
}

export interface SidebarSchema {
  /** itens fora de grupo, mostrados acima dos grupos */
  pinned: SidebarItem[]
  groups: SidebarGroup[]
  /** itens fora de grupo, mostrados no rodapé (configurações) */
  footer: SidebarItem[]
}

export const sidebarSchema: SidebarSchema = {
  pinned: [
    { id: 'dashboard', label: 'Visão Geral', href: '/app/dashboard', icon: 'LayoutDashboard', permission: 'dashboard' },
    { id: 'today', label: 'Hoje', href: '/app/today', icon: 'Sun', permission: 'activities' },
    { id: 'team-performance', label: 'Performance da Equipe', href: '/app/team-performance', icon: 'BarChart3', permission: 'users' },
    { id: 'conversations', label: 'Conversas', href: '/app/conversations', icon: 'MessageSquare', permission: 'atendimento' },
    // Painel gerencial do Conversas — só gestão tem canView (ver migration 0105).
    { id: 'supervision', label: 'Supervisão', href: '/app/supervision', icon: 'Headphones', permission: 'supervision' },
    // O sino continua sendo onde se AGE; esta tela responde o que a gaveta não
    // responde: histórico, a visão da empresa e o acervo. Módulo `alerts`, que
    // é core — todo mundo tem a própria caixa.
    { id: 'alerts', label: 'Alertas', href: '/app/alerts', icon: 'Bell', permission: 'alerts' },
    { id: 'intelligence', label: 'Inteligência', href: '/app/intelligence', icon: 'Sparkles', permission: 'intelligence' },
  ],
  groups: [
    {
      id: 'crm',
      label: 'CRM',
      items: [
        // Contato é conversa que ainda não virou Lead: mesma ficha, outro estado
        // (`qualifiedAt = null`). Fica ANTES de Leads porque é por onde a pessoa
        // entra — e o que não for promovido continua vivendo aqui.
        { id: 'contatos', label: 'Contatos', href: '/app/contatos', icon: 'BookUser', permission: 'contatos' },
        { id: 'leads', label: 'Leads', href: '/app/leads', icon: 'Users', permission: 'leads' },
        { id: 'leads-duplicates', label: 'Duplicados', href: '/app/leads/duplicates', icon: 'Copy', permission: 'leads' },
        { id: 'kanban', label: 'Kanban', href: '/app/kanban', icon: 'KanbanSquare', permission: 'kanban' },
        { id: 'activities', label: 'Atividades', href: '/app/activities', icon: 'ListChecks', permission: 'activities' },
        { id: 'scheduling', label: 'Agenda', href: '/app/scheduling', icon: 'CalendarRange', permission: 'scheduling' },
        { id: 'meetings', label: 'Reuniões', href: '/app/meetings', icon: 'Mic', permission: 'meetings' },
        { id: 'negotiations', label: 'Negociações', href: '/app/negotiations', icon: 'Handshake', permission: 'negotiations' },
        { id: 'catalog', label: 'Catálogo', href: '/app/catalog', icon: 'Boxes', permission: 'catalog' },
      ],
    },
    {
      id: 'marketing',
      label: 'Marketing',
      items: [
        { id: 'chatbots', label: 'Chatbots', href: '/app/chatbots', icon: 'Bot', permission: 'chatbots' },
        { id: 'pages', label: 'Landing Pages', href: '/app/pages', icon: 'Globe', permission: 'landing_pages' },
        { id: 'forms', label: 'Formulários', href: '/app/forms', icon: 'FormInput', permission: 'forms' },
        { id: 'meta-ads', label: 'Meta Ads', href: '/app/meta-ads', icon: 'Megaphone', permission: 'marketing' },
        { id: 'google-ads', label: 'Google Ads', href: '/app/google-ads', icon: 'Search', permission: 'marketing' },
        { id: 'links', label: 'Links rastreáveis', href: '/app/links', icon: 'Link2', permission: 'marketing' },
        { id: 'tracking', label: 'Rastreamento', href: '/app/tracking', icon: 'Activity', permission: 'marketing' },
        { id: 'reputation', label: 'Radar de Reputação', href: '/app/reputation', icon: 'Radar', permission: 'reputation_radar' },
      ],
      initiallyCollapsed: true,
    },
    {
      id: 'sales',
      label: 'Vendas & Automação',
      items: [
        { id: 'sales-ai', label: 'Vendas IA', href: '/app/sales-ai', icon: 'TrendingUp', permission: 'vendas' },
        { id: 'goals-commissions', label: 'Metas & Comissões', href: '/app/goals-commissions', icon: 'Target', permission: 'goals_commissions' },
        { id: 'workflows', label: 'Fluxos', href: '/app/workflows', icon: 'Workflow', permission: 'workflows' },
        { id: 'sales-cadences', label: 'Cadências', href: '/app/sales-cadences', icon: 'Megaphone', permission: 'sales_engagement' },
        { id: 'jobs', label: 'Filas & Monitor', href: '/app/jobs', icon: 'GanttChart', permission: 'workflows' },
      ],
      initiallyCollapsed: true,
    },
    {
      id: 'support',
      label: 'Suporte',
      items: [
        { id: 'helpdesk', label: 'Chamados', href: '/app/helpdesk', icon: 'LifeBuoy', permission: 'helpdesk' },
        { id: 'helpdesk-sla', label: 'SLA', href: '/app/helpdesk/sla', icon: 'Clock', permission: 'helpdesk' },
        { id: 'helpdesk-automation', label: 'Automação', href: '/app/helpdesk/automation', icon: 'Workflow', permission: 'helpdesk' },
        { id: 'helpdesk-kb', label: 'Base de Conhecimento', href: '/app/helpdesk/kb', icon: 'BookOpen', permission: 'helpdesk' },
        { id: 'helpdesk-csat', label: 'CSAT', href: '/app/helpdesk/csat', icon: 'Award', permission: 'helpdesk' },
        { id: 'helpdesk-orgs', label: 'Organizações', href: '/app/helpdesk/organizations', icon: 'Building2', permission: 'helpdesk' },
        { id: 'helpdesk-reports', label: 'Relatórios', href: '/app/helpdesk/reports', icon: 'BarChart3', permission: 'helpdesk' },
        { id: 'helpdesk-channels', label: 'Canais', href: '/app/helpdesk/channels', icon: 'Settings', permission: 'helpdesk' },
        { id: 'helpdesk-import', label: 'Importar', href: '/app/helpdesk/import', icon: 'Download', permission: 'helpdesk' },
      ],
      initiallyCollapsed: true,
    },
    {
      id: 'reports',
      label: 'Relatórios',
      items: [
        { id: 'analytics', label: 'Meus Painéis', href: '/app/analytics', icon: 'LineChart', permission: 'dashboard' },
        { id: 'meta-ads-report', label: 'Relatório Meta Ads', href: '/app/meta-ads-report', icon: 'BarChart3', permission: 'vendas' },
        { id: 'funnel-report', label: 'Relatório de Funil', href: '/app/funnel-report', icon: 'Workflow', permission: 'vendas' },
        { id: 'google-ads-report', label: 'Relatório Google Ads', href: '/app/google-ads-report', icon: 'BarChart3', permission: 'vendas' },
        { id: 'conversation-audit', label: 'Auditoria de Conversas', href: '/app/conversation-audit', icon: 'Bot', permission: 'conversation_audit' },
        { id: 'ai-journey', label: 'Jornada IA', href: '/app/ai-journey', icon: 'Sparkles', permission: 'ai_journey' },
        { id: 'funnel-conversion', label: 'Funil de Conversão', href: '/app/funnel-conversion', icon: 'GitFork', permission: 'funnels' },
        { id: 'status-summary-report', label: 'Relatório por Resumo', href: '/app/status-summary-report', icon: 'Tag', permission: 'status_summary' },
      ],
    },
    {
      id: 'tools',
      label: 'Utilitários',
      items: [
        { id: 'utms', label: 'UTMs', href: '/app/utms', icon: 'Link2', permission: 'tools' },
        { id: 'whatsapp-link', label: 'Link de WhatsApp', href: '/app/whatsapp-link', icon: 'Phone', permission: 'tools' },
        { id: 'qr', label: 'QR Code', href: '/app/qr', icon: 'Boxes', permission: 'tools' },
        { id: 'url-inspector', label: 'URL Inspector', href: '/app/url-inspector', icon: 'Search', permission: 'tools' },
      ],
      initiallyCollapsed: true,
    },
    {
      id: 'channels',
      label: 'Canais',
      items: [
        { id: 'whatsapp', label: 'WhatsApp', href: '/app/whatsapp', icon: 'Phone', permission: 'whatsapp' },
        { id: 'cloud-api', label: 'WhatsApp API', href: '/app/cloud-api', icon: 'Cloud', permission: 'whatsapp' },
        { id: 'whatsapp-templates', label: 'Modelos de Mensagem', href: '/app/whatsapp-templates', icon: 'FileText', permission: 'whatsapp' },
        { id: 'whatsapp-dispatch', label: 'Disparos & Custos', href: '/app/whatsapp-dispatch', icon: 'BarChart3', permission: 'whatsapp' },
        { id: 'broadcast', label: 'Disparos em Massa', href: '/app/broadcast', icon: 'Megaphone', permission: 'broadcast' },
        { id: 'smart-broadcast', label: 'Disparos Inteligentes', href: '/app/smart-broadcast', icon: 'BrainCircuit', permission: 'smart_broadcast' },
        { id: 'telegram', label: 'Telegram', href: '/app/telegram', icon: 'Send', permission: 'telegram' },
        { id: 'instagram', label: 'Instagram', href: '/app/instagram', icon: 'Instagram', permission: 'instagram' },
        { id: 'voip', label: 'VoIP', href: '/app/voip', icon: 'Phone', permission: 'voip' },
      ],
      initiallyCollapsed: true,
    },
    {
      id: 'integrations-group',
      label: 'Integrações',
      items: [
        { id: 'integrations', label: 'Visão geral', href: '/app/integrations', icon: 'Plug', permission: 'settings' },
        { id: 'google', label: 'Google Workspace', href: '/app/google', icon: 'Sparkles', permission: 'google' },
        { id: 'make', label: 'Make.com', href: '/app/make', icon: 'Boxes', permission: 'google' },
        { id: 'conversions', label: 'Conversões Meta Ads', href: '/app/conversions', icon: 'Send', permission: 'vendas' },
        { id: 'integ-evolution', label: 'Evolution API', href: '/app/integrations/evolution', icon: 'Activity', permission: 'settings' },
        { id: 'integ-email', label: 'E-mail', href: '/app/integrations/email', icon: 'Mail', permission: 'settings' },
        { id: 'integ-sms', label: 'SMS', href: '/app/integrations/sms', icon: 'MessageSquare', permission: 'settings' },
        { id: 'integ-ai', label: 'IA / Tokens', href: '/app/integrations/ai', icon: 'Brain', permission: 'settings' },
        { id: 'integ-dns', label: 'DNS', href: '/app/integrations/dns', icon: 'Globe', permission: 'settings' },
        { id: 'integ-webhooks', label: 'Webhooks de Saída', href: '/app/integrations/webhooks', icon: 'Webhook', permission: 'apikeys' },
        { id: 'integ-inbound-webhooks', label: 'Webhooks de Entrada', href: '/app/integrations/inbound-webhooks', icon: 'Webhook', permission: 'apikeys' },
        { id: 'integ-db-connectors', label: 'Conector de BD', href: '/app/integrations/db-connectors', icon: 'Database', permission: 'apikeys' },
        { id: 'integ-api-keys', label: 'API Keys', href: '/app/integrations/api-keys', icon: 'Key', permission: 'apikeys' },
        { id: 'integ-payments', label: 'Pagamentos', href: '/app/integrations/payments', icon: 'CreditCard', permission: 'settings' },
        { id: 'integ-kommo', label: 'Kommo CRM', href: '/app/integrations/kommo', icon: 'Plug', permission: 'settings' },
        { id: 'integ-crmedu', label: 'CRM Educacional', href: '/app/integrations/crm-educacional', icon: 'GraduationCap', permission: 'settings' },
      ],
      initiallyCollapsed: true,
    },
    {
      id: 'cadastros',
      label: 'Cadastros',
      items: [
        { id: 'funnels', label: 'Funis', href: '/app/funnels', icon: 'GitFork', permission: 'funnels' },
        { id: 'tags', label: 'Etiquetas', href: '/app/tags', icon: 'Tag', permission: 'tags' },
        // Modelos: cadastro operacional usado em cadências/atividades. Gated
        // por 'leads' (não mais 'captacao') — AGENT já possui leads, evita
        // exigir role administrativo para item de gestão de mensagens.
        { id: 'templates', label: 'Modelos', href: '/app/templates', icon: 'FileText', permission: 'leads' },
        { id: 'personas', label: 'Personas / ICPs', href: '/app/personas', icon: 'Users', permission: 'tools' },
        { id: 'cad-teams', label: 'Equipes', href: '/app/cadastros/teams', icon: 'Users', permission: 'settings' },
        { id: 'cad-routing', label: 'Roteamento de Leads', href: '/app/cadastros/routing', icon: 'Map', permission: 'settings' },
        // Importar leads: operação administrativa de carga em massa. Gated por
        // 'settings' — MANAGER/ADMIN/SUPERADMIN têm; AGENT e VIEWER não.
        { id: 'cad-leads-import', label: 'Importar leads', href: '/app/leads/import', icon: 'Upload', permission: 'settings' },
        // Objeções (motivos de perda): operador usa ao marcar lead como perdido.
        // Gated por 'leads' para AGENT poder visualizar/escolher; CRUD continua
        // restrito por canCreate/canEdit/canDelete no backend.
        { id: 'cad-loss-reasons', label: 'Objeções', href: '/app/cadastros/loss-reasons', icon: 'XCircle', permission: 'leads' },
        // Resumos: catálogo do módulo status_summary (nasce OFF). Gated pelo
        // próprio módulo — tenant que não usa não vê o item.
        { id: 'cad-status-summaries', label: 'Resumos', href: '/app/cadastros/status-summaries', icon: 'Tag', permission: 'status_summary' },
        { id: 'cad-custom-fields', label: 'Campos personalizados', href: '/app/cadastros/custom-fields', icon: 'Database', permission: 'settings' },
        { id: 'cad-business-hours', label: 'Atendimento', href: '/app/cadastros/business-hours', icon: 'Clock', permission: 'settings' },
      ],
      initiallyCollapsed: true,
    },
    // ── Educacional (base) — catálogo + processo seletivo + Portal de Matrículas.
    //    É o "produto" do cliente que tem Educacional+Portal SEM ERP. Tudo aqui é
    //    permission 'educacional' ou 'enrollment_portals' (independem do ERP). ──
    {
      id: 'educational',
      label: 'Educacional',
      items: [
        { id: 'educational', label: 'Visão geral', href: '/app/educational', icon: 'GraduationCap', permission: 'educacional' },
        { id: 'he-market', label: 'Mercado (Ensino Superior)', href: '/app/he-market', icon: 'Target', permission: 'higher_ed_market' },
        { id: 'edu-units', label: 'Unidades', href: '/app/educational/units', icon: 'Building2', permission: 'educacional' },
        { id: 'edu-campuses', label: 'Campus', href: '/app/educational/campuses', icon: 'MapPin', permission: 'educacional' },
        { id: 'edu-levels', label: 'Níveis', href: '/app/educational/levels', icon: 'GraduationCap', permission: 'educacional' },
        { id: 'edu-modalities', label: 'Modalidades', href: '/app/educational/modalities', icon: 'Layers', permission: 'educacional' },
        { id: 'edu-courses', label: 'Cursos', href: '/app/educational/courses', icon: 'BookOpen', permission: 'educacional' },
        { id: 'edu-offerings', label: 'Ofertas', href: '/app/educational/offerings', icon: 'CalendarRange', permission: 'educacional' },
        { id: 'edu-entry-modes', label: 'Modos de ingresso', href: '/app/educational/entry-modes', icon: 'Award', permission: 'educacional' },
        { id: 'edu-selection-processes', label: 'Processos seletivos', href: '/app/educational/selection-processes', icon: 'FileCheck2', permission: 'educacional' },
        { id: 'edu-doc-review', label: 'Revisão de documentos', href: '/app/educational/doc-review', icon: 'ClipboardList', permission: 'educacional' },
        { id: 'edu-evaluations', label: 'Avaliações', href: '/app/educational/evaluations', icon: 'Award', permission: 'educacional' },
        { id: 'enrollment-portals', label: 'Portal de Matrículas', href: '/app/enrollment-portals', icon: 'School', permission: 'enrollment_portals' },
      ],
      initiallyCollapsed: true,
    },
    // ── ERP Acadêmico (add-on) — só aparece quando os sub-módulos aca_* estão
    //    ativos. Cada grupo some inteiro se o cliente não tiver aquele bloco. ──
    {
      id: 'erp-estrutura',
      label: 'ERP · Estrutura & Cadastros',
      items: [
        { id: 'aca-estrutura', label: 'Estrutura Acadêmica', href: '/app/aca/estrutura', icon: 'Layers', permission: 'aca_estrutura' },
        { id: 'aca-curriculo', label: 'Currículo', href: '/app/aca/curriculo', icon: 'GitFork', permission: 'aca_estrutura' },
        { id: 'aca-cadastros', label: 'Cadastros auxiliares', href: '/app/aca/cadastros', icon: 'Boxes', permission: 'aca_cadastros' },
        { id: 'aca-importacao', label: 'Importação de dados', href: '/app/aca/importacao', icon: 'Upload', permission: 'aca_cadastros' },
      ],
      initiallyCollapsed: true,
    },
    {
      id: 'erp-academico',
      label: 'ERP · Acadêmico',
      items: [
        { id: 'aca-instituicao', label: 'Instituição', href: '/app/aca/instituicao', icon: 'Building2', permission: 'aca_matriculas' },
        { id: 'aca-matrizes', label: 'Matrizes curriculares', href: '/app/aca/matrizes', icon: 'Layers', permission: 'aca_matriculas' },
        { id: 'aca-vinculos', label: 'Vínculos acadêmicos', href: '/app/aca/vinculos', icon: 'GraduationCap', permission: 'aca_matriculas' },
        { id: 'aca-esquemas', label: 'Esquemas de avaliação', href: '/app/aca/esquemas', icon: 'Gavel', permission: 'aca_pedagogico' },
        { id: 'aca-equivalencias', label: 'Equivalências', href: '/app/aca/equivalencias', icon: 'GitFork', permission: 'aca_pedagogico' },
        { id: 'aca-pessoas', label: 'Pessoas', href: '/app/aca/pessoas', icon: 'Users', permission: 'aca_matriculas' },
        { id: 'aca-alunos', label: 'Alunos', href: '/app/aca/alunos', icon: 'GraduationCap', permission: 'aca_matriculas' },
        { id: 'aca-matriculas', label: 'Matrículas', href: '/app/aca/matriculas', icon: 'ClipboardList', permission: 'aca_matriculas' },
        { id: 'aca-movimentacoes', label: 'Movimentações', href: '/app/aca/movimentacoes', icon: 'Repeat', permission: 'aca_movimentacoes' },
        { id: 'aca-diario', label: 'Diário de Classe', href: '/app/aca/diario', icon: 'BookOpen', permission: 'aca_pedagogico' },
        { id: 'aca-conselho', label: 'Conselho de Classe', href: '/app/aca/conselho', icon: 'Gavel', permission: 'aca_pedagogico' },
        { id: 'aca-calendario', label: 'Calendário', href: '/app/aca/calendario', icon: 'CalendarRange', permission: 'aca_pedagogico' },
        { id: 'aca-acesso', label: 'Controle de Acesso', href: '/app/aca/acesso', icon: 'Key', permission: 'aca_acesso' },
        { id: 'aca-docente', label: 'Docentes / RH', href: '/app/aca/docente', icon: 'School', permission: 'aca_docente' },
        { id: 'aca-producao-docente', label: 'Produção docente', href: '/app/aca/producao-docente', icon: 'Clock', permission: 'aca_docente' },
        { id: 'aca-ead', label: 'EAD / LMS', href: '/app/aca/ead', icon: 'Cloud', permission: 'aca_ead' },
        { id: 'aca-alocacao', label: 'Alocação de Recursos', href: '/app/aca/alocacao', icon: 'MapPin', permission: 'aca_alocacao' },
        { id: 'aca-vestibular', label: 'Vestibular (classificação)', href: '/app/aca/vestibular', icon: 'ClipboardList', permission: 'aca_vestibular' },
        { id: 'aca-provas', label: 'Prova online', href: '/app/aca/provas', icon: 'PenLine', permission: 'aca_vestibular' },
      ],
      initiallyCollapsed: true,
    },
    {
      id: 'erp-secretaria',
      label: 'ERP · Secretaria',
      items: [
        { id: 'aca-secretaria', label: 'Secretaria', href: '/app/aca/secretaria', icon: 'FileText', permission: 'aca_secretaria' },
        { id: 'aca-requerimentos', label: 'Requerimentos', href: '/app/aca/requerimentos', icon: 'Inbox', permission: 'aca_secretaria' },
        { id: 'aca-estagio', label: 'Estágio & Atividades', href: '/app/aca/estagio', icon: 'Briefcase', permission: 'aca_secretaria' },
        { id: 'aca-tcc', label: 'TCC', href: '/app/aca/tcc', icon: 'BookOpen', permission: 'aca_secretaria' },
        { id: 'aca-ged', label: 'GED (Documentos)', href: '/app/aca/ged', icon: 'FileCheck2', permission: 'aca_ged' },
        { id: 'aca-acervo', label: 'Acervo acadêmico', href: '/app/aca/acervo', icon: 'Archive', permission: 'aca_ged' },
        { id: 'aca-regime-especial', label: 'Regime especial', href: '/app/aca/regime-especial', icon: 'HeartPulse', permission: 'aca_secretaria' },
        { id: 'aca-assinatura', label: 'Assinatura de Contratos', href: '/app/aca/assinatura', icon: 'FileSignature', permission: 'aca_assinatura' },
        { id: 'aca-egressos', label: 'Egressos', href: '/app/aca/egressos', icon: 'Award', permission: 'aca_secretaria' },
        { id: 'aca-diploma', label: 'Diploma Digital', href: '/app/aca/diploma', icon: 'ShieldCheck', permission: 'aca_diploma' },
        { id: 'aca-qualificacoes', label: 'Qualificação profissional', href: '/app/aca/qualificacoes', icon: 'Award', permission: 'aca_secretaria' },
        { id: 'aca-reconhecimento', label: 'Reconhecimento de saberes', href: '/app/aca/reconhecimento', icon: 'ScrollText', permission: 'aca_secretaria' },
        { id: 'aca-portais-plus', label: 'Centrais (Resp./Ex-aluno)', href: '/app/aca/portais', icon: 'Key', permission: 'aca_portais_plus' },
        { id: 'aca-comunicacao', label: 'Comunicação', href: '/app/aca/comunicacao', icon: 'MessageSquare', permission: 'aca_comunicacao' },
      ],
      initiallyCollapsed: true,
    },
    {
      id: 'erp-financeiro',
      label: 'ERP · Financeiro',
      items: [
        { id: 'aca-financeiro', label: 'Financeiro', href: '/app/aca/financeiro', icon: 'Wallet', permission: 'aca_financeiro' },
        { id: 'aca-fin-banco', label: 'Financeiro Bancário', href: '/app/aca/fin-banco', icon: 'CreditCard', permission: 'aca_financeiro_bancario' },
        { id: 'aca-cobranca-fiscal', label: 'Cobrança Judicial & Fiscal', href: '/app/aca/cobranca-fiscal', icon: 'Gavel', permission: 'aca_cobranca_fiscal' },
      ],
      initiallyCollapsed: true,
    },
    {
      id: 'erp-relatorios',
      label: 'ERP · Relatórios',
      items: [
        { id: 'aca-bi', label: 'Indicadores (BI)', href: '/app/aca/bi', icon: 'BarChart3', permission: 'aca_relatorios' },
        { id: 'aca-gestao', label: 'Painel de gestão', href: '/app/aca/gestao', icon: 'LayoutDashboard', permission: 'aca_relatorios' },
        { id: 'aca-evasao', label: 'Risco de evasão', href: '/app/aca/evasao', icon: 'TrendingDown', permission: 'aca_relatorios' },
        { id: 'aca-enade', label: 'Regularidade ENADE', href: '/app/aca/enade', icon: 'ShieldAlert', permission: 'aca_relatorios' },
        { id: 'aca-avaliacao-inst', label: 'Avaliação Institucional (CPA)', href: '/app/aca/avaliacao-inst', icon: 'BarChart3', permission: 'aca_avaliacao_institucional' },
        { id: 'aca-sistec', label: 'Censo / SISTEC', href: '/app/aca/sistec', icon: 'Database', permission: 'aca_relatorios' },
        { id: 'aca-censo', label: 'Censo INEP / ENADE', href: '/app/aca/censo', icon: 'FileSpreadsheet', permission: 'aca_relatorios' },
      ],
      initiallyCollapsed: true,
    },
  ],
  footer: [
    { id: 'users', label: 'Usuários', href: '/app/users', icon: 'Users', permission: 'users' },
    { id: 'module-permissions', label: 'Permissões', href: '/app/module-permissions', icon: 'ShieldCheck', permission: 'users' },
    // Sem `permission` de propósito: item sem chave declarada só o SUPERADMIN
    // enxerga (regra do SidebarBody), e é exatamente quem pode editar a matriz
    // — ela amplia o alcance de um papel para além do escopo dele.
    { id: 'conversation-access', label: 'Acesso ao Conversas', href: '/app/conversation-access', icon: 'MessageSquare' },
    { id: 'settings', label: 'Configurações', href: '/app/settings', icon: 'Settings', permission: 'settings' },
  ],
}

/** Lista plana de todos os itens — usada pelo Cmd+K e por busca. */
export function flattenItems(schema: SidebarSchema = sidebarSchema): SidebarItem[] {
  return [...schema.pinned, ...schema.groups.flatMap((g) => g.items), ...schema.footer]
}

/** Encontra item por id ou href. */
export function findItem(idOrHref: string, schema: SidebarSchema = sidebarSchema): SidebarItem | undefined {
  return flattenItems(schema).find((i) => i.id === idOrHref || i.href === idOrHref)
}

/** A rota está dentro deste href? (exato ou como pai de uma sub-rota) */
function matchesHref(location: string, href: string): boolean {
  // A barra no fim evita que `/app/leads` case com `/app/leads-import`.
  return location === href || location.startsWith(`${href}/`)
}

// Uma varredura por rota, não uma por item do menu: sem isto cada um dos ~120
// itens percorreria a lista inteira a cada render.
let activeHrefCache: { location: string; href: string | null } | null = null

/**
 * Href do item que "possui" a rota atual — o match mais específico.
 *
 * `/app/leads/duplicates` casa por prefixo tanto com Leads quanto com
 * Duplicados; quem vence é o href mais longo, senão os dois acendem juntos.
 * Já `/app/leads/482` (detalhe do lead, fora do menu) não casa com nenhum
 * href mais longo e continua acendendo Leads, que é o certo.
 */
export function activeHref(location: string, schema: SidebarSchema = sidebarSchema): string | null {
  const cacheable = schema === sidebarSchema
  if (cacheable && activeHrefCache?.location === location) return activeHrefCache.href

  let best: string | null = null
  for (const item of flattenItems(schema)) {
    if (matchesHref(location, item.href) && (best === null || item.href.length > best.length)) {
      best = item.href
    }
  }

  if (cacheable) activeHrefCache = { location, href: best }
  return best
}

/** O item é o dono da rota atual? Usado pelo destaque do menu. */
export function isItemActive(location: string, href: string, schema: SidebarSchema = sidebarSchema): boolean {
  return activeHref(location, schema) === href
}
