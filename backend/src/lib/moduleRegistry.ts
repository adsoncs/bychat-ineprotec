// src/lib/moduleRegistry.ts
// Registro centralizado dos módulos do sistema — source of truth para backend e frontend

export interface ModuleDefinition {
  id: string
  name: string
  icon: string
  category: string
  description: string         // descrição curta para a UI de gerenciamento
  pages: string[]
  routePrefixes: string[]
  actions: ('view' | 'create' | 'edit' | 'delete')[]
  core?: boolean              // true = não pode ser desativado (módulos essenciais)
  defaultEnabled?: boolean    // true = vem ligado por padrão (default: true para core, false para os demais)
}

export const MODULE_REGISTRY: ModuleDefinition[] = [
  {
    id: 'dashboard', name: 'Dashboard', icon: '📊', category: 'overview',
    description: 'Visão geral consolidada com widgets configuráveis e métricas-chave.',
    pages: ['dashboard'],
    routePrefixes: ['/api/admin/widget-data', '/api/admin/user-dashboards', '/api/admin/dashboard', '/api/admin/team-metrics', '/api/bychat/stats'],
    actions: ['view', 'create', 'edit', 'delete'],
    core: true, defaultEnabled: true,
  },
  {
    id: 'atendimento', name: 'Conversas', icon: '💬', category: 'crm',
    description: 'Inbox unificada de atendimento — WhatsApp, Instagram, Email em um só lugar.',
    pages: ['atendimento'],
    routePrefixes: ['/api/atendimento', '/api/bychat/chat'],
    actions: ['view', 'create', 'edit', 'delete'],
    core: true, defaultEnabled: true,
  },
  {
    id: 'leads', name: 'Leads', icon: '👥', category: 'crm',
    description: 'Cadastro e gestão de leads/contatos com histórico, campos personalizados e segmentação.',
    pages: ['leads'],
    routePrefixes: [
      '/api/bychat/leads', '/api/admin/leads', '/api/leads',
      '/api/saved-filters', '/api/applied-filter',
      // Modelos e Objeções: cadastros usados pelo operador no dia a dia do
      // trabalho com leads (cadência/atividade + marcar lead como Perdido).
      // Alinhado com sidebar (permission='leads') — não está em 'captacao'
      // nem 'settings' que são gating administrativo.
      '/api/templates', '/api/admin/templates', '/api/loss-reasons', '/api/admin/loss-reasons',
    ],
    actions: ['view', 'create', 'edit', 'delete'],
    core: true, defaultEnabled: true,
  },
  {
    id: 'intelligence', name: 'Inteligência', icon: '🧠', category: 'crm',
    description: 'Análise inteligente de leads, score, enriquecimento e recomendações via IA.',
    pages: ['intelligence'],
    routePrefixes: ['/api/bychat/leads', '/api/admin/ai-journey', '/api/admin/conversation-audits', '/api/admin/scoring-config', '/api/admin/enrichment', '/api/bychat/enrichment', '/api/bychat/analyze'],
    actions: ['view', 'create', 'edit', 'delete'],
    defaultEnabled: true,
  },
  {
    id: 'kanban', name: 'Kanban', icon: '📋', category: 'crm',
    description: 'Visualização em colunas (drag & drop) de leads por etapa do funil.',
    pages: ['kanban'],
    routePrefixes: ['/api/admin/kanban'],
    actions: ['view', 'create', 'edit', 'delete'],
    core: true, defaultEnabled: true,
  },
  {
    id: 'funnels', name: 'Funis', icon: '🔀', category: 'crm',
    description: 'Configuração de pipelines/funis com etapas customizáveis para diferentes processos comerciais.',
    pages: ['funnels'],
    routePrefixes: ['/api/admin/funnels', '/api/admin/stages'],
    actions: ['view', 'create', 'edit', 'delete'],
    core: true, defaultEnabled: true,
  },
  {
    id: 'activities', name: 'Atividades', icon: '📅', category: 'crm',
    description: 'Tarefas, ligações, reuniões e follow-ups vinculados aos leads — com agenda e notificações.',
    pages: ['activities'],
    routePrefixes: ['/api/admin/activities', '/api/activities'],
    actions: ['view', 'create', 'edit', 'delete'],
    defaultEnabled: true,
  },
  {
    id: 'scheduling', name: 'Agendamentos', icon: '📅', category: 'crm',
    description: 'Agendamento de reuniões (estilo Calendly): tipos de reunião, disponibilidade, página pública, Google Meet e integração com leads/funil.',
    pages: ['scheduling'],
    routePrefixes: ['/api/admin/scheduling', '/api/scheduling'],
    actions: ['view', 'create', 'edit', 'delete'],
    defaultEnabled: false,
  },
  {
    id: 'tags', name: 'Tags', icon: '🏷', category: 'crm',
    description: 'Etiquetagem de leads para segmentação e filtros rápidos.',
    pages: ['tags'],
    routePrefixes: ['/api/admin/tags', '/api/tags'],
    actions: ['view', 'create', 'edit', 'delete'],
    defaultEnabled: true,
  },
  {
    id: 'workflows', name: 'Automação', icon: '⚡', category: 'automacao',
    description: 'Workflows automáticos disparados por eventos — emails, mensagens, webhooks, integrações.',
    pages: ['workflows', 'queuemonitor'],
    routePrefixes: ['/api/admin/workflows', '/api/admin/queues', '/api/admin/workflow-executions'],
    actions: ['view', 'create', 'edit', 'delete'],
    defaultEnabled: true,
  },
  {
    id: 'sales_engagement', name: 'Cadências de Vendas', icon: '📣', category: 'automacao',
    description: 'Cadências outbound (WhatsApp/email/SMS) com governança, classificação IA de respostas, opt-out e métricas.',
    pages: ['sales-cadences'],
    routePrefixes: ['/api/admin/sales-cadences', '/api/admin/channel-governance'],
    actions: ['view', 'create', 'edit', 'delete'],
    defaultEnabled: true,
  },
  {
    id: 'captacao', name: 'Captação', icon: '🎯', category: 'captacao',
    description: 'Landing pages, formulários, chatbots e templates de captura de leads.',
    pages: ['landingpages', 'forms', 'chatbots', 'templates'],
    routePrefixes: [
      '/api/admin/pages', '/api/admin/forms', '/api/admin/chatbots',
      '/api/admin/inbound-webhooks',
      // Endpoints sem /admin
      '/api/pages', '/api/forms', '/api/chatbots',
      // templates ficou em 'leads' (cadastro do operador, não captacao admin)
    ],
    actions: ['view', 'create', 'edit', 'delete'],
    defaultEnabled: true,
  },
  {
    id: 'marketing', name: 'Marketing', icon: '📢', category: 'marketing',
    description: 'Meta Ads, links rastreáveis, origens UTM e tracking unificado de campanhas.',
    pages: ['meta', 'trackablelinks', 'origins', 'tracking'],
    routePrefixes: [
      '/api/admin/meta', '/api/admin/trackable-links', '/api/admin/origins', '/api/admin/tracking',
      '/api/meta', '/api/tracking',
    ],
    actions: ['view', 'create', 'edit', 'delete'],
    defaultEnabled: true,
  },
  {
    id: 'vendas', name: 'Vendas & Anúncios', icon: '💰', category: 'vendas',
    description: 'Gestão de vendas detectadas e relatório de Meta Ads (investimento, leads, ROAS).',
    pages: ['sales', 'meta-ads-report'],
    routePrefixes: ['/api/admin/sales', '/api/admin/meta-ads-report', '/api/admin/reports', '/api/admin/conversions', '/api/admin/payments', '/api/admin/coupons'],
    actions: ['view', 'create', 'edit', 'delete'],
    defaultEnabled: true,
  },
  {
    id: 'whatsapp', name: 'WhatsApp', icon: '📱', category: 'canais',
    description: 'Conexão de instâncias (Evolution/Cloud API), envio em massa e templates oficiais Meta.',
    pages: ['whatsapp', 'cloudapi', 'metatemplates'],
    routePrefixes: [
      '/api/admin/instances', '/api/admin/cloud-api', '/api/admin/whatsapp',
      '/api/whatsapp', '/api/cloud-api', '/api/instagram', '/api/telegram',
      '/api/oauth',
    ],
    actions: ['view', 'create', 'edit', 'delete'],
    defaultEnabled: true,
  },
  {
    id: 'broadcast', name: 'Disparos em Massa', icon: '🚀', category: 'marketing',
    description: 'Campanhas de envio em massa via WhatsApp Oficial (Cloud API) com templates HSM, seleção de leads ou importação de base, métricas e custo.',
    pages: ['broadcast'],
    routePrefixes: ['/api/admin/broadcast', '/api/broadcast'],
    actions: ['view', 'create', 'edit', 'delete'],
    defaultEnabled: true,
  },
  {
    id: 'google', name: 'Google', icon: '🔗', category: 'integracoes',
    description: 'Integrações Google: Sheets, Calendar, Drive, Ads, GA4, Gmail, Tasks, Looker e Make.',
    pages: ['googlesheets', 'googlecalendar', 'googledrive', 'googleads', 'ga4', 'gmail', 'googletasks', 'lookerstudio', 'make'],
    routePrefixes: [
      '/api/admin/google', '/api/admin/ga4', '/api/admin/gmail', '/api/v1/looker',
      '/api/integrations/google',
    ],
    actions: ['view', 'create', 'edit', 'delete'],
    defaultEnabled: true,
  },
  {
    id: 'educacional', name: 'Educacional', icon: '🎓', category: 'educacional',
    description: 'Gestão acadêmica: unidades, campus, cursos, modalidades, ofertas, processos seletivos e matrículas. Ideal para escolas, faculdades e cursos.',
    pages: ['eduDashboard', 'eduLevels', 'eduModalities', 'eduUnits', 'eduCampuses', 'eduCourses', 'eduOfferings', 'eduSelectionProcesses'],
    routePrefixes: ['/api/admin/educacional', '/api/admin/enrollment-registrations', '/api/admin/enrollment-documents', '/api/admin/enrollment-document-reviews', '/api/admin/enem-imports', '/api/admin/essay-submissions', '/api/admin/registrations', '/api/admin/presencial-exams'],
    actions: ['view', 'create', 'edit', 'delete'],
    defaultEnabled: false,
  },
  {
    id: 'settings', name: 'Configurações', icon: '⚙', category: 'config',
    description: 'Configurações gerais do sistema, aparência e campos personalizados.',
    pages: ['settings', 'appearance', 'customfields'],
    routePrefixes: [
      '/api/admin/settings', '/api/admin/appearance', '/api/admin/custom-fields',
      '/api/admin/routing', '/api/admin/system-emails', '/api/admin/business-hours',
      '/api/admin/make', '/api/admin/evolution-monitor', '/api/admin/evolution',
      '/api/admin/landing-contact', '/api/admin/user-module-overrides', '/api/admin/sms',
      '/api/admin/agents', '/api/admin/default-team', '/api/admin/payment-providers',
      // Endpoints sem /admin
      '/api/custom-fields',
      // loss-reasons ficou em 'leads' (cadastro do operador, usado ao marcar lead Perdido)
    ],
    actions: ['view', 'create', 'edit', 'delete'],
    core: true, defaultEnabled: true,
  },
  {
    id: 'users', name: 'Usuários', icon: '👤', category: 'config',
    description: 'Cadastro de usuários, roles e permissões granulares por módulo.',
    pages: ['users', 'module-permissions'],
    routePrefixes: ['/api/admin/users'],
    actions: ['view', 'create', 'edit', 'delete'],
    core: true, defaultEnabled: true,
  },
  {
    id: 'teams', name: 'Equipes', icon: '👥', category: 'config',
    description: 'Setores de atendimento (Comercial, Financeiro, Suporte) e seus membros.',
    pages: ['teams'],
    routePrefixes: ['/api/admin/teams', '/api/teams'],
    actions: ['view', 'create', 'edit', 'delete'],
    core: true, defaultEnabled: true,
  },
  {
    id: 'enrollment_portals', name: 'Portal de Matrículas', icon: '🎓', category: 'educacional',
    description: 'Portais públicos de inscrição/matrícula (educacional). Vincula processos seletivos e coleta candidatos.',
    pages: ['enrollment-portals'],
    routePrefixes: ['/api/admin/enrollment-portals'],
    actions: ['view', 'create', 'edit', 'delete'],
    defaultEnabled: true,
  },
  {
    id: 'security', name: 'Segurança', icon: '🛡', category: 'config',
    description: 'Logs de acesso, sessões, IPs bloqueados e auditoria de ações.',
    pages: ['security'],
    routePrefixes: ['/api/admin/security'],
    actions: ['view', 'create', 'edit', 'delete'],
    defaultEnabled: true,
  },
  {
    id: 'apikeys', name: 'API & Webhooks', icon: '🔑', category: 'config',
    description: 'Geração de API Keys e configuração de webhooks de saída para integrações externas.',
    pages: ['apikeys', 'webhooks'],
    routePrefixes: ['/api/admin/api-keys', '/api/admin/webhooks'],
    actions: ['view', 'create', 'edit', 'delete'],
    defaultEnabled: true,
  },
  {
    id: 'installations', name: 'Instalações', icon: '🏢', category: 'admin',
    description: 'Gestão multi-tenant de instalações (apenas SUPERADMIN), lixeira e roadmap.',
    pages: ['installations', 'trash', 'roadmap'],
    routePrefixes: ['/api/admin/installations', '/api/admin/trash'],
    actions: ['view', 'create', 'edit', 'delete'],
    core: true, defaultEnabled: true,
  },
  {
    id: 'tools', name: 'Ferramentas', icon: '🛠', category: 'ferramentas',
    description: 'Utilitários do dia-a-dia: UTM Builder, Link de WhatsApp, QR Code, URL Inspector e Personas/ICPs. Não afeta dados de leads — pode ser desativado sem impacto operacional.',
    pages: ['utms', 'whatsapp-link', 'qr', 'url-inspector', 'personas'],
    routePrefixes: ['/api/admin/utms', '/api/admin/tools', '/api/admin/personas'],
    actions: ['view', 'create', 'edit', 'delete'],
    defaultEnabled: true,
  },
  {
    id: 'helpdesk', name: 'Helpdesk / Chamados', icon: '🎫', category: 'support',
    description: 'Central de chamados/tickets de suporte com protocolo, prioridade, tipos, atribuição por setor, thread público/interno e timeline. Base para SLA, automações, base de conhecimento e portal do cliente (módulo em construção).',
    pages: ['helpdesk'],
    routePrefixes: ['/api/helpdesk', '/api/admin/helpdesk'],
    actions: ['view', 'create', 'edit', 'delete'],
    defaultEnabled: false,
  },
  {
    id: 'voip', name: 'VoIP', icon: '📞', category: 'integracoes',
    description: 'Telefonia integrada (FaleMaisVoip): click-to-call pelo ramal do operador, registro de ligações como atividade e sincronização de gravações.',
    pages: ['voip'],
    // O callback público de gravações fica fora de /api/voip (não exige auth/gating).
    routePrefixes: ['/api/admin/voip', '/api/voip'],
    actions: ['view', 'create', 'edit', 'delete'],
    defaultEnabled: false,
  },
]

export function getModuleForRoute(path: string): ModuleDefinition | undefined {
  return MODULE_REGISTRY.find(m => m.routePrefixes.some(p => path.startsWith(p)))
}

export function getModuleForPage(page: string): ModuleDefinition | undefined {
  return MODULE_REGISTRY.find(m => m.pages.includes(page))
}

export function getAllModuleIds(): string[] {
  return MODULE_REGISTRY.map(m => m.id)
}
