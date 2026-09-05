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
  /**
   * Ao ser semeado pela PRIMEIRA vez, herda o `active` deste outro módulo.
   *
   * Existe para desmembrar um módulo sem ligar nem desligar nada em produção:
   * quem tinha o módulo-pai ligado continua com as funções ligadas, quem tinha
   * desligado continua sem. Só vale no seed inicial — depois disso o toggle do
   * admin manda, como em qualquer outro módulo.
   */
  inheritFrom?: string
  dependsOn?: string[]        // ids de módulos exigidos: ligar este liga as dependências; não dá pra desligar uma dependência com dependentes ativos
}

export const MODULE_REGISTRY: ModuleDefinition[] = [
  {
    // O sino de alertas. `core` porque desligá-lo cala tudo de uma vez —
    // integração morta, linha caída, proposta esquecida — e o resto do sistema
    // conta com ele para não sofrer em silêncio. Quem não quer um TIPO de
    // alerta silencia aquele tipo, não a caixa inteira.
    id: 'alerts', name: 'Alertas', icon: '🔔', category: 'overview',
    description: 'Caixa de alertas do time: integração fora do ar, prazo estourado e trabalho parado.',
    pages: [],
    routePrefixes: ['/api/alerts'],
    actions: ['view', 'edit'],
    core: true, defaultEnabled: true,
  },
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
    routePrefixes: ['/api/atendimento', '/api/bychat/chat', '/api/admin/conversation-access'],
    actions: ['view', 'create', 'edit', 'delete'],
    core: true, defaultEnabled: true,
  },
  {
    id: 'contatos', name: 'Contatos', icon: '📇', category: 'crm',
    description: 'Quem já conversou com a empresa e ainda não virou Lead. Mesma ficha do Lead, num estado anterior.',
    pages: ['contatos'],
    routePrefixes: ['/api/contatos'],
    actions: ['view', 'create', 'edit', 'delete'],
    core: true, defaultEnabled: true,
  },
  {
    id: 'supervision', name: 'Supervisão', icon: '🎧', category: 'crm',
    description: 'Painel gerencial do Conversas: baldes, KPIs, quem conduz (bot ou humano), canal, funil e ações sobre as conversas.',
    pages: ['supervision'],
    routePrefixes: ['/api/supervision'],
    actions: ['view', 'edit'],
    // Vive colado no Conversas (core): nasce ligado junto com ele. O recorte de
    // quem entra é por papel — VIEWER não recebe canView no preset padrão e o
    // backend ainda exige SUPERADMIN/ADMIN/MANAGER.
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
    description: 'Lead score, enriquecimento de dados e análise de leads por IA.',
    pages: ['intelligence'],
    // `/api/bychat/leads` saiu daqui: o módulo `leads` já reivindica esse
    // prefixo, e `getModuleForRoute` é um `.find()` — quem ganhava era só quem
    // estivesse declarado primeiro no arquivo. Uma reordenação inocente do
    // registry tiraria a tela de Leads de todo tenant com Inteligência
    // desligada. Jornada IA e Auditoria de Conversas viraram módulos próprios
    // logo abaixo: fazem coisas sem parentesco com score e enriquecimento, e
    // ligá-las obrigava a ligar tudo junto.
    routePrefixes: ['/api/admin/scoring-config', '/api/admin/enrichment', '/api/bychat/enrichment', '/api/bychat/analyze'],
    actions: ['view', 'create', 'edit', 'delete'],
    defaultEnabled: true,
  },
  {
    id: 'ai_journey', name: 'Jornada IA', icon: '✨', category: 'crm',
    description: 'A IA acompanha a conversa e sugere (ou aplica) a próxima etapa do funil, por funil.',
    pages: ['ai-journey'],
    routePrefixes: ['/api/admin/ai-journey'],
    actions: ['view', 'create', 'edit', 'delete'],
    defaultEnabled: true,
    inheritFrom: 'intelligence',
  },
  {
    id: 'conversation_audit', name: 'Auditoria de Conversas', icon: '🔎', category: 'crm',
    description: 'Avaliação por IA do atendimento já realizado, com nota por operador e por conversa.',
    pages: ['conversation-audit'],
    routePrefixes: ['/api/admin/conversation-audits'],
    actions: ['view', 'create', 'edit', 'delete'],
    defaultEnabled: true,
    inheritFrom: 'intelligence',
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
    id: 'smart_broadcast', name: 'Disparos Inteligentes', icon: '🧠', category: 'marketing',
    description: 'Campanhas pelos números próprios conectados (Evolution), com ritmo humanizado, simulação de digitação, variações de texto, aquecimento e proteção automática do número.',
    pages: ['smart-broadcast'],
    routePrefixes: ['/api/admin/smart-broadcast'],
    actions: ['view', 'create', 'edit', 'delete'],
    // Nasce DESLIGADO: envio por número próprio é decisão consciente do tenant
    // (fora dos termos oficiais do WhatsApp e com risco de bloqueio do chip).
    defaultEnabled: false,
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
  // ── ERP Acadêmico (sub-módulos, guarda-chuva "educacional") ──
  // O ERP foi quebrado em 8 sub-módulos toggláveis. As dependências são de DADOS
  // (FKs obrigatórias) e formam uma cadeia: educacional → estrutura → matrículas →
  // {financeiro, pedagógico, secretaria, comunicação, portais, relatórios}.
  // Ligar um filho liga os pais (cascata em setModuleEnabled); não dá pra desligar
  // um pai com filhos ativos (bloqueio em /modules/:id/toggle).
  {
    id: 'aca_estrutura', name: 'Estrutura Acadêmica', icon: '🏛', category: 'erp_academico',
    description: 'Disciplinas, matriz curricular, turmas, períodos letivos e planos de pagamento. Base do ERP — vincula cursos/ofertas do módulo Educacional.',
    pages: ['acaEstrutura'],
    routePrefixes: [
      '/api/admin/aca/disciplinas', '/api/admin/aca/matrizes', '/api/admin/aca/turmas',
      '/api/admin/aca/periodos', '/api/admin/aca/ofertas', '/api/admin/aca/planos-pagamento',
      '/api/admin/aca/componentes', '/api/admin/aca/pre-requisitos', '/api/admin/aca/curriculo',
    ],
    actions: ['view', 'create', 'edit', 'delete'],
    defaultEnabled: false, dependsOn: ['educacional'],
  },
  {
    id: 'aca_alocacao', name: 'Alocação de Recursos', icon: '🏫', category: 'erp_academico',
    description: 'Ambientes físicos (salas/laboratórios) e tipos, equipamentos e tipos, e reservas de espaço com detecção de conflito de horário.',
    pages: ['acaAlocacao'],
    routePrefixes: ['/api/admin/aca/alocacao'],
    actions: ['view', 'create', 'edit', 'delete'],
    defaultEnabled: false, dependsOn: ['aca_estrutura'],
  },
  {
    id: 'aca_matriculas', name: 'Alunos & Matrículas', icon: '🎓', category: 'erp_academico',
    description: 'Alunos (sobre o CRM), inscrições e matrícula com ciclo de vida (máquina de estados). Núcleo de cadastro do aluno.',
    pages: ['acaAlunos', 'acaMatriculas'],
    routePrefixes: ['/api/admin/aca/alunos', '/api/admin/aca/inscricoes', '/api/admin/aca/matriculas', '/api/admin/aca/pessoas'],
    actions: ['view', 'create', 'edit', 'delete'],
    defaultEnabled: false, dependsOn: ['aca_estrutura'],
  },
  {
    id: 'aca_avaliacao_institucional', name: 'Avaliação Institucional (CPA)', icon: '📊', category: 'erp_academico',
    description: 'Avaliação institucional / CPA: questionários por dimensões, perguntas (escala/NPS/texto/sim-não), aplicação por link público e dashboard de resultados (médias, NPS, participação).',
    pages: ['acaAvaliacaoInst'],
    routePrefixes: ['/api/admin/aca/avaliacao-inst'],
    actions: ['view', 'create', 'edit', 'delete'],
    defaultEnabled: false, dependsOn: ['educacional'],
  },
  {
    id: 'aca_vestibular', name: 'Processo Seletivo', icon: '📝', category: 'erp_academico',
    description: 'Camada admin do processo seletivo: componentes de nota (digitação), classificação com critério de desempate, convocação por chamadas e ensalamento. Opera sobre os candidatos do módulo Educacional.',
    pages: ['acaVestibular'],
    routePrefixes: ['/api/admin/aca/vestibular'],
    actions: ['view', 'create', 'edit', 'delete'],
    defaultEnabled: false, dependsOn: ['educacional'],
  },
  {
    id: 'aca_acesso', name: 'Controle de Acesso', icon: '🚪', category: 'erp_academico',
    description: 'Controle de acesso físico (catraca/QR): pontos de acesso, credenciais por aluno, decisão de liberação (credencial válida + bloqueio) e registro de acessos. A catraca é o ponto de integração.',
    pages: ['acaAcesso'],
    routePrefixes: ['/api/admin/aca/acesso'],
    actions: ['view', 'create', 'edit', 'delete'],
    defaultEnabled: false, dependsOn: ['aca_matriculas'],
  },
  {
    id: 'aca_movimentacoes', name: 'Movimentações Acadêmicas', icon: '🔁', category: 'erp_academico',
    description: 'Trancamento, afastamento, transferência (interna/externa), remanejamento, reclassificação, cancelamento e reingresso — com registro auditável e processo de "atualiza situações" em lote (alunos sem rematrícula → evadidos).',
    pages: ['acaMovimentacoes'],
    routePrefixes: ['/api/admin/aca/movimentacoes'],
    actions: ['view', 'create', 'edit', 'delete'],
    defaultEnabled: false, dependsOn: ['aca_matriculas'],
  },
  {
    id: 'aca_financeiro', name: 'Financeiro Acadêmico', icon: '💳', category: 'erp_academico',
    description: 'Mensalidades/contratos (Asaas), central financeira, encargos (juros/multa/desconto), renegociação, bloqueio acadêmico, recibos e controle de NFS-e.',
    pages: ['acaFinanceiro'],
    routePrefixes: ['/api/admin/aca/financeiro', '/api/admin/aca/parcelas'],
    actions: ['view', 'create', 'edit', 'delete'],
    defaultEnabled: false, dependsOn: ['aca_matriculas'],
  },
  {
    id: 'aca_financeiro_bancario', name: 'Financeiro Bancário', icon: '🏦', category: 'erp_academico',
    description: 'Back-office financeiro: plano de contas, contas bancárias, indexadores, feriados, cobranças recorrentes/avulsas e remessa/retorno CNAB (boleto registrado).',
    pages: ['acaFinBanco'],
    routePrefixes: ['/api/admin/aca/fin-banco'],
    actions: ['view', 'create', 'edit', 'delete'],
    defaultEnabled: false, dependsOn: ['aca_financeiro'],
  },
  {
    id: 'aca_cobranca_fiscal', name: 'Cobrança Judicial & Fiscal', icon: '⚖️', category: 'erp_academico',
    description: 'Dívida ativa (CDA) e cobrança judicial, integração contábil (regras + lançamentos) e geração de lote de NFS-e.',
    pages: ['acaCobrancaFiscal'],
    routePrefixes: ['/api/admin/aca/cobranca-fiscal'],
    actions: ['view', 'create', 'edit', 'delete'],
    defaultEnabled: false, dependsOn: ['aca_financeiro_bancario'],
  },
  {
    id: 'aca_pedagogico', name: 'Núcleo Pedagógico', icon: '📖', category: 'erp_academico',
    description: 'Diário de classe, frequência, avaliações/notas, conselho de classe e fechamento, calendário acadêmico, quadro de horários e plano de ensino & materiais.',
    pages: ['acaDiario', 'acaConselho', 'acaCalendario'],
    routePrefixes: [
      '/api/admin/aca/diarios', '/api/admin/aca/aulas', '/api/admin/aca/avaliacoes',
      '/api/admin/aca/resultados', '/api/admin/aca/conselhos', '/api/admin/aca/eventos',
      '/api/admin/aca/horarios', '/api/admin/aca/materiais', '/api/admin/aca/config',
    ],
    actions: ['view', 'create', 'edit', 'delete'],
    defaultEnabled: false, dependsOn: ['aca_matriculas'],
  },
  {
    id: 'aca_ead', name: 'EAD / LMS', icon: '🖥', category: 'erp_academico',
    description: 'Ponte EAD com o LMS próprio (a construir): turmas EAD, sincronização de matrículas, recebimento de médias e registro de acesso. O LMS é o ponto de integração (modo simulado para validar sem ele).',
    pages: ['acaEad'],
    routePrefixes: ['/api/admin/aca/ead'],
    actions: ['view', 'create', 'edit', 'delete'],
    defaultEnabled: false, dependsOn: ['aca_pedagogico'],
  },
  {
    id: 'aca_docente', name: 'Docente / RH Acadêmico', icon: '👨‍🏫', category: 'erp_academico',
    description: 'Cadastro de docentes (titulação/regime/valor-hora), tipos de atividade com fator, atividades docentes mensais com cálculo de valores e aceite/disponibilidade de disciplinas.',
    pages: ['acaDocente'],
    routePrefixes: ['/api/admin/aca/docente'],
    actions: ['view', 'create', 'edit', 'delete'],
    defaultEnabled: false, dependsOn: ['aca_pedagogico'],
  },
  {
    id: 'aca_secretaria', name: 'Secretaria & Documentos', icon: '📁', category: 'erp_academico',
    description: 'Histórico escolar, declarações, atas, certificados/egressos, requerimentos (secretaria virtual) e estágio & atividades complementares.',
    pages: ['acaSecretaria', 'acaRequerimentos', 'acaEstagio', 'acaEgressos'],
    routePrefixes: [
      '/api/admin/aca/documentos', '/api/admin/aca/requerimentos', '/api/admin/aca/requerimento-tipos',
      '/api/admin/aca/requerimento-categorias',
      '/api/admin/aca/egressos', '/api/admin/aca/estagio', '/api/admin/aca/atividades', '/api/admin/aca/tcc',
    ],
    actions: ['view', 'create', 'edit', 'delete'],
    defaultEnabled: false, dependsOn: ['aca_matriculas'],
  },
  {
    id: 'aca_cadastros', name: 'Cadastros Auxiliares', icon: '🗂', category: 'erp_academico',
    description: 'Listas de apoio acadêmicas: áreas de conhecimento, formações, atendimentos especiais (acessibilidade) e tipos de documento.',
    pages: ['acaCadastros'],
    routePrefixes: ['/api/admin/aca/cadastros'],
    actions: ['view', 'create', 'edit', 'delete'],
    defaultEnabled: false, dependsOn: ['educacional'],
  },
  {
    id: 'aca_diploma', name: 'Diploma Digital (MEC)', icon: '🎓', category: 'erp_academico',
    description: 'Diploma digital no padrão MEC: geração do XML, assinatura ICP-Brasil (ponto de integração), registro, anulação e validação pública por código.',
    pages: ['acaDiploma'],
    routePrefixes: ['/api/admin/aca/diploma'],
    actions: ['view', 'create', 'edit', 'delete'],
    defaultEnabled: false, dependsOn: ['aca_secretaria'],
  },
  {
    id: 'aca_ged', name: 'GED (Documentos do Aluno)', icon: '🗄', category: 'erp_academico',
    description: 'Gestão eletrônica de documentos do aluno (GED): anexar por link, classificar por tipo e conferir (recebido/conferido/pendente).',
    pages: ['acaGed'],
    routePrefixes: ['/api/admin/aca/ged'],
    actions: ['view', 'create', 'edit', 'delete'],
    defaultEnabled: false, dependsOn: ['aca_secretaria'],
  },
  {
    id: 'aca_assinatura', name: 'Assinatura de Contratos', icon: '✍️', category: 'erp_academico',
    description: 'Assinatura eletrônica de contratos do aluno via Autentique (envelope + signatários, links de assinatura, webhook de status). Modo simulado para testes sem credencial.',
    pages: ['acaAssinatura'],
    routePrefixes: ['/api/admin/aca/assinatura'],
    actions: ['view', 'create', 'edit', 'delete'],
    defaultEnabled: false, dependsOn: ['aca_secretaria'],
  },
  {
    id: 'aca_comunicacao', name: 'Comunicação Acadêmica', icon: '📨', category: 'erp_academico',
    description: 'Avisos automáticos de vencimento (régua de cobrança) e de notas, reusando WhatsApp/e-mail do ByChat.',
    pages: ['acaComunicacao'],
    routePrefixes: ['/api/admin/aca/comunicacao'],
    actions: ['view', 'create', 'edit', 'delete'],
    defaultEnabled: false, dependsOn: ['aca_matriculas'],
  },
  {
    id: 'aca_portais', name: 'Portais Aluno/Professor', icon: '🔑', category: 'erp_academico',
    description: 'Portais de autoatendimento via magic-link (SSR): aluno (boletim, financeiro, documentos) e professor (diário, notas, materiais).',
    pages: ['acaPortais'],
    routePrefixes: ['/api/admin/aca/portal'],
    actions: ['view', 'create', 'edit', 'delete'],
    defaultEnabled: false, dependsOn: ['aca_matriculas'],
  },
  {
    id: 'aca_portais_plus', name: 'Centrais (Responsável/Ex-aluno)', icon: '🧑‍🤝‍🧑', category: 'erp_academico',
    description: 'Portais magic-link adicionais por perfil: Central do Responsável (acompanha boletim/financeiro do dependente) e Central do Ex-aluno (histórico + 2ª via de documentos).',
    pages: ['acaPortaisPlus'],
    routePrefixes: ['/api/admin/aca/portal-plus'],
    actions: ['view', 'create', 'edit', 'delete'],
    defaultEnabled: false, dependsOn: ['aca_portais'],
  },
  {
    id: 'aca_relatorios', name: 'Indicadores & Censo', icon: '📈', category: 'erp_academico',
    description: 'BI acadêmico/financeiro (KPIs) e exportação Censo/SISTEC. Somente leitura — agrega os dados dos demais módulos.',
    pages: ['acaBi', 'acaSistec'],
    routePrefixes: ['/api/admin/aca/bi', '/api/admin/aca/sistec', '/api/admin/aca/censo'],
    actions: ['view', 'create', 'edit', 'delete'],
    defaultEnabled: false, dependsOn: ['aca_matriculas'],
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
      // Administração da Tela Inicial (a leitura do próprio usuário é bypass em permissions.ts)
      '/api/admin/home-screens',
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
  {
    id: 'meetings', name: 'Reuniões (Transcrição)', icon: '🎙', category: 'crm',
    description: 'Transcreve e analisa reuniões ONLINE (bot em Google Meet/Teams/Zoom) e PRESENCIAIS (grava o áudio da sala no celular/navegador ou por upload, sem bot). Tudo transcrito localmente (soberano, sem enviar áudio a terceiros) + análise por IA anexada ao lead. A GRAVAÇÃO exige opt-in/consentimento explícito (LGPD) — ver Configurações › LGPD/Legal.',
    pages: ['meetings'],
    routePrefixes: ['/api/admin/meetings', '/api/meetings'],
    actions: ['view', 'create', 'edit', 'delete'],
    defaultEnabled: false,
  },
  {
    id: 'catalog', name: 'Catálogo de Produtos e Serviços', icon: '📦', category: 'crm',
    description: 'O que a empresa vende — produtos, serviços, planos ou mensalidades (cadastro manual + importação por planilha). É a fonte da verdade que o chatbot de IA consulta para responder sobre itens, preços e disponibilidade sem inventar, e de onde saem os itens das propostas no módulo Negociações.',
    pages: ['catalog'],
    routePrefixes: ['/api/admin/catalog'],
    actions: ['view', 'create', 'edit', 'delete'],
    defaultEnabled: false,
  },
  {
    id: 'goals_commissions', name: 'Metas e Comissões', icon: '🎯', category: 'vendas',
    description: 'Metas por funil e por agente (receita, mensalidade, nº de vendas e conversão) e a comissão de cada venda — percentual ou valor fixo, com taxa separada para pagamento único e mensalidade, e faixas que melhoram a taxa conforme o atingimento da meta. Os valores saem das propostas ganhas do módulo Negociações: nada é digitado duas vezes.',
    pages: ['goals-commissions'],
    routePrefixes: ['/api/admin/commissions', '/api/admin/goals'],
    actions: ['view', 'create', 'edit', 'delete'],
    // Nasce desligado: comissionamento é decisão comercial de cada operação, e
    // ligar sem regra cadastrada só mostraria tela vazia.
    defaultEnabled: false,
  },
  {
    id: 'negotiations', name: 'Negociações', icon: '🤝', category: 'crm',
    description: 'Negociações/propostas: itens do catálogo, mensalidade vs. pagamento único, descontos, condição de pagamento, anexos e fechamento ganho/perdido. Tem tela própria (todas as propostas, KPIs de recorrência e pipeline por status) e uma seção no detalhe do lead.',
    pages: ['negotiations'],
    routePrefixes: ['/api/admin/negotiations'],
    actions: ['view', 'create', 'edit', 'delete'],
    defaultEnabled: false,
  },
  {
    id: 'goals_commissions', name: 'Metas e Comissões', icon: '🎯', category: 'vendas',
    description: 'Metas por funil e por agente (receita, mensalidade, nº de vendas e conversão) e a comissão de cada venda — percentual ou valor fixo, com taxa separada para pagamento único e mensalidade, e faixas que melhoram a taxa conforme o atingimento da meta. Os valores saem das propostas ganhas do módulo Negociações: nada é digitado duas vezes.',
    pages: ['goals-commissions'],
    routePrefixes: ['/api/admin/commissions', '/api/admin/goals'],
    actions: ['view', 'create', 'edit', 'delete'],
    // Nasce desligado: comissionamento é decisão comercial de cada operação, e
    // ligar sem regra cadastrada só mostraria tela vazia.
    defaultEnabled: false,
  },
  {
    id: 'status_summary', name: 'Resumos', icon: '🏷️', category: 'crm',
    description: 'Inverte o kanban: em vez de arrastar o card, o operador classifica a situação do atendimento escolhendo um Resumo (ex.: "AT-200 SOLICITOU MATRICULA"), e o motor move a etapa, gera as atividades com prazo e responsável, marca ganho/perdido e exige a objeção. Nasce desligado.',
    pages: ['status-summaries', 'status-summary-report'],
    routePrefixes: ['/api/status-summaries', '/api/activity-templates'],
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

// Dependências TRANSITIVAS de um módulo (os módulos que ele exige para funcionar).
// Ex.: aca_financeiro → [aca_matriculas, aca_estrutura, educacional].
export function getModuleDependencies(moduleId: string): string[] {
  const seen = new Set<string>()
  const visit = (id: string) => {
    const def = MODULE_REGISTRY.find(m => m.id === id)
    for (const dep of def?.dependsOn ?? []) {
      if (!seen.has(dep)) { seen.add(dep); visit(dep) }
    }
  }
  visit(moduleId)
  return [...seen]
}

// Dependentes TRANSITIVOS de um módulo (os módulos que dependem dele, direta ou
// indiretamente). Ex.: aca_matriculas → [aca_financeiro, aca_pedagogico, ...].
export function getModuleDependents(moduleId: string): string[] {
  const seen = new Set<string>()
  const stack = [moduleId]
  while (stack.length) {
    const cur = stack.pop()!
    for (const m of MODULE_REGISTRY) {
      if ((m.dependsOn ?? []).includes(cur) && !seen.has(m.id)) {
        seen.add(m.id); stack.push(m.id)
      }
    }
  }
  return [...seen]
}
