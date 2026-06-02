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
      { name: 'Atividades', desc: 'Tarefas, ligações, reuniões e follow-ups vinculados ao lead, com agenda e notificações.' },
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
