import { Check } from 'lucide-preact'
import { Page } from '@/components/ui/Page'

interface RoadmapItem {
  name: string
  desc: string
  effort?: 'Baixo' | 'Médio' | 'Alto'
  done?: boolean
}

interface RoadmapPhase {
  phase: number | string
  title: string
  color: string
  items: RoadmapItem[]
}

interface UrgentItem {
  n: number
  name: string
  phase: string
  impact: string
  complexity: string
  color: string
}

const TOP_URGENT: UrgentItem[] = [
  { n: 1, name: 'Cloudflare (WAF + DDoS + CDN)', phase: 'Fase 14', impact: 'Segurança profissional, apenas configuração de DNS sem mudança de código', complexity: 'Muito baixa', color: '#1a73e8' },
  { n: 2, name: 'Jornada de Compra Automática por IA', phase: 'Fase 9', impact: 'IA move lead entre etapas do funil (complementa a Vendas IA que só detecta fechamento)', complexity: 'Alta', color: '#34a853' },
  { n: 3, name: 'Auditoria de Conversas por IA', phase: 'Fase 9', impact: 'Score 0-100 por atendimento, ranking de operadores, alertas de qualidade em tempo real', complexity: 'Alta', color: '#e37400' },
  { n: 4, name: 'App oficial Zapier + Make', phase: 'Fase 13.5', impact: 'Conecta a 7000+ apps sem código (Google Calendar e Sheets já estão nativos)', complexity: 'Média', color: '#9334e6' },
  { n: 5, name: 'Multi-Tenant + Billing', phase: 'Fase 12', impact: 'Destrava monetização SaaS (Fase 15 já preparou permissões e TenantModuleAccess)', complexity: 'Alta', color: '#c5221f' },
]

const CURRENT_FEATURES: { icon: string; name: string; desc: string }[] = [
  { icon: '📊', name: 'Dashboard Personalizável', desc: 'Widget builder com 23 métricas, 15 tipos de visualização (KPI, barras, linha, área, pizza, donut, polar, radar, gauge, funil, tabela, progresso, cards numéricos, lista com barras, barras horizontais). Múltiplos dashboards por usuário, filtros de data/funil, drag-reorder' },
  { icon: '📈', name: 'Analytics Personalizável', desc: 'Mesmo sistema de widgets do Dashboard — cada usuário cria suas próprias views analíticas com os dados disponíveis no sistema' },
  { icon: '👥', name: 'Leads com UID Único', desc: 'Código único por lead (LD-XXXXXX), tabela com busca por UID, filtros avançados, ordenação, paginação server-side, criação manual com detecção de duplicata, seleção em lote, exportação CSV' },
  { icon: '🔄', name: 'Deduplicação e Merge', desc: 'Detecção automática de duplicatas por WhatsApp (chave primária) e e-mail (fallback) em todos os 7 pontos de criação. Merge de cadastros com transferência de mensagens, eventos e atividades. Aba "Duplicatas" no detalhe do lead' },
  { icon: '📋', name: 'Kanban Profissional', desc: 'Board multi-coluna drag-and-drop, busca, ordenação, modo compacto, WIP limits, alerta de leads parados, auto-refresh, seletor de funil, permissões por role' },
  { icon: '🔀', name: 'Funis com Etapas', desc: 'CRUD de funis com etapas próprias (cor, posição, reordenação), copiar etapas entre funis, vincular a chatbots. Gestão de etapas centralizada dentro de Funis' },
  { icon: '📱', name: 'WhatsApp Multi-Instância', desc: 'Criar, conectar (QR Code), desconectar, reiniciar instâncias, vincular chatbot por instância' },
  { icon: '🤖', name: 'Chatbots', desc: 'CRUD de perfis com prompts (system, extração, análise), mensagens, perguntas por etapa, funil de destino' },
  { icon: '🔐', name: 'Usuários e Auth', desc: 'CRUD com roles (Admin/Gerente/Visualizador), login por email+senha, JWT com expiração, recuperação de senha' },
  { icon: '⚙', name: 'Configurações', desc: '5 submenus: IA, WhatsApp, Notificações, Segurança, Geral' },
  { icon: '🧠', name: 'IA Dual Provider', desc: 'Anthropic + OpenAI com fallback automático, modelos configuráveis' },
  { icon: '⏰', name: 'Verificação de Inatividade', desc: 'Detecta conversas paradas, reengajamento via WhatsApp, auto-close' },
  { icon: '💬', name: 'Chat Diagnóstico', desc: 'Conversa com IA via chat web e WhatsApp, 40 perguntas, extração e análise' },
  { icon: '📧', name: 'Notificações', desc: 'Email e WhatsApp para admin ao completar diagnóstico, relatório para o lead' },
  { icon: '🛡', name: 'Permissões Kanban', desc: 'Controle por role de avançar/retroceder leads' },
  { icon: '⬇', name: 'Exportação', desc: 'Download CSV (todos ou selecionados), exportação em lote' },
  { icon: '📱', name: 'Mobile-First', desc: 'Admin responsivo completo, tabelas viram cards, kanban com tabs' },
  { icon: '🕐', name: 'Histórico do Lead', desc: 'Timeline unificada de eventos com tracking de navegação (pageviews, cliques, scroll, forms). Filtro por categoria. Stats e jornada. Registro de merge de leads' },
  { icon: '📅', name: 'Atividades Agendadas', desc: 'Agendar WhatsApp, email, SMS, ligação, reunião, tarefa e follow-up com execução automática' },
  { icon: '📝', name: 'Templates de Mensagem', desc: 'Modelos por canal com variáveis dinâmicas, categorias, HTML para email, compositor rico' },
  { icon: '🔄', name: 'Scheduler', desc: 'Execução automática: envia WhatsApp/email no horário agendado, marca atrasadas' },
  { icon: '📘', name: 'Meta Lead Ads', desc: 'Integração Facebook/Instagram: webhook, OAuth, sync de formulários, mapeamento, tracking de campanha, UTM, logs, deduplicação de leads' },
  { icon: '🔍', name: 'Beyond Tracking', desc: 'Script bt.js com fingerprint, pageviews, cliques, scroll depth, Web Vitals, SPA detection, UTM, heartbeat. Painel com visitantes, páginas com validação de tracking ativo, sites monitorados. Normalização de URLs e limpeza de dados de teste' },
  { icon: '📄', name: 'Landing Pages Builder', desc: 'Criador de LPs com 27 tipos de seção, 4 templates, editor visual com preview ao vivo, SEO completo, CSS responsivo, HTML semântico. Controle de estilo por seção e por elemento' },
  { icon: '📝', name: 'Formulários Embeddáveis', desc: 'Builder de forms com mapeamento para lead, Web Component Shadow DOM, pipeline form→lead com deduplicação, funil/etapa, BT.identify(), webhook. Painel de conversões' },
  { icon: '🏷', name: 'Campos Personalizados', desc: 'Sistema de custom fields com 11 tipos, 4 grupos, código de integração (API Key) por campo com auto-geração e botão copiar, flags de visibilidade (lista/kanban/form). Integrado com forms, Meta Ads e API' },
  { icon: '🎨', name: 'Aparência', desc: 'Logo, cores e estilos visuais personalizáveis do painel' },
  { icon: '🗂', name: 'Menu Organizado', desc: 'Sidebar com 6 seções colapsáveis (Atendimento, CRM, Captação, Integrações, Analytics, Configurações), persistência de estado, auto-expand ao navegar, acentuação correta' },
  { icon: '🛡', name: 'Segurança e Proteção', desc: 'Rate limit Redis, CSRF, sanitização, CSP/HSTS, JWT blacklist, backup automático, hardening MySQL/firewall, painel de segurança com logs e gestão de bloqueios' },
  { icon: '🧩', name: 'Frontend Modular', desc: 'app.js dividido em 18 módulos independentes (21k→2.9k linhas no core). Cada módulo em arquivo separado com cache bust automático, sem build system' },
  { icon: '🔐', name: 'Permissões por Módulo', desc: '18 módulos com CRUD granular (Ver/Criar/Editar/Excluir) por role e por usuário. Enforcement no backend (403), sidebar dinâmico, gate de navegação. UI de gestão com grid visual' },
  { icon: '🎨', name: 'Aparência com Cache Instantâneo', desc: 'Aparência do admin cacheada no localStorage e aplicada instantaneamente ao carregar /admin (título, brand, cores). Sem flash de defaults. LP e Admin com configurações independentes' },
  { icon: '👥', name: 'Equipes & Multi-Agente', desc: 'Setores (Comercial/Financeiro/Suporte) com cor, ícone e membros líderes. Lead.assignedUserId/teamId. Abas Meus/Fila/Todos no atendimento. Modal de transferência. Roteamento automático por chatbot/instância. Histórico de transferências. Som + alerta de título ao chegar lead na fila. Horário de atendimento por setor. Heartbeat + bolinha de presença' },
  { icon: '🎓', name: 'Portal de Matrículas', desc: 'Portal público com slug + custom domain. Formulário multi-step com CPF/CEP/máscaras. Integração Asaas (PIX/boleto/cartão) + webhook. Quiz IA. Chat ao vivo integrado ao CRM. Captcha reCAPTCHA v3/hCaptcha server-side. Portal do candidato com dashboard, upload de documentos e comprovante PDF. Funil analítico com A/B. Lembrete 24h + expiração via cron. Link assinado HMAC para pré-preencher LP. WhatsApp Enrollment Bot' },
  { icon: '📲', name: 'Evolution API 2.3.7 + LID', desc: 'Upgrade para evoapicloud/evolution-api 2.3.7 com suporte a WhatsApp Linked IDs (JID @lid). Lead.waLid indexado, toEvoNumber() preserva JID no envio, associação por pushName evita duplicatas. Monitor de versão no painel com botão "Atualizar agora"' },
  { icon: '🎯', name: 'Lead vs Conversa', desc: 'Separação clara: lead "qualificado" (form/portal/ads/manual) entra no funil; mensagem WhatsApp ad-hoc fica como "conversa" e não infla métricas. Botão "Promover a Lead" no Conversas. Backfill seguro com preview' },
  { icon: '⭐', name: 'Promover a Lead com Funil/Etapa', desc: 'Modal único reutilizado em 3 fluxos: banner do InfoPanel, estrela hover na TicketRow e ação em massa na Caixa de entrada (checkbox + barra com "Promover N"). Pré-seleciona funil padrão + 1ª etapa ativa, opção "Sem funil" para só qualificar. Endpoint /qualify aceita {funnelId, stageKey} numa transação; novo /qualify-bulk processa até 100 com resumo (qualified/alreadyQualified/failed)' },
  { icon: '💬', name: 'Caixa de Entrada Bruta', desc: 'Conversas tem 3 tabs: Atendimento (tickets ativos), Caixa de entrada (mensagens sem ticket aberto), Resolvidos. Operador escolhe quando abrir atendimento. Reabertura automática quando cliente responde em conversa fechada' },
  { icon: '📨', name: 'Notificações via Templates+Workflows', desc: '5 eventos de inscrição/documento (submitted, payment_confirmed, payment_pending_reminder, document_approved, document_rejected) com 10 templates editáveis (5 email + 5 WhatsApp) e 5 workflows pré-criados. Sem HTML hardcoded — admin edita texto, canal e disparos pela UI' },
  { icon: '📱', name: 'Integração SMS Comtele', desc: 'Provider integrado (auth-key + POST /api/v2/send). Fila wf-sms + worker. Action send_sms em workflows com suporte a templateId. UI em Configurações → SMS com botão "Enviar SMS de teste". Normaliza número (DDI 55 removido se presente)' },
  { icon: '📋', name: 'Análise de Documentos', desc: 'Painel acadêmico dedicado com fila ordenada por antiguidade, filtros por status/sugestão IA/busca, KPIs (pendentes/aprovados/rejeitados). Drawer lateral com preview do arquivo, sugestão IA + dados extraídos, ações aprovar/rejeitar/reanalisar. Notificação automática ao candidato em rejeição' },
  { icon: '🛡', name: 'Soft Delete Educacional', desc: 'Todas 8 entidades (Level/Modality/Unit/Campus/Course/Offering/SP/EntryMode) só deletam se zero dependências. Vão pra lixeira centralizada com snapshot (preserva vínculos campus, doc reqs). Modal de bloqueio listando o que precisa ser removido antes' },
  { icon: '📑', name: 'Listas + Busca em Tudo', desc: '9 telas educacionais + Portal de Matrículas convertidas de cards para lista/tabela. Helper _eduRenderListPage com KPI bar + busca normalizada (NFD, case-insensitive) + filtros. Largura 100% em todas as páginas admin (removido max-width:1280)' },
  { icon: '🎓', name: 'CRUD Modos de Ingresso', desc: 'Modos de Ingresso deixou de ser "seed read-only". Botão "+ Novo modo" + editor com code/name/icon/description/evaluationType/flags/defaultFormExtras (JSON). Cliente pode criar Mestrado, Vestibular EaD, Doutorado, etc' },
  { icon: '⋮', name: 'Dropdown de Ações Reutilizável', desc: 'Helper _eduActionsMenu com kebab "⋮" no Portal de Matrículas: Abrir portal, Copiar URL, Ver inscrições, Editar, Excluir. Posicionamento fixed com clamp ao viewport, fecha em ESC/clique fora/scroll/resize' },
  { icon: '🔒', name: 'Type-to-Confirm em Desativação', desc: 'Desativar módulo com dados em uso exige digitação do nome do módulo (padrão GitHub/Stripe). Modal lista o que há cadastrado e explica consequências. Auditoria do toggle gravada em Setting com snapshot do uso (quem, quando, o que)' },
  { icon: '🔍', name: 'Acessibilidade WCAG AA', desc: '3 níveis de tamanho de fonte (Confortável/Grande/Maior) com botão AA no topbar e cards em Aparência. Persistência localStorage + Setting (sincroniza dispositivos). WCAG: focus-visible azul 2px, contraste reforçado (cinzas tímidos #9aa0a6 → #5f6368), touch targets ≥44px no Maior. Implementação via overrides CSS (não zoom — preserva posicionamento de dropdowns)' },
]

const ROADMAP_PHASES: RoadmapPhase[] = [
  {
    phase: 19, title: 'Maturidade, Acessibilidade e Disciplina de Dados (Implementado 2026-04-25)', color: '#00c853', items: [
      { name: 'Lead vs Conversa', desc: 'qualifiedAt + qualificationSource (migration 0021) — separa lead real de mensagem WhatsApp ad-hoc. 13 pontos de criação auditados, filtros aplicados em kanban/dashboard/stats/sales/publicApi. Backfill seguro com preview', effort: 'Alto', done: true },
      { name: 'Promover a Lead com Funil/Etapa (modal + bulk + estrela)', desc: 'PromoteLeadDialog único reutilizado em 3 entradas: banner do InfoPanel, estrela hover na TicketRow e barra de seleção múltipla na Caixa de entrada (checkbox + "Promover N"). Pré-seleciona funil padrão e 1ª etapa ativa, com opção "Sem funil" (só qualifica). Backend: POST /qualify aceita {funnelId, stageKey} numa transação; novo POST /qualify-bulk processa até 100 leads com resumo qualified/alreadyQualified/failed. Auditoria via lead_qualified + status_changed', effort: 'Médio', done: true },
      { name: 'Caixa de Entrada Bruta + Atendimento Sob Demanda', desc: 'conversationOpenedAt + conversationClosedAt (migration 0022) — Conversas tem 3 tabs (Atendimento / Caixa de entrada / Resolvidos). Operador escolhe quando abrir; outbound abre auto; inbound em conversa fechada reabre', effort: 'Alto', done: true },
      { name: 'Notificações via Templates+Workflows', desc: '5 events (enrollment.submitted/payment_confirmed/payment_pending_reminder/document_approved/document_rejected) + seed de 10 templates editáveis + 5 workflows ativos. enrollmentNotify reescrito para emitir eventos. Sem HTML hardcoded', effort: 'Alto', done: true },
      { name: 'Integração SMS Comtele', desc: 'Provider (POST /api/v2/send com auth-key), fila wf-sms + worker, action send_sms em workflows com templateId, UI Configurações → SMS com botão de teste. Normaliza número (DDI 55)', effort: 'Médio', done: true },
      { name: 'Painel Análise de Documentos', desc: 'Aba dedicada com fila ordenada (FIFO), filtros (status/aiSuggestion/q), KPIs. Drawer 720px com preview img/PDF, sugestão IA + dados extraídos, ações aprovar/rejeitar/reanalisar. Notificação automática ao candidato em rejeição', effort: 'Alto', done: true },
      { name: 'Override de Docs por Processo Seletivo', desc: 'SelectionProcessDocumentRequirement (migration 0020) com flag useCustomDocuments e endpoint clone-from-mode. Painel candidato lê effectiveDocumentRequirements (SP > EntryMode)', effort: 'Médio', done: true },
      { name: 'Soft Delete Educacional Total', desc: '8 entidades (Level/Modality/Unit/Campus/Course/Offering/SP/EntryMode) só deletam se zero dependências. Vão pra lixeira centralizada com snapshot+restore preservando vínculos. Modal de bloqueio listando dependências', effort: 'Médio', done: true },
      { name: 'Listas + Busca em Todas as Telas', desc: 'Helper _eduRenderListPage reutilizado em 9 telas educacionais + Portal de Matrículas. KPI bar + busca normalizada (NFD) + filtros. Largura 100% em todas páginas admin', effort: 'Médio', done: true },
      { name: 'CRUD Completo do EntryMode', desc: 'Modos de Ingresso deixou de ser seed read-only. Botão + Novo modo + editor com code/name/icon/description/evaluationType/flags/defaultFormExtras (JSON). Cliente cria Mestrado, Vestibular EaD, Doutorado etc', effort: 'Baixo', done: true },
      { name: 'Dropdown de Ações Reutilizável', desc: 'Helper _eduActionsMenu (kebab ⋮) com posicionamento fixed clamped ao viewport, fecha em ESC/outside/scroll/resize. Aplicado no Portal de Matrículas (Abrir, Copiar URL, Inscrições, Editar, Excluir)', effort: 'Baixo', done: true },
      { name: 'Type-to-Confirm em Desativação', desc: 'Padrão GitHub/Stripe — desativar módulo com dados em uso exige digitar o nome. Modal lista dependências, explica consequências, audita em Setting (quem, quando, snapshot do uso). Backend: POST /toggle exige confirmName batendo def.name', effort: 'Médio', done: true },
      { name: 'Acessibilidade WCAG AA', desc: '3 níveis (Confortável/Grande/Maior) com botão AA no topbar e cards em Aparência. Persistência localStorage + Setting a11y.size. WCAG: focus-visible, contraste reforçado, touch targets ≥44px no Maior. CSS via attribute selectors (não zoom — preserva posicionamento de dropdowns)', effort: 'Alto', done: true },
      { name: 'Educacional sem Side-Effects', desc: 'Ativação do módulo Educacional não cria mais nada automaticamente (níveis MEC, modalidades, custom fields). Cliente cadastra por demanda usando o CRUD; tabelas Prisma já existem via migrations', effort: 'Baixo', done: true },
      { name: 'Configurações de Módulos sem Tier', desc: 'Removida nomenclatura starter/pro/enterprise (defaultPlan saiu do ModuleDefinition). Lista + busca + filtros (categoria/status). Auditoria por toggle gravada em module_audit.<id>.last_change', effort: 'Baixo', done: true },
    ],
  },
  {
    phase: 0, title: 'Marketing, Tracking e Dados (Implementado)', color: '#00c853', items: [
      { name: 'Beyond Tracking (bt.js)', desc: 'Script de analytics com fingerprint, pageviews, cliques, scroll depth, Web Vitals, SPA detection, UTM, heartbeat. Instalado no próprio sistema', effort: 'Alto', done: true },
      { name: 'Painel de Tracking', desc: '5 tabs: Visão Geral, Visitantes, Páginas (com validação de tracking ativo), Validar URL, Sites Monitorados', effort: 'Alto', done: true },
      { name: 'Vinculação Tracking → Lead', desc: 'BT.identify() automático, merge de histórico anônimo, tab Tracking no detalhe do lead', effort: 'Médio', done: true },
      { name: 'Landing Pages Builder', desc: '27 tipos de seção, 4 templates, editor visual, SEO completo, HTML semântico', effort: 'Alto', done: true },
      { name: 'Formulários Embeddáveis', desc: 'Web Component Shadow DOM, pipeline form→lead com deduplicação, BT.identify(), webhook', effort: 'Alto', done: true },
      { name: 'Painel de Conversões', desc: 'Leads convertidos em Forms e LPs com origem/UTM e contadores', effort: 'Médio', done: true },
      { name: 'Campos Personalizados com Código de Integração', desc: '11 tipos, 4 grupos, API Key por campo (auto-gerada, copiável, imutável após criação), validação de duplicata de código', effort: 'Médio', done: true },
      { name: 'Dashboard Personalizável', desc: 'Widget builder com 23 métricas e 15 tipos de visualização (KPI, barras, linha, área, pizza, donut, polar, radar, gauge, funil, tabela, progresso, cards, lista, hbar). Múltiplos dashboards por usuário', effort: 'Alto', done: true },
      { name: 'Analytics Personalizável', desc: 'Mesmo widget builder do Dashboard — views analíticas independentes por usuário', effort: 'Alto', done: true },
      { name: 'UID Único por Lead', desc: 'Código LD-XXXXXX gerado automaticamente, buscável, exibido na lista e detalhe do lead', effort: 'Médio', done: true },
      { name: 'Deduplicação Centralizada', desc: 'Busca por WhatsApp (primário) e e-mail (fallback) em todos os 7 pontos de criação de lead', effort: 'Médio', done: true },
      { name: 'Merge de Leads', desc: 'Mesclar cadastros duplicados: transfere mensagens, eventos e atividades. Aba Duplicatas no detalhe. Alerta na criação manual', effort: 'Médio', done: true },
      { name: 'Validação de Tracking Ativo', desc: 'Endpoint batch para verificar se bt.js está instalado em páginas. Status Ativo/Sem tracking por URL', effort: 'Baixo', done: true },
      { name: 'Menu Sidebar Colapsável', desc: '6 seções (Atendimento, CRM, Captação, Integrações, Analytics, Configurações) com toggle, persistência e auto-expand. Acentuação correta', effort: 'Baixo', done: true },
      { name: 'Gestão de Etapas dentro de Funis', desc: 'Eliminação da página standalone de Etapas, gestão centralizada dentro de Funis com reorder, lead count e CRUD completo', effort: 'Baixo', done: true },
      { name: 'Links Rastreáveis Avançados (Fase A)', desc: 'Página intermediária /l/:slug com delay + pixel, captura de fbclid/gclid/ctwa_clid/tintim_fbid, QR Code por link, gerador de botão flutuante, export CSV de cliques, dois tipos de URL (/r/ direto e /l/ com pixel)', effort: 'Médio', done: true },
      { name: 'Links Rastreáveis — Jornada e Atribuição (Fase B)', desc: 'Lead Journey por link com join de Stage, atribuição automática de venda (totalSales/totalRevenue), webhook trackable_link.click com dispatchStandaloneEvent, 6 cards de stats enriquecidos com receita agregada', effort: 'Médio', done: true },
      { name: 'Pixel JS Próprio — /pixel/bychat.js', desc: '3.2KB, cookie+localStorage 365d, API window.bychat, auto-reescrita de <a data-bychat-track>, PixelVisitor com first/last attribution sticky, cruzamento anônimo→lead via #ref:slug:sid, endpoints /api/pixel/track e /api/pixel/identify', effort: 'Alto', done: true },
      { name: 'Meta Conversions API — Links Rastreáveis', desc: 'fireCapiLeadNoLead() dispara Lead event server-side com fbc/IP/UA/country hasheado, dedup automático com browser pixel via event_id compartilhado, configurável por link (fbPixelId + fbCapiAccessToken)', effort: 'Alto', done: true },
      { name: 'Origens com Fallback Automático', desc: 'Webhook Meta preenche originType=meta_lead_ads, query usa COALESCE(originType, source, "organic"), backfill executado em 106 leads antigos, frontend ampliado para web_chat/chat/api/import', effort: 'Baixo', done: true },
    ],
  },
  {
    phase: 1, title: 'Monetização e Escala', color: '#1a73e8', items: [
      { name: 'Multi-tenancy', desc: 'Cada cliente com ambiente isolado, seus funis, chatbots e leads — inspirado na arquitetura tenant do ZPro', effort: 'Alto' },
      { name: 'Planos e Assinaturas', desc: 'Tela de planos, limite de leads/mês, integração com Stripe/Asaas', effort: 'Alto' },
      { name: 'Controle de Pagamento por Tenant', desc: 'Status de pagamento, bloqueio por inadimplência, dashboard de cobrança', effort: 'Médio' },
      { name: 'Assistente de boas-vindas', desc: 'Fluxo guiado para novo cliente configurar chatbot, WhatsApp e perguntas', effort: 'Médio' },
      { name: 'White-label', desc: 'Logo, cores e domínio customizado por cliente', effort: 'Médio' },
      { name: 'API Key por Tenant', desc: 'Cada cliente gera sua própria chave de API com permissões isoladas', effort: 'Médio' },
    ],
  },
  {
    phase: 2, title: 'Inteligência e Automação', color: '#34a853', items: [
      { name: 'Follow-up Automático', desc: 'Inatividade por chatbot (reengajamento automático, max retries, auto-close) + Workflow Engine com sequências multi-step (Wait → WhatsApp → Email → Condição). CRM > Workflows', effort: 'Médio', done: true },
      { name: 'Lead Scoring Dinâmico', desc: 'Pesos e regras de scoring configuráveis pelo admin', effort: 'Médio' },
      { name: 'Agendamento de Mensagens', desc: 'Agendar envio de mensagens para data/hora futura, com fila Bull/Redis', effort: 'Médio', done: true },
      { name: 'Agendamento de Reunião', desc: '✅ Google Calendar integrado: atividades viram eventos, Google Meet automático, notificação WhatsApp ao lead. Pendente: Calendly', effort: 'Médio', done: true },
      { name: 'Tags e Segmentação', desc: 'Tags manuais e automáticas por regras (score > 70 = "quente"), filtros por tag, add/remove por workflow', effort: 'Baixo', done: true },
      { name: 'Histórico de Atividades', desc: 'Timeline de cada lead: criação, mudança de etapa, emails, mensagens, abertura de relatório', effort: 'Médio', done: true },
      { name: 'Flow Builder Visual', desc: 'Editor drag-and-drop para criar fluxos de chatbot com nós de mensagem, mídia, condição, webhook e delay', effort: 'Alto' },
      { name: 'Auto-Reply por Palavra-chave', desc: 'Respostas automáticas baseadas em palavras-chave detectadas na mensagem do lead', effort: 'Médio' },
      { name: 'Mensagem de Saudação', desc: 'Mensagem automática quando lead inicia contato pela primeira vez, configurável por instância', effort: 'Baixo', done: true },
      { name: 'Mensagem de Encerramento', desc: 'Mensagem automática ao fechar/concluir atendimento do lead', effort: 'Baixo' },
      { name: 'Horário de Atendimento', desc: 'Definir expediente por dia da semana, mensagem automática fora do horário, feriados configuráveis', effort: 'Médio' },
      { name: 'Auto-Close de Leads Inativos', desc: 'Fechar automaticamente leads sem interação após X dias, com mensagem de encerramento', effort: 'Baixo', done: true },
      { name: 'Cadências de Vendas (Sales Cadences)', desc: '[Sales Engagement] Sequências outbound dedicadas a prospecção: lista de leads-alvo, cadência template (ex: D0 WhatsApp → D2 email → D5 SMS → D9 ligação → D14 break-up), pause-on-reply automático, retomada manual, exclusão por evento (conversão/desinteresse). Diferente do Workflow Engine: foco em outbound proativo com fila de tarefas pro operador, não em automação reativa', effort: 'Alto' },
      { name: 'Break-up Message Automática', desc: '[Sales Engagement] Última mensagem amigável da cadência ("vou parar de incomodar, qualquer coisa estou aqui") disparada após N tentativas sem resposta. Configurável por cadência. Aumenta resposta em até 30% segundo benchmarks', effort: 'Baixo' },
      { name: 'Priorização Dinâmica de Leads', desc: '[Sales Engagement] Fila do operador ordenada por probabilidade de conversão: combina lead score + recência da última interação + etapa do funil + sinais de tracking (visitou /precos hoje sobe). Atualiza em tempo real conforme leads engajam', effort: 'Alto' },
      { name: 'Encerramento Inteligente de Cadência', desc: '[Sales Engagement] IA classifica resposta do lead (positiva/objeção/desinteresse/dúvida) e encerra ou desvia a cadência. Resposta positiva → cria tarefa "ligar hoje"; objeção → muda pra cadência de objeção; desinteresse → opt-out automático', effort: 'Médio' },
    ],
  },
  {
    phase: 3, title: 'Dashboard e Relatórios', color: '#9334e6', items: [
      { name: 'Dashboard Personalizável por Usuário', desc: 'Widget builder com 23 métricas, 15 tipos de gráfico, múltiplos dashboards, filtros de data e funil', effort: 'Alto', done: true },
      { name: 'Dashboard por Período', desc: 'Filtro de data (hoje, 7d, 30d, 90d) e por funil em todos os widgets', effort: 'Baixo', done: true },
      { name: 'Taxa de Conversão por Etapa', desc: '% de leads que avançam entre etapas (funil de conversão real)', effort: 'Médio' },
      { name: 'Comparativo de Funis', desc: 'Métricas side-by-side entre funis diferentes', effort: 'Baixo' },
      { name: 'Relatório PDF', desc: 'Gerar PDF do diagnóstico com branding para o lead baixar (jsPDF)', effort: 'Médio' },
      { name: 'Métricas de Chatbot', desc: 'Conversas iniciadas vs completas, taxa de abandono por pergunta', effort: 'Médio' },
      { name: 'Relatório por Usuário', desc: 'Performance individual: leads atendidos, tempo médio, conversões por agente', effort: 'Médio' },
      { name: 'Relatório por Canal', desc: 'Evolução de leads por canal (WhatsApp, web, etc) com gráficos de tendência', effort: 'Médio' },
      { name: 'Relatório por Região', desc: 'Mapa de leads por estado/cidade, segmentação geográfica', effort: 'Baixo' },
      { name: 'Exportação de Relatórios', desc: 'Download de relatórios em PDF, XLSX e CSV com filtros aplicados', effort: 'Médio' },
      { name: 'Dashboard de Filas', desc: 'Visão em tempo real de leads por fila/etapa com métricas de SLA', effort: 'Médio' },
    ],
  },
  {
    phase: 4, title: 'Comunicação e CRM', color: '#f9ab00', items: [
      { name: 'Caixa de Entrada Unificada', desc: 'Ver e responder mensagens de WhatsApp de todos os números no painel, com status lido/não lido', effort: 'Alto' },
      { name: 'Notas Internas no Lead', desc: 'Anotações da equipe com mentions (@usuario) e histórico', effort: 'Baixo', done: true },
      { name: 'Templates de Mensagem Rápida', desc: 'Mensagens pré-prontas categorizadas para envio rápido via WhatsApp com variáveis', effort: 'Baixo', done: true },
      { name: 'Email Marketing Básico', desc: 'Disparar email para segmentos de leads por etapa, score ou tag', effort: 'Médio' },
      { name: 'Notificações In-App', desc: 'Badge no sidebar com alertas de novos leads, mudanças de etapa e mensagens', effort: 'Baixo' },
      { name: 'Chat Interno da Equipe', desc: 'Mensagens privadas entre usuários do painel, grupos internos, sem sair do sistema', effort: 'Médio' },
      { name: 'Campanhas de Disparo em Massa', desc: 'Criar campanhas com lista de contatos, agendamento, tracking de entrega e variáveis personalizadas', effort: 'Alto' },
      { name: 'Campos Personalizados com API Key', desc: 'Sistema com 11 tipos, código de integração por campo, integrado com forms, Meta Ads e API', effort: 'Médio', done: true },
      { name: 'Deduplicação e Merge de Leads', desc: 'Detecção por WhatsApp/email em todos os canais, merge com transferência de dados, aba Duplicatas no lead', effort: 'Médio', done: true },
      { name: 'UID Único por Lead', desc: 'Código LD-XXXXXX para identificação, buscável, exibido em lista e detalhe', effort: 'Baixo', done: true },
      { name: 'Importação de Contatos', desc: 'Importar leads em massa via CSV/XLSX com mapeamento de colunas', effort: 'Médio' },
      { name: 'Carteira de Leads por Usuário', desc: 'Atribuir leads a usuários específicos, com visão de carteira individual', effort: 'Baixo' },
      { name: 'Avaliação/Satisfação do Lead', desc: 'Formulário de avaliação pós-atendimento, rating com estrelas, relatório de NPS', effort: 'Médio' },
      { name: 'Protocolo e SLA', desc: 'Número de protocolo por atendimento, tempo máximo de resposta, alertas de SLA estourado', effort: 'Médio' },
      { name: 'Opt-out / Central de Preferências', desc: '[Sales Engagement] Página pública /preferencias/:token onde o lead escolhe quais canais aceita receber (WhatsApp/email/SMS) e frequência. Link incluído automaticamente em rodapés de email/cadência. Lead.optOutChannels JSON impede envio nos canais marcados. Compliance LGPD/CAN-SPAM', effort: 'Médio' },
      { name: 'Frequency Cap & Governança de Canal', desc: '[Sales Engagement] Limite global e por lead: máx N mensagens/dia/canal/lead (default WhatsApp 2/dia, email 1/dia). Blacklist de números. Bloqueio em janela de silêncio (22h-8h, fim de semana opcional). Override manual com confirmação', effort: 'Médio' },
      { name: 'Métricas de Engajamento por Cadência', desc: '[Sales Engagement] Dashboard por cadência: taxa de resposta, taxa de abertura (email), conversão por step (qual etapa converte mais), tempo médio até resposta, comparativo entre cadências. Drill-down por canal e operador', effort: 'Médio' },
    ],
  },
  {
    phase: 5, title: 'Integrações e API', color: '#e37400', items: [
      { name: 'Webhooks de Saída', desc: '15 eventos suportados, HMAC-SHA256, retry automático, headers customizáveis, logs de entrega, painel de gestão', effort: 'Baixo', done: true },
      { name: 'Webhooks de Entrada', desc: 'Receber dados de sistemas externos para criar/atualizar leads automaticamente', effort: 'Médio' },
      { name: 'Integração Zapier/Make', desc: 'Templates prontos para conectar com outros sistemas', effort: 'Baixo' },
      { name: 'API Pública com Docs', desc: '16 endpoints REST, API Keys com permissões granulares (13 permissões), rate limit por key, SHA-256, painel de gestão', effort: 'Médio', done: true },
      { name: 'Integração com CRMs', desc: 'RD Station, HubSpot, Pipedrive — push automático de leads', effort: 'Alto' },
      { name: 'Google Sheets Sync', desc: 'Envio automático event-driven para planilhas, 15 eventos, field mapping configurável, OAuth2, painel completo', effort: 'Baixo', done: true },
      { name: 'Integração Dialogflow (NLP)', desc: 'Google Dialogflow para compreensão de linguagem natural, roteamento por intenção', effort: 'Alto' },
      { name: 'Integração TypeBot', desc: 'Conectar chatbots TypeBot externos via webhook para fluxos complexos', effort: 'Médio' },
      { name: 'Canal Instagram DM', desc: 'Receber e responder mensagens do Instagram Direct no painel unificado', effort: 'Alto' },
      { name: 'Canal Facebook Messenger', desc: 'Integração com páginas do Facebook para atendimento via Messenger', effort: 'Alto' },
      { name: 'Canal Telegram', desc: 'Bot Telegram integrado para receber leads e responder via painel', effort: 'Médio' },
      { name: 'Canal SMS', desc: 'Envio e recebimento de SMS com provedor configurável', effort: 'Médio' },
      { name: 'WABA (WhatsApp Business API)', desc: 'Integração oficial com Meta WhatsApp Business API para templates, botões interativos e listas', effort: 'Alto' },
    ],
  },
  {
    phase: 6, title: 'Experiência e Performance', color: '#ea4335', items: [
      { name: 'Busca Global', desc: 'Campo de busca no topo para encontrar lead por nome/empresa/telefone em tempo real', effort: 'Baixo', done: true },
      { name: 'Paginação Server-Side', desc: 'Tabelas com paginação para performance com muitos leads (25/50/100 por página)', effort: 'Médio', done: true },
      { name: 'Filtros Avançados', desc: 'Filtrar leads por data, score, etapa, segmento, progresso, ordenação por colunas', effort: 'Médio', done: true },
      { name: 'Ações em Massa', desc: 'Selecionar múltiplos leads para mover para funil, excluir em lote e exportar CSV selecionados', effort: 'Médio', done: true },
      { name: 'PWA / Modo Offline', desc: 'Service worker para funcionar sem internet com sync posterior', effort: 'Alto' },
      { name: 'Audit Log', desc: 'Registro de todas as ações do admin (quem, o que, quando) com filtro e exportação', effort: 'Médio', done: true },
      { name: 'Fila de Jobs (BullMQ + Redis)', desc: '5 filas BullMQ: whatsapp, email, webhook, internal-task, workflow-step. Painel de monitoramento com contadores, retry, status', effort: 'Médio', done: true },
      { name: 'Virtual Scrolling', desc: 'Scroll infinito com virtualização para listas com milhares de leads sem travar', effort: 'Médio' },
      { name: 'Cache com Redis', desc: 'Cache de sessões, configurações e dados frequentes para reduzir consultas ao banco', effort: 'Médio' },
      { name: 'Fix UI Modais Google', desc: 'Correção de textos invisíveis (cor branca) em todos os modais Google (Sheets, Calendar, Tasks, Ads, Gmail, GA4). Fix eventos Google Sheets usando labels corretos. Cache de aparência instantâneo no admin', effort: 'Baixo', done: true },
      { name: 'Fix Tela Preta no Admin', desc: 'Correção do goTo() que removia route-admin, causando tela preta. CSS admin isolado da landing page. Título da aba aplicado do cache sem flash', effort: 'Baixo', done: true },
    ],
  },
  {
    phase: 7, title: 'Atendimento e Ticketing', color: '#00897b', items: [
      { name: 'Sistema de Tickets (Lead-as-Ticket)', desc: 'Lead funciona como ticket: aberto/pendente/em atendimento/resolvido/fechado, atribuição a operador e setor (Fase 16). Ticket separado fica para fase futura se necessário', effort: 'Alto', done: true },
      { name: 'Filas / Setores de Atendimento', desc: '✅ Setores (Comercial, Financeiro, Suporte, configuráveis). Leads roteados por chatbot.defaultTeamId. Fila do setor visível no atendimento. Pendente: roteamento por LP/MetaForm/IA', effort: 'Médio', done: true },
      { name: 'Atribuição Automática (round-robin)', desc: 'Distribuir leads automaticamente entre atendentes por round-robin / menor carga / capacidade. Hoje atribuição é manual via botão "Assumir"', effort: 'Médio' },
      { name: 'Status de Atendente', desc: 'Online, ausente, em pausa, offline — com roteamento inteligente baseado na disponibilidade. Auto-status ao logar/deslogar', effort: 'Baixo' },
      { name: 'Transferência de Atendimento', desc: '✅ Botão Transferir no header do chat: setor + operador opcional + motivo. Botões Assumir/Devolver à fila. Histórico em LeadEvent (operator_assigned)', effort: 'Baixo', done: true },
      { name: 'Tempo de Resposta (SLA)', desc: 'Métricas de TMA/TME por atendente e fila. SLA Engine com alerta visual e escalonamento por tempo. Dependente de dados reais de produção', effort: 'Médio' },
      { name: 'Horário de Atendimento por Setor', desc: 'Definir expediente por dia da semana, mensagem fora do horário, feriados configuráveis. Lead fora do horário fica em fila marcada', effort: 'Médio' },
      { name: 'Notificação ao Operador', desc: 'Lead chega na fila → badge no sidebar, push (PWA), opcional WhatsApp/email para líder do setor', effort: 'Baixo' },
      { name: 'Chat Interno entre Agentes', desc: 'Mensagens privadas entre operadores, mention @usuário, anexar lead como referência, grupos por setor', effort: 'Médio' },
      { name: 'Atribuição em Massa', desc: 'Selecionar múltiplos leads no kanban/listagem e atribuir todos a um setor/operador (hoje 1 a 1)', effort: 'Baixo' },
      { name: 'Visão Manager', desc: 'Tela dedicada para líder ver métricas e leads do seu setor sem precisar entrar no atendimento', effort: 'Médio' },
      { name: 'Mensagens Offline', desc: 'Armazenar mensagens recebidas fora do horário e entregar ao atendente quando voltar', effort: 'Baixo' },
    ],
  },
  {
    phase: 8, title: 'Comunicação Avançada', color: '#6d4c41', items: [
      { name: 'Mensagens com Mídia', desc: 'Enviar e receber imagens, vídeos, documentos, áudios e stickers via painel', effort: 'Médio', done: true },
      { name: 'Mensagens com Botões Interativos', desc: 'Botões de resposta rápida e listas de seleção nas mensagens do WhatsApp', effort: 'Médio' },
      { name: 'Reações em Mensagens', desc: 'Reagir a mensagens recebidas com emojis diretamente pelo painel', effort: 'Baixo' },
      { name: 'Variáveis em Mensagens', desc: 'Personalizar mensagens com {{nome}}, {{empresa}}, {{score}} etc em templates e campanhas', effort: 'Baixo', done: true },
      { name: 'Gravação de Áudio no Painel', desc: 'Gravar e enviar mensagens de voz diretamente pela caixa de entrada', effort: 'Médio' },
      { name: 'Processamento de Mídia', desc: 'Otimização de imagens (sharp), conversão de áudio (ffmpeg), thumbnail de vídeos', effort: 'Médio' },
      { name: 'Gestão de Grupos WhatsApp', desc: 'Criar, gerenciar participantes, enviar mensagens em massa para grupos, lista de banidos', effort: 'Alto' },
      { name: 'Lista de Palavras-chave por Grupo', desc: 'Ações automáticas ao detectar palavras específicas em grupos (alertas, bans, respostas)', effort: 'Baixo' },
    ],
  },
  {
    phase: 9, title: 'Segurança e Infraestrutura', color: '#455a64', items: [
      { name: 'Rate Limiting Avançado', desc: 'Limites de requisição por IP (60 req/min API, 10 req/min login), bloqueio automático por excesso, detecção de abuso', effort: 'Baixo', done: true },
      { name: 'Proteção contra Ataques', desc: 'Detecção e bloqueio de SQL injection, XSS, path traversal, user-agents de scanners (sqlmap, nikto, hydra, etc)', effort: 'Médio', done: true },
      { name: 'Bloqueio Automático de IP', desc: 'Brute force (5 falhas em 10min = bloqueio 30min), rate limit excedido (5x em 5min = bloqueio 15min), cache em memória', effort: 'Médio', done: true },
      { name: 'Painel de Segurança', desc: 'Dashboard com KPIs, top IPs, log de eventos com filtros, gestão de bloqueios (bloquear/desbloquear), auto-refresh', effort: 'Médio', done: true },
      { name: 'Helmet + CORS Avançado', desc: 'CSP, HSTS, X-Frame-Options, Referrer-Policy, Permissions-Policy no Nginx + CORS por domínio + proteção CSRF', effort: 'Baixo', done: true },
      { name: 'Logs Estruturados (Pino)', desc: 'Logging JSON estruturado com níveis, request tracing e rotação de logs', effort: 'Baixo' },
      { name: 'Monitoramento APM', desc: 'Integração com Sentry para erros e/ou New Relic para performance', effort: 'Médio' },
      { name: 'Backup Automático', desc: 'Cron diário às 3h com mysqldump + gzip, retenção 30 dias, script hardening MySQL', effort: 'Baixo', done: true },
      { name: 'Socket.io em Tempo Real', desc: 'WebSocket para atualização live do painel: novos leads, mensagens, mudanças de etapa sem reload', effort: 'Alto' },
      { name: 'Multi-instância com Redis Adapter', desc: 'Socket.io com Redis adapter para escalar horizontalmente em múltiplos processos/servidores', effort: 'Médio' },
      { name: 'Refresh Token (JWT)', desc: 'Token de acesso curto + refresh token para sessões seguras sem re-login frequente', effort: 'Médio' },
    ],
  },
  {
    phase: 10, title: 'Gestão Interna e Produtividade', color: '#7b1fa2', items: [
      { name: 'To-Do / Tarefas Internas', desc: 'Lista de tarefas pessoal por usuário com prazo, descrição e status', effort: 'Baixo' },
      { name: 'Kanban de Tarefas', desc: 'Board visual para gerenciar tarefas internas da equipe com lanes customizáveis', effort: 'Médio' },
      { name: 'Variáveis do Sistema', desc: 'Gerenciar variáveis globais reutilizáveis em templates, chatbots e campanhas', effort: 'Baixo' },
      { name: 'Validação de Número', desc: 'Verificar se número de WhatsApp existe antes de enviar, evitar desperdício', effort: 'Baixo' },
      { name: 'Verificação por Ligação', desc: 'Iniciar chamada de verificação para confirmar número/lead ativo', effort: 'Médio' },
      { name: 'Contatos Favoritos / Wallet', desc: 'Lista de contatos prioritários por usuário para acesso rápido', effort: 'Baixo' },
    ],
  },
  {
    phase: 11, title: 'Integrações Externas', color: '#0d47a1', items: [
      { name: 'Integração Google Ads', desc: 'OAuth, conversões offline via GCLID, Customer ID/Developer Token/Conversion Action configuráveis, contadores de envio', effort: 'Alto', done: true },
      { name: 'Integração Google Sheets', desc: 'Event-driven sync, 15 eventos, field mapping, OAuth2, multi-planilha, logs de entrega, painel completo', effort: 'Médio', done: true },
      { name: 'Integração Google Calendar', desc: 'Sincroniza atividades, Google Meet automático, notificação WhatsApp ao lead, picker de calendários', effort: 'Médio', done: true },
      { name: 'Coexistence WhatsApp Business', desc: 'Usar mesmo número no app WhatsApp Business + na plataforma simultaneamente via API Coexistence da Meta', effort: 'Alto' },
      { name: 'API Pública Documentada', desc: '16 endpoints REST, API Keys com 13 permissões, rate limit por key, webhooks outbound, Looker Studio connector', effort: 'Médio', done: true },
    ],
  },
  {
    phase: 12, title: 'Expansão e Escala', color: '#004d40', items: [
      { name: 'Multi-Tenant', desc: 'Suporte a múltiplas empresas/contas na mesma instância com isolamento de dados, painel administrativo, planos e billing integrado', effort: 'Alto' },
      { name: 'Programa de Parceiros / Agência', desc: 'Conta master com sub-contas por cliente, acesso limitado para cliente, dashboard consolidado e relatórios automáticos', effort: 'Alto' },
      { name: 'App Mobile (PWA)', desc: 'Notificações push, chat com leads via WhatsApp, kanban simplificado, atividades pendentes, acesso offline básico', effort: 'Alto' },
      { name: 'Sequências Automáticas Multi-Canal', desc: 'Workflow Engine: Wait → WhatsApp → Email → Condição → Branch. 7 ações, delays BullMQ, pause on reply, variáveis dinâmicas', effort: 'Alto', done: true },
      { name: 'Fluxos de Automação Visual', desc: 'Workflow Builder com 15+ triggers, 7 ações, condições if/else, goal event, painel de monitoramento de filas. CRM > Automação', effort: 'Alto', done: true },
    ],
  },
  {
    phase: 13, title: 'Integrações Nativas', color: '#b71c1c', items: [
      { name: '13.1 — Calendário e Agendamentos', desc: '✅ Google Calendar (OAuth2, Meet, sync de atividades), ✅ Google Tasks (sync de tarefas). Pendente: Outlook/Teams, Calendly', effort: 'Médio', done: true },
      { name: '13.2 — Notificações e Colaboração', desc: 'Slack (cards ricos, botões interativos, resumo diário), Microsoft Teams, Telegram Bot, Discord Webhooks', effort: 'Baixo' },
      { name: '13.3 — CRMs Externos', desc: 'HubSpot, Pipedrive, RD Station CRM e Marketing, Salesforce, Bitrix24 — sincronização bidirecional de contatos e deals', effort: 'Alto' },
      { name: '13.4 — Pagamentos e Financeiro', desc: 'Stripe, Mercado Pago, Asaas, PagSeguro, Hotmart/Kiwify/Eduzz — webhook de pagamento → venda confirmada com valor real no ROI', effort: 'Médio' },
      { name: '13.5 — Automação e Conectores', desc: 'Zapier (7000+ apps), Make/Integromat, n8n (self-hosted), API Pública v1 com OpenAPI/Swagger, SDKs JS e Python', effort: 'Médio' },
      { name: '13.6 — Telefonia e VoIP', desc: 'Twilio Voice (click-to-call, gravação), Zenvia/Total Voice (SMS + VoIP BR), JivoChat', effort: 'Médio' },
      { name: '13.7 — Documentos e Propostas', desc: '✅ Google Drive (pasta por lead, upload automático de mídias). Pendente: Clicksign/DocuSign, PandaDoc', effort: 'Médio', done: true },
      { name: '13.8 — Marketing e Enriquecimento', desc: '✅ Google Sheets (event-driven), ✅ GA4 Measurement Protocol, ✅ Gmail (envio pelo Gmail do operador), ✅ Looker Studio connector. Pendente: CNPJ.ws, Clearbit, Mailchimp, ActiveCampaign', effort: 'Médio', done: true },
      { name: '13.9 — Suporte e Helpdesk', desc: 'Zendesk e Freshdesk — escalar conversas para tickets de suporte nível 2 com sincronização de status', effort: 'Médio' },
      { name: '13.10 — Armazenamento e Infra', desc: 'AWS S3 / Cloudflare R2 (CDN, sem custo de egress), MinIO self-hosted — storage profissional para mídias do chat', effort: 'Baixo' },
      { name: '13.11 — Inteligência (Enriquecimento de Leads)', desc: '✅ Providers multi-tier (Gravatar, BrasilAPI, ViaCEP, Hunter, GitHub, Google CSE, Social), LGPD-first, dossiê JSON/PDF, score consolidado 0-100, promoção automática de email/empresa/cidade descobertos, página Inteligência no sidebar CRM', effort: 'Alto', done: true },
      { name: '13.12 — Links Rastreáveis Avançados + Pixel + Meta CAPI', desc: '✅ Página /l/ com delay+pixel, captura de click IDs, QR Code, gerador de botão flutuante, CSV export, Lead Journey, atribuição de venda, webhook de clique, pixel JS próprio com PixelVisitor, jornada anônimo→lead, Meta CAPI server-side com dedup, modais "Como funciona?" e "Instalar Pixel"', effort: 'Alto', done: true },
    ],
  },
  {
    phase: 14, title: 'Segurança Avançada', color: '#263238', items: [
      { name: 'Cloudflare (WAF + DDoS + CDN)', desc: 'Ativar Cloudflare no domínio para WAF profissional, proteção DDoS L3/L4/L7 e CDN. Plano Free já cobre o essencial', effort: 'Baixo' },
    ],
  },
  {
    phase: 15, title: 'Modularização e Permissões', color: '#1b5e20', items: [
      { name: 'Frontend Modular (18 módulos)', desc: 'app.js dividido de 21k para 2.9k linhas. 18 módulos em arquivos separados com cache bust automático', effort: 'Alto', done: true },
      { name: 'Permissões CRUD por Módulo', desc: '18 módulos com controle granular (Ver/Criar/Editar/Excluir) por role. Enforcement no backend com 403. Cache Redis 60s', effort: 'Alto', done: true },
      { name: 'Override por Usuário', desc: 'Permissões individuais que sobrescrevem o role (herdar/permitir/negar). Tri-state no painel de gestão', effort: 'Médio', done: true },
      { name: 'Painel de Permissões', desc: 'UI com grid visual: abas por role, checkboxes CRUD, atalhos (Todos/Nenhum/Somente leitura), seção de overrides por usuário', effort: 'Médio', done: true },
      { name: 'Sidebar Dinâmico', desc: 'Menu lateral filtra itens automaticamente baseado nas permissões do banco. Gate no adminNav() bloqueia navegação direta', effort: 'Baixo', done: true },
      { name: 'Planos SaaS (preparado)', desc: 'Módulos mapeados para tiers (starter/pro/enterprise). Tabela TenantModuleAccess pronta para multi-tenant', effort: 'Médio', done: true },
    ],
  },
  {
    phase: 16, title: 'Equipes & Atendimento Multi-Agente (IMPLEMENTADO 2026-04-23)', color: '#00897b', items: [
      { name: 'Modelo Team / TeamMember', desc: 'Setor com nome, slug, cor, ícone, descrição. Membros com flag isLeader. 3 setores seed: Comercial, Financeiro, Suporte', effort: 'Alto', done: true },
      { name: 'Lead.assignedUserId / teamId / assignedAt', desc: 'Atribuição direta de lead a operador e setor com timestamp. Migration 0006 aplicada em produção (apenas adições, 109 leads legados preservados)', effort: 'Médio', done: true },
      { name: 'Chatbot.defaultTeamId — roteamento automático', desc: 'Lead criado por chatbot vai direto para a fila do setor padrão. Configurável no editor de chatbot. Helper teamRouting.ts deriva por chatbotId ou instanceName', effort: 'Médio', done: true },
      { name: 'Endpoints de equipes (11)', desc: 'CRUD admin/teams + reorder + gestão de membros (POST/PUT/DELETE) + GET /api/teams (autenticado) + GET /api/atendimento/my-teams', effort: 'Alto', done: true },
      { name: 'Endpoints de atribuição (3)', desc: 'POST tickets/:id/assign (transferir setor+operador), /claim (operador assume), /release (devolve à fila). Geram LeadEvent operator_assigned com oldValue/newValue', effort: 'Médio', done: true },
      { name: 'Filtro de scope no GET /tickets', desc: 'scope=mine|team|all. Não-admin sempre limitado a mine+team. Retorna assignedUser/team em cada ticket. Contadores expandidos: mine, teamQueue, waiting, attending, resolved', effort: 'Médio', done: true },
      { name: 'Guards de acesso (assertTicketAccess)', desc: 'Endpoints sensíveis (mensagens, info, close, reopen, delete, claim, release) bloqueiam acesso a leads de outros setores via URL direta. SUPERADMIN/ADMIN sempre passam', effort: 'Médio', done: true },
      { name: 'Frontend modules/teams.js', desc: 'CRUD admin de setores com seletor de cor (12 cores), modal de gestão de membros com toggle de líder, item no menu lateral', effort: 'Alto', done: true },
      { name: 'Frontend atendimento.js — abas de scope', desc: 'Linha extra "Meus | Fila do setor | Todos" com contadores. Badges de setor (cor) e dono em cada card. Subtítulo do chat com setor+operador', effort: 'Médio', done: true },
      { name: 'Frontend atendimento.js — botões e modal de transferência', desc: 'Header do chat: Assumir / Transferir / Devolver. Modal com setor → operadores do setor + motivo. Visibilidade dinâmica por contexto', effort: 'Médio', done: true },
      { name: 'Frontend users.js — gestão de equipes do usuário', desc: 'Botão "Equipes" no menu de actions de cada usuário abre modal com checkbox por setor + flag líder, autosave', effort: 'Baixo', done: true },
      { name: 'Frontend captacao.js — setor padrão no chatbot', desc: 'Campo "Setor padrão" no editor de chatbot. PUT /api/admin/chatbots aceita defaultTeamId no payload', effort: 'Baixo', done: true },
      { name: 'Permissão do módulo teams', desc: 'Adicionado em ALL_MODULES. SUPERADMIN/ADMIN têm CRUD completo, MANAGER/VIEWER bloqueados (mesma regra de users). Total: 84 permissões', effort: 'Baixo', done: true },
      { name: 'Auditoria automática de transferências', desc: 'Toda assign/claim/release gera LeadEvent operator_assigned com oldValue/newValue formatados como "operador / setor" e metadata estruturada. Pronto para futuro relatório', effort: 'Baixo', done: true },
    ],
  },
  {
    phase: '16.1', title: 'Atendimento Multi-Agente Avançado', color: '#00695c', items: [
      { name: 'Round-robin / Distribuição Automática', desc: 'Lead entra na fila do setor → atribuído ao operador online com menor carga (configurável: round-robin / menor carga / aleatório). Capacidade máxima por operador', effort: 'Alto' },
      { name: 'Roteamento por Landing Page / Form', desc: 'Form.defaultTeamId — leads de uma LP específica vão direto ao setor correto (hoje formulários LP vão pra fila geral)', effort: 'Baixo' },
      { name: 'Roteamento por Meta Lead Ads', desc: 'MetaForm.defaultTeamId — leads de campanhas X → setor Y automaticamente', effort: 'Baixo' },
      { name: 'Roteamento por Palavra-chave / IA', desc: 'Detecta intenção da primeira mensagem e direciona para setor correspondente automaticamente', effort: 'Médio' },
      { name: 'SLA Engine', desc: 'Tempo máximo de primeira resposta e resolução por setor. Alertas visuais em tickets que ultrapassam SLA', effort: 'Médio' },
      { name: 'Escalonamento por Tempo', desc: 'Lead na fila por mais de N min sem dono → notifica líder, depois admin. Configurável por setor', effort: 'Médio' },
      { name: 'Métricas por Agente', desc: 'Painel de Performance: leads atendidos, TMA, TME, taxa de resolução, satisfação. Filtros por período/setor', effort: 'Médio' },
      { name: 'Métricas por Setor', desc: 'Volume, tempo médio na fila, distribuição entre membros, leads transferidos pra fora vs. recebidos', effort: 'Médio' },
      { name: 'Ranking de Operadores', desc: 'Top performers do dia/semana/mês, badges, gamificação leve para motivar a equipe', effort: 'Baixo' },
      { name: 'Status de Operador + Heartbeat', desc: 'User.lastSeenAt atualizado a cada 60s. Helper presenceDot() desenha bolinha verde/cinza em cards e selects de transferência. Roteamento futuro respeitará status Disponível/Ausente/Pausa/Offline', effort: 'Baixo', done: true },
      { name: 'Horário de Atendimento por Setor', desc: 'Team.businessHours (JSON) + service businessHours.ts com isWithinBusinessHours(). Fora do expediente, chatbot responde com offHoursMessage configurável. Página Configurações > Horário de atendimento', effort: 'Médio', done: true },
      { name: 'Notificação ao Operador', desc: 'Som (WebAudio AudioContext) + alerta no título da aba (document.title) quando novo lead entra na fila do setor do operador logado. Toggle "Sons" no header do atendimento', effort: 'Baixo', done: true },
      { name: 'Chat Interno entre Agentes', desc: 'Mensagens privadas entre operadores, mention @usuário, anexar lead como referência, grupos por setor', effort: 'Médio' },
      { name: 'Tags por Setor', desc: 'Tags com teamId opcional aparecem só no respectivo setor (financeiro vê tags de cobrança, comercial vê de qualificação)', effort: 'Baixo' },
      { name: 'Mensagens Prontas (Snippets) por Setor', desc: 'Atalhos /saudacao, /cobranca configuráveis por setor — operador digita / e completa', effort: 'Baixo' },
      { name: 'Histórico de Transferências (UI)', desc: 'Aba "Transferências" no detalhe do lead lendo LeadEvent tipo operator_assigned com linha do tempo formatada (operador → operador, setor → setor, motivo)', effort: 'Baixo', done: true },
      { name: 'Relatório de Transferências', desc: 'Quantos leads cada setor recebe vs. transfere, motivos mais comuns (campo reason), gargalos', effort: 'Médio' },
      { name: 'Auditoria de Carga Horária', desc: 'Tempo total que cada operador ficou online, em pausa, atendendo', effort: 'Médio' },
      { name: 'Atribuição em Massa', desc: 'Selecionar múltiplos leads no kanban/listagem e atribuir todos a um setor/operador (hoje 1 a 1)', effort: 'Baixo' },
      { name: 'Filtros Avançados na Listagem', desc: 'Filtrar por setor, operador específico, "sem dono há mais de X horas"', effort: 'Baixo' },
      { name: 'Visão "Manager"', desc: 'Tela específica para líder ver métricas e leads do seu setor sem entrar no atendimento', effort: 'Médio' },
      { name: 'Workflows com Atribuição', desc: 'Actions assignToTeam / assignToUser / transferToTeam em workflows (hoje workflows não mexem em atribuição)', effort: 'Médio' },
      { name: 'Fila de Tarefas do Operador (Today\'s Tasks)', desc: '[Sales Engagement] Tela "Minhas tarefas hoje" agrega: cadências ativas (próxima ação programada), atividades agendadas, follow-ups, leads sem resposta há X dias. Ordenada por priorização dinâmica. Operador trabalha a fila top-down sem precisar buscar lead a lead. Botão "Próxima tarefa" estilo Outreach/Salesloft', effort: 'Alto' },
    ],
  },
  {
    phase: '16.2', title: 'Evolution API v2.3.7 + LID (IMPLEMENTADO 2026-04-23)', color: '#006064', items: [
      { name: 'Upgrade Evolution 2.2.3 → 2.3.7', desc: 'Repositório migrado de atendai/evolution-api para evoapicloud/evolution-api. Suporte nativo a WhatsApp Linked IDs (JID @lid), que estava bloqueando envio para contatos com privacidade LID', effort: 'Médio', done: true },
      { name: 'Monitor de versão no painel', desc: 'Configurações > Evolution API mostra versão em execução + versão mais recente + botão "Atualizar agora". Job em background via services/evolutionUpgrade.ts executa docker compose pull && up -d', effort: 'Médio', done: true },
      { name: 'Sincronização de estado ao boot', desc: 'syncConnectionStateFromEvolution() roda no startup e em SSE com lastConnectionState=unknown. Corrige o bug "conectado dizendo off" após restart', effort: 'Baixo', done: true },
      { name: 'Lead.waLid (migration 0009)', desc: 'Campo waLid indexado armazena o Linked ID quando diferente do phone number. Helper toEvoNumber() preserva JID completo no envio e usa waLid como remoteJid quando disponível', effort: 'Médio', done: true },
      { name: 'Associação por pushName', desc: 'Quando LID não resolve para PN, lead é localizado/atualizado pelo pushName, prevenindo duplicatas a cada troca de LID ↔ PN', effort: 'Médio', done: true },
    ],
  },
  {
    phase: 17, title: 'Portal de Matrículas (IMPLEMENTADO 2026-04-24)', color: '#c2185b', items: [
      { name: 'EnrollmentPortal (schema + migration 0011)', desc: 'Portal público com slug único, customDomain opcional, branding (cores/logo/favicon), formConfig multi-step JSON, paymentConfig Asaas, SEO completo (meta/OG/Twitter/schema.org), pixels (GA4/GTM/Meta/TikTok/LinkedIn), captcha (reCAPTCHA v3 ou hCaptcha), LP sections, quiz IA, funnelCounters JSON', effort: 'Alto', done: true },
      { name: 'EnrollmentRegistration + EnrollmentDocument', desc: 'Matrícula com candidateCode formato MAT-YY-NNNNNN, vínculo a portal + SelectionProcess + ProcessRegistration + Lead. Documento com status pending/approved/rejected, reviewer e nota de revisão', effort: 'Alto', done: true },
      { name: 'SelectionProcess.slug único + Chatbot.enrollmentPortalId', desc: 'Migration 0010 + backfill via script Node (REGEXP_REPLACE nativo incompatível com MySQL). Migration 0012 vincula chatbot ao portal para disparo automático no fim do fluxo', effort: 'Médio', done: true },
      { name: 'LP pública /p/:slug com render server-side', desc: 'HTML renderizado com schema.org EducationalOrganization + Course, Open Graph, Twitter Cards, pixels injetados, LP sections, formulário multi-step. Hook onRequest faz rewrite quando Host casa com customDomain (Let\'s Encrypt via certbot)', effort: 'Alto', done: true },
      { name: 'Formulário multi-step com validação', desc: 'Runtime enrollment-portal.js com CPF (dígitos verificadores), CEP auto-fill via viacep, máscaras de telefone, offering picker com filtros, simulador financeiro inline. Pré-preenchimento via token assinado HMAC', effort: 'Alto', done: true },
      { name: 'Integração Asaas (PIX/boleto/cartão)', desc: 'services/paymentAsaas.ts com createCustomer, createPayment e parser de webhook. ASAAS_STATUS_MAP normaliza status. POST /api/webhooks/asaas valida token e atualiza paymentStatus', effort: 'Alto', done: true },
      { name: 'Portal do candidato autenticado', desc: 'POST /api/candidate/login (CPF + MAT-YY-NNNNNN) retorna JWT-style HMAC-SHA256. /me com dashboard, timeline, próximos passos. Upload de documentos (drag-drop, multipart, validação mime/size). Comprovante PDF via puppeteer', effort: 'Alto', done: true },
      { name: 'Quiz de recomendação por IA', desc: 'quizConfig no portal com regras de pontuação. POST /api/public/portals/:slug/quiz/recommend retorna top 3 cursos mais aderentes às respostas do candidato', effort: 'Médio', done: true },
      { name: 'Chat ao vivo integrado ao CRM', desc: 'session/message/messages endpoints. Cria Lead no CRM com sessionId em formData. Mensagens são Message normais — operador atende pela tela de Conversas como se fosse WhatsApp', effort: 'Alto', done: true },
      { name: 'Captcha server-side', desc: 'services/captcha.ts com verificação de reCAPTCHA v3 (score mínimo) e hCaptcha, escolhido por captchaProvider do portal. Bloqueia submit fraudulento antes de criar Lead', effort: 'Médio', done: true },
      { name: 'Funil analítico + A/B', desc: 'POST /api/public/portals/:slug/track grava eventos (view, step_1..N, submit, payment) em funnelCounters JSON via raw SQL JSON_SET. GET /funnel retorna contadores + taxa de conversão + split A/B', effort: 'Médio', done: true },
      { name: 'Lembrete 24h + expiração via cron', desc: 'services/enrollmentExpireJob.ts roda a cada 30min: runExpireSweep() expira matrículas sem pagamento, runReminderSweep() envia lembrete 24h antes do vencimento via WhatsApp', effort: 'Médio', done: true },
      { name: 'Admin UI (modules/enrollmentPortals.js)', desc: 'Modal com 6 abas (Básico, Formulário, Permissões, Pagamento, SEO, Avançado). Analytics do funil. Matrículas com detalhe, CSV (UTF-8 BOM) e revisão de documentos (aprovar/rejeitar com nota)', effort: 'Alto', done: true },
      { name: 'WhatsApp Enrollment Bot', desc: 'Chatbot.enrollmentPortalId: ao concluir o fluxo educacional, dispara link assinado HMAC do portal (pré-preenchido com nome/CPF/telefone) via WhatsApp. Template Educacional atualizado com o campo', effort: 'Médio', done: true },
      { name: 'Sitemap + robots + customDomain', desc: 'Geração dinâmica de /sitemap.xml e /robots.txt por portal. Suporte a domínio próprio com CNAME + certbot. Docs em CUSTOM-DOMAIN.md e CLOUDFLARE.md', effort: 'Médio', done: true },
    ],
  },
]

const EFFORT_STYLES: Record<string, { bg: string; color: string }> = {
  Baixo: { bg: '#e6f4ea', color: '#137333' },
  Médio: { bg: '#fef7e0', color: '#b06000' },
  Alto: { bg: '#fce8e6', color: '#c5221f' },
}

function EffortBadge({ effort }: { effort?: string }) {
  if (!effort) return null
  const c = EFFORT_STYLES[effort] ?? EFFORT_STYLES.Médio!
  return (
    <span
      class="inline-flex items-center px-2 py-0.5 rounded text-[0.625rem] font-medium shrink-0"
      style={{ background: c.bg, color: c.color }}
    >
      {effort}
    </span>
  )
}

export function RoadmapPage() {
  const totalFeatures = CURRENT_FEATURES.length

  return (
    <Page
      title="Planejamento"
      description="Funcionalidades atuais e plano de evolução"
    >
      <div class="space-y-6">
        {/* Top 5 Urgente */}
        <section
          class="rounded-lg border-2 overflow-hidden"
          style={{ borderColor: '#fbbc04', background: 'linear-gradient(135deg, color-mix(in srgb, #fbbc04 12%, transparent) 0%, transparent 100%)' }}
        >
          <div class="flex items-center justify-between px-4 py-3 border-b" style={{ background: 'color-mix(in srgb, #fbbc04 18%, transparent)', borderColor: 'color-mix(in srgb, #fbbc04 30%, transparent)' }}>
            <div>
              <div class="text-sm font-semibold text-fg">🔥 Top 5 Urgente — Próximos Passos</div>
              <div class="text-[0.6875rem] text-fg-muted mt-0.5">Revisão 2026-04-12 — itens já implementados removidos</div>
            </div>
            <span
              class="inline-flex items-center px-2.5 py-0.5 rounded text-[0.6875rem] font-semibold"
              style={{ background: '#fbbc04', color: '#202124' }}
            >
              5 pendentes
            </span>
          </div>
          <div class="p-3 grid gap-2.5">
            {TOP_URGENT.map((t) => (
              <div
                key={t.n}
                class="flex gap-3 p-3 rounded-lg border bg-surface"
                style={{ borderLeft: `4px solid ${t.color}`, borderColor: 'var(--color-border)' }}
              >
                <div
                  class="shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold text-white"
                  style={{ background: t.color }}
                >
                  {t.n}
                </div>
                <div class="min-w-0 flex-1">
                  <div class="flex flex-wrap items-center gap-2 mb-1">
                    <span class="text-sm font-semibold text-fg">{t.name}</span>
                    <span class="inline-flex items-center px-2 py-0.5 rounded text-[0.625rem] font-medium" style={{ background: 'color-mix(in srgb, var(--color-info) 15%, transparent)', color: 'var(--color-info)' }}>{t.phase}</span>
                    <span class="inline-flex items-center px-2 py-0.5 rounded text-[0.625rem] font-medium bg-surface-3 text-fg-muted">Complexidade: {t.complexity}</span>
                  </div>
                  <div class="text-xs text-fg-muted leading-relaxed">{t.impact}</div>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Funcionalidades Implementadas */}
        <section class="rounded-lg border border-border overflow-hidden bg-surface">
          <div class="flex items-center justify-between px-4 py-3 border-b border-border">
            <div class="text-sm font-semibold text-fg">✅ Funcionalidades Implementadas</div>
            <span class="inline-flex items-center px-2.5 py-0.5 rounded text-[0.6875rem] font-medium" style={{ background: '#e6f4ea', color: '#137333' }}>
              {totalFeatures} features
            </span>
          </div>
          <div class="p-3 grid gap-2.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
            {CURRENT_FEATURES.map((f) => (
              <div key={f.name} class="flex gap-2.5 p-3 rounded-lg border border-border bg-surface-2">
                <span class="text-xl leading-none shrink-0" aria-hidden>{f.icon}</span>
                <div class="min-w-0">
                  <div class="text-[0.8125rem] font-medium text-fg">{f.name}</div>
                  <div class="text-[0.6875rem] text-fg-muted leading-relaxed mt-0.5">{f.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Fases */}
        {ROADMAP_PHASES.map((p) => {
          const doneCount = p.items.filter((i) => i.done).length
          const total = p.items.length
          return (
            <section key={String(p.phase)} class="rounded-lg border border-border overflow-hidden bg-surface">
              <div
                class="flex items-center justify-between px-4 py-3 border-b border-border"
                style={{ borderLeft: `4px solid ${p.color}` }}
              >
                <div>
                  <div class="text-sm font-semibold text-fg">Fase {p.phase}: {p.title}</div>
                  <div class="text-[0.6875rem] text-fg-muted mt-0.5">{total} funcionalidades planejadas</div>
                </div>
                {doneCount > 0 ? (
                  <span class="inline-flex items-center px-2.5 py-0.5 rounded text-[0.6875rem] font-medium shrink-0" style={{ background: '#e6f4ea', color: '#137333' }}>
                    {doneCount}/{total} implementados
                  </span>
                ) : (
                  <span class="inline-flex items-center px-2.5 py-0.5 rounded text-[0.6875rem] font-medium shrink-0 bg-surface-3 text-fg-muted">
                    Planejado
                  </span>
                )}
              </div>
              <div class="px-3 py-1">
                {p.items.map((item, idx) => (
                  <div
                    key={item.name}
                    class="flex items-start gap-2.5 px-1 py-2.5"
                    style={{
                      borderBottom: idx < p.items.length - 1 ? '1px solid var(--color-border)' : 'none',
                      background: item.done ? 'color-mix(in srgb, #34a853 6%, transparent)' : 'transparent',
                    }}
                  >
                    {item.done ? (
                      <span
                        class="w-5 h-5 rounded-full shrink-0 mt-0.5 flex items-center justify-center"
                        style={{ background: '#34a853' }}
                      >
                        <Check size={12} class="text-white" />
                      </span>
                    ) : (
                      <span
                        class="w-5 h-5 rounded-full shrink-0 mt-0.5"
                        style={{ border: '2px solid var(--color-border)' }}
                      />
                    )}
                    <div class="flex-1 min-w-0">
                      <div class="flex flex-wrap items-center gap-2">
                        <span class="text-[0.8125rem] font-medium" style={{ color: item.done ? '#137333' : 'var(--color-fg)' }}>
                          {item.name}
                        </span>
                        {item.done && (
                          <span class="inline-flex items-center px-2 py-0.5 rounded text-[0.625rem] font-medium" style={{ background: '#e6f4ea', color: '#137333' }}>
                            Implementado
                          </span>
                        )}
                      </div>
                      <div class="text-[0.6875rem] text-fg-muted leading-relaxed mt-0.5">{item.desc}</div>
                    </div>
                    <EffortBadge {...(item.effort ? { effort: item.effort } : {})} />
                  </div>
                ))}
              </div>
            </section>
          )
        })}

        {/* Legenda de esforço */}
        <section class="rounded-lg border border-border bg-surface-2 p-4">
          <div class="text-[0.8125rem] font-medium text-fg mb-2">Legenda de esforço</div>
          <div class="flex flex-wrap gap-4 text-xs text-fg-muted items-center">
            <span class="inline-flex items-center gap-2"><EffortBadge effort="Baixo" /> 1-3 dias</span>
            <span class="inline-flex items-center gap-2"><EffortBadge effort="Médio" /> 1-2 semanas</span>
            <span class="inline-flex items-center gap-2"><EffortBadge effort="Alto" /> 2-4 semanas</span>
          </div>
        </section>
      </div>
    </Page>
  )
}
