/**
 * Conteúdo e configuração da landing institucional.
 *
 * Textos e seções são editados aqui (exigem rebuild). Os CONTATOS, porém,
 * são editáveis por painel SUPERADMIN (Configurações › Landing Institucional):
 * o backend injeta `window.__LANDING_CONTACT__` ao servir a página, e os
 * valores abaixo são apenas o fallback estático quando nada foi configurado.
 */

interface LandingContactOverride {
  whatsappNumber?: string
  whatsappMessage?: string
  loginUrl?: string
}
declare global {
  interface Window {
    __LANDING_CONTACT__?: LandingContactOverride
  }
}

/** Fallback estático — espelha os defaults do backend (server.ts/settings.ts). */
const CONTACT_DEFAULTS = {
  /** Número no formato internacional sem símbolos, ex: 5511999999999. */
  whatsappNumber: '5562985703567',
  whatsappMessage: 'Olá! Quero conhecer o ByChat e agendar uma demonstração.',
  /** Onde o botão "Entrar" leva (app servido em /app). */
  loginUrl: '/app',
}

const CONTACT_OVERRIDE: LandingContactOverride =
  (typeof window !== 'undefined' && window.__LANDING_CONTACT__) || {}

export const CONTACT = {
  whatsappNumber: CONTACT_OVERRIDE.whatsappNumber || CONTACT_DEFAULTS.whatsappNumber,
  whatsappMessage: CONTACT_OVERRIDE.whatsappMessage || CONTACT_DEFAULTS.whatsappMessage,
  loginUrl: CONTACT_OVERRIDE.loginUrl || CONTACT_DEFAULTS.loginUrl,
} as const

export function whatsappHref(): string {
  const msg = encodeURIComponent(CONTACT.whatsappMessage)
  return `https://wa.me/${CONTACT.whatsappNumber}?text=${msg}`
}

export const NAV_LINKS: ReadonlyArray<{ label: string; href: string }> = [
  { label: 'Recursos', href: '#recursos' },
  { label: 'Módulos', href: '#modulos' },
  { label: 'IA', href: '#ia' },
  { label: 'Soluções', href: '#solucoes' },
  { label: 'Integrações', href: '#integracoes' },
  { label: 'Perguntas', href: '#faq' },
]

export const HERO = {
  badge: '100% nacional · LGPD · Parceira de tecnologia Meta',
  title: 'Atenda, venda e fidelize no WhatsApp com IA',
  highlight: 'tudo numa plataforma só',
  subtitle:
    'O ByChat reúne atendimento multicanal, CRM de vendas, chatbot com inteligência artificial, automação e gestão de Meta e Google Ads — para você responder mais rápido, vender mais e decidir com dados.',
  primaryCta: 'Agende uma demonstração',
  secondaryCta: 'Falar no WhatsApp',
  reassurance: 'Sem cartão de crédito · Onboarding assistido · Suporte em português',
} as const

export const SOCIAL_PROOF = {
  intro: 'Operações de vendas e atendimento que já confiam no ByChat',
  // Placeholders — trocar por logos reais de clientes.
  logos: ['Cliente A', 'Cliente B', 'Cliente C', 'Cliente D', 'Cliente E'],
  badges: ['Parceira de tecnologia Meta', 'Conforme LGPD', 'Software 100% nacional'],
} as const

export const IMPACT_STATS: ReadonlyArray<{ value: string; label: string }> = [
  { value: '+1M', label: 'mensagens processadas por mês' },
  { value: '24/7', label: 'atendimento automatizado com IA' },
  { value: '+30%', label: 'de conversão média após adoção' },
  { value: '< 2 min', label: 'tempo médio de primeira resposta' },
]

export interface Pillar {
  id: string
  tab: string
  title: string
  description: string
  bullets: ReadonlyArray<string>
}

export const PILLARS: ReadonlyArray<Pillar> = [
  {
    id: 'atender',
    tab: 'Atenda melhor',
    title: 'Atendimento omnichannel num só inbox',
    description:
      'WhatsApp, Instagram e Telegram numa caixa única com filas, equipes e roteamento automático. Nada de cliente esquecido.',
    bullets: [
      'Caixa de entrada com filas: Atendimento, Aguardando e Resolvidos',
      'Equipes, claim/transferência e roteamento por instância',
      'Múltiplas conexões de WhatsApp na mesma operação',
      'Histórico unificado do contato em cada conversa',
    ],
  },
  {
    id: 'vender',
    tab: 'Venda mais',
    title: 'CRM de vendas pensado para conversas',
    description:
      'Funil visual, cadências de prospecção e engajamento de vendas com métricas reais de conversão e receita.',
    bullets: [
      'Kanban por funil com estágios e motivos de perda',
      'Cadências outbound multicanal com builder visual',
      'Sales Engagement com drill-down por canal e operador',
      'Atividades, anotações e ciclo de vida do lead',
    ],
  },
  {
    id: 'automatizar',
    tab: 'Automatize',
    title: 'Chatbot e automação que trabalham por você',
    description:
      'Chatbots, jornadas automáticas e workflows visuais que qualificam, respondem e movem o lead sem intervenção manual.',
    bullets: [
      'Chatbot com fluxos e templates configuráveis',
      'Workflows visuais (arraste-e-solte) com ramificações',
      'Jornada automática disparada por mensagem recebida',
      'Geração de cadências por IA em poucos cliques',
    ],
  },
  {
    id: 'dados',
    tab: 'Decida com dados',
    title: 'ROI de Ads e performance em tempo real',
    description:
      'Meta e Google Ads conectados ao funil, dashboards de receita e performance por operador — do clique à venda.',
    bullets: [
      'ROI e ROAS de Meta e Google Ads plugados à receita',
      'Conversões/CAPI com matching avançado',
      'Performance por operador e por equipe',
      'Monitor de filas, envios e vendas',
    ],
  },
]

export const AI = {
  eyebrow: 'Inteligência artificial nativa',
  title: 'Uma IA que atende, qualifica e vende com você',
  subtitle:
    'A IA do ByChat não é um plugin — está no centro da plataforma, operando 24 horas por dia ao lado da sua equipe.',
  features: [
    {
      title: 'Atende 24/7',
      text: 'Responde dúvidas, conduz a conversa e só passa para um humano quando precisa.',
    },
    {
      title: 'Lead Score preditivo',
      text: 'Pontua cada lead (quente/morno/frio) com base no seu negócio e prioriza quem está pronto para comprar.',
    },
    {
      title: 'Gera cadências',
      text: 'Cria sequências de prospecção completas a partir de um briefing.',
    },
    {
      title: 'Audita conversas',
      text: 'Analisa atendimentos e aponta oportunidades de melhoria.',
    },
  ],
} as const

export const STEPS: ReadonlyArray<{ n: string; title: string; text: string }> = [
  {
    n: '1',
    title: 'Conecte seus canais',
    text: 'WhatsApp, Instagram, Telegram, Meta e Google Ads em minutos.',
  },
  {
    n: '2',
    title: 'Configure funil e IA',
    text: 'Defina estágios, equipes e ative chatbot e automações.',
  },
  {
    n: '3',
    title: 'Atenda e venda',
    text: 'Sua equipe trabalha com contexto; a IA cuida do resto.',
  },
  {
    n: '4',
    title: 'Meça e escale',
    text: 'Acompanhe ROI, conversão e performance em tempo real.',
  },
]

export interface Segment {
  title: string
  text: string
  highlight?: boolean
}

export const SEGMENTS: ReadonlyArray<Segment> = [
  {
    title: 'Educação',
    text: 'Portal de matrículas, processos seletivos, modos de ingresso e checkout transparente (PIX, boleto e cartão). Um diferencial que nenhum concorrente entrega.',
    highlight: true,
  },
  {
    title: 'Varejo e e-commerce',
    text: 'Recupere carrinhos, atenda em escala e venda pelo WhatsApp com automação e Ads integrados.',
  },
  {
    title: 'Serviços e B2B',
    text: 'Qualificação de leads, cadências de prospecção e CRM completo para ciclos de venda consultivos.',
  },
  {
    title: 'Saúde e clínicas',
    text: 'Agendamentos, lembretes automáticos e atendimento humanizado com histórico do paciente.',
  },
]

export const INTEGRATIONS = {
  title: 'Conecta com o ecossistema que você já usa',
  subtitle:
    'Mais do que um chat: um hub que centraliza marketing, vendas, pagamento e produtividade.',
  items: [
    'WhatsApp & Cloud API',
    'Instagram',
    'Telegram',
    'Meta Ads',
    'Google Ads',
    'Google Workspace',
    'Pagar.me',
    'Asaas',
    'Make.com',
    'Webhooks & API',
  ],
} as const

export interface Case {
  quote: string
  name: string
  role: string
  metric: string
}

export const CASES: ReadonlyArray<Case> = [
  {
    quote:
      'Centralizamos atendimento, vendas e Ads num lugar só. A equipe parou de perder lead e a conversão subiu de verdade.',
    name: 'Cliente em destaque',
    role: 'Diretor Comercial',
    metric: '+38% de conversão',
  },
  {
    quote:
      'O portal de matrículas mudou nossa captação. Do anúncio à matrícula paga, tudo dentro da plataforma.',
    name: 'Coordenação acadêmica',
    role: 'Instituição de ensino',
    metric: '3x mais matrículas online',
  },
  {
    quote:
      'A IA responde fora do horário e qualifica antes do humano entrar. Nosso time foca em quem está pronto para comprar.',
    name: 'Gestor de atendimento',
    role: 'Operação de vendas',
    metric: '< 2 min de 1ª resposta',
  },
]

export const BR_DIFF: ReadonlyArray<{ title: string; text: string }> = [
  {
    title: 'Suporte em português',
    text: 'Time brasileiro, sem fuso horário e sem tradução automática.',
  },
  {
    title: 'Onboarding assistido',
    text: 'Acompanhamos a implantação para você começar a vender rápido.',
  },
  {
    title: 'Conforme a LGPD',
    text: 'Tratamento de dados em conformidade com a legislação brasileira.',
  },
  {
    title: 'Tecnologia nacional',
    text: 'Produto desenvolvido no Brasil, pensado para o mercado local.',
  },
]

export const FAQ: ReadonlyArray<{ q: string; a: string }> = [
  {
    q: 'O que é o ByChat?',
    a: 'Uma plataforma brasileira que reúne atendimento multicanal, CRM de vendas, chatbot com IA, automação e gestão de Meta/Google Ads — tudo integrado.',
  },
  {
    q: 'Preciso instalar algo?',
    a: 'Não. O ByChat é uma plataforma web. Você conecta seus canais e começa a usar; cuidamos da infraestrutura.',
  },
  {
    q: 'Funciona com mais de um número de WhatsApp?',
    a: 'Sim. A operação suporta múltiplas conexões de WhatsApp com roteamento por equipe e por instância.',
  },
  {
    q: 'Vocês atendem o segmento educacional?',
    a: 'Sim, com diferencial: portal de matrículas, processos seletivos e checkout transparente (PIX, boleto e cartão) — algo que nenhum concorrente oferece.',
  },
  {
    q: 'O ByChat grava e transcreve reuniões?',
    a: 'Sim. Um bot entra em Google Meet, Teams ou Zoom, grava e transcreve; a IA gera resumo, próximos passos, objeções e até uma nota de aderência ao seu playbook comercial. Também funciona para reuniões presenciais (por gravação ou upload de áudio), e a transcrição roda no seu próprio servidor.',
  },
  {
    q: 'Tem central de chamados (helpdesk)?',
    a: 'Sim, nativa. Uma central de suporte completa com chamados, SLA, base de conhecimento, portal do cliente e pesquisa de satisfação — sem precisar contratar Zendesk ou outro sistema à parte.',
  },
  {
    q: 'Como contrato?',
    a: 'Agende uma demonstração ou fale no WhatsApp. Montamos um plano sob medida para a sua operação.',
  },
  {
    q: 'Meus dados estão seguros?',
    a: 'Sim. O tratamento de dados segue a LGPD e a plataforma adota camadas de segurança e controle de acesso.',
  },
]

/**
 * Mapa de módulos — espelha os grupos reais do painel (sidebar.config.ts).
 * O grupo Educacional é deliberadamente omitido aqui: ele tem vitrine
 * própria em /educacional. `icon` é resolvido em sections.tsx.
 */
export interface ModuleItem {
  name: string
  desc: string
}
export interface ModuleGroup {
  id: string
  label: string
  icon: string
  tagline: string
  items: ReadonlyArray<ModuleItem>
}

export const MODULE_MAP: ReadonlyArray<ModuleGroup> = [
  {
    id: 'operacao',
    label: 'Operação diária',
    icon: 'Gauge',
    tagline: 'O dia da sua equipe começa e termina aqui.',
    items: [
      { name: 'Visão Geral', desc: 'Dashboard consolidado com widgets configuráveis e métricas-chave de leads, atendimento, vendas e campanhas.' },
      { name: 'Hoje', desc: 'Agenda do operador: tudo que vence no dia — atividades, follow-ups e cadências — numa tela de execução.' },
      { name: 'Performance da Equipe', desc: '15+ KPIs por operador, carga de trabalho em tempo real e drill-down com objeções e receita.' },
      { name: 'Conversas', desc: 'Inbox unificada (WhatsApp, Instagram, Telegram, E-mail) com filas, claim automático e roteamento por equipe.' },
      { name: 'Inteligência', desc: 'IA que faz score preditivo, enriquece dados e recomenda a próxima ação para cada lead.' },
      { name: 'Reuniões com IA', desc: 'Bot que entra em Meet/Teams/Zoom, grava, transcreve e analisa a reunião — resumo, próximos passos, objeções e coaching de vendas. Também no modo presencial.' },
    ],
  },
  {
    id: 'crm',
    label: 'CRM',
    icon: 'Users',
    tagline: 'Nenhum lead esquecido, nenhum dado perdido.',
    items: [
      { name: 'Leads', desc: 'Gestão completa de contatos com histórico, campos personalizados, anotações append-only e segmentação.' },
      { name: 'Lead Score IA', desc: 'Pontuação preditiva por IA (quente/morno/frio) com base no contexto do seu negócio, raciocínio explicável e calibração contínua pelos resultados reais.' },
      { name: 'Duplicados', desc: 'Tratamento de leads duplicados com sinalização automática — sem merge cego.' },
      { name: 'Kanban', desc: 'Funil visual com drag & drop dos leads por etapa.' },
      { name: 'Atividades', desc: 'Tarefas, ligações, reuniões, e-mail (Gmail integrado) e follow-ups vinculados ao lead, com agenda e notificações.' },
      { name: 'Negociações', desc: 'Pipeline de propostas dentro do lead: itens do catálogo, desconto e valor final, forma de pagamento, anexos e fechamento (ganho/perdido) que atualiza o funil.' },
      { name: 'Exportação de dados', desc: 'Exporte tudo de um lead ou de vários — dados, campos, score, negociações, atividades, timeline, conversas e mais — em Excel, CSV, PDF ou HTML.' },
    ],
  },
  {
    id: 'marketing',
    label: 'Marketing',
    icon: 'Megaphone',
    tagline: 'Do anúncio ao lead, com atribuição real.',
    items: [
      { name: 'Chatbots', desc: 'Construtor de fluxos de captação e atendimento automatizado, com jornada por IA.' },
      { name: 'Landing Pages', desc: 'Páginas de captura com controle total de aparência, SEO, mídia, tracking e uploads.' },
      { name: 'Meta Ads', desc: 'Campanhas do Facebook/Instagram com mapeamento de campos de formulário e captura de leads.' },
      { name: 'Google Ads', desc: 'Conexão OAuth, conta e ação de conversão com mapeamento multi-gatilho.' },
      { name: 'Links rastreáveis', desc: 'Links curtos com rastreamento de origem e atribuição ao lead.' },
      { name: 'Rastreamento', desc: 'Tracking unificado de campanhas, origens e jornada do contato.' },
    ],
  },
  {
    id: 'vendas',
    label: 'Vendas & Automação',
    icon: 'TrendingUp',
    tagline: 'A máquina que vende enquanto você dorme.',
    items: [
      { name: 'Vendas IA', desc: 'Gestão de vendas detectadas, conversão real e diagnóstico comercial assistido por IA.' },
      { name: 'Fluxos', desc: 'Automações por evento (e-mail, mensagem, webhook) com builder visual e ramificações.' },
      { name: 'Cadências', desc: 'Cadências outbound (WhatsApp/E-mail/SMS) com classificação de respostas por IA, opt-out e métricas.' },
      { name: 'Filas & Monitor', desc: 'Monitor operacional de envios, vendas e jobs com rastreio persistente.' },
      { name: 'Catálogo de produtos', desc: 'Produtos/serviços (com importação por planilha) que alimentam as negociações e a IA — que passa a responder só com o que existe no catálogo, sem inventar.' },
    ],
  },
  {
    id: 'suporte',
    label: 'Suporte / Helpdesk',
    icon: 'Headphones',
    tagline: 'Uma central de chamados nativa, sem contratar outro sistema.',
    items: [
      { name: 'Chamados (Tickets)', desc: 'Central de atendimento com protocolo, prioridade, status, atribuição, seguidores, tags e histórico — em visão Lista ou Kanban.' },
      { name: 'SLA & Escalonamento', desc: 'Políticas de SLA de 1ª resposta e resolução, com horário comercial, pausa por status e alertas de risco e violação.' },
      { name: 'Omnichannel', desc: 'Abertura de chamado por e-mail, WhatsApp, formulário e API — a resposta pública volta pelo mesmo canal do cliente.' },
      { name: 'Base de Conhecimento', desc: 'Central de ajuda pública com busca, categorias e artigos — com sugestão automática de artigos ao abrir o chamado (deflection).' },
      { name: 'Portal do Cliente', desc: 'Área do cliente por link mágico para abrir e acompanhar chamados, sem senha.' },
      { name: 'CSAT & Qualidade', desc: 'Pesquisa de satisfação ao resolver e avaliação de qualidade (QA) do atendimento por IA.' },
      { name: 'Automações & Macros', desc: 'Gatilhos, automações por tempo e macros de resposta — inclusive sugeridas por IA.' },
      { name: 'Organizações B2B', desc: 'Agrupamento de solicitantes por empresa (por domínio de e-mail), com SLA e visão por organização.' },
    ],
  },
  {
    id: 'relatorios',
    label: 'Relatórios',
    icon: 'BarChart3',
    tagline: 'Decisão com dado, não com achismo.',
    items: [
      { name: 'Meus Painéis', desc: 'Painéis analíticos personalizáveis pelo usuário.' },
      { name: 'Relatório Meta Ads', desc: 'Investimento, leads, alcance, ROAS, vendas e receita por campanha.' },
      { name: 'Relatório Google Ads', desc: 'Espelho do relatório Meta, com ROAS plugado por gclid.' },
      { name: 'Auditoria de Conversas', desc: 'Avaliação de qualidade das conversas conduzidas por IA.' },
      { name: 'Jornada IA', desc: 'Acompanhamento da jornada automática conduzida por inteligência artificial.' },
      { name: 'Funil de Conversão', desc: 'Funil visual de conversão por etapa.' },
    ],
  },
  {
    id: 'canais',
    label: 'Canais',
    icon: 'MessageSquare',
    tagline: 'Onde o seu cliente estiver.',
    items: [
      { name: 'WhatsApp', desc: 'Conexão de múltiplas instâncias via Evolution API, envio em massa e roteamento.' },
      { name: 'Cloud API', desc: 'WhatsApp oficial da Meta com templates aprovados.' },
      { name: 'Telegram', desc: 'Canal Telegram integrado à mesma inbox.' },
      { name: 'Instagram', desc: 'Mensagens do Instagram na operação unificada.' },
    ],
  },
  {
    id: 'integracoes',
    label: 'Integrações',
    icon: 'Plug',
    tagline: 'Conecta com tudo que você já usa.',
    items: [
      { name: 'Google Workspace', desc: 'Sheets, Calendar, Drive, Ads, GA4, Gmail, Tasks e Looker — modelo híbrido por operador e empresa.' },
      { name: 'Make.com', desc: 'Automação cross-app via app Make dedicado.' },
      { name: 'Conversões Meta (CAPI)', desc: 'Envio server-side de conversões com matching avançado.' },
      { name: 'Evolution API', desc: 'Configuração e diagnóstico das conexões WhatsApp.' },
      { name: 'E-mail / SMS', desc: 'Provedores de e-mail e SMS para automações e cadências.' },
      { name: 'IA / Tokens', desc: 'Chaves de IA (Anthropic/OpenAI) que alimentam toda a inteligência.' },
      { name: 'DNS', desc: 'Configuração de domínio e subdomínios.' },
      { name: 'Webhooks & API Keys', desc: 'Webhooks de saída e chaves de API para integrações externas.' },
      { name: 'Pagamentos', desc: 'Pagar.me e Asaas com link de pagamento e confirmação por webhook.' },
    ],
  },
  {
    id: 'cadastros',
    label: 'Cadastros',
    icon: 'Database',
    tagline: 'A base que sustenta toda a operação.',
    items: [
      { name: 'Funis', desc: 'Pipelines com etapas e regras para diferentes processos comerciais.' },
      { name: 'Etiquetas', desc: 'Tags para segmentação e filtros rápidos.' },
      { name: 'Formulários', desc: 'Formulários de captura conectados ao funil.' },
      { name: 'Modelos', desc: 'Templates reutilizáveis de mensagem e captação.' },
      { name: 'Personas / ICPs', desc: 'Perfis de cliente ideal que alimentam a IA.' },
      { name: 'Equipes', desc: 'Setores de atendimento (Comercial, Financeiro, Suporte) e membros.' },
      { name: 'Objeções', desc: 'Catálogo de motivos de perda para análise de conversão.' },
      { name: 'Campos personalizados', desc: 'Campos sob medida para o seu negócio.' },
      { name: 'Atendimento', desc: 'Horários de funcionamento que regem automações e SLAs.' },
    ],
  },
  {
    id: 'admin',
    label: 'Administração',
    icon: 'ShieldCheck',
    tagline: 'Controle, segurança e governança.',
    items: [
      { name: 'Usuários', desc: 'Cadastro de usuários com usuários ilimitados.' },
      { name: 'Permissões', desc: 'Controle granular de acesso por módulo.' },
      { name: 'Segurança & Auditoria', desc: 'Logs de acesso, sessões, IPs bloqueados e trilha de auditoria.' },
      { name: 'Configurações', desc: 'Configurações gerais, aparência e ajustes da plataforma.' },
    ],
  },
] as const

/**
 * Recursos nativos do WhatsApp — features novas (Calling, interativos, Flows).
 * Conteúdo aditivo: não substitui nenhuma seção existente.
 */
export const NATIVE_WA = {
  eyebrow: 'Novo · Nativo do WhatsApp',
  title: 'O WhatsApp inteiro dentro da plataforma',
  subtitle:
    'Vá além do texto: ligações de voz, botões, listas e formulários nativos do WhatsApp — tudo conduzido pelo seu time e pela IA, sem o cliente sair da conversa.',
  features: [
    {
      icon: 'Phone',
      title: 'Ligações por voz (VoIP)',
      text: 'Receba e faça chamadas de voz do WhatsApp Business direto no painel, via WebRTC — atendimento por voz sem desviar para o celular.',
      tag: 'WhatsApp Calling',
    },
    {
      icon: 'MousePointerClick',
      title: 'Botões e listas interativos',
      text: 'Respostas rápidas, menus e listas nativas nos chatbots. O cliente toca em vez de digitar — mais conversão, menos atrito.',
      tag: 'Cloud API',
    },
    {
      icon: 'ListChecks',
      title: 'WhatsApp Flows',
      text: 'Formulários nativos dentro do WhatsApp para captar dados estruturados sem tirar o cliente da conversa.',
      tag: 'Formulários nativos',
    },
  ],
} as const

/**
 * Jornada 100% IA — a IA conduz a conversa e usa ferramentas determinísticas.
 */
export const AI_JOURNEY = {
  eyebrow: 'Novo · Jornada 100% IA',
  title: 'A IA conduz do “oi” ao horário agendado',
  subtitle:
    'No modo Jornada IA, a inteligência artificial assume a conversa inteira — interpreta a resposta livre do cliente e aciona ferramentas determinísticas para executar cada passo, com repasse para um humano quando faz sentido.',
  steps: [
    { title: 'Conversa e qualifica', text: 'Entende a intenção em linguagem natural e qualifica o lead conforme as regras do seu negócio.' },
    { title: 'Salva e organiza', text: 'Registra dados, move o lead de etapa no funil e atualiza o CRM sem digitação manual.' },
    { title: 'Oferece horários', text: 'Consulta a disponibilidade real da agenda e propõe os melhores horários ao cliente.' },
    { title: 'Agenda e confirma', text: 'Cria o agendamento, dispara a confirmação e mantém o histórico — tudo dentro do WhatsApp.' },
  ],
  footnote: 'Handoff humano a qualquer momento. A IA nunca fica presa: quando precisa, passa para a sua equipe com todo o contexto.',
} as const

/**
 * Alcance & agenda — disparos em massa (HSM) e módulo de agendamentos.
 */
export const ENGAGE = {
  eyebrow: 'Novo · Alcance & agenda',
  title: 'Fale com muitos e organize a agenda de todos',
  broadcast: {
    title: 'Disparos em massa',
    text: 'Campanhas com template oficial (HSM) para a sua base e listas importadas — com wizard guiado, agendamento, opt-out, deduplicação e painel de custo e entrega por campanha.',
    bullets: ['Templates HSM aprovados na Meta', 'Audiência por leads ou import (XLSX)', 'Opt-out e deduplicação automáticos', 'Métricas de entrega e custo por campanha'],
  },
  scheduling: {
    title: 'Agendamentos',
    text: 'Um módulo de agenda no estilo Calendly, com disponibilidade por operador, sincronização bidirecional com o Google Calendar e link de agendamento embutível em formulários e landing pages.',
    bullets: ['Disponibilidade por operador e equipe', 'Sincronização bidirecional com Google Calendar', 'Embed em formulários e landing pages', 'Lembretes e confirmações automáticas'],
  },
} as const

/**
 * Reuniões com IA — bot de transcrição + análise (online e presencial).
 */
export const MEETINGS = {
  eyebrow: 'Novo · Reuniões com IA',
  title: 'Toda reunião vira CRM, resumo e coaching de vendas',
  subtitle:
    'Um bot entra na sua reunião online — ou você grava a presencial — e a IA transforma a conversa em resumo, próximos passos, objeções e nota de aderência ao seu playbook. Os dados ficam 100% no seu servidor.',
  features: [
    { icon: 'Video', title: 'Entra e transcreve', text: 'O bot participa de Google Meet, Teams ou Zoom, grava e transcreve automaticamente — com identificação de quem falou.' },
    { icon: 'Sparkles', title: 'Analisa com IA', text: 'Resumo, itens de ação, objeções, sentimento e próximos passos — anexados ao lead sem digitar nada.' },
    { icon: 'Target', title: 'Coaching de vendas', text: 'Avalia a conduta do time à luz do seu playbook: nota de aderência, pontos fortes, o que melhorar e scorecards por critério.' },
    { icon: 'Mic', title: 'Também presencial', text: 'Sem reunião online? Grave pelo navegador/celular ou envie o áudio — a mesma análise vale para o encontro presencial.' },
  ],
  footnote:
    'Soberania total: a transcrição roda no seu próprio servidor (nada é enviado a serviços de terceiros). Licença de bot ativável por usuário.',
} as const

/**
 * Central de Chamados (Helpdesk) nativa.
 */
export const HELPDESK = {
  eyebrow: 'Novo · Central de Chamados',
  title: 'Suporte de nível Zendesk, nativo e sem outra mensalidade',
  subtitle:
    'Um helpdesk completo dentro da mesma plataforma: chamados com SLA, base de conhecimento, portal do cliente e pesquisa de satisfação — tudo conectado ao CRM e aos canais que você já usa.',
  bullets: [
    'Chamados com protocolo, prioridade, atribuição e visão Lista ou Kanban',
    'SLA de 1ª resposta e resolução, com horário comercial e alertas',
    'Abertura por e-mail, WhatsApp, formulário e API (omnichannel)',
    'Base de conhecimento pública com sugestão de artigos (deflection)',
    'Portal do cliente por link mágico e pesquisa de satisfação (CSAT)',
    'Automações, macros e avaliação de qualidade por IA',
  ],
} as const

export const FINAL_CTA = {
  title: 'Pronto para vender mais com menos esforço?',
  subtitle:
    'Veja o ByChat funcionando na sua operação. Agende uma demonstração ou fale agora com nosso time.',
  primary: 'Agende uma demonstração',
  secondary: 'Falar no WhatsApp',
} as const

export const FOOTER = {
  tagline:
    'Plataforma brasileira de atendimento, vendas e automação no WhatsApp.',
  columns: [
    {
      title: 'Produto',
      links: [
        { label: 'Recursos', href: '#recursos' },
        { label: 'Inteligência artificial', href: '#ia' },
        { label: 'Soluções', href: '#solucoes' },
        { label: 'Integrações', href: '#integracoes' },
        { label: 'Para Educação', href: '/educacional' },
      ],
    },
    {
      title: 'Empresa',
      links: [
        { label: 'Entrar no painel', href: '/app' },
        { label: 'Perguntas frequentes', href: '#faq' },
      ],
    },
  ],
  legal: `© ${new Date().getFullYear()} ByChat. Todos os direitos reservados.`,
} as const
