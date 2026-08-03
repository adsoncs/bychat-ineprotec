import type { WidgetType } from '@/hooks/useWidgets'

export type WidgetSize = 'sm' | 'md' | 'lg' | 'xl'

export interface WidgetMeta {
  metric: string
  title: string
  description: string
  icon: string
  defaultSize: WidgetSize
  defaultType: WidgetType
  availableTypes: WidgetType[]
}

export interface WidgetMetaWithCategory extends WidgetMeta {
  category: string
}

export interface WidgetCategory {
  id: string
  label: string
  /**
   * Se preenchido, a categoria só aparece para usuários com `canView` neste módulo.
   * Mantém Visão Geral e Meus Painéis enxutos para clientes que não usam o módulo.
   */
  requiresPermission?: string
  /** Pílula curta exibida ao lado do label (ex.: "Educacional"). */
  domainBadge?: string
}

export const WIDGET_CATEGORIES: WidgetCategory[] = [
  { id: 'leads', label: 'Leads' },
  { id: 'atividades', label: 'Atividades' },
  { id: 'paginas', label: 'Páginas & Forms' },
  { id: 'tracking', label: 'Tracking' },
  { id: 'mensagens', label: 'Mensagens' },
  { id: 'sistema', label: 'Sistema' },
  { id: 'negociacoes', label: 'Negociações', requiresPermission: 'negotiations', domainBadge: 'Vendas' },
  { id: 'matriculas', label: 'Matrículas', requiresPermission: 'educacional', domainBadge: 'Educacional' },
  { id: 'helpdesk', label: 'Helpdesk', requiresPermission: 'helpdesk', domainBadge: 'Suporte' },
]

export const WIDGET_CATALOG: WidgetMetaWithCategory[] = [
  { category: 'leads', metric: 'leads_total', title: 'Total de Leads', description: 'Número total de leads no sistema', icon: '👥', defaultSize: 'sm', defaultType: 'kpi', availableTypes: ['kpi', 'gauge', 'stat_grid'] },
  { category: 'leads', metric: 'leads_new', title: 'Leads Novos', description: 'Leads criados hoje e na semana', icon: '📈', defaultSize: 'sm', defaultType: 'kpi', availableTypes: ['kpi', 'stat_grid'] },
  { category: 'leads', metric: 'leads_uncontacted', title: 'Sem Contato', description: 'Leads na primeira etapa sem nenhuma atividade executada', icon: '📵', defaultSize: 'sm', defaultType: 'kpi', availableTypes: ['kpi', 'gauge'] },
  { category: 'leads', metric: 'leads_avg_score', title: 'Score Médio', description: 'Média geral dos scores dos leads', icon: '🎯', defaultSize: 'sm', defaultType: 'kpi', availableTypes: ['kpi', 'gauge'] },
  { category: 'leads', metric: 'leads_conversion', title: 'Prob. Conversão (IA)', description: 'Probabilidade média de conversão via IA', icon: '🤖', defaultSize: 'sm', defaultType: 'kpi', availableTypes: ['kpi', 'gauge'] },
  { category: 'leads', metric: 'leads_by_date', title: 'Leads por Período', description: 'Evolução de leads ao longo do tempo', icon: '📊', defaultSize: 'lg', defaultType: 'line', availableTypes: ['line', 'area', 'bar'] },
  { category: 'leads', metric: 'leads_by_status', title: 'Leads por Etapa', description: 'Distribuição por etapa do funil', icon: '🔀', defaultSize: 'md', defaultType: 'bar', availableTypes: ['bar', 'hbar', 'pie', 'donut', 'polar', 'funnel', 'hbar_list'] },
  { category: 'leads', metric: 'leads_by_source', title: 'Origem dos Leads', description: 'De onde os leads vieram', icon: '🌐', defaultSize: 'md', defaultType: 'donut', availableTypes: ['bar', 'hbar', 'pie', 'donut', 'polar', 'hbar_list'] },
  { category: 'leads', metric: 'leads_by_segment', title: 'Leads por Segmento', description: 'Top segmentos de mercado', icon: '🏷️', defaultSize: 'md', defaultType: 'bar', availableTypes: ['bar', 'hbar', 'pie', 'donut', 'polar', 'hbar_list'] },
  { category: 'leads', metric: 'leads_by_funnel', title: 'Leads por Funil', description: 'Visão geral de cada funil', icon: '🔄', defaultSize: 'xl', defaultType: 'funnel', availableTypes: ['funnel', 'bar', 'table'] },
  { category: 'leads', metric: 'leads_by_pillar', title: 'Score por Pilar', description: 'Média de score por pilar de avaliação', icon: '📉', defaultSize: 'md', defaultType: 'progress', availableTypes: ['radar', 'progress', 'bar', 'hbar', 'polar'] },
  { category: 'leads', metric: 'leads_maturidade', title: 'Maturidade', description: 'Distribuição de maturidade dos leads', icon: '🧩', defaultSize: 'md', defaultType: 'donut', availableTypes: ['pie', 'donut', 'polar', 'bar', 'hbar', 'hbar_list'] },
  { category: 'leads', metric: 'leads_by_tag', title: 'Leads por Tag', description: 'Distribuição de leads por tag', icon: '🏷', defaultSize: 'md', defaultType: 'bar', availableTypes: ['bar', 'hbar', 'pie', 'donut', 'polar', 'hbar_list'] },
  { category: 'leads', metric: 'leads_recent', title: 'Últimos Leads', description: 'Tabela com os leads mais recentes', icon: '📋', defaultSize: 'xl', defaultType: 'table', availableTypes: ['table'] },
  { category: 'leads', metric: 'leads_won', title: 'Negócios Ganhos', description: 'Leads marcados como ganhos no período (com Δ% vs período anterior)', icon: '🏆', defaultSize: 'sm', defaultType: 'kpi', availableTypes: ['kpi'] },
  { category: 'leads', metric: 'leads_won_revenue', title: 'Receita Ganha', description: 'Soma do valor de venda dos negócios ganhos no período', icon: '💰', defaultSize: 'sm', defaultType: 'kpi', availableTypes: ['kpi'] },
  { category: 'leads', metric: 'leads_lost', title: 'Negócios Perdidos', description: 'Leads marcados como perdidos no período + maior objeção', icon: '📉', defaultSize: 'sm', defaultType: 'kpi', availableTypes: ['kpi'] },
  { category: 'leads', metric: 'leads_conversion_rate', title: 'Taxa de Conversão (fechamento)', description: 'Ganhos sobre negócios encerrados (ganhos + perdidos) no período', icon: '🎯', defaultSize: 'sm', defaultType: 'kpi', availableTypes: ['kpi', 'gauge'] },
  { category: 'leads', metric: 'leads_loss_reasons', title: 'Objeções (Leads perdidos)', description: 'Distribuição dos motivos de perda no período', icon: '❌', defaultSize: 'md', defaultType: 'donut', availableTypes: ['donut', 'pie', 'bar', 'hbar', 'polar', 'hbar_list', 'table'] },
  { category: 'leads', metric: 'leads_lost_revenue_by_reason', title: 'Receita perdida por objeção', description: 'Soma de saleValue dos leads perdidos agrupado por objeção', icon: '💸', defaultSize: 'md', defaultType: 'hbar', availableTypes: ['hbar', 'bar', 'hbar_list', 'table'] },
  { category: 'leads', metric: 'leads_submissions', title: 'Inscrições', description: 'Total de submissões (forms, meta, portal, API, make) — cada uma é um evento de aquisição', icon: '📥', defaultSize: 'sm', defaultType: 'kpi', availableTypes: ['kpi', 'stat_grid'] },
  { category: 'leads', metric: 'leads_unique', title: 'Leads únicos', description: 'Inscrições menos duplicados pendentes de revisão (pessoas distintas pós-dedup)', icon: '👤', defaultSize: 'sm', defaultType: 'kpi', availableTypes: ['kpi', 'stat_grid'] },
  { category: 'leads', metric: 'leads_duplicates_pending', title: 'Duplicados pendentes', description: 'Leads sinalizados como possíveis duplicados aguardando revisão', icon: '🔁', defaultSize: 'sm', defaultType: 'kpi', availableTypes: ['kpi', 'stat_grid'] },

  { category: 'atividades', metric: 'activities_summary', title: 'Resumo Atividades', description: 'Pendentes, atrasadas e concluídas', icon: '✅', defaultSize: 'sm', defaultType: 'kpi', availableTypes: ['kpi', 'stat_grid', 'donut', 'pie'] },
  { category: 'atividades', metric: 'activities_by_type', title: 'Atividades por Tipo', description: 'Distribuição por tipo de atividade', icon: '📝', defaultSize: 'md', defaultType: 'bar', availableTypes: ['bar', 'hbar', 'pie', 'donut', 'polar', 'hbar_list'] },

  { category: 'paginas', metric: 'pages_performance', title: 'Landing Pages', description: 'Views, conversões e taxas', icon: '🌟', defaultSize: 'lg', defaultType: 'table', availableTypes: ['table', 'kpi', 'bar', 'stat_grid'] },
  { category: 'paginas', metric: 'forms_performance', title: 'Formulários', description: 'Submissões e performance', icon: '📝', defaultSize: 'lg', defaultType: 'table', availableTypes: ['table', 'kpi', 'bar', 'stat_grid'] },

  { category: 'tracking', metric: 'tracking_visitors', title: 'Visitantes', description: 'Total de visitantes, sessões e pageviews', icon: '👁️', defaultSize: 'sm', defaultType: 'kpi', availableTypes: ['kpi', 'stat_grid'] },
  { category: 'tracking', metric: 'tracking_by_device', title: 'Dispositivos', description: 'Visitantes por tipo de dispositivo', icon: '📱', defaultSize: 'md', defaultType: 'donut', availableTypes: ['pie', 'donut', 'polar', 'bar', 'hbar', 'hbar_list'] },
  { category: 'tracking', metric: 'tracking_by_source', title: 'Fontes de Tráfego', description: 'Origem do tráfego (UTM Source)', icon: '🔗', defaultSize: 'md', defaultType: 'bar', availableTypes: ['bar', 'hbar', 'pie', 'donut', 'polar', 'hbar_list'] },

  { category: 'mensagens', metric: 'messages_volume', title: 'Volume de Mensagens', description: 'Mensagens enviadas e recebidas', icon: '💬', defaultSize: 'lg', defaultType: 'bar', availableTypes: ['line', 'area', 'bar', 'kpi', 'stat_grid'] },
  { category: 'mensagens', metric: 'templates_usage', title: 'Templates Usados', description: 'Templates mais utilizados', icon: '📨', defaultSize: 'lg', defaultType: 'table', availableTypes: ['table', 'bar', 'hbar', 'hbar_list'] },

  { category: 'sistema', metric: 'meta_leads', title: 'Meta Lead Ads', description: 'Leads recebidos do Meta Ads', icon: '📘', defaultSize: 'sm', defaultType: 'kpi', availableTypes: ['kpi', 'stat_grid', 'donut'] },
  { category: 'sistema', metric: 'chatbots_summary', title: 'Chatbots', description: 'Resumo dos chatbots ativos', icon: '🤖', defaultSize: 'sm', defaultType: 'kpi', availableTypes: ['kpi', 'pie', 'donut', 'polar', 'bar'] },

  { category: 'matriculas', metric: 'portals_total', title: 'Portais Ativos', description: 'Quantidade de portais de matrícula ativos', icon: '🎓', defaultSize: 'sm', defaultType: 'kpi', availableTypes: ['kpi', 'stat_grid'] },
  { category: 'matriculas', metric: 'registrations_total', title: 'Total de Inscrições', description: 'Inscrições recebidas no período', icon: '📝', defaultSize: 'sm', defaultType: 'kpi', availableTypes: ['kpi', 'stat_grid'] },
  { category: 'matriculas', metric: 'registrations_paid', title: 'Matrículas Pagas', description: 'Inscrições com pagamento confirmado', icon: '💳', defaultSize: 'sm', defaultType: 'kpi', availableTypes: ['kpi', 'stat_grid'] },
  { category: 'matriculas', metric: 'registrations_revenue', title: 'Receita de Matrículas', description: 'Valor pago total (R$)', icon: '💰', defaultSize: 'sm', defaultType: 'kpi', availableTypes: ['kpi', 'stat_grid'] },
  { category: 'matriculas', metric: 'registrations_conversion_rate', title: 'Taxa de Conversão', description: 'Inscrições que viraram matrícula paga', icon: '🎯', defaultSize: 'sm', defaultType: 'kpi', availableTypes: ['kpi', 'gauge'] },
  { category: 'matriculas', metric: 'registrations_by_day', title: 'Inscrições por Período', description: 'Evolução de inscrições ao longo do tempo', icon: '📈', defaultSize: 'lg', defaultType: 'line', availableTypes: ['line', 'area', 'bar'] },
  { category: 'matriculas', metric: 'registrations_by_portal', title: 'Inscrições por Portal', description: 'Distribuição entre portais', icon: '📊', defaultSize: 'md', defaultType: 'bar', availableTypes: ['bar', 'hbar', 'pie', 'donut', 'polar', 'hbar_list', 'table'] },
  { category: 'matriculas', metric: 'registrations_by_status', title: 'Inscrições por Status', description: 'Pendente, pago, aprovado, etc', icon: '🔀', defaultSize: 'md', defaultType: 'donut', availableTypes: ['bar', 'hbar', 'pie', 'donut', 'polar', 'hbar_list'] },
  { category: 'matriculas', metric: 'registrations_by_source', title: 'Fontes de Inscrição', description: 'Top UTM sources das matrículas', icon: '🔗', defaultSize: 'md', defaultType: 'bar', availableTypes: ['bar', 'hbar', 'pie', 'donut', 'polar', 'hbar_list'] },
  { category: 'matriculas', metric: 'registrations_recent', title: 'Últimas Inscrições', description: 'Tabela com inscrições mais recentes', icon: '📋', defaultSize: 'xl', defaultType: 'table', availableTypes: ['table'] },

  { category: 'helpdesk', metric: 'helpdesk_volume', title: 'Volume de Chamados', description: 'Criados, resolvidos, backlog e reaberturas', icon: '🎫', defaultSize: 'md', defaultType: 'stat_grid', availableTypes: ['stat_grid', 'kpi'] },
  { category: 'helpdesk', metric: 'helpdesk_sla', title: 'Cumprimento de SLA', description: '% de SLA cumprido (1ª resposta e resolução)', icon: '⏱️', defaultSize: 'sm', defaultType: 'stat_grid', availableTypes: ['stat_grid', 'gauge'] },
  { category: 'helpdesk', metric: 'helpdesk_times', title: 'Tempos Médios (TMA/TMR)', description: 'Tempo médio de 1ª resposta e de resolução', icon: '⏳', defaultSize: 'sm', defaultType: 'stat_grid', availableTypes: ['stat_grid'] },
  { category: 'helpdesk', metric: 'helpdesk_csat', title: 'Satisfação (CSAT)', description: 'Nota média e respostas no período', icon: '😊', defaultSize: 'sm', defaultType: 'stat_grid', availableTypes: ['stat_grid', 'kpi'] },
  { category: 'helpdesk', metric: 'helpdesk_trend', title: 'Tendência de Chamados', description: 'Criados vs resolvidos por dia', icon: '📈', defaultSize: 'lg', defaultType: 'line', availableTypes: ['line', 'area', 'bar'] },
  { category: 'helpdesk', metric: 'helpdesk_by_status', title: 'Chamados por Status', description: 'Distribuição por status', icon: '🔀', defaultSize: 'md', defaultType: 'donut', availableTypes: ['donut', 'pie', 'polar', 'bar', 'hbar', 'hbar_list'] },
  { category: 'helpdesk', metric: 'helpdesk_by_priority', title: 'Chamados por Prioridade', description: 'Distribuição por prioridade', icon: '🚨', defaultSize: 'md', defaultType: 'bar', availableTypes: ['bar', 'hbar', 'donut', 'pie', 'polar', 'hbar_list'] },
  { category: 'helpdesk', metric: 'helpdesk_by_channel', title: 'Chamados por Canal', description: 'E-mail, WhatsApp, web, etc', icon: '📨', defaultSize: 'md', defaultType: 'bar', availableTypes: ['bar', 'hbar', 'donut', 'pie', 'polar', 'hbar_list'] },
  { category: 'helpdesk', metric: 'helpdesk_by_agent', title: 'Desempenho por Agente', description: 'Atribuídos, resolvidos, TMR e CSAT', icon: '👤', defaultSize: 'xl', defaultType: 'table', availableTypes: ['table'] },

  // ── Negociações (módulo Negociação) ──
  { category: 'negociacoes', metric: 'negotiations_mrr_open', title: 'Mensalidade em Negociação', description: 'Soma das mensalidades das negociações em aberto agora (MRR na mesa)', icon: '🔁', defaultSize: 'sm', defaultType: 'kpi', availableTypes: ['kpi'] },
  { category: 'negociacoes', metric: 'negotiations_mrr_won', title: 'Mensalidade Fechada', description: 'Novo MRR fechado no período — só a parte recorrente (com Δ% vs anterior)', icon: '📈', defaultSize: 'sm', defaultType: 'kpi', availableTypes: ['kpi'] },
  { category: 'negociacoes', metric: 'negotiations_mrr_avg_ticket', title: 'Ticket Médio Mensal', description: 'Mensalidade média das negociações ganhas que têm recorrência', icon: '🎫', defaultSize: 'sm', defaultType: 'kpi', availableTypes: ['kpi'] },
  { category: 'negociacoes', metric: 'negotiations_onetime_open', title: 'Pagamento Único em Negociação', description: 'Implantação, setup e projetos em aberto agora — sem misturar com recorrência', icon: '🧾', defaultSize: 'sm', defaultType: 'kpi', availableTypes: ['kpi'] },
  { category: 'negociacoes', metric: 'negotiations_onetime_won', title: 'Pagamento Único Fechado', description: 'Total de pagamento único fechado no período (com Δ% vs anterior)', icon: '💰', defaultSize: 'sm', defaultType: 'kpi', availableTypes: ['kpi'] },
  { category: 'negociacoes', metric: 'negotiations_onetime_avg_ticket', title: 'Ticket Médio Único', description: 'Valor médio de pagamento único por negociação ganha que tem essa parte', icon: '🏷️', defaultSize: 'sm', defaultType: 'kpi', availableTypes: ['kpi'] },
  { category: 'negociacoes', metric: 'negotiations_open', title: 'Em Negociação (total)', description: 'Valor total na mesa agora, misturando mensalidade e pagamento único', icon: '🤝', defaultSize: 'sm', defaultType: 'kpi', availableTypes: ['kpi'] },
  { category: 'negociacoes', metric: 'negotiations_won_revenue', title: 'Fechado em Negociações (total)', description: 'Soma do total das negociações ganhas no período (1º ciclo, com Δ% vs anterior)', icon: '💰', defaultSize: 'sm', defaultType: 'kpi', availableTypes: ['kpi'] },
  { category: 'negociacoes', metric: 'negotiations_avg_ticket', title: 'Ticket Médio (total)', description: 'Valor médio por negociação ganha no período (receita ganha ÷ nº de ganhas)', icon: '🎫', defaultSize: 'sm', defaultType: 'kpi', availableTypes: ['kpi'] },
]

export const FUNNEL_AWARE_METRICS = [
  'leads_total', 'leads_new', 'leads_uncontacted', 'leads_by_date', 'leads_by_status', 'leads_by_source',
  'leads_by_segment', 'leads_by_funnel', 'leads_by_pillar', 'leads_maturidade',
  'leads_avg_score', 'leads_conversion', 'leads_recent', 'leads_by_tag',
  'leads_loss_reasons', 'leads_lost_revenue_by_reason',
]

export const GROUPABLE_METRICS = ['leads_by_date', 'messages_volume', 'registrations_by_day']

export const LIMITABLE_METRICS = [
  'leads_recent', 'leads_by_segment', 'pages_performance', 'forms_performance',
  'templates_usage', 'registrations_recent', 'registrations_by_portal',
]

export const TYPE_LABELS: Record<WidgetType, string> = {
  kpi: 'KPI (Número)',
  bar: 'Barras Vertical',
  hbar: 'Barras Horizontal',
  line: 'Linha',
  area: 'Área',
  pie: 'Pizza',
  donut: 'Donut',
  polar: 'Polar Area',
  radar: 'Radar/Spider',
  funnel: 'Funil',
  table: 'Tabela',
  progress: 'Barras de Progresso',
  gauge: 'Velocímetro',
  stat_grid: 'Cards Numéricos',
  hbar_list: 'Lista com Barras',
  // legacy aliases mantidos por compat com dashboards já salvos
  chart: 'Gráfico',
  list: 'Lista',
  breakdown: 'Distribuição',
}

export const SIZE_LABELS: Record<WidgetSize, string> = {
  sm: 'Pequeno (1/4)',
  md: 'Médio (1/3)',
  lg: 'Grande (1/2)',
  xl: 'Largura total',
}

export function findWidget(metric: string): WidgetMetaWithCategory | undefined {
  return WIDGET_CATALOG.find((w) => w.metric === metric)
}
