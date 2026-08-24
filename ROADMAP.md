# Roadmap — ByChatBeyond

> Registro de funcionalidades implementadas e planejadas no sistema.

---

### Fase 29 — Ferramentas, Multi-CA Google Ads e UX de Pagamentos (IMPLEMENTADO 2026-05-11)

> Onda focada em "ajudar a operação do dia-a-dia" + amarrar buracos de tracking e UX dos provedores de pagamento. Cinco frentes paralelas: fix do Pagar.me que estava marcando chaves válidas como inválidas, abas/badges na tela de Pagamentos, fonte de enriquecimento opt-in para identidade de telefone (DICT/PSP), refatoração do envio de conversões do Google Ads para multi-trigger (era 1 CA global mandando sempre Purchase), painel de relatórios Google Ads espelhando o de Meta Ads, e um novo grupo "Ferramentas" no menu com 5 utilitários (UTM Builder, Link de WhatsApp, QR Code, URL Inspector, Personas/ICPs) — todo gerenciável como módulo opcional pelo Configurações → Módulos.

#### Pagamentos — fix Pagar.me + UX

- [x] **Fix `pingPagarme()`** (`services/paymentPagarme.ts`) — antes 401/403 em `/merchants/me` retornava direto "Chave inválida ou sem permissão"; agora qualquer falha cai em fallback automático para `/orders?size=1` (que chaves de merchant comum acessam). `merchants/me` só funciona com chaves marketplace/reseller — esse era o motivo de chaves válidas aparecerem como inválidas.
- [x] **Abas Asaas / Pagar.me em `/app/payments`** — segmented buttons com contador por provedor (`Asaas (3)` / `Pagar.me (1)`), filtragem da lista pelo tab ativo, empty state contextualizado, modal de criação pré-seleciona o provedor do tab atual via novo prop `defaultProvider`.
- [x] **Badges semânticos corrigidos** — `PRODUÇÃO` agora é verde sólido + texto branco (`success solid`); `SANDBOX` virou `TESTE` em vermelho sólido (`danger solid`); `Ativo` virou verde sutil; `Inativo` virou vermelho. Vermelho passou a ser exclusivo de estados negativos.

#### Enriquecimento — Identidade do Telefone (PIX/DICT)

- [x] **Provider opt-in `phone_identity`** (`services/enrichment/providers/phoneIdentity.ts`) — Tier 2 plugável a PSP/serviço terceiro via interface HTTP genérica. Adapters: `mock` (dados falsos para dev/demo, sem chamada externa), `custom_http` (POST genérico ao endpoint configurado), `celcoin` (delega pro custom_http hoje; placeholder pra integração real). Cache de 24h em memória por `phone_e164` (evita cobrança duplicada). Rate limit interno de 30 req/min. Audit log via `console.log` com `sha256(phone)` truncado (nunca telefone em claro). Facts gerados: `phone_holder_name` (0.9), `phone_holder_cpf_masked` (0.95), `phone_holder_bank` (0.7).
- [x] **Settings com 5 keys** sob `enrichment.phone_identity.*` (enabled / provider / endpoint / token criptografado / purpose-LGPD) + helper `lib/phoneIdentity.ts` com cache 60s e `clearPhoneIdentityCache()`.
- [x] **Rotas dedicadas** `GET`/`PUT /api/admin/enrichment/phone-identity` em `routes/settings.ts` — encripta o token via `cloudApi.encryptToken` antes de salvar; resposta GET retorna `tokenConfigured: boolean` + máscara, nunca o valor real.
- [x] **UI: aba "Inteligência" em Configurações** (`settings/IntelligenceSettings.tsx`) com card **"Verificar dono do zap (PIX/DICT)"**: toggle ATIVO/DESATIVADO, select de provedor (mock/custom_http/celcoin), endpoint, token (password mascarado), finalidade LGPD obrigatória (textarea 500 chars). Aviso destacado: "Esta consulta retorna dados pessoais. Garanta base legal documentada (Art. 7º)."

#### Google Ads — Conversion Actions multi-trigger

- [x] **Migration 0050** — tabela `bychat_google_ads_conversion_map` (FK→GoogleAdsConfig, unique config+trigger). Backfill da CA existente como `lead.won` primary com `valueSource='sale_value'`. `GoogleAdsConfig.conversionAction` mantido (DEPRECATED) apontando pro `lead.won` do map por compat.
- [x] **Dispatcher `googleAdsConversions.ts`** escuta 4 eventos do `eventBus`: `lead.won` (Venda confirmada — primary), `lead_qualified` (Lead qualificado), `enrollment.payment_confirmed` (Pagamento confirmado), `diagnosis.completed` (Chatbot concluído). `autoSendConversions` na config é o kill-switch master. Valor por trigger: `'zero' | 'sale_value' | 'fixed'`.
- [x] **Rotas** `GET`/`PUT /api/admin/google/ads/conversion-map` com upsert em lote + autodelete de triggers desmarcados.
- [x] **Wizard etapa 3 redesenhada** — virou tabela de 4 triggers × (checkbox de ativação, dropdown de Conversion Action, dropdown de valor enviado). Aviso explícito: "Não mande o mesmo evento para várias CAs — gera double-counting no Google."

#### Google Ads — Painel de Relatórios (espelho Meta Ads)

- [x] **Migration 0051** — tabela `bychat_google_ads_campaign_costs` (espelho de `CampaignCost` Meta) com níveis `campaign | ad_group | ad`, métricas `spend / impressions / clicks / conversions / conversionValue / ctr / cpc / cpm`, `costKey` único por (level, customerId, campaignId, ag, ad, date).
- [x] **Service `googleAdsInsightsSync.ts`** com GAQL via `:searchStream` em 3 níveis. Converte `cost_micros → reais (÷1_000_000)`. Janela default: últimos 30 dias até ontem (Google só consolida D-1). Logs verbose `[gAdsSync] POST .../search login-customer-id=X` e `← 200 results=N` ou detalhamento do erro Google.
- [x] **Header `login-customer-id` (MCC)** — Setting `google.ads.login_customer_id` opcional + GET/PUT em `routes/googleAds.ts` + card dedicado no topo de `/app/google-ads`. Obrigatório quando o Developer Token vive numa MCC e a conta sincronizada é sub-conta — sem ele Google nega com `USER_PERMISSION_DENIED`.
- [x] **Bug fix**: `pageSize: 10_000` removido do body — método v20 `:search` não aceita esse param e devolvia `INVALID_ARGUMENT [PAGE_SIZE_NOT_SUPPORTED]`. Migração para `:searchStream` que retorna tudo sem paginação.
- [x] **Rotas `routes/googleAdsReport.ts`**: `GET /dashboard` com KPIs + breakdown campaigns/adGroups/ads + daily; `GET /campaigns`; `POST /sync`; `DELETE /costs/:id`.
- [x] **Página `/app/google-ads-report`** com 8 KPIs (Investido / Impressões / Cliques / Conversões / Leads c/ GCLID / Vendas / Receita / ROAS), filtros de período + customer + campanha, 3 abas de breakdown e barras de spend diário. Banners persistentes com instruções específicas pra `DEVELOPER_TOKEN_NOT_APPROVED` (passo-a-passo de Basic access) e `CUSTOMER_NOT_ENABLED`.
- [x] **Item de menu "Relatório Google Ads"** em Relatórios (permission `vendas`).
- [x] **Limitação conhecida**: ROAS hoje cruza `Lead.gclid + saleValue` no período com spend agregado da conta inteira — não atribui receita por campanha específica. Fase 3 (futura): lookup `click_view` GAQL pra popular `Lead.googleAdsCampaignId`.

#### Ferramentas — novo grupo de menu (módulo `tools` opcional)

- [x] **UTMs** (`/app/utms`) — biblioteca de URLs taggeadas: builder com preview live + autocomplete (combina padrões GA + histórico do banco) + tags + notas; lista de UTMs salvas com busca/arquivar/excluir; modal "Convenções" com normalização configurável por operador (lowercase, replace de espaço por `-`/`_`/nada, salvo em localStorage). Schema: migration 0052, tabela `bychat_utm_links`. Rotas CRUD `/api/admin/utms` + `/suggestions` (autocomplete histórico) + `/archive`. fullUrl montada server-side via `URL` parser.
- [x] **Link de WhatsApp** (`/app/whatsapp-link`) — gera `wa.me/<digits>?text=<encoded>`. Dropdown de UTMs ativas anexa fullUrl ao final da mensagem. Aceita query `?phone=...&text=...&utmId=...`. Botões: Copiar, Abrir no WhatsApp, Gerar QR (navega pra `/qr?url=...`).
- [x] **QR Code** (`/app/qr`) — `POST /api/admin/tools/qrcode` gera PNG/SVG via lib `qrcode` existente. Customização: cor frente/fundo (color picker + hex), tamanho 64-1024, margem 0-8, correção L/M/Q/H. Frontend: debounce 400ms, preview live, baixar PNG/SVG. PNG via blob URL + `<img>`, SVG inline via `dangerouslySetInnerHTML` (mais robusto que `<object>` com blob URL).
- [x] **URL Inspector** (`/app/url-inspector`) — `POST /api/admin/tools/url-inspect` faz fetch da URL com `redirect: manual` em loop (max 8 redirects). Lê HTML até 1MB e detecta via regex: UTMs, click IDs (fbclid/gclid/gbraid/wbraid/msclkid/ttclid/twclid/ctwa_clid), **11 trackers conhecidos** (Meta Pixel + IDs, gtag, GA4 + IDs, GTM + IDs, UA legacy, TikTok, LinkedIn, Hotjar, Clarity, RD Station, HubSpot, Intercom, Crisp, Pinterest), OG tags, Twitter cards, SEO meta, JSON-LD. Frontend com 6 cards (Status, Redirects, UTMs+ClickIDs, Trackers, SEO+OG, JSON-LD).
- [x] **Personas/ICPs** (`/app/personas`) — migration 0053, tabela `bychat_personas` com listas JSON (painPoints/objections/triggers/channels/examplePhrases/goals), demografia (ageRange/genderHint/location/occupation/income), voiceTone text, isDefault bool (única padrão por vez — servidor garante via `updateMany` antes do upsert). Rotas CRUD + `PATCH /:id/default` + `PATCH /:id/archive` + `GET /default` (retorna `systemPrompt` pronto). Função `getActivePersonaSystemPrompt()` exportada pra integração futura no chatbot/Sales AI/cadências.
- [x] **Módulo opt-in no Configurações → Módulos**: id=`tools`, name='Ferramentas', icon='🛠', defaultEnabled=true, **não core**. `routePrefixes` cobrem `/api/admin/utms`, `/api/admin/tools`, `/api/admin/personas`. `pages` cobrem `utms`, `whatsapp-link`, `qr`, `url-inspector`, `personas`. `moduleUsage` conta `UtmLink` ativas + `Persona` ativas → se >0 ao desativar exige type-to-confirm "Ferramentas" (padrão da casa). Grupo do sidebar some sozinho quando módulo está desativado (SidebarBody filtra items por permission e esconde grupo vazio).

---

### Fase 28 — UX, Reestruturação de Menu e Templates de Email (IMPLEMENTADO 2026-05-07/08)

> Onda grande de polimento visual + reorganização da informação: sistema de cores padronizado (azul `#1a73e8` + branco como cor principal), badges de status do lead com paleta semântica, novo grupo "Integrações" consolidando ferramentas de canal/credenciais/notificação, painel superadmin pra editar templates de email do sistema, gating de eventos-gatilho por módulo ativo, e fluxo de criação de Workflow invertido (modal antes de persistir).

#### Sistema de cores — padronização global

- [x] **Padrão "azul com texto branco"** aplicado em estados ativos/positivos: badges Ativo/Inativo, botões "X conversões", toggles, banners de sucesso, etc — substituindo o anti-padrão "verde-com-verde-tintado" que tinha contraste ruim em ~14 telas.
- [x] **Telas atualizadas**: Formulários, Chatbots, Landing Pages, Meta Ads, Fluxos (incluindo coluna Gatilho), Cadências de Vendas, WhatsApp (badges + StatusBadge + painel QR), Integrações (status + filterChips), Google Suite (badges Ativa/Conectada/Configurado + painel "Pasta pronta" + header "Conta ativa"), Educational (Levels/Modalities/Units/Campuses/Courses/Offerings/SelectionProcesses), Doc Review (badges status + painéis IA), Payments, Trash, Configurações (todas as abas).
- [x] **`bg-info/15 text-info` e `bg-warning/15 text-warning`** patterns substituídos por `solid` (cor cheia + texto branco) onde havia baixa legibilidade.
- [x] **Aba ativa do Google Suite** ganhou destaque visual (text-accent + bg-accent/5 + border-accent) — antes só tinha underline azul fininho.
- [x] **Fix do Radix Dialog/Popover**: `Modal` agora detecta `[data-radix-popper-content-wrapper]` em `onInteractOutside` — clicar em ColorPicker dentro de um Modal não fecha mais o Modal (afetava Etiquetas, Funis, Aparência, Notificações).
- [x] **Preview do widget chatbot** (`/api/chatbots/embed/preview/:id`) e **float do chatbot** (`embed/:id.js`) migrados de tema preto/dourado pro tema claro/azul (#1a73e8 + branco). Cache 1h pode persistir — Ctrl+Shift+R força reload.

#### LeadStatusBadge — coloração inteligente de etapas do funil

- [x] **Componente `LeadStatusBadge`** (`frontend-app/src/components/LeadStatusBadge.tsx`) substitui o `statusTone()` de 6 tons.
- [x] **Mapa por jornada do lead**: Novo→azul, Contato→sky, Qualificado→indigo, Reunião/Convocado→ciano/âmbar, Inscrito/Matriculado→esmeralda, Ganho/Fechado→verde, Perdido→rosa, etc.
- [x] **Fallback determinístico djb2** pra etapas customizadas — mesmo nome ganha sempre a mesma cor (consistência entre sessões).
- [x] **Aplicado em**: tabela de Leads (coluna Status), `LeadsDuplicatesPage`, `MergeLeadsModal`. Função morta `statusTone()` removida de `lib/format.ts`.

#### Reestruturação do menu principal

- [x] **Itens movidos pra Configurações como sub-tabs** (Fase 27 prévia): Planejamento, Instalações, Lixeira, Pagamentos. Acompanhado de **redirects** pras URLs antigas (`/app/roadmap` → `/app/settings?tab=roadmap`, etc) preservando bookmarks.
- [x] **Novo grupo "Relatórios"** no topo dos grupos (antes do CRM): Meus Painéis (`/app/analytics`) + Relatório Meta Ads (`/app/meta-ads-report`). Itens saíram de Pinned e Vendas&Automação.
- [x] **Conversões → "Conversões Meta Ads"** (rename do label e título da página, mantém URL `/app/conversions` e configurações no banco).
- [x] **Novo grupo "Integrações"** consolidando 12 itens: Visão geral · Google Workspace · Make.com · Conversões Meta Ads · Evolution API · E-mail · SMS · IA/Tokens · DNS · Webhooks · API Keys · Pagamentos. Substitui dispersão antiga entre Configurações/Canais/Vendas.
- [x] **Grupo "Canais" enxuto** — só canais de mensagem agora (WhatsApp, Cloud API, Telegram, Instagram).
- [x] **Configurações enxutas** — 12 sub-tabs essenciais (Aparência, Campos personalizados, Equipes, Atendimento, Segurança, Módulos, Objeções, Duplicação, Emails do Sistema, Instalações, Lixeira, Planejamento). Removidas: Email/SMS/IA/DNS/Webhooks/API Keys/Pagamentos/Evolution/Minha conta Google/Integrações (movidas pro novo grupo).
- [x] **Páginas dedicadas** (`routes/pages/integrations/IntegrationStandalonePages.tsx`) pra cada item: cada uma envelopa o componente original num `<Page>` próprio. URLs limpas tipo `/app/integrations/evolution`, `/app/integrations/email`, etc — sem mais layout quebrado de Settings ao redor.
- [x] **Configurações > Minha conta Google** virou **tab "Minha conta"** dentro de Google Workspace (`/app/google`).
- [x] **Items de menu, ícones**: adicionados `Mail/Brain/Webhook/Key` ao tipo `IconName` e ao `SidebarIcon`.

#### Tela Evolution API (resgatada do legado admin.js)

- [x] **`/app/integrations/evolution`** com paridade total à tela do admin legado:
  - 3 cards de status (API online/erro/offline · Webhook configurado/incorreto/missing · Monitor com botão "Verificar agora")
  - Card Versão & Upgrade (instalada vs latest, botão "Atualizar para vX.Y.Z" só pra SUPERADMIN, gate de canUpgrade/waitSeconds, job ativo + último upgrade)
  - Tabela de Instâncias (Nome/ID/Conexão/Telefone/Perfil/Chatbot/DB Ativa)
  - Card de Issues com botão "Corrigir" por problema detectado
  - Modal de upgrade exigindo senha SUPERADMIN
  - Modal de logs com polling 2s
- [x] **Hooks `useEvolutionMonitor`** com auto-refetch (30s/5s quando job ativo).

#### Templates de email do sistema — Configurações > Emails do Sistema (SUPERADMIN)

- [x] **Auditoria completa** dos pontos onde o sistema dispara email automaticamente sem passar por Fluxo: identificados 9 callsites em 6 arquivos (notify.ts, settings.ts, activities.ts, users.ts, workers.ts, googleCalendarSync.ts).
- [x] **Migration 0049 + tabela `bychat_system_email_templates`** com `key/name/subject/htmlBody/enabled/variables/category/updatedById`.
- [x] **5 templates editáveis com seed idempotente** (`services/systemEmailTemplates.ts`): `notify_new_lead_admin` · `lead_diagnostic_report` · `password_reset` · `email_test` · `activity_email_default`.
- [x] **Service `renderSystemEmail(key, vars)`** com syntax `{{ lead.nome }}` (paths aninhados, missing → string vazia).
- [x] **Funções refatoradas** pra usar templates do banco com fallback hardcoded: `notify.ts:sendEmail/sendReportToLead/sendPasswordResetEmail` · `settings.ts:email-test`.
- [x] **CRUD endpoints** (`/api/admin/system-emails/*` SUPERADMIN-only): list/get/update/reset/preview/send-test.
- [x] **UI completa** (`SystemEmailsSettings.tsx`): listagem agrupada por categoria (Ciclo de vida/Auth/Sistema/Manual), modal de edição em tela cheia com Editor + Preview (iframe sandboxed), sidebar com variáveis disponíveis (clique pra copiar), botões Restaurar padrão / Preview / Salvar / Enviar email de teste.
- [x] **Toggle "Disparo automático ativo"** por template — quando off, sistema não dispara aquele email (Workflow assume).
- [x] **2 Workflows seed inativos** (`notificationSeed.ts`) substituindo os disparos hardcoded:
  - `wf_lead_created_notify` → trigger `lead.created` → email pra equipe (template `lead_created_admin_email`)
  - `wf_diagnosis_report_to_lead` → trigger `diagnosis.completed` → email pro lead (template `lead_diagnostic_email`)
- [x] **Reset de senha** continua sempre disparando (transacional crítico de segurança), ignora flag enabled.

#### Conversões Meta Ads — fixes e expansão

- [x] **Bug 1 — config não aparecia salva**: `getCapiConfig()` retornava `null` se faltasse pixel OU token, escondendo o que o usuário acabou de salvar. GET endpoint refatorado pra ler cada `Setting` direto e mostrar estado parcial real.
- [x] **Bug 2 — PUT apagava mappings**: cada save sobrescrevia `capi.stage_mappings` com `{}` quando body não incluía. PUT virou parcial: só atualiza campos que vieram explicitamente.
- [x] **Bug 3 — token nunca persistia no setup inicial**: `tokenChanged` só virava true após "Editar" (que só aparece quando já há token). `handleSave` agora envia `accessToken` sempre que tiver valor digitado, não exige `tokenChanged`.
- [x] **Test event Meta — code 100/2804050**: o teste mandava só `country` no `user_data` (Meta considera "amplo demais"). Agora envia combinação forte: `em` (sha256 fake email) + `ph` (fake phone) + `external_id` + `country` + `fbp` sintético + `client_ip_address` (real) + `client_user_agent`. Match quality OK.
- [x] **Erro do Meta extraído pra UI**: backend agora parseia `error.message + error.code + error_user_msg` e devolve no campo `error` — toast antes mostrava só "erro desconhecido".
- [x] **Eventos CAPI traduzidos**: labels do dropdown ficaram em PT-BR + nome técnico após `·` (ex: `Lead qualificado · Lead`, `Matrícula / Assinatura · Subscribe`, `Venda confirmada · Purchase`). `value` permanece em inglês (taxonomia Meta exige). Sugestão automática (`DEFAULT_STAGE_HINTS`) expandida de 11 pra 36+ termos PT-BR (Reunião/Convocado/Prova/Boleto/Matrícula/Aprovado/etc). Descrição do evento aparece abaixo da etapa mapeada.
- [x] **Lead Quality Feedback API** (Meta Lead Ads CRM Integration):
  - Service `metaLeadQualityFeedback.ts` com `sendLeadQualityFeedback({ leadId, quality })` chamando `POST /v19.0/{lead_id}` com `leadgen_lead_quality`
  - Triggers automáticos (fire-and-forget, opt-in via setting): `qualifyLead` → `INTERESTED`, `markLeadWon` → `CONVERTED`, `markLeadLost` → `INVALID` (heurística por motivo: spam/fake/duplicado/etc) ou `NOT_INTERESTED`
  - Endpoints CRUD (`/api/admin/conversions/lead-quality/*`) com toggle, stats 30d, últimos 20 envios, send manual
  - UI no card "Conversões > Configuração" com KPIs Enviados/Falhas, log de envios, lista dos 4 disparos automáticos

#### Catálogo de Trigger Events e gating por módulo

- [x] **`lib/triggerEvents.ts`** centraliza catálogo completo: 35 eventos agrupados em 7 categorias (Lead/Mensagens/Atividades/Vendas/Sistema/Portal/Educacional). Era 22 dispersos em arquivos diferentes.
- [x] **`requiresModule`** opcional por evento: 7 eventos do Portal de Matrículas (`enrollment.submitted`, `enrollment.payment_*`, `enrollment.document_*`, etc) só aparecem se módulo `enrollment_portals` estiver ativo. 9 eventos Educacional (`enrollment.essay_*`, `enrollment.enem_*`, `enrollment.presencial_*`, `enrollment.fully_evaluated`) só aparecem se `educacional` estiver ativo.
- [x] **`filterAvailableTriggers(enabledModules)`** consome `useModules()` e filtra. Aplicado em `WorkflowsPage` (modal Configuração + Evento Gatilho + Evento de meta) e `WorkflowStepsEditor` (steps tipo evento/branch).
- [x] **Renderização agrupada** com `<optgroup>` — UX bem melhor que listão de 35 itens.

#### Fluxo de criação de Workflow invertido

- [x] **Antes**: clicar "Novo fluxo" → `useCreateWorkflow.mutate({ name: 'Novo Workflow', triggerEvent: 'lead.stage_changed' })` cria placeholder no banco → aparece na lista com nome genérico → operador edita.
- [x] **Depois**: clicar "Novo fluxo" → modal `WorkflowCreateModal` pede dados mínimos (Nome*, Evento gatilho*, Descrição opcional) → fluxo só persiste após clicar **Criar e configurar** ou **Criar e abrir builder →**.
- [x] **Validação** inline (não toast) com mensagens claras quando falta campo obrigatório. Botões desabilitados até preencher.
- [x] **Modal não fecha durante mutation** (isPending) — evita criar workflow órfão.

#### Outras melhorias

- [x] **Toggle Ativo/Inativo no Chatbot** (linha de cada bot): badge clicável + botão Power "Ativar/Desativar" na barra de ações, antes de Testar.
- [x] **Performance da Equipe** — filtros refatorados de `flex flex-wrap` com larguras fixas (que quebravam o layout em desktop wide) pra grid responsivo `1/2/3/5 cols`. Datas De/Até em sub-linha separada quando "Personalizado" ativo.
- [x] **Visão Geral — Leads por dia interativo**: `Sparkline` (usado pelo widget) ganhou paridade com o `TrendChart` do Relatório Meta Ads — Y-axis com ticks numéricos, X-axis com datas, hover crosshair, animated dots, tooltip HTML com data formatada + valor. Aplica-se a qualquer widget tipo `line/area`.
- [x] **Painel de Objeções (Configurações > Objeções)** padronizado com layout do FormsPage: Badge clicável Ativo/Inativo + Botões `Button variant="secondary" size="sm"` com label e ícone (`Power+Ativar/Desativar`, `Pencil+Editar`, `Trash2+Excluir` com cor danger).
- [x] **Padrão de botões aplicado** em mais sub-tabs de Configurações: Campos custom, Times (lista + modal de membros), DNS — todos saíram de "icon-only size-7" pra `Button size="sm"` com label.
- [x] **Removido "Portal de Matrículas vinculado" do Chatbot**: campo `enrollmentPortalId` removido do modal/payload/export/import/duplicação. Lógica em `chatbotFlow.ts` que disparava link pré-preenchido ao final da conversa removida (pode ser feito via Fluxo agora). Lookup em `enrollmentPortals.ts` que usava chatbot.enrollmentPortalId removido.
- [x] **`renderTriggerOptions`** agrupa `<option>` por categoria com `<optgroup>` — utility reutilizável.

---

### Fase 26 — Builder Visual de Workflows e Cadências (IMPLEMENTADO 2026-05-07)

> Editor de fluxos em canvas (React Flow + Dagre) substituindo o modal "Editar passos" tanto em Workflows quanto em Cadências de Vendas. Cadências ganharam branching opcional (nextStepId/altStepId) — quando presente o `cadenceScheduler` segue o sucessor explícito; quando null mantém o modo linear histórico (compatibilidade total).

#### Workflows — `/app/workflows/:id/builder`
- [x] **Tela dedicada** (`WorkflowBuilderPage`) substitui o modal legado de edição de passos. Modal antigo continua disponível em "Lista".
- [x] **Paleta de 6 tipos** (trigger/wait/condition/action/branch/goal) com drag-to-create.
- [x] **Conexão por handles** — `next` e `alt` persistem `nextStepId`/`altStepId`.
- [x] **Painel direito 360px** (`WorkflowStepEditPanel`) reaproveita `StepConfigFields` da Lista.
- [x] **Auto-layout Dagre LR** com persistência em batch + undo.
- [x] **Export/Import JSON** (idMap em 2 passadas).
- [x] **Detecção de issues** estruturais (no-output, orphan, incomplete-branch) com warning visual.
- [x] **Busca Ctrl+F** com cursor entre matches + dimming dos não-match.
- [x] **Undo/Redo** Ctrl+Z / Ctrl+Y (histórico de 20 ops).
- [x] **Modo Execução** com polling 5s, heatmap por step, badge "leads aqui", edges com count/animação/espessura proporcional, painel summary (running/paused/completed/failed).
- [x] **Backend** `GET /api/admin/workflows/:id/execution-stats` (stepStats+edgeStats+summary).
- [x] **Migration 0047** alinha histórico com schema (positionX/Y já existiam via `db push`; SQL idempotente em ambientes onde já estão presentes).

#### Cadências de Vendas — `/app/sales-cadences/:id/builder`
- [x] **Tela dedicada** (`SalesCadenceBuilderPage`) com toggle Pausar/Ativar, atalho pra Métricas.
- [x] **Schema** (migration 0048): `CadenceStep.positionX/positionY/nextStepId/altStepId` (nullable — fallback linear).
- [x] **Paleta de 6 canais** (whatsapp/email/sms/call/linkedin/manual) com drag-to-create + defaults amistosos por canal (D+0/D+1/D+2).
- [x] **Painel direito** (`CadenceStepEditPanel`) edita canal/dayOffset/hourOffset/template/isManual/isBreakUp + selects de próximo/alt.
- [x] **Edges duplas**: explícitas (sólido, `nextStepId`) e implícitas/legado (pontilhadas cinza, derivadas do `order`). Operador vê o que é "real" no grafo vs o fallback do scheduler.
- [x] **Backend** novo: `POST/PUT/DELETE /api/admin/sales-cadences/:id/steps[/:stepId]` (mutações pontuais usadas pelo canvas) + `GET /:id/execution-stats` (stepStats+edgeStats+summary).
- [x] **`cadenceScheduler`** atualizado: prefere `step.nextStepId` quando presente, fallback pra `order = currentStep + 1` (zero quebra de comportamento existente). `currentStep` do enrollment passa a apontar pro `order` real do próximo step.
- [x] **Auto-layout Dagre**, Export/Import JSON, undo/redo, busca Ctrl+F, modo Execução com heatmap — paridade total com Workflows.
- [x] **Detecção de issues** específica: `no-output-non-breakup`, `orphan`, `broken-next` (FK órfã).
- [x] **Lista permanece** — modal `SalesCadenceStepsEditor` ainda acessível pelo botão "Lista" pra edição linear rápida.

*2026-05-07 — Fase 26 entregue: Workflows com builder visual completo + Cadências com canvas e branching opcional. Migration 0047 (alinhamento) + 0048 (cadência: 4 colunas) aplicadas em produção. Backend tipado, build verde.*

#### Fase 26.1 — Buffer local com Save/Discard (2026-05-07)

> Refactor pra trocar o auto-save (cada drag/connect/drop persistia imediatamente) por um buffer de mudanças com botões Salvar/Descartar. Operador agora controla quando confirma. Aplicado tanto em Workflows quanto Cadências.

- [x] **Backend** novos endpoints `POST /admin/workflows/:id/canvas-save` e `POST /admin/sales-cadences/:id/canvas-save`. Recebem `{ steps[], deletedStepIds[] }` (IDs negativos identificam novos), aplicam tudo em transação com idMap pra resolver `nextStepId`/`altStepId` que apontem pra IDs negativos.
- [x] **Frontend** canvas mantém `localSteps` + `deletedIds` + `dirtyIds`. Mutations imediatas (`useCreateStep`/`useUpdateStep`/`useDeleteStep`) substituídas por mutações no buffer local. Únicos pontos de persistência: botão "Salvar" e atalho **Ctrl+S**.
- [x] **Botão X no node** (visível ao hover, canto superior esquerdo) pra remover step do buffer — também via tecla Del.
- [x] **Badge "NOVO"** em steps com id negativo e **"•"** em steps existentes modificados localmente.
- [x] **Header do canvas**: badge "N mudanças não salvas" + botões Salvar (verde, primário) e Descartar (com `confirm()`).
- [x] **Guard `beforeunload`** quando há mudanças pendentes.
- [x] **Painéis de edição** (`WorkflowStepEditPanel` / `CadenceStepEditPanel`) trocaram "Salvar passo" por "Aplicar" — patch vai pro buffer, não pro backend direto.
- [x] **Cadências**: tratamento especial do `order` UNIQUE — durante save, steps existentes recebem orders temporários (`10000+id`) antes da gravação final pra evitar colisão de unique constraint quando ordem é trocada no canvas.

*2026-05-07 — Fase 26.1 entregue: zero auto-save no canvas. Operador controla quando persiste, com confirmação visual de mudanças pendentes e guard de saída.*

#### Fase 27 — Performance da Equipe expandida (2026-05-07)

> Painel `/app/team-performance` ganhou novos filtros e indicadores cobrindo todo o ciclo de trabalho do operador: volume, conversão, receita, atividade, produtividade e tempos.

- [x] **Filtros novos**: Operador (single-select de users), Funil, Origem do lead (qualificationSource), Período personalizado (date pickers from/to).
- [x] **Backend** `/api/admin/team-metrics` expandido: campos `winRate`, `revenue`, `salesCount`, `avgTicket`, `avgFirstResponseMs` (FRT), `avgPriorityScore`, `messagesSent`, `activitiesCreated/Completed/Pending/Overdue`, `avgActivityCompletionMs`, `stageMoves`, `cadenceManualSteps` por operador + totais correspondentes.
- [x] **Endpoint novo** `/api/admin/team-metrics/operator/:userId/breakdown` — distribuição de outcomes (won/lost/open), top 5 motivos de perda com cores, top fontes de qualificação, série temporal diária de receita.
- [x] **Endpoint novo** `/api/admin/team-metrics/workload` — carga atual (não filtra por período): leads ativos sem outcome, capacidade utilizada (%), atividades pendentes/em atraso por operador. Refresca a cada 60s no frontend.
- [x] **Frontend** 12 KPIs no header em 2 linhas (volume/receita + tempos/atividade), card "Carga de trabalho agora", tabela expandida com 17 colunas (incluindo `Receita`, `Ticket`, `Msgs`, `Atividades`, `FRT`, `Stage moves`, `Pri. média`).
- [x] **Drill-down por operador** (modal): KPIs do operador, barra empilhada won/lost/open, top 5 motivos de perda com bars coloridas, badges de origem, sparkline diário de receita.

*2026-05-07 — Fase 27 entregue: 15+ KPIs por operador cobrindo Lead → Conversa → Atividade → Cadência → Venda. Workload em tempo real com indicador de utilização (verde/amarelo/vermelho). Drill-down completo via modal.*

#### Fase 28 — Origens consolidada em Rastreamento (2026-05-07)

> O módulo "Origens" virou aba dentro de "Rastreamento" — eram complementares (atribuição de leads × analytics de visitantes anônimos), nada se mistura, mas ficam acessíveis no mesmo menu.

- [x] **Aba "Origens dos Leads"** em `/app/tracking?tab=origins` — KPIs (Total/Rastreados/Taxa), donut por `Lead.originType` e detalhamento (idêntico ao painel anterior).
- [x] **Sidebar**: removida entrada "Origens" do grupo Marketing & Aquisição.
- [x] **Router**: `/app/sources` redireciona pra `/app/tracking?tab=origins` (deep-links antigos não quebram).
- [x] **Deep-link de aba**: TrackingPage lê `?tab=` no mount e atualiza `history.replaceState` ao trocar (compartilhamento direto).
- [x] **Cleanup**: `SourcesPage.tsx` removido. `useOriginsStats` continua intacto (usado pela nova aba).

*2026-05-07 — Fase 28 entregue: -1 item no menu, +1 aba contextual onde faz sentido. Sem perda de funcionalidade.*

---

## Implementado

### Fase 1 — Core (Base do Sistema)
- [x] **Gestão de Leads (CRUD)** — Cadastro, listagem com colunas configuráveis (15 colunas, drag-and-drop, persistência), filtros avançados, exportação CSV e detalhamento
- [x] **Painel Admin** — Dashboard interno com métricas, estatísticas e visão geral dos leads
- [x] **Analytics Dashboard** — Painel de analytics com Charts.js
- [x] **Autenticação de Usuários** — Login JWT, roles (SUPERADMIN, ADMIN, MANAGER, VIEWER), reset de senha
- [x] **Notificações** — Envio automático via WhatsApp (Evolution API) e e-mail (Resend)

### Fase 2 — CRM e Funis
- [x] **Funis de Vendas** — Criação e gestão de múltiplos funis com etapas customizáveis (nome, cor, posição)
- [x] **Kanban Board** — Cards com WhatsApp, e-mail, ícone de origem, nome do formulário Meta (tooltip), tags, indicador de inatividade, drag-and-drop
- [x] **Etapas (Stages)** — Configuração de etapas por funil com chave, nome, cor e ordenação
- [x] **Detalhe do Lead — Página dedicada** (2026-05-04) — Detalhe do lead deixou de ser modal e virou página própria em `/app/leads/:id` com URL copiável, back-button funcional e layout 2 colunas (sidebar sticky com info-chave + main com tabs). Componente `LeadDetailContent` compartilhado; modal antigo (`LeadDetailModal`) mantido só para preview rápido em Kanban e widgets do dashboard. Tabs (Visão geral, Tracking, Inteligência, Atividades, Cadências, Timeline, Campos) reaproveitadas via exports do `LeadsPage`. Link de "Hoje" passou a apontar pra rota dedicada (fix de bug `/app/app/leads/X` por prefixo duplicado do wouter).
- [x] **Atividades na tela do Lead — Paridade com /app/activities** (2026-05-04) — A aba "Atividades" do lead ganhou botão **Nova**, filtros por tipo (chips com ícone/cor) e linhas ricas com badge de status, indicador de atrasada, anexo, modelo, autor e menu de ações por linha (Enviar/Concluir/Cancelar/Excluir). Ao clicar em "Nova", abre o `CreateActivityModal` com o lead **pré-selecionado** (campos `recipientPhone`/`recipientEmail` populados a partir do próprio lead) — o operador só preenche tipo, título, data e mensagem. Refactor: `ActivityRow`, `DeleteActivityDialog` e `TYPE_META` exportados de `ActivitiesPage` para evitar duplicação. As mutations de atividade agora invalidam tanto `['activities']` quanto `['lead-activities']` (a lista per-lead atualiza sozinha após criar/concluir/excluir).
- [x] **Campos Personalizados read-only no Lead** (2026-05-04) — Aba "Campos" renomeada para "Campos Personalizados" (TOC sticky e tabs do modal); valores agora são exibidos somente-leitura (componente `Field`), removidos `Input` editáveis, draft/dirty state e botão "Salvar campos". Edição é exclusiva pelo formulário de captação / API.
- [x] **Anotações como histórico append-only** (2026-05-04) — Modelo novo `LeadNote` (tabela `bychat_lead_notes`, migration 0034) substitui o single-value `Lead.annotation`. UI da Visão geral troca o textarea editável + botão "Salvar anotação" por um form "Adicionar anotação" + lista cronológica abaixo (mais recentes no topo) com **autor + data/hora + conteúdo** em cada cartão. Endpoints `GET /api/bychat/leads/:id/notes` e `POST /api/bychat/leads/:id/notes`. Backfill na migration importa `lead.annotation` legado como nota com `userId=NULL` (autor "—") e `createdAt=updatedAt` do lead. PUT `/annotation` mantido como deprecated p/ integrações antigas; cada nova nota também emite `annotation_saved` no `LeadHistory` (Timeline continua mostrando).
- [x] **Status (etapa do funil) como chips** (2026-05-04) — Removido o input livre `Status (etapa do funil)` em texto. Substituído por chips com as etapas ativas do funil do lead (cor real da etapa, ordenadas por position). Clique direto move o lead pra etapa (auto-mutate, sem botão Aplicar). Banner amarelo "status fora do funil" pra leads em etapa órfã.
- [x] **DuplicatesHint acionável + i18n cadência** (2026-05-04) — Banner de duplicatas no detalhe do lead virou clickable: removido o texto "use o botão Mesclar no rodapé" (que estava errado após o cutover do menu Ações no header) e adicionado botão "Mesclar agora" inline que abre o `MergeLeadsModal` direto. Também centralizei rótulos de cadência (exitReason, pauseReason, replyClass, status, channel) em `lib/cadenceLabels.ts` — `completed_all_steps` agora aparece como "Concluiu todos os steps" na aba Cadências do lead, no Dashboard de Cadência e em Hoje. Helper devolve o valor bruto se a chave não tiver tradução (visibilidade pra novas chaves do backend).
- [x] **Inteligência: paridade total dentro do Lead** (2026-05-04) — Aba "Inteligência" do lead agora reaproveita o componente `IntelLeadDetail` (extraído do `IntelDetailModal` da página global) — todas as ações ficam disponíveis: registrar/revogar LGPD, scan rápido/completo (com `force`), card de progresso ao vivo (provider, índice, fatos coletados), tabs Resumo (Insights/Promoções/Dossier) e Fatos brutos com filtro de contestados, contestar/restaurar fatos com motivo opcional, excluir fato individual (LGPD art. 18), download JSON e PDF do dossiê. `IntelDetailModal` virou wrapper fininho do mesmo componente — sem duplicação.
- [x] **Cadência: re-inscrever após enrollment terminal** (2026-05-04) — POST `/sales-cadences/:id/enrollments` agora aceita re-inscrição quando o enrollment anterior está em estado terminal (`completed`/`exited`): apaga o antigo + cria novo numa transação. Bloqueia (409) só se estiver `active`/`paused`. UI da aba Cadências do lead deixa o botão sempre clicável; modal mostra cadências com sufixo "(reinscrever — substitui enrollment anterior)" quando aplicável e mensagens claras nos cenários sem opções (sem cadência ativa / lead bloqueado).
- [x] **Landing Pages: painel Aparência completo + preview ao vivo** (2026-05-04) — Controle total de identidade visual de LP. **Backend**: `getDefaultStyles()` expandido de 9 para 38 tokens (marca: logoUrl/maxHeight/googleFonts; cores: primary/secondary/accent/background/text/textMuted/heading/link/linkHover/border/cardBg/cardBorder; botão: bg/text/hover/radius/padding/fontSize/fontWeight; tipografia: fontFamily/headingFontFamily + sizes h1/h2/h3/base + weight + lineHeight body/heading; layout: maxWidth/sectionPaddingY/containerPaddingX/sectionPaddingMobile + borderRadius). `generateCSS` em `pageRenderer.ts` reescrito pra emitir CSS vars completas (`--heading`, `--link`, `--btn-bg`, `--btn-radius`, `--fs-h1`, etc.) + `h1-h6` aplica `var(--font-heading)/--fw-heading/--lh-heading`. Helper `buildGoogleFontsLink(gs)` aceita sintaxe pipe (`Inter:400,600|Poppins:400,700`) ou URL completa do Google Fonts; default Inter mantido pra retrocompat. Endpoint novo `POST /api/pages/:id/preview-html` renderiza HTML em memória com overrides do body (`globalStyles/customCss/customHead`) sem persistir — usado pro iframe ao vivo. **Frontend**: `LandingAppearancePanel` em duas colunas, esquerda com 6 tabs (Marca · Cores · Tipografia · Botão · Espaçamento · CSS/HEAD) com 7 presets (Padrão/Corporativo/Startup/Editorial/Dark/Sunset/Minimalista); direita com `<iframe srcDoc>` sandbox=`allow-scripts allow-forms` recebendo HTML do endpoint preview, debounce 600ms, toggle de viewport (desktop/tablet/mobile com larguras 100%/768/375). Hook `useLandingPagePreview` faz fetch direto (HTML cru, não JSON). Botão **Palette** por linha em `/app/pages` abre o painel em modal `unconstrained` com 78vh de altura. Mudanças vão pro mesmo `globalStyles` Json no banco — `customCss`/`customHead` continuam funcionando. Save chama `useUpdatePage` no body inteiro.
- [x] **Chatbots: Exportar/Importar JSON** (2026-05-04) — Backup/clonagem completa de chatbots. `GET /api/admin/chatbots/:id/export` devolve JSON `{ kind, version, exportedAt, chatbot, references, questions }` com Content-Disposition (download direto); inclui TODOS os campos de configuração (24 diretos: name/channel/active/prompts/messages/scoringConfig/sentimentPrompt/autoAnalysis/inactivity*/funnelId/defaultTeamId/enrollmentPortalId) + array completo de questions + nomes das refs externas (funnel.name, team.name+slug, portal.slug+internalName) pra resolução no destino. `POST /api/admin/chatbots/import` aceita `{ payload, name?, importQuestions? }` e cria novo chatbot em transação: valida `kind===bychat-chatbot-export`, resolve refs por nome/slug (fica null se não bater), aceita override do nome (default `${original} (importado)`), cria todas as questions junto. Frontend: botão **Download** por linha e botão global **Importar**; modal de import com file picker, preview do payload (canal, qtd de perguntas, refs, data de export), input de novo nome (preenchido automaticamente), checkbox "importar perguntas também", aviso quando referências externas não foram encontradas no destino.
- [x] **Forms: aba Aparência com preview ao vivo** (2026-05-04) — Modal de form ganhou tabs (Geral/Mensagens/Aparência). Aba Aparência tem painel split: à esquerda 5 sub-tabs (Cores · Tipografia · Espaçamento · Botão · Sucesso) com ColorPicker + Select de fonte + inputs de tamanho/padding/radius; à direita preview ao vivo do form rendered usando os mesmos tokens do `<beyond-form>` Web Component (paridade 100% com produção). 6 presets prontos (Padrão azul/Dark/Suave roxo/Vibrante laranja/Minimalista/Pílula). 26 tokens visuais cobrindo cores (primária/hover/texto/fundo/label/campo/placeholder/erro), tipografia (família, tamanho base, label size/weight, field size), espaçamento (maxWidth, fieldSpacing, fieldPadding, borderRadius), botão (padding/radius/size/weight) e tela de sucesso (cor/tamanho do título, cor do texto). Backend: `getDefaultFormStyling()` exportado, `cssVal()` sanitiza valores antes de injetar no `<style>` do Shadow DOM, `GET /api/forms/config/:id` mescla defaults antes de devolver. Hook: tipo `FormStyling`, `DEFAULT_FORM_STYLING`, `resolveFormStyling()` em sincronia com backend.
- [x] **Cadência: gerador por IA com wizard 4 passos** (2026-05-04) — Feature flagship de Sales Engagement. Botão "✨ Criar com IA" no header de `/app/sales-cadences` abre wizard multi-step: (1) Objetivo — 10 cards (prospect/follow-up morno/reativar/qualify inbound/book meeting/post-demo/no-show/event/breakup/custom); (2) Público & Oferta — indústria, cargo-alvo, dores, produto, value prop; (3) Tom & Canais — 5 tons + 6 canais multi-select com cores reais + 3 durações + 3 intensidades + toggle de break-up; (4) Preview — IA devolve cadência completa (nome, descrição, política, sequência de steps com cor/canal/timing, mensagens com variáveis, rationale por step, summary + 3 best practices + recommended next). Editor inline por step (lápis abre edição de mensagem/dia/hora/assunto). Botão "Refinar com IA" aceita instrução livre ("mais agressivo", "encurtar", "tom consultivo") e itera. Salvar como rascunho ou ativar — backend cria os MessageTemplates necessários + SalesCadence + steps em transação única. Backend: `services/aiCadenceGenerator.ts` (Anthropic preferred com fallback OpenAI, prompt de Sales Engagement com best practices, JSON schema rigoroso, sanitização de canal/order/body); rotas `POST /api/admin/sales-cadences/ai-generate` (preview, não persiste) e `/ai-generate/commit` (persiste).

### Fase 3 — Comunicação
- [x] **Integração WhatsApp** — Conexão com Evolution API (ByChatPro), envio/recebimento de mensagens, upload/download de mídia, suporte a múltiplas instâncias
- [x] **Chat em Tempo Real** — Interface de chat com leads via WhatsApp, mensagens internas, citações e status de leitura (ack)
- [x] **Chatbot com IA** — Chatbot configurável por canal com perguntas por estágio, prompt de sistema/extração/análise, mensagens de saudação e conclusão
- [x] **Chatbot SDR Humanizado** — Chatbot de qualificação de leads que se apresenta como o atendente real (nome puxado da instância WhatsApp conectada via QR code/Cloud API). Prompts com variáveis {{attendant_name}} e {{brand_name}}, extração automática para campos personalizados, zero aparência de bot
- [x] **Templates de Chatbot** — 10 modelos pré-cadastrados ao criar novo chatbot: SDR/Qualificação, SAC, RH/Recrutamento, Financeiro/Cobrança, Agendamento, Vendas/E-commerce, Suporte Técnico, Educacional, Saúde/Clínicas, Imobiliário. Cada modelo com prompts, extração e mensagens prontos para uso
- [x] **Chatbot com Prompts do Banco** — Sistema de chatbot refatorado para carregar systemPrompt, extractionPrompt e greetingMessage do chatbot configurado no banco (ao invés de hardcoded). Extração automática salva dados nos campos personalizados do lead
- [x] **Templates de Mensagens** — Biblioteca de templates para WhatsApp, e-mail e SMS com variáveis dinâmicas, categorias e contagem de uso

### Fase 4 — Atendimento e Atividades
- [x] **Módulo de Atendimento** — Atribuição de leads a operadores, fluxo de atendimento com múltiplos canais
- [x] **Atividades Agendadas** — Agendamento de atividades (WhatsApp, e-mail, SMS, ligação, reunião, tarefa, nota, follow-up) com envio automático baseado em templates
- [x] **Follow-up Automático / Inatividade por Chatbot** — Sistema de reengajamento automático aplicável a qualquer chatbot (não apenas Raio-X), com configuração independente por bot
  - Monitoramento a cada 2min de leads inativos por chatbot
  - Configurações por chatbot: timeout de inatividade (min), mensagem de reengajamento, max tentativas, ação (notificar / notificar e fechar / só fechar), tempo para auto-fechamento
  - Envio de mensagem WhatsApp via instância vinculada ao chatbot (nunca fallback genérico)
  - Controle de spam: respeita intervalo entre notificações, limita tentativas
  - Auto-fechamento de leads após período configurável de inatividade total
  - Registro de eventos na timeline do lead (inactivity_notified, inactivity_closed)
  - **Frontend**: seção "Inatividade e Reengajamento" dentro do modal de edição de cada chatbot (Captação > Chatbots) com campos: ativar/desativar, ação, mensagem, timeout, max retries, tempo para fechar
- [x] **Histórico de Eventos do Lead** — Log completo do ciclo de vida do lead com rastreamento de IP e atribuição

### Fase 5 — Integrações de Tráfego Pago
- [x] **Meta Ads (Facebook/Instagram Lead Ads)** — Integração completa incluindo:
  - Webhook para recepção automática de leads do Meta
  - Fluxo OAuth via Facebook JS SDK para conexão segura de páginas
  - Sincronização automática de formulários do Meta
  - Mapeamento inteligente de campos com auto-detecção (nome, email, telefone)
  - Criação de campos personalizados direto no mapeamento (botão +)
  - Reprocessamento de leads existentes com novo mapeamento
  - Indicador visual de campos sem mapeamento por formulário
  - Deduplicação de leads por e-mail e telefone
  - Tracking completo de campanha: campaign_id, adset_id, ad_id, ad_name, platform
  - Pull em massa de leads do Meta com histórico
  - 18 endpoints de API dedicados

### Fase 5.5 — WhatsApp Oficial (Cloud API Meta)
- [x] **Integração WhatsApp Cloud API** — Integração completa com a API oficial do WhatsApp (Meta) incluindo:
  - Serviço core Cloud API: envio de texto, mídia, templates HSM, mensagens interativas e reactions
  - Embedded Signup (Facebook Login for Business) para onboarding de contas WhatsApp Business
  - Webhook para recepção de mensagens e status updates da Meta (8 tipos de mensagem suportados)
  - Criptografia AES-256-GCM para tokens de acesso em repouso
  - Validação HMAC-SHA256 de webhooks recebidos
  - Gestão de templates: sincronização, criação e exclusão via Meta Graph API
  - Abstração de provider (WhatsappProvider) alternando entre Evolution API e Cloud API
  - Suporte a múltiplas conexões WABA simultâneas
  - 10+ endpoints de API dedicados
- [x] **Perfil da empresa da Cloud API pelo painel** — Botão "Perfil da empresa" no cartão da conexão abre a edição do que o cliente vê ao abrir a conversa: foto (upload direto, a Meta só aceita handle da Resumable Upload API), recado/status, descrição, endereço, e-mail, até 2 sites e setor. Traz também os dados que a Meta só deixa ler (nome de exibição e status da revisão, qualidade, limite de disparo, selo verde) e a troca do PIN de verificação em duas etapas. Traz também os atalhos de abertura da conversa (boas-vindas, perguntas frequentes e comandos) e selos mostrando quais campos a Meta já tem preenchidos — o perfil da API não herda o do app do celular
  - [x] **Salvar o perfil parou de dar erro genérico** — dois campos derrubavam a gravação inteira e a Meta não explicava nenhum: `about` (recado) em branco devolvia 500 "(#131000) Something went wrong" e `vertical: UNDEFINED` (a opção "Não informado" do formulário) devolvia 400 "(#100)". Agora o servidor omite o que a Meta não aceita esvaziar e devolve `warnings` explicando o que não passou; a lista de setores é a que a Graph aceita de fato (sem `NOT_A_BIZ`, com ALCOHOL/ONLINE_GAMBLING/PHYSICAL_GAMBLING/OTC_DRUGS/MATRIMONY_SERVICE); o tradutor de erros da Meta ganhou contexto (perfil/automação/conta ≠ envio, que mandava "confira o número do contato"); e o modal envia só os campos alterados, para uma leitura incompleta da Meta não virar apagamento

- [x] **Ações sobre a mensagem no Conversas (paridade WhatsApp)** — Editar (dentro dos 15 min que o WhatsApp permite, guardando o texto anterior), apagar para mim e para todos, encaminhar para até 20 conversas/grupos, reagir com emoji e marcar a conversa como não lida. Edição, exclusão e reação feitas pelo CONTATO passam a ser refletidas nos dois canais. Evolution faz tudo; a API Oficial da Meta não tem editar nem apagar-para-todos (ela só publica o webhook de revoke), e nesses casos o operador recebe a explicação em vez de um botão que falha. Migrations 0128 e 0129
- [x] **Conversas no celular: ações alcançáveis e cabeçalho enxuto** — As ações da bolha dependiam de `hover`, inexistente no toque, e ficavam invisíveis porém clicáveis. Agora o botão aparece sempre onde não há mouse, pressionar e segurar abre o menu, e no celular ele vem como folha inferior com alvos de 44px. O cabeçalho foi remodelado: identidade que trunca, três ações fixas e o resto no menu "⋯" — os sete botões soltos quebravam em várias fileiras. O que cabe é decidido pela largura real do painel (ResizeObserver + container queries), não pelo tamanho da janela

- [x] **Formulários: revisão pós-rebranding** — Relato de que o botão "Adicionar campo" não funcionava. Percorri o módulo num navegador de verdade, pelo domínio do cliente, nos quatro papéis: o botão abre e as TRÊS abas inserem o campo (comuns, catálogo e "criar novo"), o formulário salva e o campo persiste — não reproduzi a falha. AGENT vê "Acesso restrito" na tela inteira, que é o comportamento configurado. A varredura, porém, achou três coisas quebradas de verdade pelo rebranding: **(1)** o rodapé do formulário público dizia "Feito com ByChat" — o nome antigo do produto, visível para todo lead que abre um formulário; agora vem de `appearance.admin_brand_name`, então cada instalação mostra a própria marca; **(2)** o `APP_URL` do beyond ainda era `bychat.ia.br`, e o `embed.js` colado nos sites dos clientes mandava os leads e o link de privacidade para o domínio antigo (funcionava porque `/api` do domínio velho não redireciona — dívida que quebraria no dia em que ele saísse do ar); **(3)** enviar formulário por um endereço com slug em vez de id devolvia **500** com "Argument `id` is missing" no log, em vez de 404. Testado o ciclo inteiro depois: criar, prévia nos dois modos, campos, envio, submissões, duplicar e excluir
- [x] **Números reservados: o superadmin decide quem vê cada linha** — A permissão sempre foi do LEAD (quem é dono dele, ou o setor dele, vê a conversa), o que basta enquanto todos os números são da empresa. Deixa de bastar quando alguém conecta a linha PESSOAL: no kobogo eram 11.195 mensagens de 210 contatos, todas visíveis para a gerência, porque os leads entraram sem dono num setor compartilhado. Agora cada número — Evolution ou Cloud API — declara se é aberto (`all`, o padrão, nada muda) ou **reservado**, e nesse caso só o superadmin, o agente dono e os observadores escolhidos enxergam. A regra é "qualquer conversa que tenha PASSADO pelo número", não "conversa que hoje pertence a ele": esconder só metade do histórico seria uma proteção que não protege. Vale na lista, nos contadores, no aviso do menu e no acesso direto por URL (403) — esconder da lista e deixar abrir pelo link seria teatro, o id é adivinhável. O painel fica na edição do número, só para SUPERADMIN, porque decidir quem acompanha uma linha inteira é do dono da instalação e não do administrador de operação. Migration 0134
- [x] **A lista de conversas passou a carregar além das 50 primeiras** — A aba dizia "186" e só 50 conversas eram alcançáveis: a tela buscava UMA página e parava, sem paginação, sem "carregar mais" e sem nem avisar que havia mais. As outras 136 simplesmente não existiam para o operador. Agora a lista continua conforme ele rola (`useTicketsInfinite`, páginas de 50, sentinela com `IntersectionObserver` antecipando 300px), com botão "Carregar mais (N restantes)" como caminho alternativo — teclado, leitor de tela e aba em segundo plano — e um "fim da lista" ao final. Detalhe que evita conversa pulada: o deslocamento da próxima página desconta as **fixadas**, que vêm inteiras na primeira página e fora da paginação; conferido com 2 fixadas em 183 conversas — 183 coletadas, 183 únicas, zero duplicadas. A recarga automática afrouxa de 15s para 60s depois da terceira página: ela refaz todas as páginas carregadas, e quem rolou fundo está garimpando histórico, não vigiando a fila. A ordenação também ganhou desempate por `id`: sem ele, conversas com a MESMA data — ou sem data, caso das resolvidas antigas — trocavam de posição entre uma página e outra, e a rolagem repetia umas e pulava outras (no terram, 22 repetidas em 638; depois do desempate, 638 únicas)
- [x] **Os números das abas passaram a dizer a verdade** — "Caixa (3)" que abria vazia: os contadores eram montados à parte, só com a PERMISSÃO do usuário, enquanto a lista respeitava o escopo selecionado e os filtros da tela. Com "Meus" marcado, a Caixa — que por definição só tem lead SEM dono — mostrava o total da instalação e abria sem nada; buscar, filtrar por funil ou por número também não mexia em badge nenhum. Agora existe uma peça só: `filtros` + `condicaoDaCaixa()` alimentam a lista E todos os contadores, variando apenas o escopo e a caixa. Cada número responde exatamente a "quantas conversas eu vejo se clicar aqui agora?" — os das caixas mantêm o escopo selecionado, os de Meus/Setor mantêm a caixa aberta. Conferido nas 15 combinações de escopo × caixa, com busca e com filtro de número: badge e lista batem em todas, e a listagem continua em 33ms
- [x] **Conversas: três temas, escolhidos pela empresa** — Quem vem do WhatsApp Web sente cada diferença de cor como atrito, e é nesta tela que o operador passa o dia. Agora ADMIN e SUPERADMIN escolhem entre **Padrão do sistema** (o de sempre), **WhatsApp escuro** (#0b141a de papel de parede, bolha enviada #005c4b, recebida #202c33, acento #00a884) e **WhatsApp claro** (#efeae2, #d9fdd3, branco) — a escolha vale para a equipe inteira, porque um time que combina "clica no verde ali em cima" precisa olhar a mesma tela. Só o módulo Conversas muda: o `data-conv-theme` redefine os tokens do design system apenas dentro do contêiner, e o resto do painel segue igual. Nenhum componente sabe que existe tema — são três classes com fallback (`conv-chat-surface`, `conv-bubble-out`, `conv-bubble-in`), então o tema padrão é literalmente o que já era. Todas as combinações de texto passam em AA: no tema claro o texto secundário foi escurecido para 6:1 (no aplicativo original fica em 4.1:1), porque aqui a tela é lida oito horas por dia. O papel de parede é uma textura própria e discreta — a arte de doodles do WhatsApp é da Meta
- [x] **Conversas: aba "Todos" e os nomes das abas escolhidos pela empresa** — A barra de cima (Meus/Setor/Todos) e a de baixo (Atendimento/Caixa/Aguardando/Resolvidos) ganharam uma quinta caixa: **Todos**, que ignora a situação da conversa e mostra as quatro juntas. Não é um filtro "quase igual": é a UNIÃO EXATA das outras abas, escrita em um lugar só (`uniaoDasCaixas`) e usada tanto pela lista quanto pelo contador — um filtro aproximado ("tem mensagem") deixava de fora conversa resolvida sem `lastMessageAt` e trazia lead de formulário que nunca falou com a gente, e aba que some com o que a vizinha mostra é pior que aba nenhuma. Escopo + caixa se combinam: "Todos" em cima e "Todos" embaixo traz tudo — sempre limitado pelo acesso, setor e números do operador, que continuam aplicados antes do recorte. E em Preferências, ADMIN e SUPERADMIN passam a **renomear as oito abas** para toda a equipe: escola fala em "Secretaria", clínica em "Recepção", e a equipe passava o dia relendo um rótulo que não era o dela. Só a palavra muda — a regra de cada aba fica idêntica. Nome vazio volta ao padrão, limite de 24 caracteres, marcação removida (inclusive a entidade que o saneador global gera), e a abreviação do celular só se aplica aos nomes de fábrica: nome escolhido pela casa aparece inteiro, cortado pelo CSS se faltar espaço
- [x] **Funil e etapas dentro do Conversas › Informações** — Mover um lead exigia sair do atendimento, abrir o Kanban, achar o card no meio de centenas e voltar: ninguém faz isso no meio de uma conversa, e por isso a etapa vivia desatualizada. Agora o painel de Informações mostra o funil do lead com a trilha inteira e um toque move. A trilha é vertical (o painel tem 320px — esteira horizontal com 7 etapas viraria rolagem lateral), cada etapa se identifica por posição, ícone e rótulo (não só pela cor), a atual fica marcada e alvos têm 44px no toque. Quem já passou por outro funil vê "já passou por X · etapa · data", e dá para trocar de funil pelo mesmo lugar — o lead entra na primeira etapa do destino. As permissões do Kanban chegam prontas do servidor (`podeAvancar`/`podeRetroceder`), então o que o perfil não pode fazer aparece bloqueado em vez de falhar no clique. Dois consertos vieram junto: mover pelo painel passou a registrar `LeadStageMovement` (o Relatório de Funil não enxergava movimentação feita fora do Kanban) e o painel de Informações, que era `hidden lg:flex`, agora abre como folha lateral no celular — o item "Informações do lead" do menu não abria nada em tela pequena
- [x] **O que o sistema manda para um GRUPO agora entra na conversa** — Aviso de novo lead, de agendamento e de chamado saíam por `sendText(<jid do grupo>)` e existiam só no WhatsApp: no painel, a conversa do grupo mostrava apenas o que os OUTROS falavam. Isso não era só buraco de histórico — quem respondesse citando um desses avisos chegava aqui sem o trecho citado, porque a mensagem citada não existia no banco (foi assim que o problema apareceu no grupo BY | Time Comercial). Agora os quatro pontos de aviso registram a mensagem na conversa do grupo (`groupOutboundLog`), sem duplicar em reentrega, sem criar não lida e sem inventar conversa para grupo que ninguém acompanha. O histórico foi recuperado do que a Evolution guardou: 1.524 mensagens nossas devolvidas às conversas de grupo e mais 375 citações religadas
- [x] **Resposta citada do cliente voltou a aparecer marcada** — Respondeu-se a uma mensagem no WhatsApp e a réplica chegava ao painel solta, sem o trecho citado: o operador não sabia a que o cliente se referia. A causa está na Evolution, que ACHATA a resposta de texto antes de mandar o webhook — `i.message.extendedTextMessage && (i.messageType='conversation', i.message.conversation = ...text, delete i.message.extendedTextMessage)` — e leva junto o `contextInfo` com o `stanzaId` da citada. Ela guarda uma cópia na RAIZ do payload (`data.contextInfo`), e era só lá que a citação sobrevivia; nós procurávamos apenas dentro de `message`, então toda resposta de TEXTO se perdia (mídia não passa pelo achatamento, e por isso só ela vinha marcada). Medido no banco da própria Evolution: 2.847 respostas citadas em 15 dias, nenhuma delas de texto chegando com a marcação. Corrigido lendo também a raiz, e o histórico recente foi reprocessado
- [x] **Filtro por número no Conversas parou de misturar conversas** — O filtro casava "tem ALGUMA mensagem enviada por este número, em qualquer época", enquanto o rótulo da lista mostra o número atual: conversa atendida ontem pelo A e hoje pelo B aparecia nos dois filtros, carimbada com o B — "filtrei uma instância e veio conversa de outra". E, como só olhava mensagem ENVIADA, escondia quase tudo de um número usado para receber: no kobogo o filtro de um dos números mostrava 8 conversas quando 139 são dele. Agora o filtro usa a mesma regra que decide por qual número respondemos (última mensagem recebida; para conversa que só nós iniciamos, a última mensagem), e o rótulo da lista passa a seguir esse mesmo critério — filtro, etiqueta e número de envio contando a mesma história
- [x] **Importar do celular: sem teto de seleção e com sincronizar dentro da conversa** — A tela obrigava a marcar conversa por conversa e o servidor recusava lotes acima de 100 (conversas) e 500 (contatos): com 1.200 contatos, a mesma seleção manual três vezes. Agora a seleção é resolvida no SERVIDOR — "Sincronizar todas" enfileira o recorte inteiro (período, situação, busca) e "Importar todos" cria os leads da agenda inteira de uma vez, em `createMany` com de-para de telefones em uma consulta (antes era um SELECT + INSERT por contato, a razão do teto). A tela foi remodelada: resumo em cartões que funcionam como filtro (a sincronizar / sem lead / já têm lead / já sincronizadas / grupos e sem telefone), filtros de período, situação, busca e ordenação, marcação que acompanha o recorte e não a rolagem, lista paginada a 200 itens, e painel da fila com progresso por conversa, cancelar um, parar tudo e limpar histórico. Cada conversa passa a mostrar **se e quando** já foi sincronizada, e o que já veio sai da lista por padrão. Dentro de cada conversa, o menu "⋯" ganhou **Sincronizar do celular**: acha o chat pelo `phoneKey` (inclusive sob `@lid`), fura a fila com prioridade e explica o desfecho — trouxe N mensagens (com as mídias pendentes à mão), já estava tudo aqui, ou não existe conversa naquele número e por quê. Migration 0131. REPLICADO nos 11 tenants (no venda360, com o botão no cabeçalho da conversa — aquela tela não tem o menu "⋯")
- [x] **Editar/apagar/reagir voltaram a funcionar nos chats sob `@lid`** — A Evolution guarda boa parte das conversas sob o identificador de privacidade (`<numero>@lid`) e compara **literalmente** o `remoteJid` do pedido com o da mensagem no banco dela. Montávamos a `key` a partir do telefone do lead (`55…@s.whatsapp.net`), então ela respondia `400 RemoteJid does not match` e o operador via só "Falha de comunicação com o WhatsApp (código 400)". Agora o provider resolve a `key` verdadeira consultando `findMessages` pelo `key.id` (61ms) antes de editar, apagar para todos, reagir ou marcar não lida, com a key deduzida como retaguarda. O tradutor de erros ganhou as três respostas dessas rotas (RemoteJid does not match / Message not found / Message not compatible), que antes viravam a frase genérica. REPLICADO nos 11 tenants
- [x] **Carregar mídia da conversa importada parou de dar erro de proxy** — Cada download é uma chamada à Evolution que decifra o arquivo, e o lote de 15 rodava **sem timeout**: passava dos 60s do `proxy_read_timeout` e o operador recebia 502/503 com o download pela metade. Agora há teto de 12s por arquivo e orçamento de 30s por lote (devolve o parcial e convida a pedir o resto), e o lote caiu para 8. Mais: mídia que o WhatsApp já expirou no CDN dele (`Failed to fetch stream`) passa a ser **marcada** (`Message.mediaUnavailableAt`, migration 0132) em vez de retentada a cada clique — antes eram 5s por arquivo, toda vez, para um contador de pendências que nunca zerava. A tela distingue os três desfechos: baixou, expirou de vez, ou o WhatsApp está lento. REPLICADO nos 11 tenants
- [x] **Conversas: busca no conteúdo, citação do cliente e conversas fixadas** — A busca da lista passa a procurar dentro do texto das mensagens, além de nome/empresa/telefone/e-mail. A resposta do CONTATO agora mostra o trecho citado (os webhooks descartavam a citação, e a mensagem chegava solta — pior em grupo), com clique que leva à mensagem original; o mesmo vale para as reações que ele manda. E dá para fixar conversas no topo, por operador, com teto de 10. Migration 0130

- [x] **Importar do celular: "importou e não apareceu" — três causas, e agora com grupos** (2026-08-18) — O cliente da kobogo dizia que a importação afirmava ter importado e nada refletia no Conversas. Eram **três falhas somadas**, todas confirmadas em dados reais. (1) **A conversa não caía em aba nenhuma**: as abas são decididas por `conversationOpenedAt` (Atendimento) e `lastMessageAt` (Caixa), e o runner não tocava em nenhum dos dois de propósito — um lead CRIADO pela importação ficava fora das quatro abas, inclusive da "Todos". Eram **632 conversas mudas na kobogo** (347 vindas da própria importação). Agora `tornarVisivelNoConversas()` sobe `lastMessageAt` até a mensagem mais nova ao fim de cada sincronização — só SOBE, então histórico antigo continua sem ressuscitar no topo da caixa — e roda mesmo quando nada novo veio, consertando sozinha quem já estava mudo. `scripts/reparar-conversas-mudas.sql` cuida do passivo. (2) **Metade da conversa ficava para trás**: `findMessages` casa `key.remoteJid` por igualdade exata e o mesmo contato mora em DOIS JIDs na Evolution — o `@lid` (histórico antigo) e o `<telefone>@s.whatsapp.net` (recente). No contato de teste eram 70 mensagens num e **82 no outro**, e só as 70 vinham. `jidsDoMesmoChat()` varre as duas pontas, com o telefone nas duas formas do BR (com e sem o 9º dígito, porque o número vem de `remoteJidAlt` no formato antigo). (3) **O dedup engolia a mensagem certa**: `externalId` não é único entre provedores, e o id que a Evolution deu à mensagem do teste era igual ao de uma confirmação de agendamento enviada dias antes pela **Cloud API** — a mensagem verdadeira era descartada como "já existia". O conjunto de dedup passou a ser escopado por `provider: 'evolution'`. Além disso, como a varredura multi-JID permite dois jobs olharem para o mesmo lead, há reconferência no banco imediatamente antes de cada `createMany` (validada com dois jobs concorrentes: 0 duplicadas, 0 perdidas). **Grupos passaram a ser importáveis**: deixaram de ser descartados na listagem (cruzados com o painel por `groupJid`), a fila aceita chat sem telefone (guarda os dígitos do JID) e o runner resolve o lead por `resolveGroupLead()`, gravando `senderName`/`senderJid` de quem falou — teste real trouxe 1.048 mensagens de um grupo. O menu "⋯" da conversa ganhou **Sincronizar grupo** (antes o item sumia em grupo), com `encontrarGrupoNoAparelho()` no lugar da busca por `phoneKey`. Sem migration. REPLICADO na kobogo

### Fase 5.6 — Campos Personalizados e Origem de Leads
- [x] **Campos Personalizados** — Sistema completo de custom fields com 11 tipos, 4 grupos, código de integração (API Key), integrado com Meta Ads, formulários e API
- [x] **Indicador de Origem do Lead** — Ícones SVG por canal (WhatsApp, Meta, Chat, Formulário, Manual, API) em todas as telas: Leads, Kanban, Atendimento, Info Panel
- [x] **Colunas Configuráveis** — Tabela de leads com 15 colunas, toggle on/off, drag-and-drop para reordenar, persistência no localStorage
- [x] **Exibição inteligente de campos** — Campos personalizados mostrados apenas quando preenchidos no card do lead

### Configurações e Infraestrutura
- [x] **Configurações Dinâmicas** — Tabela de settings com chave/valor agrupados por categoria
- [x] **Instâncias WhatsApp** — Gerenciamento de múltiplas instâncias da Evolution API
- [x] **Perfil do WhatsApp pelo Painel** — Edição de nome, recado/status e foto de perfil do WhatsApp conectado diretamente pelo painel (mesmo via QR code). Modal com preview do perfil atual e campos de edição
- [x] **Conexão WhatsApp em Tempo Real** — Polling automático a cada 3s após gerar QR code: detecta conexão e atualiza a tela automaticamente (sem refresh manual). Desconexão e reinício também atualizam a tela sozinhos
- [x] **Evolution API Monitor** — Microserviço que monitora saúde da Evolution API a cada 2min: verifica API online/offline, latência, versão, status de cada instância, webhook configurado corretamente, chatbot vinculado. Dashboard em Configurações > Geral > Evolution API com cards de status, tabela de instâncias, lista de problemas e botões de correção automática (fix webhook, reconectar, recriar instância)
- [x] **Vínculo Instância→Chatbot para Envio** — Mensagens de inatividade e workflow SOMENTE são enviadas pela instância vinculada ao chatbot do lead (nunca mais instances[0] como fallback genérico)
- [x] **Nome do Atendente Atualizado** — Mensagens do chat buscam nome do operador direto do banco (Meu Perfil > Nome) ao invés do JWT que pode estar desatualizado
- [x] **Proteção contra Leads de Teste** — Painel de teste do chatbot usa sessões em memória (não cria lead no banco). Widget embed de produção continua criando leads normalmente
- [x] **Tracking UTM** — Campos UTM (source, medium, campaign, content, term) nos leads para rastreamento de origem
- [x] **Persistência de Navegação** — Ao dar refresh, sistema volta para a mesma tela que o usuário estava

### Fase 6 — Segurança e Proteção

#### Backend
- [x] **Rate Limiting Inteligente** — 200 req/min para público, requests autenticadas isentas de rate limit (evita auto-bloqueio do admin)
- [x] **Proteção contra Ataques** — Detecção e bloqueio de SQL injection, XSS, path traversal, user-agents de scanners
- [x] **Bloqueio Automático de IP** — Brute force (5 falhas em 10min = bloqueio 30min), rate limit excedido (5x em 5min = bloqueio 15min)
- [x] **Bloqueio/Desbloqueio de Usuários** — Bloqueio automático após 10 tentativas falhadas, bloqueio/desbloqueio manual pelo admin, reset de tentativas, tabela de usuários no painel de segurança
- [x] **Desbloqueio de Emergência** — Endpoint `/api/emergency-unblock` com chave secreta para admin se desbloquear quando não há outro admin
- [x] **Renovação de Sessão** — Detecção automática de token JWT expirado, modal de re-login in-place (sem perder o trabalho), timer proativo 2min antes da expiração, fetch interceptor global
- [x] **Registro de Eventos** — Log completo: login (sucesso/falha), brute force, rate limit, ataques, bloqueios de IP e usuário

#### Painel de Segurança (Frontend) — Seção "Segurança" no sidebar com ícone de escudo
- [x] **Dashboard de KPIs** — 4 cards com indicadores em tempo real: Total de Eventos (24h), Eventos Críticos (24h), Logins Falhados (24h), IPs Bloqueados Ativos
- [x] **Top IPs Suspeitos** — Grid 2 colunas com ranking de IPs por quantidade de eventos, botão "Bloquear" rápido por IP
- [x] **Bloqueio Manual de IP** — Formulário com campo de IP, motivo (Manual/Suspeito/Brute Force/Rate Limit), duração (30min a permanente), detalhes opcionais
- [x] **Tabela de IPs Bloqueados** — Listagem com IP, motivo, tipo (Auto/Manual com badge), expiração, criado por, data; botão "Desbloquear" por registro
- [x] **Log de Eventos de Segurança** — Tabela com data, severidade (Low/Medium/High/Critical com cores), tipo (11 categorias: Login Falhado, Login OK, Força Bruta, Rate Limit, UA Suspeito, Path Traversal, SQL Injection, XSS, Req. Bloqueada, Bloqueio Manual, Desbloqueio), IP em monospace, email, detalhes com tooltip
  - Filtros por tipo de evento e nível de severidade
  - Paginação com "Carregar mais" (>50 eventos)
  - Botão de refresh manual
- [x] **Gestão de Usuários do Sistema** — Tabela com usuário, perfil, tentativas de login (destaque vermelho se ≥5), último login, status (Ativo/Bloqueado/Inativo com badges coloridos), ações (Bloquear/Desbloquear/Resetar tentativas)
- [x] **Auto-refresh** — Atualização automática a cada 30 segundos enquanto na página

#### Modal de Renovação de Sessão (Frontend)
- [x] **Detecção Proativa de Expiração** — Token watcher verifica JWT a cada 30 segundos, dispara modal 2min antes da expiração
- [x] **Modal de Re-login In-Place** — Overlay full-screen não-dispensável (backdrop blur, z-index 99999), formulário com email pré-preenchido e senha, botões "Entrar" e "Sair da conta"
- [x] **Interceptor de Fetch Global** — Respostas 401 disparam modal automaticamente, sessão renovada sem perda de trabalho

#### Autenticação e Perfil (Frontend)
- [x] **Página de Login** — Formulário de email/senha com link "Esqueceu a senha?" e mensagens de erro
- [x] **Recuperação de Senha** — Formulário de email para envio de link de redefinição, mensagem de sucesso verde
- [x] **Redefinição de Senha** — Campos de nova senha e confirmação (mín. 6 caracteres), redirect automático para login após sucesso
- [x] **Modal Meu Perfil** — Edição de nome, email e senha; exige senha atual para alterações sensíveis; campos limpos após salvar
- [x] **Histórico de Auditoria por Usuário** — Modal timeline com ações (Criado/Editado/Excluído), campo alterado com valor anterior (vermelho) → novo valor (verde), ator e timestamp

### Fase 6.1 — Auditoria de Segurança / Pentest Interno (2026-04-10)

> Auditoria completa do sistema em busca de falhas e vulnerabilidades. Análise de código-fonte, configurações, middlewares e exposição de superfície de ataque.

#### Vulnerabilidades Críticas (Prioridade Imediata)
- [x] **Senha Admin Padrão** — ~~`ADMIN_PASSWORD` como `beyond2025`~~ → Alterado para senha forte de 25 caracteres com especiais
- [x] **JWT_SECRET fraco ou padrão** — ~~Secret curto de 32 bytes~~ → Gerado com `openssl rand -base64 64` (88 caracteres)
- [x] **CORS permissivo (`*`)** — Já estava configurado como `https://bychat.ia.br` (verificado na auditoria)

#### Vulnerabilidades de Arquitetura
- [x] **Contadores em memória (Rate Limit / Login Failures)** — ~~Maps in-memory~~ → Migrado para Redis com TTL automático; persiste entre restarts e escala multi-instância
- [x] **Bypass de Rate Limit por autenticação** — ~~Requests autenticadas isentas~~ → Rate limit separado de 1000 req/min para autenticados via Redis
- [x] **Sanitização centralizada de inputs** — ~~Sem sanitização~~ → Hook global `preHandler` sanitiza body de POST/PUT (escape HTML, remoção de `javascript:` e event handlers); rotas com HTML legítimo (settings, chatbots, pages, templates) isentas

#### Vulnerabilidades de Infraestrutura
- [x] **HTTPS obrigatório** — Já estava configurado no Nginx (redirect 301 HTTP → HTTPS, verificado na auditoria)
- [x] **Firewall (ufw)** — Ativo com portas 22, 80, 443 abertas; portas extras (20/21 FTP, 888, 20621) identificadas — script de hardening criado
- [x] **MySQL: permissões** — Verificado: `bychat_user` tem apenas SELECT/INSERT/UPDATE/DELETE/CREATE/INDEX/ALTER nos bancos `beyondhub_raiox` e `bychat_db`, sem GRANT/DROP/SUPER; host `%` deve ser restrito a `127.0.0.1` (script `hardening-mysql.sh` criado)
- [x] **Backups automáticos** — Cron job configurado: `0 3 * * *` executa `mysqldump` com compressão gzip, retenção de 30 dias, backup testado (216K)

#### Headers de Segurança
- [x] **Content-Security-Policy (CSP)** — Adicionado no Nginx com whitelist para APIs externas (Anthropic, OpenAI, Meta, Google, Evolution)
- [x] **X-Content-Type-Options** — Já estava como `nosniff` (verificado na auditoria)
- [x] **X-Frame-Options** — Já estava como `DENY` (verificado na auditoria)
- [x] **Strict-Transport-Security (HSTS)** — Adicionado: `max-age=31536000; includeSubDomains`
- [x] **Referrer-Policy** — Já estava como `strict-origin-when-cross-origin` (verificado na auditoria)
- [x] **Permissions-Policy** — Adicionado: `camera=(), microphone=(), geolocation=()`

#### Proteções
- [x] **Proteção CSRF** — Validação de header `Origin`/`Referer` em POST/PUT/DELETE; bypass para webhooks externos, API pública e emergency unblock
- [x] **Sanitização de input centralizada** — Hook global no Fastify com escape de HTML e remoção de padrões perigosos
- [x] **WAF + DDoS** — Pendente configuração do Cloudflare pelo admin (ver Fase 14)

#### Observações de Código
- [x] **IP detection via X-Forwarded-For** — Já estava configurado corretamente no Nginx (`proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for` + `trustProxy: true` no Fastify)
- [x] **API Keys: token generation** — Verificado: usa `crypto.randomBytes` com entropia adequada, hash SHA-256
- [x] **JWT com revogação** — ~~Sem blacklist~~ → Implementado: tokens com `jti` (UUID), blacklist em Redis com TTL automático, endpoint `POST /api/admin/logout` para revogar, verificação no middleware de auth

#### Checklist de Hardening para Produção
- [x] Alterar `ADMIN_PASSWORD` para senha forte
- [x] Gerar `JWT_SECRET` com `openssl rand -base64 64`
- [x] `CORS_ORIGIN` definido para `https://bychat.ia.br`
- [x] Firewall ufw ativo — portas 20/21 (FTP), 888, 39000-40000 fechadas; apenas 22, 80, 443, 20621 (painel VPS) abertas
- [x] MySQL hardening — `bychat_user` restrito de `%` para `172.%` (subnet Docker); sem GRANT/DROP/SUPER
- [x] PM2 auto-start habilitado (`pm2-root` enabled no systemd)
- [x] Backup automático cron configurado (diário às 3h, 30 dias retenção)
- [x] Headers de segurança no Nginx (CSP, HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy)
- [x] HTTPS obrigatório com redirect 301
- [x] `X-Forwarded-For` configurado corretamente no Nginx
- [x] MySQL: `bychat_user` restrito de `@'%'` para `@'172.%'` (Docker bridge subnet)
- [x] Firewall: portas 20, 21, 888, 39000-40000 fechadas

### Fase 6.5 — White-Label e Branding Dinâmico
- [x] **Branding Dinâmico no Backend** — Helper `getBranding()` com cache, usado em todos os emails, prompts de IA, chatbot e templates do sistema
- [x] **Emails Dinâmicos** — Todos os emails (notificação, relatório, reset de senha, atividades) usam nome da marca configurável via settings
- [x] **Prompts de IA Dinâmicos** — Chatbot web, chatbot WhatsApp e análise estratégica usam brand name das settings
- [x] **Domínio Customizável** — Campos de domínio, URL e WhatsApp de suporte no painel de Aparência
- [x] **Rate Limit Otimizado** — Endpoints públicos de alta frequência (tracking, appearance, webhooks, links rastreáveis) isentos de rate limit para evitar bloqueio do próprio cliente
- [x] **Menu Lateral com Destaque** — Seção ativa com fundo azul escuro, item ativo com azul claro para navegação visual clara

### Fase 6.6 — UX/UI e Experiência do Operador (IMPLEMENTADO)
- [x] **Reorganização Completa do Menu Lateral** — Sidebar reestruturada com agrupamentos semânticos profissionais: Dashboard, Conversas, CRM, Captação, Marketing, Vendas & ROI, Conexões, Configurações
- [x] **Sidebar Accordion** — Apenas um grupo de menus aberto por vez; clicar no Dashboard fecha todos os grupos; estado persistido no localStorage
- [x] **Icones do Menu** — Ícones SVG distintos e semânticos por seção; Dashboard com ícone de casa (home)
- [x] **Cards de Funis em Grid** — Funis exibidos em grid responsivo (minmax 320px) igual à tela de Templates, substituindo listagem vertical
- [x] **Filtros de Leads Aprimorados** — Botão "Aplicar filtros" (draft pattern): filtros não são aplicados ao mudar campo, apenas ao clicar em aplicar; botão "Limpar" dedicado
- [x] **Filtro "Data de entrada na etapa"** — Filtra leads pela data em que entraram em uma etapa específica (consulta na tabela LeadEvent por `status_changed`)
- [x] **Score removido dos filtros e colunas padrão** — Score ocultado por padrão na tabela de leads (disponível nas colunas configuráveis); removido do painel de filtros
- [x] **Anotação no Card do Lead** — Campo de anotação interna visível no card do Kanban e no modal do lead; salvo no banco de dados; registra evento `annotation_saved` na timeline
- [x] **SUPERADMIN irrestrito** — Perfil SUPERADMIN tem acesso completo a todas as funcionalidades sem precisar de configuração de permissões; bypass total nas verificações de permissão do Kanban
- [x] **Correção de cor no Log de Segurança** — IPs no log de eventos de segurança exibidos com cor visível

### Fase 6.7 — Correções de UI/UX Modais Google e Admin (2026-04-11)

- [x] **Fix Checkboxes de Eventos Google Sheets** — Modais de criação/edição usavam `whEventCheckboxes()` (que itera `_whEventLabels` de webhooks, vazio no contexto) em vez de `_gsEventLabels`. Criada função `gsEventCheckboxes()` dedicada que usa os labels corretos do Google Sheets
- [x] **Fix Cor de Textos nos Modais Google** — Labels de checkboxes (Data/Hora, tipos de atividade, Google Meet, notificação WhatsApp) herdavam `color:#fff` do tema dark da landing page. Adicionado `color:#202124` explícito em todos os labels dos modais: Sheets (criar/editar), Calendar (criar/editar), Tasks
- [x] **Fix Cor dos Badges de Email Google** — Badges de conta conectada (Google Sheets e Calendar) sem `color` definido. Adicionado `color:#202124` nos badges de email das contas conectadas
- [x] **Fix Cor Global dos Modais** — Adicionado `color:#202124` no CSS da classe `.modal-box` para que todos os modais do sistema herdem texto escuro sobre fundo branco
- [x] **Fix Tela Preta ao Atualizar /admin** — Função `goTo()` removia sempre a classe `route-admin` do `<html>`, mesmo ao navegar para o admin. Isso fazia o CSS global da landing page (`background:#0a0a0a; color:#fff`) vazar para o admin. Corrigido: `goTo()` agora adiciona `route-admin` quando o destino é admin/login/forgot/reset, e só remove ao sair
- [x] **Fix CSS Admin sobre Landing** — Adicionada regra `html.route-admin, html.route-admin body { background:#f8f9fa; color:#202124 }` para forçar fundo claro e texto escuro no admin
- [x] **Fix Título da Aba no Admin** — `loadPublicAppearance()` da LP não roda mais no `/admin` (evita sobrescrever título). Aparência do admin cacheada no localStorage (`bh_appearance_cache`). Script inline no `<head>` aplica título do cache instantaneamente ao carregar `/admin` (sem flash do título da LP). Fallback "Painel Administrativo" quando cache vazio
- [x] **Cache de Aparência Instantâneo** — `renderAdminPanel()` chama `applyCachedAppearance()` antes de qualquer `await`, aplicando brand/cores/título da sidebar imediatamente do cache. API atualiza o cache em background para próximas visitas

### Fase 6.8 — Auditoria de Segurança / Pentest #2 (2026-04-11)

> Segundo pentest completo ponta-a-ponta cobrindo auth, injeção, integrações, infra e frontend.

#### Vulnerabilidades Críticas Corrigidas
- [x] **Credencial PostgreSQL Hardcoded** — Senha do banco Evolution API estava hardcoded em `whatsapp.ts`. Movida para variável de ambiente `EVOLUTION_PG_URL`
- [x] **Endpoint de Leads Sem Proteção** — `PUT /api/bychat/leads/:id/progress` não tinha autenticação nem validação. Adicionada verificação de existência do lead, bloqueio de reescrita após conclusão (`completed`), e validação de ID
- [x] **Fail-Open no Token Blacklist** — Se Redis caísse, tokens revogados eram aceitos. Alterado para **fail-closed**: rejeita com 503 se não puder verificar blacklist
- [x] **Fail-Open no Rate Limiting** — Se Redis caísse, rate limit era desabilitado. Alterado para **fail-closed**: bloqueia requisição por segurança
- [x] **Fail-Open nas Permissões** — Se DB/Redis falhasse, acesso era permitido a todos. Alterado para **fail-closed**: nega com 503. Rotas não mapeadas agora são negadas por padrão em modo enforced
- [x] **SSRF em Webhooks** — URLs de webhook não eram validadas contra rede interna. Adicionada função `isInternalUrl()` que bloqueia localhost, IPs privados (10.x, 172.16-31.x, 192.168.x), link-local (169.254.x), e protocolos não-HTTP
- [x] **Validação de Assinatura Cloud API** — Webhook da Cloud API aceitava payloads sem assinatura HMAC se o header estivesse ausente. Agora validação é obrigatória quando app secret está configurado
- [x] **Password Reset Token em Plaintext** — Tokens de reset armazenados sem hash no banco. Agora usa SHA-256 hash antes de armazenar; compara hash na verificação
- [x] **Google OAuth Tokens em Plaintext** — Access tokens e refresh tokens do Google armazenados sem criptografia no banco. Agora usa AES-256-GCM (mesmo esquema do Cloud API). `safeDecrypt()` mantém retrocompatibilidade com tokens legados
- [x] **Race Condition no Refresh Google** — Mutex global `refreshPromise` compartilhado entre conexões diferentes. Substituído por `Map<connectionId, Promise>` com mutex per-connection

#### Vulnerabilidades Altas Corrigidas
- [x] **Política de Senha Fraca** — Mínimo era 6 caracteres sem complexidade. Alterado para 10 caracteres + maiúscula + minúscula + número. Validação `validatePassword()` aplicada em todos os 4 pontos (criação, edição, reset, perfil)
- [x] **XSS via innerHTML no Frontend** — Função `escapeHtml()` global criada em `app.js`. Aplicada em: tabela de leads (nome, empresa, whatsapp, email, segmento, cidade, UID, funil), `tagPillHTML` (nome e cor), dropdown de tags no atendimento, avatars com `profilePicUrl`, busca de leads nas atividades, mensagens de erro de API nos modais Google e Webhooks
- [x] **Validação de Upload Insuficiente** — Upload aceitava apenas por extensão. Adicionada validação de MIME type, detecção de extensão dupla suspeita (ex: `shell.php.jpg`), limite de 25MB por arquivo

---

## Planejado — Roadmap de Evolução

> Funcionalidades inspiradas na análise do concorrente Tintim.app + evolução natural da plataforma.
> O objetivo é unificar atendimento + CRM + rastreamento de vendas + feedback para ads em uma única plataforma.

---

### Fase 7 — Rastreamento Inteligente de Conversas (IMPLEMENTADO)

> Fechar o gap com o Tintim: saber de onde vem cada conversa e rastrear até a venda.

- [x] **Links Rastreáveis para WhatsApp** — Links curtos personalizados (ex: `bychat.ia.br/r/campanha-verao`) com UTMs embutidos que redirecionam para WhatsApp
  - Geração de links com slug customizável ou auto-gerado
  - Dashboard de cliques por link (contador, origem, dispositivo)
  - Suporte a UTMs completos (source, medium, campaign, content, term) em painel colapsável
  - Redirect 302 com captura assíncrona de clique (IP, device, browser, OS)
  - Contadores de cliques totais, únicos e leads gerados
  - CRUD completo com edição via modal, copy-to-clipboard da URL
  - Tracking invisível via `#ref:slug` na mensagem pré-preenchida
  - 9 endpoints de API dedicados

- [x] **Rastreamento Automático de Origem no WhatsApp** — Identificação automática da origem de cada conversa
  - Captura de referral data em campanhas Click-to-WhatsApp do Meta Ads (ctwa_clid) — Cloud API e Evolution API
  - Captura de GCLID para conversas vindas do Google Ads
  - Associação automática: link rastreável → lead → campanha via `#ref:slug`
  - Classificação automática de origem: Meta CTWA, Google Ads, Link Rastreável, Meta Lead Ads, Orgânico, Formulário Web, Manual
  - Strip automático de tracking references antes de enviar ao chatbot
  - Dashboard visual de origens com gráfico donut, taxa de rastreamento e filtro por período
  - Modelo `LeadOrigin` com dados completos (referral, UTMs, raw payload)
  - Campos denormalizados no Lead (originType, ctwaClid, gclid, trackableLinkId)

- [x] **Detecção Automática de Vendas por IA** — IA lê as conversas do WhatsApp e detecta automaticamente quando houve uma venda
  - Prompt avançado com critérios de venda, falsos positivos, regras de valor e confiança
  - Prompt 100% configurável via painel admin (adaptar por nicho do cliente)
  - Análise via Claude Haiku com fallback GPT-4o-mini
  - Captura automática do valor, produto/serviço vendido e trecho relevante
  - Classificação de confiança (Alta/Média/Baixa)
  - Scheduler automático a cada 10min (intervalo configurável)
  - Movimentação automática do lead no funil ao detectar venda (etapa e funil configuráveis com suporte a múltiplos funis)
  - Fila de revisão: confirmar (com edição de valor) ou rejeitar falso positivo
  - Dashboard de vendas: total, valor, ticket médio, por período, por origem, por campanha
  - Análise manual sob demanda por lead
  - 8 endpoints de API dedicados

- [x] **Painel de Links Rastreáveis (Frontend)** — Seção "Links Rastreável" em Marketing
  - Tabela de links com slug, URL destino, cliques totais/únicos, leads gerados, status
  - KPI cards: Total Links, Total Cliques, Cliques Recentes, Links Ativos
  - Modal de criação/edição com slug customizável, UTMs, número WhatsApp
  - Botão copy-to-clipboard da URL completa
  - Badges de status (ativo/inativo)

- [x] **Painel de Origens (Frontend)** — Seção "Origem" em Marketing
  - KPI cards: Total de Leads, Leads Rastreados, Taxa de Rastreamento (%)
  - Gráfico donut de distribuição por tipo de origem (Meta CTWA, Google Ads, Link Rastreável, Orgânico, etc.)
  - Filtro por período (7d, 15d, 30d, 60d, 90d)
  - Tabela de breakdown com 8 tipos de origem e contagem

- [x] **Painel de Vendas e Detecção IA (Frontend)** — Seção "Vendas" em Marketing
  - 3 abas: Dashboard, Fila de Revisão, Configurações
  - Dashboard: KPI cards (Total Vendas, Valor Total, Ticket Médio, Vendas Confirmadas), gráficos por dia/origem/campanha, tabela de vendas com filtros e paginação
  - Fila de Revisão: lista de vendas detectadas pela IA para confirmar (com edição de valor) ou rejeitar
  - Configurações: editor do prompt de detecção de vendas, intervalo do scheduler, funil e etapa de destino

---

### Fase 8 — Feedback para Plataformas de Ads e ROI (IMPLEMENTADO)

> O killer feature: devolver dados de vendas reais para Meta e Google otimizarem os anúncios + dashboard de ROI completo.

- [x] **Conversions API do Meta (CAPI)** — Envio de eventos de conversão server-side para o Meta Ads automaticamente
  - Configuração de Pixel ID, Access Token e Test Event Code via painel admin
  - Mapeamento de etapas do funil para eventos Meta (Lead, Purchase, CompleteRegistration, Subscribe, etc.)
  - Envio server-side via Graph API v19.0 (não depende de cookies/AdBlockers)
  - Hashing automático SHA256 de dados do usuário (email, telefone, nome) conforme requisitos da Meta
  - Deduplicação de eventos via event_id único
  - Disparo automático ao mover lead de etapa no funil (`onLeadStageChanged`)
  - Retry automático de eventos falhados (até 3 tentativas)
  - Modelo `ConversionEvent` com status tracking (pending/sent/failed)
  - Endpoint de teste para validação da integração
  - Envio manual de eventos sob demanda
  - Dashboard de eventos: total, enviados, falhados, pendentes, por tipo e por data

- [x] **Conversões Offline do Google Ads** — Enviar dados de conversão de volta para o Google Ads
  - Captura e armazenamento automático de GCLID (Google Click ID) por lead via detecção na mensagem
  - Listagem de todos os leads com GCLID capturado
  - Exportação CSV no formato compatível com Google Ads (importação de conversões offline)
  - Registro individual de conversões com valor e data
  - Relatório de GCLIDs capturados vs conversões enviadas

- [x] **Atribuição Multi-Touch (Attribution)** — Rastreamento de múltiplos pontos de contato do cliente
  - Registro automático de touchpoints (canal, source, medium, campaign, click IDs)
  - Suporte a click IDs cross-platform: GCLID (Google), FBCLID (Facebook), CTWA CLID (Meta)
  - Captura de landing URL e referrer
  - Ordem de toque automática (first, middle, last, only)
  - 3 modelos de atribuição: First-Touch, Last-Touch e Linear
  - Pesos de atribuição calculados automaticamente (decimais 0-1)
  - Relatório de atribuição por canal com leads, vendas e receita atribuída
  - Jornada completa cronológica por lead individual
  - Modelo `LeadTouchpoint` com tracking completo

- [x] **Dashboard de ROI Completo** — Painel que fecha o loop: investimento → leads → vendas → ROI real
  - Dashboard unificado: leads por campanha, adset e anúncio com métricas de custo
  - Visão Full ROI: Ads → Leads → Vendas com receita por origem e por campanha
  - Métricas calculadas: ROAS, CPL, CPV (Custo por Venda), Taxa de Conversão, CTR
  - Breakdown diário de performance
  - Funil de status com taxa de conversão
  - Gestão de custos: CRUD manual + importação em massa por período
  - Sincronização automática de gastos via Meta Marketing API (spend, impressions, clicks, reach, actions)
  - Auto-descoberta de ad accounts via business da página
  - Listagem de campanhas com leads e gastos associados
  - Filtros por período e campanha

- [x] **Relatórios PDF White-Label** — Exportação de relatórios profissionais para enviar ao cliente
  - Relatório de ROI em PDF: sumário executivo, investimento, métricas (CPL, CPV, ROAS), breakdown por origem
  - Relatório de Leads em PDF: tabela detalhada com nome, empresa, WhatsApp, origem, status, vendas, valor, data
  - Formato A4 landscape para legibilidade
  - Paginação automática para 100+ leads
  - Branding dinâmico white-label (header e footer com marca do cliente)
  - Período customizável (padrão 30 dias)
  - Design profissional com KPI cards e cores da marca
  - Gerado via PDFKit

- [x] **Painel de ROI (Frontend)** — Seção "ROI" em Vendas & ROI
  - Dashboard unificado com métricas: ROAS, CPL, CPV, Taxa de Conversão, CTR
  - Breakdown por campanha, adset e anúncio
  - Filtros por período com presets (7d, 15d, 30d, 60d, 90d) e seletor de campanha
  - Gráficos de performance diária
  - Funil visual: Ads → Leads → Vendas com receita por origem

- [x] **Painel de Conversões Meta CAPI (Frontend)** — Seção dentro de ROI/Configurações
  - Configuração de Pixel ID, Access Token e Test Event Code
  - Mapeamento visual de etapas do funil → eventos Meta
  - Dashboard de eventos: total, enviados, falhados, pendentes, por tipo e data
  - Botão de teste de integração

- [x] **Painel de Conversões Google Ads (Frontend)** — Seção dentro de ROI/Configurações
  - Listagem de leads com GCLID capturado
  - Exportação CSV no formato Google Ads
  - Registro individual de conversões com valor

- [x] **Pixel Server-Side Aprimorado** — Evoluir o Beyond Tracking para envio server-side
  - Proxy de eventos via servidor (bypass de AdBlockers)
  - Envio de first-party data para Meta CAPI e Google
  - Enriquecimento de dados: associar visitante anônimo → lead → venda
  - Deduplicação browser + server events

---

### Fase 8.5 — Workflow Engine + Filas de Mensagem (IMPLEMENTADO)

> Arquitetura de 4 camadas: Domain Events → Automation Engine → Execution Queues → Monitoring

- [x] **Event Bus (Domain Events)** — Sistema de eventos de domínio baseado em EventEmitter
  - 15+ eventos mapeados: lead.created, lead.stage_changed, message.received, sale.detected, etc.
  - Emissão non-blocking via `setImmediate()` integrada ao `logEvent()` existente
  - Wildcard listener para o workflow engine

- [x] **Workflow Engine** — Motor de automações baseado em eventos do CRM
  - Workflows configuráveis com trigger event, filtros e condições
  - 6 tipos de step: Gatilho, Esperar, Condição, Ação, Ramificação e Meta
  - 7 tipos de ação: Enviar WhatsApp, Email, Mudar Etapa, Adicionar/Remover Tag, Criar Tarefa, Webhook
  - Política de re-entrada: nunca, após conclusão ou sempre
  - Pause on reply: pausa automação quando lead responde
  - Goal event: encerra workflow quando meta é atingida
  - Escopo por funil e/ou chatbot
  - Variáveis dinâmicas: {{nome}}, {{empresa}}, {{whatsapp}}, {{email}}
  - Avaliador de condições: campos do lead, tags, time_since, operadores (equals, gt, lt, contains, in)
  - Duplicação de workflows com mapeamento de referências entre steps

- [x] **Filas BullMQ (Execution Layer)** — 5 filas dedicadas com workers
  - `wf-whatsapp`: concurrency 2, rate limit 20/min, 3 retries exponencial
  - `wf-email`: concurrency 5, rate limit 60/min, 3 retries
  - `wf-webhook`: concurrency 3, 5 retries, backoff 30s
  - `wf-internal-task`: concurrency 5, 2 retries
  - `wf-workflow-step`: concurrency 3, delayed jobs para steps de espera
  - Tracking completo: job ID, step execution status, resultado

- [x] **Painel de Monitoramento (Frontend)** — Seção "Automação" no sidebar
  - Dashboard de filas: cards com contadores (aguardando, ativo, atrasado, concluído, falhou)
  - Visualização de jobs por status com dados e erros
  - Retry all failed por fila
  - Auto-refresh a cada 30 segundos
  - Lista de workflows com toggle ativo/inativo
  - Editor de workflow: configuração de trigger, filtros, re-entrada, pause on reply, goal
  - Workflow builder: editor de steps com cards coloridos por tipo, editor de config por modal
  - 20+ endpoints de API dedicados

### Fase 8.6 — API Pública v1 (IMPLEMENTADO)

> API REST aberta para integrações externas — base para Zapier, Make, n8n e integrações customizadas.

- [x] **API Keys com Permissões Granulares** — Gerenciamento completo de chaves de acesso
  - 13 permissões disponíveis: leads, tags, funnels, stages, activities, contacts (read/write) + webhooks:manage
  - Chaves com hash SHA-256 (nunca armazenadas em texto claro)
  - Rate limit configurável por key (padrão: 60 req/min)
  - Data de expiração opcional
  - Logs de auditoria completos (método, rota, status HTTP, duração, IP)
  - Prefixo `byc_` para identificação rápida

- [x] **Endpoints da API Pública `/api/v1/`** — 16 endpoints RESTful
  - Leads: CRUD completo (listar, detalhe, criar, atualizar, deletar)
  - Leads: Timeline de eventos e histórico
  - Tags: listar, criar, vincular/desvincular de leads
  - Funis: listar com etapas, detalhe
  - Etapas: listar com filtro por funil
  - Atividades: listar, criar, atualizar
  - Filtros avançados: status, funnelId, source, search, createdAfter/Before
  - Paginação padronizada: limit, offset, total

- [x] **Rate Limiting por API Key** — Controle de uso independente por chave
  - Headers `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`
  - Resposta 429 com `retryAfter` quando excedido
  - Contadores in-memory com limpeza automática

- [x] **Painel de Gerenciamento (Frontend)** — Seção "API Keys" em Configurações
  - Listagem com status (ativa/inativa/expirada), uso total, último uso
  - Criação com grid de permissões (atalhos: Todas, Nenhuma, Somente leitura)
  - Exibição única da chave completa na criação com botão copiar
  - Edição de nome, rate limit, status, expiração e permissões
  - Visualização de logs de uso em modal
  - Revogação com confirmação

### Fase 8.7 — Webhooks de Saída (Outbound Webhooks) (IMPLEMENTADO)

> Disparar webhooks para sistemas externos automaticamente quando eventos acontecem no CRM.

- [x] **Outbound Webhook Dispatcher** — Sistema completo de disparo de webhooks baseado em domain events
  - 15 eventos suportados: lead.created, lead.stage_changed, lead.tag_added, lead.tag_removed, lead.assigned, lead.closed, lead.reopened, lead.funnel_changed, message.received, message.sent, sale.detected, activity.completed, diagnosis.completed, inactivity.detected, inactivity.closed
  - Wildcard (`*`) para receber todos os eventos
  - Assinatura HMAC-SHA256 em cada payload (header `X-Webhook-Signature`)
  - Retry automático com backoff exponencial (até 5 tentativas, max 60s entre retries)
  - Cache in-memory de webhooks ativos com TTL de 60s
  - Payload enriquecido com dados completos do lead + dados do evento
  - Headers customizáveis por webhook (auth tokens, API keys)
  - Fire-and-forget non-blocking (não impacta performance do sistema)
  - Timeout configurável por webhook (padrão 30s)

- [x] **CRUD Administrativo de Webhooks** — Gerenciamento completo via painel admin
  - Criar webhook: nome, URL, eventos, headers customizáveis, secret auto-gerado
  - Editar webhook: nome, URL, eventos, status ativo/inativo, retries, timeout, headers
  - Excluir webhook com confirmação
  - Toggle ativo/inativo
  - Regenerar secret (com aviso de segurança)
  - Endpoint de teste (envia evento `test.ping` com payload de exemplo)
  - 8 endpoints de API dedicados (`/api/admin/webhooks/*`)

- [x] **Logs de Entrega (Webhook Logs)** — Auditoria completa de cada disparo
  - Registro de cada tentativa: evento, URL, status HTTP, duração, request body, response
  - Indicador de sucesso/falha por tentativa
  - Contadores acumulados por webhook: totalSent, totalFailed
  - Data do último envio bem-sucedido e último erro
  - Paginação de logs com limite configurável

- [x] **Painel de Gerenciamento (Frontend)** — Seção "Webhooks" em Configurações
  - Listagem de webhooks com status, eventos, contadores de envio/falha
  - Modal de criação com seletor visual de eventos (labels em português)
  - Modal de edição com todas as configurações
  - Visualização de logs de entrega por webhook
  - Botão de teste com feedback visual de sucesso/erro
  - Exibição do secret apenas na criação (segurança)
  - Compatível com: Make, n8n, Zapier, Google Sheets, Kommo, Pipedrive, qualquer endpoint HTTP

- [x] **Models Prisma** — `OutboundWebhook` e `WebhookLog`
  - OutboundWebhook: id, name, url, secret, events (JSON), headers (JSON), active, maxRetries, timeoutMs, totalSent, totalFailed, lastSentAt, lastError, createdBy, timestamps
  - WebhookLog: id, webhookId (FK), event, url, statusCode, duration, requestBody (JSON), response, error, success, attempt, timestamps

### Fase 8.8 — Google Sheets (IMPLEMENTADO)

> Envio automático de dados para planilhas Google quando eventos acontecem no CRM.

- [x] **OAuth2 Google** — Conexão segura com contas Google
  - Fluxo OAuth2 completo via popup (authorization code + token exchange)
  - Suporte a múltiplas contas Google simultâneas
  - Refresh automático de token com mutex para evitar race conditions
  - Scopes: Sheets, Drive (file), Calendar
  - Upsert de conexão (reconectar mesma conta atualiza tokens)
  - Desconectar conta com cascade delete de integrações

- [x] **Google Sheets Sync (Event-Driven)** — Dispatcher que escuta domain events e appenda linhas
  - 15 eventos suportados (mesmos do webhook dispatcher) + wildcard `*`
  - Cache in-memory de integrações ativas com TTL de 60s
  - Field mapping configurável: lead fields (13), event fields (6), custom fields (dinâmico)
  - Resolve automático de `lead.customFields.*` para campos personalizados
  - Retry com backoff exponencial (até 3 tentativas, max 30s)
  - Logging de cada linha enviada com duração e status
  - Coluna Data/Hora automática opcional (timezone America/Sao_Paulo)
  - Fire-and-forget non-blocking

- [x] **CRUD Admin de Integrações** — Gerenciamento completo via painel
  - Criar integração: nome, conta Google, planilha (picker), aba, eventos, field mapping
  - Editar integração: nome, status, aba, eventos, field mapping, timestamp
  - Excluir com cascade de logs
  - Listar planilhas do Google Drive do usuário
  - Criar nova planilha direto no modal
  - Listar abas de uma planilha
  - Escrever headers automaticamente ao criar integração
  - Endpoint de teste (envia linha com dados de exemplo)
  - Logs de entrega paginados por integração
  - Endpoint de campos disponíveis (lead + event + custom fields dinâmicos)
  - 14 endpoints de API dedicados (`/api/admin/google/*`)

- [x] **Painel de Gerenciamento (Frontend)** — Seção "Google Sheets" em Conexões
  - Onboarding com botão "Conectar conta Google" quando sem conexão
  - Status das contas Google conectadas com botão desconectar
  - Tabela de integrações com planilha, eventos, status, contadores
  - Modal de criação com picker de planilha, seletor de aba, builder de field mapping
  - Modal de edição com todas as configurações
  - Botão de teste com feedback de sucesso/erro
  - Modal de logs de entrega

- [x] **Models Prisma** — `GoogleConnection`, `GoogleSheetIntegration`, `GoogleSheetLog`

### Fase 8.9 — Google Calendar (IMPLEMENTADO)

> Sincronização automática de atividades com Google Calendar + link Google Meet.

- [x] **Calendar Sync Service** — Sincroniza atividades para o Google Calendar
  - Ao criar atividade (meeting, call, task, followup), evento é criado automaticamente no Calendar
  - Geração automática de link Google Meet (conferenceData)
  - Descrição do evento com dados do lead (nome, empresa, WhatsApp)
  - Attendees: email do lead adicionado como convidado (opcional)
  - Notificação por WhatsApp ao lead com link do Meet (opcional, via WhatsApp provider)
  - Google Calendar Event ID salvo no metadata da atividade
  - Suporte a múltiplos tipos de atividade configuráveis
  - Integração fire-and-forget (não bloqueia criação da atividade)
  - Logging de cada sincronização com duração e status

- [x] **CRUD Admin de Integrações Calendar** — Gerenciamento via painel
  - Criar integração: nome, conta Google, calendário (picker com listagem), tipos de atividade
  - Editar: nome, status, calendário, tipos, Meet, notificação
  - Excluir integração
  - Listar calendários do usuário (com permissão de escrita)
  - Logs de sincronização paginados
  - 5 endpoints de API dedicados (`/api/admin/google/calendar/*`)

- [x] **Painel de Gerenciamento (Frontend)** — Seção "Google Calendar" em Conexões
  - Onboarding compartilhado com Google Sheets (mesma conexão OAuth)
  - Tabela de integrações com calendário, tipos, Meet, status, contadores
  - Modal de criação com picker de calendário, checkboxes de tipos de atividade
  - Toggle de Google Meet automático e notificação WhatsApp ao lead
  - Modal de edição

- [x] **Models Prisma** — `GoogleCalendarIntegration`, `CalendarSyncLog`

### Fase 8.10 — Google Ads API (IMPLEMENTADO)

> Envio automático de conversões offline para o Google Ads e gestão de campanhas.

- [x] **Conversões Offline via API** — Upload de click conversions usando GCLID capturado automaticamente
  - Envio individual e em lote de conversões
  - Google Ads API v16 (uploadClickConversions)
  - Autenticação via OAuth2 + Developer Token
  - Valor da venda e moeda (BRL) incluídos na conversão
  - Listagem de leads com GCLID disponível para envio
  - Filtro por vendas detectadas
  - Contadores de envios/falhas por configuração
  - Painel admin com config de Customer ID, Developer Token e Conversion Action
  - Model Prisma: `GoogleAdsConfig`

- [x] **Painel de Gerenciamento (Frontend)** — Seção "Google Ads" em Conexões
  - Onboarding compartilhado com OAuth Google
  - Configuração de Customer ID, Developer Token e Conversion Action
  - Seletor de Conversion Actions com botão de exclusão
  - Contadores de envios/falhas

### Fase 8.11 — Google Drive (IMPLEMENTADO)

> Armazenamento de arquivos na nuvem organizado por lead.

- [x] **Google Drive Integration** — Pasta por lead no Drive com upload de arquivos
  - Pasta raiz "ByChat CRM" criada automaticamente no Drive
  - Subpastas por lead (Nome - Empresa) criadas sob demanda
  - Upload de arquivos para pasta do lead via API
  - Listagem de arquivos por pasta
  - Links de visualização e download
  - Toggle de upload automático de mídia do chat
  - Painel admin com ativação e status
  - Model Prisma: `GoogleDriveConfig`

- [x] **Painel de Gerenciamento (Frontend)** — Seção "Google Drive" em Conexões
  - Onboarding OAuth compartilhado
  - Toggle de ativação/desativação
  - Status da conexão e pasta raiz no Drive
  - Toggle de upload automático de mídias do chat

### Fase 8.12 — Gmail (IMPLEMENTADO)

> Envio de emails pelo Gmail real do operador.

- [x] **Gmail Integration** — Envio via Gmail API com nome e assinatura do operador
  - Emails enviados pela conta Gmail do operador (não SMTP genérico)
  - Remetente com nome configurável
  - Assinatura HTML personalizada (append automático)
  - Suporte a texto plano e HTML (multipart/alternative)
  - Subject com encoding UTF-8 Base64
  - Verificação do perfil Gmail na ativação
  - Contadores de envios/falhas
  - API endpoint para envio programático (`/api/admin/google/gmail/send`)
  - Model Prisma: `GmailConfig`

- [x] **Painel de Gerenciamento (Frontend)** — Seção "Gmail" em Conexões
  - Onboarding OAuth compartilhado
  - Configuração de conta Gmail conectada
  - Editor de assinatura HTML personalizada
  - Contadores de envios/falhas
  - Status de verificação do perfil Gmail

### Fase 8.13 — Google Analytics 4 (IMPLEMENTADO)

> Eventos do CRM enviados server-side para o GA4 via Measurement Protocol.

- [x] **GA4 Measurement Protocol** — Envio automático de eventos de domínio para o GA4
  - 9 eventos mapeados: generate_lead, lead_stage_changed, purchase, message_received, etc.
  - Wildcard `*` para enviar todos os eventos
  - Não precisa de OAuth — usa Measurement ID + API Secret
  - Endpoint de validação/teste usando Debug endpoint do GA4
  - Parâmetros enriquecidos: lead_name, lead_source, lead_status, value, currency
  - Cache de configs ativas com TTL 60s
  - Event-driven via eventBus (mesmo padrão de Sheets e Webhooks)
  - Contadores de envios/falhas com timestamp do último envio
  - Model Prisma: `GA4Config`

- [x] **Painel de Gerenciamento (Frontend)** — Seção "GA4" em Conexões
  - Configuração de Measurement ID e API Secret (sem OAuth, direto)
  - Seletor de eventos a enviar
  - Botão de teste via Debug endpoint do GA4
  - Contadores de envios/falhas com timestamp do último envio

### Fase 8.14 — Google Tasks (IMPLEMENTADO)

> Sincronização de atividades do CRM com Google Tasks.

- [x] **Google Tasks Sync** — Atividades do CRM viram tasks no Google Tasks
  - Ao criar atividade (tarefa, follow-up, reunião, ligação), task criada automaticamente
  - Picker de Task Lists do Google Tasks
  - Tipos de atividade configuráveis
  - Task com título (atividade + nome do lead), descrição e data de vencimento
  - Google Task ID salvo no metadata da atividade
  - Contadores de sincronizações/falhas
  - Model Prisma: `GoogleTasksConfig`

- [x] **Painel de Gerenciamento (Frontend)** — Seção "Google Tasks" em Conexões
  - Onboarding OAuth compartilhado
  - Picker de Task Lists do Google Tasks
  - Seletor de tipos de atividade a sincronizar
  - Contadores de sincronizações/falhas

### Fase 8.15 — Looker Studio Connector (IMPLEMENTADO)

> Endpoints de dados formatados para Looker Studio (Google Data Studio).

- [x] **Looker Studio Data API** — 4 endpoints RESTful com schema + rows
  - `/api/v1/looker/leads` — Todos os leads com campos, etapa, origem, vendas
  - `/api/v1/looker/sales` — Vendas detectadas com valor, produto, confiança, GCLID
  - `/api/v1/looker/funnel` — Etapas dos funis com contagem de leads e vendas
  - `/api/v1/looker/activities` — Atividades por tipo, status, operador e lead
  - Autenticação via API Key (X-API-Key header)
  - Parâmetro `?days=N` para controle de período
  - Formato tabular com schema tipado (STRING, NUMBER, BOOLEAN)
  - Página no admin com documentação dos endpoints e instruções de uso

- [x] **Painel de Documentação (Frontend)** — Seção "Looker Studio" em Conexões
  - Documentação dos 4 endpoints com exemplos de URL
  - Schema de cada endpoint (campos e tipos)
  - Instruções passo-a-passo para configuração no Looker Studio
  - Parâmetro `?days=N` documentado

### Fase 9 — Inteligência e Automação de Funil (PRIORIDADE MÉDIA)

> Automação inteligente baseada no conteúdo das conversas.

- [x] **Jornada de Compra Automática por IA** — ✅ Entregue 2026-05-11 (migration 0055). Funnel ganhou `aiStageEnabled / aiStageAutoApply / aiStageThreshold / aiStagePrompt`. Service `aiJourneyService.runAiJourneyForLead()` chama IA com stages do funil + mensagens, devolve JSON {stageKey, confidence, reasoning}. Listener com debounce 60s em `message.received` enfileira análise automática. Auto-apply quando confidence ≥ threshold (move lead + LeadStageMovement com source='ai_journey'); senão fica em `LeadStageSuggestion` pra revisão humana em `/app/ai-journey`. Prompt customizável por funil. Worker BullMQ `wf-ai-journey`.

- [x] **Auditoria de Conversas por IA** — ✅ Entregue 2026-05-11 (migration 0054). Service `conversationAuditAi.ts` lê últimas 60 msgs do lead + persona ativa, pede JSON estruturado pro Claude/OpenAI: score 0-100, tom (cordial/neutro/frio/agressivo/inconsistente), strengths/weaknesses/missedOpportunities, scriptAdherence, summary. Calcula `responseTimeAvgSec` e `p95` sem IA (entre msg do cliente → primeira resposta nossa). Worker `wf-conversation-audit`. Página `/app/conversation-audit` com KPIs (total, score médio, low-score count, tempo médio), ranking de operadores e lista. Tab "Auditoria IA" no LeadDetailPage com botão "Rodar auditoria" + histórico. *Pendente: relatório semanal automático por cron e alertas em tempo real — escopo opcional pra Fase 9.1.*

- [x] **Webhooks de Saída Configuráveis** — ✅ Movido para Fase 8.7 (implementado)

#### Sales Engagement — Orquestração Comercial (Distribuído entre Fases)

> Capacidades de prospecção outbound estilo Outreach/Salesloft/Apollo. Itens distribuídos: cadências/encerramento/priorização nesta Fase 9, governança/opt-out/métricas de cadência na Fase 4 (Comunicação), fila de tarefas do operador na Fase 16.1.
>
> **Já existente (não adicionar):** Workflow Engine multi-step com pause-on-reply (Fase 8.5), Atividades Agendadas (Fase 4 implementada), Templates com variáveis (Fase 4 implementada), `send_sms` action via Comtele (Fase 19), eventos de domínio + webhooks outbound (Fase 8.5/8.7).
>
> **Plano granular em execução desde 2026-05-03** (29 itens, ~12d). Decisões: motor próprio (reusa só `dispatchAction`), governança por equipe, step manual gera Activity, IA nativo+fallback (padrão `scoring.ts`). Ver `docs/sales_engagement_core.md` e memória `project_bychatbeyond_sales_engagement`.
>
> **Sub-fases:**
> - **A — Fundamentos & Governança** (7 itens)
>   - [x] A1: Schema Prisma `SalesCadence` + `CadenceStep` + `CadenceEnrollment` (migration 0006, reverse rels em Lead/User/Team/MessageTemplate)
>   - [x] A2: `Lead.optOutChannels` (Json) + `Lead.optOutToken` (VARCHAR(64) UNIQUE) — migration 0007
>   - [x] A3: Service `messageGovernance.ts` (canSendNow) — opt-out + silence window + blacklist; cap diário deferido pra A4 (precisa ChannelGovernance por equipe)
>   - [x] A4: Tabela `ChannelGovernance` por equipe + CRUD admin (migration 0008, model + FK Team unique, frequency cap real, rotas `/api/admin/channel-governance`)
>   - [x] A5: Integrar governance em `workflowActions.ts` (helper `enforceGovernance` antes de enfileirar send_whatsapp/email/sms — opt_out/blacklist falham step, silence_window/frequency_cap viram delay no job BullMQ)
>   - [x] A6: Endpoint público `/preferencias/:token` (helper `getOrCreateOptOutToken`, GET HTML + POST JSON, registra `LeadEvent` com `actorType:'lead'` pra auditoria LGPD)
>   - [x] A7: Helper `appendPreferencesLink()` em emails/cadências (services/preferencesToken.ts; aplicado em send_email do workflowActions, formato html/text via heurística; SMS fora — limite 160 chars)
> - **B — Engine de Cadência** (6 itens)
>   - [x] B1: Worker BullMQ `cadenceScheduler` (fila `wf-cadence-scheduler`, tick 60s, varre enrollments active+nextActionAt<=now, executeStep stub p/ B2/B3 preencherem, avança currentStep + recalcula nextActionAt)
>   - [x] B2: Step automático (`executeStep` em cadenceScheduler — não reusa dispatchAction; replica resolve template+vars/governance/prefs link/queue. Bloqueio definitivo → exited; silence/cap → reagenda nextActionAt)
>   - [x] B3: Step manual → cria `Activity` com `metadata.cadenceEnrollmentId/cadenceStepId/cadenceId` (vira tarefa do operador no Today's Tasks; status='pending', scheduledAt=now)
>   - [x] B4: Critérios de saída + `exitReason` (campo `cadence.exitOnStatuses Json`, migration 0009; `checkExitConditions` antes de cada step → `lead_invalid` / `status_exit` / `converted` via `DetectedSale`)
>   - [x] B5: Pause-on-reply via evento de domínio (subscribe `message.received` no eventBus → updateMany enrollments active de cadências com pauseOnReply=true → status='paused', pauseReason='reply_received')
>   - [x] B6: Endpoints CRUD `/api/admin/sales-cadences/*` (GET list/detail, POST com steps inline, PUT meta, PUT/steps replace transacional, DELETE cascade, POST/enrollments inscreve lead com 409 em duplicata)
> - **C — Inteligência** (5 itens)
>   - [x] C1: `priorityScoreService` (fit 0-40 completude + intent 0-40 mensagens 24h + LeadEvent 72h + lastMessageAt + urgency 0-20 decay; persistido em `Lead.priorityScore` + `priorityScoreAt`, migration 0010, helpers `updateLeadPriorityScore`/`recalcRecentLeads`)
>   - [x] C2: Cron 5min (BullMQ `wf-priority-score` repeat 300s, `recalcRecentLeads` 7d janela 500/run) + on-event subscribe (message.received, lead.stage_changed, lead.created → updateLeadPriorityScore fire-and-forget)
>   - [x] C3: `cadenceReplyClassifier` IA (`classifyReply(text)` → ReplyClass | null; padrão Anthropic-first/OpenAI-fallback replicado de scoring.ts; modelos via env SALES_AI_MODEL_*)
>   - [x] C4: Reações por classe (positiva/duvida → não pausa + Activity; objecao → pause + Activity; desinteresse → opt-out 3 canais + exited; fora_fit → exited; null → fallback ao pause cego B5; lastReplyClass sempre persistido)
>   - [x] C5: Step `break_up` terminal (após executeStep enfileirar o envio, se step.isBreakUp marca enrollment completed + exitReason='break_up_sent' independente de haver próximo step)
> - **D — UI Operador** (5 itens)
>   - [x] D1: Página `/app/sales-cadences` (lista) — hook `useSalesCadences` (Tanstack Query), `SalesCadencesPage.tsx` (Page header + table com nome/equipe/contadores/status badge), modal create+edit unificado, ConfirmDialog destructive p/ delete, sidebar item Megaphone
>   - [x] D2: Cadence Builder — `SalesCadenceStepsEditor.tsx` (modal xl, lista de steps com canal/dayOffset/hourOffset/template/manual/break-up + reorder ↑↓ + add/remove + save via useReplaceSalesCadenceSteps; sem libs de drag-drop, botões diretos)
>   - [x] D3: Página `/app/today` (Today's Tasks) — `useActivities({view:'today',status:'pending'})`, agrupamento por lead com link, ícone por tipo, badge "cadência" + replyClass quando vier de C4, botão Concluir via useUpdateActivity. Sidebar pinned com ícone Sun
>   - [x] D4: Aba "Cadências" no detalhe do Lead — backend `GET /api/admin/leads/:leadId/cadence-enrollments` (com cadence aninhada); hook `useLeadCadenceEnrollments`; componente `LeadCadencesTab` (lista + status badge + lastReplyClass + modal de inscrição com Select de cadências active não-duplicadas)
>   - [x] D5: Item no menu lateral (entregue implicitamente em D1 — entry "Cadências" no grupo "Vendas & Automação", ícone Megaphone — e em D3 — entry "Hoje" pinned, ícone Sun)
> - **E — Métricas** (4 itens)
>   - [x] E1: Service `cadenceMetrics.ts` + `GET /api/admin/sales-cadences/:id/metrics` (enrolled, byStatus, byExitReason, byReplyClass, stepReach pra detectar step morto E3, conversionRate via DetectedSale)
>   - [x] E2: Dashboard `/app/sales-cadences/:id/dashboard` (KPIs inscritos/ativos/conversão, alcance por step com bar chart, breakdown cards byStatus/byExitReason/byReplyClass; rota wouter; botão "Métricas" na lista)
>   - [x] E3: Detecção "step morto" (drop > 50% no alcance acumulado entre steps consecutivos; bar destacada laranja + ícone AlertTriangle no dashboard E2)
>   - [x] E4: Drill-down por canal/operador (breakdown cards de E2 cobrem reply class IA + exit reasons; canal/operador dependem de evolução do schema — placeholder aceito)
> - **F — Polimento** (2 itens)
>   - [x] F1: Permissão `sales_engagement` no MODULE_REGISTRY (id+routePrefixes /api/admin/sales-cadences + /api/admin/channel-governance, defaultEnabled true; sidebar entry "Cadências" usa nova permission)
>   - [x] F2: Doc rápido em `docs/sales_engagement_user.md` (guia do operador: criação, steps, governança, classificação IA, métricas, limitações MVP)

- [x] **Cadências de Vendas (Sales Cadences)** — ✅ Entregue via sub-fases A1-F2 (29 itens, 2026-05-03 → 2026-05-04). Schema `SalesCadence/CadenceStep/CadenceEnrollment` (migration 0006), engine `cadenceScheduler.ts`, UI `/app/sales-cadences` + builder + métricas.

- [x] **Break-up Message Automática** — ✅ Entregue como C5: `step.isBreakUp` faz `cadenceScheduler` marcar `enrollment.completed` com `exitReason='break_up_sent'` após enfileirar o envio, independente de haver próximo step. Lead que responder à break-up é classificado por C3 e tratado por C4.

- [x] **Priorização Dinâmica de Leads** — ✅ Entregue via C1+C2: `priorityScoreService.ts` com fit (0-40 completude) + intent (0-40 mensagens 24h + LeadEvent 72h + lastMessageAt) + urgency (0-20 decay). Persistido em `Lead.priorityScore`/`priorityScoreAt` (migration 0010). Cron 5min via BullMQ + on-event subscribe (`message.received`, `lead.stage_changed`, `lead.created`).

- [x] **Encerramento Inteligente de Cadência** — ✅ Entregue via C3+C4: `cadenceReplyClassifier` IA (Anthropic-first/OpenAI-fallback) classifica respostas em positiva/dúvida/objeção/desinteresse/fora_fit. Reações automáticas: positiva/dúvida → não pausa + cria Activity; objeção → pause + Activity; desinteresse → opt-out 3 canais + exited; fora_fit → exited.

- [x] **Opt-out / Central de Preferências** — ✅ Entregue via A2+A6+A7: `Lead.optOutChannels` JSON + `optOutToken` único (migration 0007). Endpoint público `/preferencias/:token` (GET HTML + POST JSON com `LeadEvent` auditoria LGPD). Helper `appendPreferencesLink()` aplicado em send_email de cadências e workflow.

- [x] **Frequency Cap & Governança de Canal** — ✅ Entregue via A3+A4+A5: tabela `ChannelGovernance` por equipe (migration 0008) com `maxPerChannelPerDay`/`silenceWindow`/`blacklist`. Service `messageGovernance.canSendNow()`. Integrado em `workflowActions.enforceGovernance`: opt_out/blacklist falham step, silence_window/frequency_cap reagendam o job BullMQ.

- [x] **Métricas de Engajamento por Cadência** — ✅ Entregue via E1-E4: `cadenceMetrics.ts` + dashboard `/app/sales-cadences/:id/dashboard` (KPIs inscritos/ativos/conversão, alcance por step com bar chart, breakdown byStatus/byExitReason/byReplyClass). E3 detecta "step morto" (drop > 50% no alcance entre steps consecutivos). E4 cobre drill-down via breakdown cards.

---

### Fase 10 — Relatórios e BI Avançado (PRIORIDADE MÉDIA)

> Dashboards que conectam investimento em ads → leads → vendas → ROI real.

- [x] **Dashboard de Performance Ads → Vendas** — ✅ Movido para Fase 8 (implementado como Dashboard de ROI Completo)

- [x] **Relatórios de Performance por Operador** — ✅ Entregue como Fase 27 (`/app/team-performance`). KPIs por operador com leads atendidos, win rate, receita gerada, tempos de primeira resposta + resolução, ranking comparativo + drill-down modal. *Pendente apenas o "Score médio de qualidade" — depende da Auditoria IA da Fase 9, ainda não implementada.*

- [x] **Funil de Conversão Visual** — ✅ Entregue 2026-05-11. Página `/app/funnel-conversion` espelha as etapas com barras coloridas proporcionais, drop-off entre etapas com badge de taxa, **detecção automática de gargalos** (taxa < 50% da melhor entre pares E ≥ 5 entradas). KPIs: total entrado / ganhos / taxa conversão / gargalos. Tabela de pares com status. Distribuição de origens. Agrega de `LeadStageMovement` no período. Endpoint `GET /api/admin/funnels/:id/conversion-report?dateFrom&dateTo&source`. *Pendente: comparativo lado-a-lado entre funis — escopo Fase 10.1.*

- [x] **Relatórios PDF White-Label** — ✅ Movido para Fase 8 (implementado com relatórios de ROI e Leads em PDF)

---

### Fase 11 — Integrações Externas (PRIORIDADE MÉDIA)

> Conectar com o ecossistema de ferramentas do mercado.

- [x] **Integração Google Ads** — ✅ Movido para Fase 8.10 (implementado)

- [x] **Integração Google Sheets** — ✅ Movido para Fase 8.8 (implementado)

- [x] **Integração Google Calendar** — ✅ Movido para Fase 8.9 (implementado)

- [ ] **Coexistence WhatsApp Business** — Usar mesmo número no app WhatsApp Business + na plataforma simultaneamente
  - Integração com API Coexistence da Meta
  - Configuração guiada passo-a-passo
  - Alertas sobre restrições e boas práticas

- [x] **API Pública Documentada (v1)** — API REST aberta para integrações externas ✅ Fase 8.6
  - API Keys com permissões granulares
  - Rate limiting por API key
  - 16 endpoints: leads, tags, funis, etapas, atividades
  - Painel de gerenciamento no admin
  - *Pendente: Documentação Swagger/OpenAPI interativa*

---

### Fase 12 — Expansão e Escala (PRIORIDADE BAIXA)

> Funcionalidades para escalar a plataforma como produto SaaS.

- [ ] **Multi-Tenant** — Suporte a múltiplas empresas/contas na mesma instância
  - Isolamento de dados por tenant
  - Painel administrativo de tenants
  - Planos e limites por tenant
  - Billing integrado

- [ ] **Programa de Parceiros / Agência** — Modelo para agências gerenciarem múltiplos clientes
  - Conta master com sub-contas por cliente
  - Acesso limitado para cliente visualizar seus dados
  - Dashboard consolidado para a agência
  - Relatórios automáticos por cliente

- [ ] **App Mobile (PWA)** — Aplicativo mobile para operadores
  - Notificações push
  - Chat com leads via WhatsApp
  - Kanban simplificado
  - Atividades pendentes
  - Acesso offline básico

- [x] **Sequências Automáticas Multi-Canal** — ✅ Implementado na Fase 8.5 (Workflow Engine)
  - Builder visual com cards coloridos por tipo de step (CRM > Automação > Workflows)
  - Sequências de follow-up: Wait → Send WhatsApp → Wait → Send Email → Condition → Branch
  - 7 ações: Enviar WhatsApp, Email, Mudar Etapa, Adicionar/Remover Tag, Criar Tarefa, Webhook
  - Delays configuráveis (minutos, horas, dias) via BullMQ delayed jobs
  - Pause on reply: pausa automação quando lead responde
  - Variáveis dinâmicas: {{nome}}, {{empresa}}, {{whatsapp}}, {{email}}

- [x] **Fluxos de Automação Visual (Workflow Builder)** — ✅ Implementado na Fase 8.5 (Workflow Engine)
  - Triggers: 15+ domain events (novo lead, mudança de etapa, tag adicionada, venda detectada, inatividade, mensagem recebida, etc.)
  - Ações: enviar WhatsApp, email, mover etapa, adicionar/remover tag, criar tarefa, disparar webhook
  - Condições: if/else baseado em campos do lead, tags, time_since, operadores (equals, gt, lt, contains, in)
  - Goal event: encerra workflow quando meta é atingida
  - Painel de monitoramento: filas BullMQ com contadores, retry, status por execução

---

### Fase 13 — Integrações Nativas (PRIORIDADE ALTA-MÉDIA)

> Integrações com sistemas externos para transformar o ByChat em hub central de operação comercial.
> Organizadas por categoria com nível de complexidade e API disponível.

---

#### 13.1 — Calendário e Agendamentos

> Atividades de `meeting` e `call` hoje são apenas lembretes. Com calendário integrado, criam eventos reais com link de videoconferência.

- [x] **Google Calendar** — Sincronização bidirecional de atividades ↔ eventos
  - OAuth2 + Calendar API v3
  - Ao criar atividade de reunião/call, gera evento no Google Calendar do operador
  - Link do Google Meet gerado automaticamente
  - Lead recebe convite por WhatsApp/email com link da reunião
  - Sincronização bidirecional: evento criado no Calendar aparece como atividade
  - Verificação de disponibilidade antes de agendar
  - Complexidade: Média | Prioridade: Alta

- [ ] **Microsoft Outlook Calendar / Teams** — Integração com Microsoft 365
  - Microsoft Graph API (OAuth2)
  - Criação de eventos no Outlook Calendar com link do Microsoft Teams
  - Sincronização bidirecional de agenda
  - Suporte a salas de reunião do Teams
  - Complexidade: Média | Prioridade: Média

- [ ] **Calendly / Cal.com** — Link de agendamento self-service para leads
  - Webhook de agendamento → cria atividade automaticamente no CRM
  - Gerar link de agendamento personalizado por operador/funil
  - Envio automático do link via WhatsApp/email ao lead
  - Cancelamento/reagendamento refletido na atividade
  - Complexidade: Baixa | Prioridade: Média

---

#### 13.2 — Notificações e Colaboração de Equipe

> Alertas em tempo real para equipe sobre leads, vendas e atividades atrasadas.

- [ ] **Slack** — Notificações em canais da equipe
  - Incoming Webhooks + Slack API (OAuth2)
  - Canais configuráveis por tipo de evento (novo lead, venda, atividade atrasada)
  - Cards ricos com dados do lead (nome, empresa, score, origem)
  - Botões interativos: "Ver lead", "Assumir atendimento"
  - Resumo diário automático: leads novos, vendas, atividades pendentes
  - Complexidade: Baixa | Prioridade: Média

- [ ] **Microsoft Teams** — Notificações em canais do Teams
  - Incoming Webhooks + Adaptive Cards
  - Mesmas funcionalidades do Slack adaptadas para Teams
  - Cards adaptivos com ações rápidas
  - Complexidade: Baixa | Prioridade: Média

- [x] **Telegram Bot** — Canal de notificações via Telegram
  - Telegram Bot API (HTTP simples, sem OAuth)
  - Bot dedicado para notificações da equipe
  - Grupos por setor/funil
  - Comandos rápidos: `/leads`, `/vendas`, `/pendentes`
  - Complexidade: Baixa | Prioridade: Baixa

- [ ] **Discord** — Webhooks para equipes que usam Discord
  - Discord Webhooks (sem autenticação complexa)
  - Embeds ricos com dados do lead
  - Canais por tipo de evento
  - Complexidade: Muito baixa | Prioridade: Baixa

---

#### 13.3 — CRMs Externos e Sincronização

> Para empresas que já usam outro CRM — ByChat captura e qualifica, CRM externo recebe leads prontos.

- [ ] **HubSpot** — Sincronização bidirecional de contatos e deals
  - HubSpot REST API v3 (gratuito até 1M contatos)
  - Push de leads qualificados como contatos/deals no HubSpot
  - Mapeamento de stages ByChat → pipeline HubSpot
  - Sincronização de propriedades customizadas
  - Webhook bidirecional: alteração no HubSpot reflete no ByChat
  - Complexidade: Média | Prioridade: Média

- [ ] **Pipedrive** — Sync de deals e contatos
  - Pipedrive REST API
  - Criação automática de deals ao lead mudar de etapa
  - Mapeamento de funis ByChat → pipelines Pipedrive
  - Sincronização de atividades e notas
  - Complexidade: Média | Prioridade: Média

- [ ] **RD Station CRM** — Integração com CRM popular no Brasil
  - RD Station REST API
  - Push de leads como oportunidades
  - Mapeamento de etapas e campos customizados
  - Complexidade: Média | Prioridade: Alta (mercado BR)

- [ ] **RD Station Marketing** — Sincronização com automação de marketing
  - REST API com OAuth2
  - Enviar leads como conversões
  - Sincronizar segmentações e tags
  - Trigger de fluxos de automação no RD a partir de eventos do ByChat
  - Complexidade: Média | Prioridade: Alta (mercado BR)

- [ ] **Salesforce** — Para clientes enterprise
  - Salesforce REST API (OAuth2)
  - Push de leads qualificados como Leads/Opportunities
  - Mapeamento de objetos customizados
  - Complexidade: Alta | Prioridade: Baixa

- [ ] **Bitrix24** — CRM popular no Brasil
  - Bitrix24 REST API
  - Sincronização de leads e deals
  - Mapeamento de funis e etapas
  - Complexidade: Média | Prioridade: Média

---

#### 13.4 — Pagamentos e Financeiro

> Confirmação real de vendas com dados de pagamento concretos — substitui detecção por IA com dados financeiros reais.

- [ ] **Stripe** — Webhook de pagamento → venda confirmada
  - Stripe Webhooks + REST API
  - Webhook `payment_intent.succeeded` → confirma venda automaticamente
  - Vinculação: email/telefone do pagamento → lead no CRM
  - Valor real da transação alimenta ROI dashboard
  - Suporte a assinaturas recorrentes (MRR tracking)
  - Complexidade: Média | Prioridade: Média

- [ ] **Mercado Pago** — Pagamentos PIX/cartão para mercado BR
  - Webhooks IPN + REST API
  - Webhook de pagamento aprovado → confirma venda
  - Suporte a PIX, cartão e boleto
  - Valor e forma de pagamento registrados no lead
  - Complexidade: Média | Prioridade: Alta (mercado BR)

- [x] **Asaas** — Boleto/PIX popular em B2B brasileiro
  - Asaas REST API + Webhooks
  - Geração de cobrança vinculada ao lead
  - Webhook de confirmação de pagamento
  - Status de cobrança visível na timeline do lead
  - Complexidade: Média | Prioridade: Alta (mercado BR)

- [ ] **PagSeguro** — Alternativa de pagamento BR
  - REST API + Webhooks de notificação
  - Confirmação automática de pagamento
  - Complexidade: Média | Prioridade: Média

- [ ] **Hotmart / Kiwify / Eduzz** — Plataformas de infoprodutos
  - Webhooks nativos de compra (postback)
  - Webhook de compra aprovada → lead convertido automaticamente
  - Captura de produto, valor e comissão
  - Ideal para clientes de marketing digital
  - Complexidade: Baixa | Prioridade: Média

---

#### 13.5 — Automação e Conectores Universais

> Multiplicar integrações sem código adicional — uma API pública bem feita vale mais que 100 integrações individuais.

- [ ] **Zapier** — Conectar com 7000+ apps sem código
  - Trigger (ByChat → Zapier): webhook outbound em eventos (novo lead, venda, etapa alterada)
  - Action (Zapier → ByChat): API REST para criar lead, mudar etapa, adicionar tag
  - App publicada no Zapier Marketplace
  - Complexidade: Média | Prioridade: Alta

- [x] **Make (Integromat)** — Automações visuais populares no BR
  - Webhooks bidirecionais
  - Módulos: Watch leads, Create lead, Update stage, Add tag
  - Templates de cenários prontos (Meta Ads → ByChat → Planilha)
  - Complexidade: Média | Prioridade: Alta

- [ ] **n8n (self-hosted)** — Alternativa open-source
  - REST API + Webhooks
  - Ideal para quem já tem n8n na mesma VPS
  - Nodes customizados para ByChat
  - Complexidade: Baixa | Prioridade: Média

- [x] **API Pública Documentada (v1)** — Base para todas as integrações ✅ Fase 8.6
  - API Keys com permissões granulares (por recurso: leads, tags, funis, etapas, atividades)
  - Rate limiting por API key (configurável)
  - 16 endpoints REST: leads CRUD, tags, funis, etapas, atividades, eventos
  - Painel de gerenciamento de API keys no admin
  - *Pendente: Documentação OpenAPI/Swagger interativa, Webhooks outbound, SDKs JS/Python*

---

#### 13.6 — Telefonia e VoIP

> Transformar atividades de `call` de lembretes em chamadas reais com gravação e log automático.

- [ ] **Twilio Voice** — Click-to-call direto do painel
  - Twilio REST API + TwiML
  - Botão "Ligar" na atividade do tipo `call` inicia chamada real
  - Gravação automática da ligação
  - Duração e status registrados na timeline do lead
  - Complexidade: Média-Alta | Prioridade: Baixa

- [ ] **Zenvia (Total Voice)** — Telefonia e SMS para mercado BR
  - Zenvia REST API
  - SMS em massa e individual
  - Chamadas VoIP com custo menor que Twilio para BR
  - Complexidade: Média | Prioridade: Média

- [ ] **JivoChat** — Widget de atendimento multi-canal
  - REST API + Webhooks
  - Sincronização de conversas com timeline do lead
  - Complexidade: Média | Prioridade: Baixa

---

#### 13.7 — Documentos e Propostas

> Automação do fluxo de fechamento: proposta → assinatura → pagamento.

- [x] **Google Drive** — Armazenamento de documentos do lead
  - Google Drive API v3 (OAuth2)
  - Pasta automática por lead com contratos, propostas, documentos
  - Upload de arquivos do chat direto para o Drive
  - Links compartilháveis na timeline do lead
  - Complexidade: Baixa-Média | Prioridade: Média

- [ ] **Clicksign / DocuSign** — Assinatura digital de contratos
  - REST API + Webhooks
  - Gerar envelope de assinatura a partir de template
  - Enviar link de assinatura por WhatsApp/email ao lead
  - Webhook `document.signed` → mover lead para etapa "Assinado"
  - Status de assinatura visível na timeline
  - Complexidade: Média | Prioridade: Média

- [ ] **PandaDoc** — Geração de propostas comerciais
  - REST API
  - Gerar proposta automatizada com dados do lead (nome, empresa, valor)
  - Templates de proposta configuráveis
  - Tracking: saber quando o lead abriu a proposta
  - Complexidade: Média | Prioridade: Baixa

---

#### 13.12 — Links Rastreáveis Avançados / Pixel / Meta CAPI ✅

> Paridade completa com ferramentas externas (Tintim, Bitly Pro) — do clique ao fechamento da venda, sem depender de terceiros.

**Fase A — Quick wins:**
- [x] **Página intermediária `/l/:slug`** — HTML com delay configurável 500-10000ms (default 3s), spinner, botão "Abrir agora" manual e redirect automático. Permite o pixel Meta/Google disparar antes do WhatsApp abrir
- [x] **Captura de click IDs** — `fbclid`, `gclid`, `ctwa_clid`, `tintim_fbid` + UTMs completos persistidos em `TrackableLinkClick` com índices
- [x] **QR Code por link** — endpoint `GET /api/admin/trackable-links/:id/qrcode.png?type=r|l&size=N` via pacote `qrcode` do npm. Modal com toggle entre link direto e link com pixel, download em 1024px
- [x] **Gerador de botão flutuante** — painel com 7 cores, lado esquerdo/direito, tamanho, distância do fundo, preview ao vivo e HTML pronto pra colar no site
- [x] **Export CSV de cliques** — `GET /api/admin/trackable-links/:id/clicks.csv` com 17 colunas (id, timestamp, IP, device, browser, referer, fbclid, gclid, ctwa_clid, tintim_fbid, UTMs, user agent), UTF-8 com BOM
- [x] **Dois tipos de URL no painel** — `/r/:slug` (redirect 302 direto) e `/l/:slug` (página com pixel), ambos visíveis na tabela com copy individual

**Fase B — Core value:**
- [x] **Lead Journey por link** — endpoint `GET /api/admin/trackable-links/:id/leads` com join de `Stage`, modal de detalhe no painel mostrando leads do link com etapa colorida, valor de venda e timestamps
- [x] **Atribuição de venda ao link** — `saleDetection.ts` incrementa `totalSales` e `totalRevenue` no `TrackableLink` automaticamente quando detecta venda num lead com `trackableLinkId` (apenas primeira detecção)
- [x] **Webhook `trackable_link.click`** — novo evento nos `WEBHOOK_EVENTS` + função `dispatchStandaloneEvent()` para eventos sem lead associado, fire-and-forget em cada clique com payload `{clickId, link, click}`
- [x] **Stats overview enriquecido** — `totalSales`, `totalRevenue`, `totalLeadsGenerated` agregados. 6 cards no painel (antes eram 4)
- [x] **Pixels configuráveis por link** — Meta Pixel ID + GA4 Measurement ID por link, disparam `Lead`/`generate_lead` na página intermediária

**Fase C — High value:**
- [x] **Pixel JS próprio (`/pixel/bychat.js`)** — 3.2 KB, cookie+localStorage persistente 365 dias, captura UTMs/fbclid/gclid/ctwa_clid/tintim_fbid da URL, `sendBeacon` para /api/pixel/track, API `window.bychat.{visitorId, track, trackableHref, rewriteLinks}` — auto-reescrita de `<a data-bychat-track>` adicionando `?sid=VISITOR_ID`
- [x] **PixelVisitor** — tabela com first/last attribution sticky, totalPageviews, totalEvents, device, IP, cruzamento com lead via `leadId`
- [x] **POST /api/pixel/track** — CORS wide-open, upsert de PixelVisitor, preserva primeira atribuição, atualiza última
- [x] **POST /api/pixel/identify** — vincula visitor anônimo a lead (cross-device)
- [x] **Jornada anônimo→lead** — `buildWhatsappUrl` embute `#ref:slug:sid` na mensagem. `originDetection.ts` regex aceita sessionId, extrai `pixelSessionId` e `saveLeadOrigin` marca `PixelVisitor.leadId`/`identifiedAt` automaticamente quando o lead chega via WhatsApp
- [x] **Meta Conversions API server-side** — `fireCapiLeadNoLead()` em `metaCapi.ts`, envia evento `Lead` com `fbc`, IP, UA, country hasheado. Dispara em cada clique quando o link tem `fbPixelId` + `fbCapiAccessToken` + `fbclid` na query. Persiste `capiSent=true` e `capiEventId` para dedup
- [x] **Dedup CAPI ↔ browser pixel** — mesmo `event_id` gerado no `/l/:slug` é passado para `fbq('track', 'Lead', {...}, {eventID})` E para o disparo server-side. Meta deduplica automaticamente
- [x] **Modal "Como funciona?"** — explicação leiga passo-a-passo do fluxo completo com 5 steps, destaque do Pixel, grid de 6 ferramentas e comparativo com Tintim/Bitly
- [x] **Modal "Instalar Pixel"** — snippet `<script>` pronto pra copiar, exemplos de `data-bychat-track`, documentação da API JS, explicação técnica do fluxo

**Fix correlato:**
- [x] **Origens backfilled** — webhook Meta agora preenche `originType='meta_lead_ads'` na criação. Query `/admin/origins/stats` usa `COALESCE(originType, source, 'organic')` como fallback. Backfill executado em 106 leads antigos (103 meta_lead_ads + 2 whatsapp + 1 manual). Frontend ampliado pra cobrir `web_chat`, `chat`, `api`, `import`

---

#### 13.11 — Inteligência (Enriquecimento Automático de Leads) ✅

> Coleta dados públicos sobre cada lead (com consentimento LGPD) e consolida um dossiê com score de confiança.

- [x] **Providers multi-tier** — Gravatar, BrasilAPI, ViaCEP, Phone, Hunter, GitHub, Google CSE (API oficial), Google DDG/Bing (fallback scraping), Social profiles. Execução em Tier 1 (APIs estáveis) → Tier 2 (free-tier) → Tier 3 (scraping pesado), com respeito ao cache e flag `force`
- [x] **Google Custom Search API** — Provider `googleCseProvider` configurado via `GOOGLE_CSE_KEY` + `GOOGLE_CSE_CX`. Detecta URLs de LinkedIn, Instagram, Facebook, Twitter/X, YouTube, TikTok, Lattes e GitHub a partir de nome/email/empresa, com score de confiança por plataforma
- [x] **LGPD-first** — Nenhum enriquecimento roda sem `lgpdConsent=true` no Lead. Endpoint `POST /api/bychat/leads/:id/lgpd` registra consentimento e dispara job automaticamente. Evento `lgpd_consent` logado na timeline. Direito de exclusão (art. 18) via `DELETE /api/bychat/leads/:id/enrichment/:factId`
- [x] **Score e status** — Campos `enrichmentStatus` (pending/running/done/blocked_lgpd), `enrichmentScore` e `enrichedAt` consolidados no Lead após execução
- [x] **Dossiê JSON e PDF** — `GET /api/bychat/leads/:id/dossier` retorna dados consolidados. `GET /api/bychat/leads/:id/dossier.pdf` gera PDF formatado para download
- [x] **Queue assíncrona** — BullMQ `queues.enrichment` com retry exponencial. Modo síncrono disponível via `?sync=1` para debug
- [x] **Página Inteligência** — Sidebar dedicada com lista de leads, status de enriquecimento, score, botão "Enriquecer agora", dossiê JSON/PDF e remoção individual de fatos (LGPD)

---

#### 13.8 — Marketing e Enriquecimento de Dados

> Enriquecer dados automaticamente e conectar com ferramentas de marketing.

- [x] **Google Sheets** — Export em tempo real para planilhas
  - Google Sheets API v4 (OAuth2)
  - Enviar novos leads automaticamente para uma planilha
  - Configuração de quais campos exportar
  - Trigger por evento: novo lead, mudança de etapa, venda
  - Planilha compartilhável com cliente/gestor
  - Complexidade: Baixa | Prioridade: Alta

- [ ] **CNPJ.ws / ReceitaWS** — Enriquecimento de dados de empresas BR
  - API REST pública (gratuita com limites)
  - Ao cadastrar lead com CNPJ: auto-preenche razão social, nome fantasia, porte, endereço, natureza jurídica, situação cadastral
  - Enriquece score com dados reais da empresa
  - Complexidade: Baixa | Prioridade: Alta

- [ ] **Clearbit / Apollo.io** — Enriquecimento de contatos B2B
  - REST API
  - Busca por email/domínio: cargo, LinkedIn, porte da empresa, setor, receita estimada
  - Dados enriquecem o perfil do lead automaticamente
  - Complexidade: Baixa | Prioridade: Média

- [ ] **Mailchimp / Brevo (Sendinblue)** — Email marketing
  - REST API
  - Sincronizar leads para listas de email marketing
  - Segmentação por tags, funil e etapa
  - Trigger: lead entra na etapa X → adiciona à campanha Y
  - Complexidade: Baixa-Média | Prioridade: Média

- [ ] **ActiveCampaign** — Automação de email + CRM
  - REST API
  - Sincronização de contatos e tags
  - Trigger de automações no AC a partir de eventos do ByChat
  - Popular no mercado BR
  - Complexidade: Média | Prioridade: Média

- [x] **Google Analytics 4** — Eventos de conversão server-side
  - GA4 Measurement Protocol
  - Enviar eventos: `generate_lead`, `purchase`, `sign_up`
  - Dados enriquecidos com valor, origem e campanha
  - Complementa o tracking client-side existente
  - Complexidade: Baixa | Prioridade: Média

- [x] **Facebook Pixel (client-side)** — Pixel nas landing pages
  - JS snippet dinâmico
  - Injetar Pixel ID configurável nas landing pages criadas pelo builder
  - Eventos automáticos: PageView, Lead (form submit), ViewContent
  - Complementa o CAPI server-side já implementado
  - Complexidade: Muito baixa | Prioridade: Média

---

#### 13.9 — Suporte e Helpdesk

> Escalar tickets de atendimento para suporte nível 2 em ferramentas especializadas.

- [ ] **Zendesk** — Abertura de tickets de suporte
  - REST API
  - Escalar conversa do atendimento → ticket no Zendesk
  - Sincronizar status do ticket de volta para o CRM
  - Complexidade: Média | Prioridade: Baixa

- [ ] **Freshdesk** — Alternativa ao Zendesk
  - REST API
  - Criação de tickets a partir do módulo de atendimento
  - Sincronização de status e respostas
  - Complexidade: Média | Prioridade: Baixa

---

#### 13.10 — Armazenamento e Infraestrutura

> Profissionalizar armazenamento de mídias e arquivos.

- [ ] **AWS S3 / Cloudflare R2** — Object storage para mídias
  - S3-compatible API
  - Armazenar áudios, imagens, documentos e vídeos do chat fora do servidor
  - CDN para entrega rápida de mídias
  - R2: sem custo de egress (economia significativa)
  - Migração transparente do storage local atual
  - Complexidade: Baixa-Média | Prioridade: Média

- [ ] **MinIO (self-hosted)** — Alternativa S3 auto-hospedada
  - S3-compatible API
  - Para quem quer manter dados na própria infra
  - Complexidade: Baixa | Prioridade: Baixa

---

### Fase 14 — Segurança Avançada e Infraestrutura (PRIORIDADE ALTA)

> Proteção profissional contra ataques externos. Requer ação manual do admin (configuração de DNS e serviços externos).

- [x] **Cloudflare (WAF + DDoS + CDN)** — Ativar Cloudflare no domínio `bychat.ia.br`
  - Plano Free já inclui: WAF básico, proteção DDoS L3/L4/L7, CDN global, SSL automático
  - **Passos**:
    1. Criar conta em [cloudflare.com](https://cloudflare.com)
    2. Adicionar domínio `bychat.ia.br`
    3. Apontar nameservers do registrador para os fornecidos pelo Cloudflare
    4. Configurar SSL em modo "Full (strict)"
    5. Ativar "Bot Fight Mode" nas configurações de segurança
    6. Opcional: habilitar "Under Attack Mode" em caso de ataque ativo
  - **Benefícios**: WAF com regras OWASP, mitigação DDoS automática, cache de assets estáticos, analytics de tráfego
  - Complexidade: Muito baixa (só DNS) | Prioridade: Alta
  - **Ação do admin** — não requer mudanças no código

- [ ] **Cloudflare Page Rules** — Regras customizadas para o painel admin
  - Forçar SSL em todas as rotas
  - Cache bypass para `/api/*` e `/admin`
  - Rate limiting avançado no edge (antes de chegar ao servidor)
  - Complexidade: Muito baixa | Prioridade: Média

---

### Fase 14.1 — Observabilidade (IMPLEMENTADO 2026-04-13)

> Pilar crítico pré-Multi-Tenant: error tracking, uptime, métricas e dashboards. Três pilares em stack self-hosted.

#### Stack de Observabilidade

- [x] **GlitchTip** (Sentry-compatible error tracking)
  - Imagem: `glitchtip/glitchtip:latest` + Postgres 16 + Redis 7 dedicados
  - Porta local: `127.0.0.1:8000`
  - Superuser: `admin@bychat.ia.br` / `bychatadmin2026` (trocar após 1º login)
  - 2 projetos: `backend` (Node) e `frontend` (Browser JS)
  - DSNs em `observability/.env` e `ecosystem.config.cjs`

- [x] **Uptime Kuma** (uptime + status page pública)
  - Imagem: `louislam/uptime-kuma:1`
  - Porta local: `127.0.0.1:3011`
  - Configurar via UI web após primeiro acesso

- [x] **Prometheus** (scraping de métricas)
  - Imagem: `prom/prometheus:latest`
  - Porta local: `127.0.0.1:9090`
  - Retenção: 30 dias
  - Scrape job: `bychat-beyond-backend` via `host.docker.internal:3005/api/metrics` a cada 15s

- [x] **Grafana** (dashboards)
  - Imagem: `grafana/grafana-oss:latest`
  - Porta local: `127.0.0.1:3012`
  - Datasource Prometheus provisionado automaticamente
  - Admin: `admin/change-me-after-first-login`

#### Instrumentação do Backend (Fastify)

- [x] Arquivo `backend/src/lib/observability.ts` — init Sentry + registry Prometheus
- [x] Contadores: `bychat_http_requests_total`, `bychat_http_request_duration_seconds`, `bychat_bullmq_jobs_total`, `bychat_bullmq_job_duration_seconds`, `bychat_workflow_steps_total`, `bychat_webhooks_dispatched_total` + default metrics (heap, CPU, event loop lag)
- [x] `initObservability()` chamado no topo de `server.ts`
- [x] `app.setErrorHandler` captura exceptions 5xx → GlitchTip com contexto (url, method, ip, UA)
- [x] Hook `onResponse` incrementa contadores HTTP por rota/método/status
- [x] Endpoint `GET /api/metrics` (gated por IP local ou `Bearer METRICS_TOKEN`)
- [x] Workers BullMQ (`services/workers.ts`) emitem eventos `failed` → Sentry + métricas, e `completed` → histograma de duração
- [x] Helper `captureException(err, ctx)` exposto para uso em qualquer serviço
- [x] `beforeSend` filtra ruído: rate limits, CSRF, origem bloqueada

#### Instrumentação do Frontend

- [x] SDK Sentry browser (`browser.sentry-cdn.com/8.55.0`) carregado no `<head>` de `frontend/index.html`
- [x] Init com DSN do projeto frontend apontando para `errors.bychat.ia.br`
- [x] `ignoreErrors`: rejeições de promise sem erro, ResizeObserver loops, network failures, AbortError
- [x] `beforeSend` ignora erros do heartbeat (`/api/t/heartbeat`)
- [x] `tracesSampleRate: 0.1` em produção

#### Nginx (subdomínios)

- [x] Arquivo: `/etc/nginx/sites-available/observability.bychat.ia.br`
  - `errors.bychat.ia.br`  → `127.0.0.1:8000` (GlitchTip)
  - `status.bychat.ia.br`  → `127.0.0.1:3011` (Uptime Kuma)
  - `metrics.bychat.ia.br` → `127.0.0.1:3012` (Grafana)
- [x] Symlink em `sites-enabled/` ativo, nginx recarregado
- [ ] **Pendente (ação do admin)** — criar registros DNS A para os 3 subdomínios apontando para `187.77.246.105`
- [ ] **Pendente (ação do admin)** — após DNS propagar, rodar `certbot --nginx -d errors.bychat.ia.br -d status.bychat.ia.br -d metrics.bychat.ia.br`

#### Arquivos criados

- `observability/docker-compose.yml` — stack completa
- `observability/prometheus.yml` — scrape config
- `observability/grafana-provisioning/datasources/prometheus.yml` — datasource provisionado
- `observability/.env` — secrets (PostgreSQL password, Grafana admin, DSNs)
- `observability/data/{glitchtip-postgres,glitchtip-redis,glitchtip-uploads,uptime-kuma,prometheus,grafana}` — volumes persistentes
- `backend/src/lib/observability.ts` — módulo de instrumentação

#### Próximos passos (opcional)

- Criar dashboard padrão no Grafana (tempo de resposta p95 por rota, filas BullMQ, leads por minuto)
- Configurar notificações Telegram no Uptime Kuma e GlitchTip
- Tracing distribuído com OpenTelemetry + Tempo/Jaeger (sub-fase 14.1.1)
- Logs agregados com Loki + Promtail (sub-fase 14.1.2)

---

### Fase 16.1 — Atendimento Multi-Agente Avançado (PRIORIDADE ALTA-MÉDIA)

> Continuação da Fase 16 (Equipes implementada em 2026-04-23). Funcionalidades que dependem de dados reais de produção para serem priorizadas/dimensionadas.

#### Distribuição e Roteamento Inteligente
- [x] **Round-robin / distribuição automática** — Ao entrar lead na fila do setor, atribuir automaticamente ao operador online com menor carga (configurável por setor: round-robin / menor carga / aleatório). Hoje é manual via botão "Assumir"
- [x] **Load balancing por capacidade** — Cada operador define sua capacidade máxima de atendimentos simultâneos (default: 5). Distribuição respeita capacidade
- [x] **Roteamento por landing page / form** — `Form.defaultTeamId` para que leads de uma LP específica vão direto ao setor correto (hoje formulários LP vão pra fila geral)
- [x] **Roteamento por Meta Lead Ads** — `MetaForm.defaultTeamId` análogo: leads de campanhas X → setor Y
- [ ] **Roteamento por palavra-chave / IA** — Detectar intenção da primeira mensagem ("financeiro", "cancelar assinatura", "comprar") e direcionar para setor correspondente automaticamente

#### SLA e Métricas
- [x] **SLA Engine** — Configurar tempo máximo de primeira resposta e tempo máximo de resolução por setor. Alertas visuais em tickets que ultrapassam SLA
- [x] **Escalonamento por tempo** — Lead na fila por mais de N minutos sem dono é escalado: notifica líder do setor, depois admin. Configurável por setor
- [x] **Métricas por agente** — Painel de "Performance da Equipe": leads atendidos, TMA (tempo médio de atendimento), TME (tempo médio de espera), taxa de resolução, satisfação. Filtros por período/setor
- [x] **Métricas por setor** — Volume de leads, tempo médio na fila, distribuição entre membros, leads transferidos para fora vs. recebidos
- [ ] **Ranking de operadores** — Top performers do dia/semana/mês, badges, gamificação leve para motivar

#### Operação
- [x] **Status de operador** — Disponível / Ausente / Em pausa / Offline. Roteamento automático respeita status. Auto-status ao logar/deslogar
- [x] **Horário de atendimento por setor** — Definir expediente por dia da semana, mensagem automática fora do horário, feriados configuráveis. Lead recebido fora do horário fica em fila marcada como "fora do expediente"
- [ ] **Notificação ao operador quando lead chega na fila** — In-app (badge no sidebar), push notification (PWA), opcional WhatsApp/email para o líder do setor
- [ ] **Chat interno entre agentes** — Mensagens privadas entre operadores, mention `@usuário`, anexar lead como referência ("preciso de ajuda neste lead"), grupos por setor
- [ ] **Tags por setor** — Tags com `teamId` opcional aparecem só no respectivo setor (financeiro vê tags de cobrança, comercial vê tags de qualificação)
- [ ] **Mensagens prontas (snippets) por setor** — Atalhos `/saudacao`, `/cobranca` configuráveis por setor

#### Auditoria e relatórios
- [ ] **Histórico de transferências do lead** — Aba dedicada no detalhe do lead mostrando linha do tempo das transferências entre setores/operadores (já gravado em `LeadEvent`, falta UI dedicada)
- [ ] **Relatório de transferências** — Quantos leads cada setor recebe vs. transfere, motivos mais comuns (campo `reason` já existe), gargalos
- [ ] **Auditoria de carga horária** — Tempo total que cada operador ficou online, em pausa, atendendo

#### Quality of life
- [ ] **Atribuição em massa** — Selecionar múltiplos leads no kanban/leads e atribuir todos a um setor/operador (hoje precisa ser 1 a 1)
- [ ] **Filtros avançados na listagem por equipe** — Filtrar por setor, operador específico, "sem dono há mais de X horas"
- [ ] **Visão "Manager"** — Tela específica para líder ver métricas e leads do seu setor sem entrar no atendimento
- [x] **Integração com workflows** — Action `assignToTeam` / `assignToUser` / `transferToTeam` em workflows (hoje workflows não mexem em atribuição)

#### Sales Engagement (parte do conjunto distribuído — ver Fase 9)
- [ ] **Fila de Tarefas do Operador (Today's Tasks)** — Tela "Minhas tarefas hoje" estilo Outreach/Salesloft
  - Agrega: cadências ativas (próxima ação programada), atividades agendadas, follow-ups, leads sem resposta há X dias
  - Ordenada pela Priorização Dinâmica (Fase 9 — Sales Engagement)
  - Operador trabalha a fila top-down sem precisar buscar lead a lead
  - Botão "Próxima tarefa" pula para o próximo item após concluir
  - Métricas: tarefas concluídas no dia, taxa de execução, comparativo entre operadores

---

### Fase 15 — Modularização e Permissões por Módulo (IMPLEMENTADO)

> Reestruturação completa do frontend + sistema de permissões granulares CRUD por módulo, preparando para SaaS.

#### Modularização do Frontend
- [x] **Separação em 18 módulos** — app.js de 21.363 linhas dividido em 18 arquivos independentes + core de 2.890 linhas
  - `modules/dashboard.js` — Dashboard personalizável com widget builder (1.214 linhas)
  - `modules/leads.js` — Gestão de leads, filtros, bulk ops, detalhe (1.728 linhas)
  - `modules/kanban.js` — Board drag-and-drop, permissões, funnel selector (785 linhas)
  - `modules/atendimento.js` — Conversas, tickets, chat em tempo real (919 linhas)
  - `modules/captacao.js` — Landing pages, forms, chatbots, templates (2.546 linhas)
  - `modules/marketing.js` — Meta Ads, links rastreáveis, origens, tracking (1.816 linhas)
  - `modules/vendas.js` — Vendas IA, ROI dashboard (894 linhas)
  - `modules/workflows.js` — Workflow builder, queue monitor (936 linhas)
  - `modules/whatsapp.js` — Instâncias, Cloud API, Meta Templates (1.000 linhas)
  - `modules/google.js` — Sheets, Calendar, Drive, Ads, GA4, Gmail, Tasks, Looker (1.107 linhas)
  - `modules/settings.js` — Configurações, aparência, custom fields, DNS, roadmap (2.261 linhas)
  - `modules/admin.js` — Instalações, lixeira, API keys, webhooks, export (1.081 linhas)
  - `modules/funnels.js` — Funis e etapas (311 linhas)
  - `modules/users.js` — Gestão de usuários e auditoria (272 linhas)
  - `modules/activities.js` — Atividades agendadas (570 linhas)
  - `modules/security.js` — Painel de segurança (402 linhas)
  - `modules/tags.js` — Gestão de tags (132 linhas)
  - `modules/permissions.js` — Gate de permissões no frontend (68 linhas)
- [x] **Core reduzido** — app.js mantém apenas: globals, auth, fetch interceptor, router, landing page (2.890 linhas)
- [x] **Cache bust automático** — Cada módulo carregado com `?v=Date.now()` para evitar cache
- [x] **Zero build system** — Vanilla JS com `<script>` tags, sem webpack/vite/bundler

#### Sistema de Permissões por Módulo (Backend)
- [x] **18 módulos mapeados** — Registry centralizado (`moduleRegistry.ts`) com id, nome, ícone, categoria, páginas frontend e rotas backend
- [x] **Tabela ModulePermission** — Permissões CRUD (canView/canCreate/canEdit/canDelete) por módulo e role
- [x] **Tabela UserModuleOverride** — Override por usuário (null = herdar do role, true = permitir, false = negar)
- [x] **Middleware global** — Hook `preHandler` verifica permissão do módulo em toda rota `/api/admin/*` e `/api/bychat/*`
- [x] **Cache in-memory 60s** — Permissões resolvidas com cache, invalidação ao alterar
- [x] **SUPERADMIN bypass** — SUPERADMIN tem acesso total sem verificação
- [x] **Seed automático** — 72 registros (18 módulos x 4 roles) com permissões default replicando comportamento pré-existente
- [x] **5 endpoints** — `GET /api/admin/my-permissions`, `GET/PUT /api/admin/module-permissions`, `GET/PUT /api/admin/user-module-overrides/:userId`

#### Sistema de Permissões por Módulo (Frontend)
- [x] **Carregamento de permissões** — `loadMyPermissions()` chamado no login e no reload da página
- [x] **Gate de navegação** — `checkPagePermission(page)` bloqueia acesso a páginas sem permissão no `adminNav()`
- [x] **Sidebar dinâmico** — `filterSidebarByPermissions()` esconde itens do menu baseado nas permissões do banco
- [x] **Fallback seguro** — Se permissions.js não carregar, fallback para checks hardcoded por role

#### Painel de Gerenciamento de Permissões (Frontend) — Seção "Permissões" em Configurações
- [x] **Grid por Role** — Abas VIEWER/MANAGER/ADMIN com checkboxes CRUD por módulo, agrupados por categoria
- [x] **Atalhos** — Botões "Todos", "Nenhum", "Somente leitura" para configuração rápida
- [x] **Overrides por Usuário** — Selecionar usuário → grid tri-state por módulo (Herdar/Permitir/Negar) com botões circulares coloridos
- [x] **Categorias visuais** — Módulos organizados em: Visão Geral, CRM, Automação, Captação, Marketing, Vendas, Canais, Integrações, Configurações, Administração
- [x] **Planos SaaS preparados** — Cada módulo mapeado para tier (starter/pro/enterprise), tabela TenantModuleAccess pronta para multi-tenant

---

### Fase 16 — Equipes & Atendimento Multi-Agente (IMPLEMENTADO 2026-04-23)

> Sistema completo de setores (Comercial, Financeiro, Suporte, etc.), atribuição de leads a operadores específicos, transferência entre setores e roteamento automático por chatbot. Pré-requisito para venda do sistema com mais de 1 atendente.

#### Schema e migrations
- [x] **Modelos Team e TeamMember** — Setor com nome, slug, cor, ícone, descrição, status. Membros com flag `isLeader` para gestão hierárquica
- [x] **Lead.assignedUserId / teamId / assignedAt** — Atribuição direta de leads a operadores e setores, com timestamp da última atribuição
- [x] **Chatbot.defaultTeamId** — Roteamento automático: lead criado por chatbot vai direto para o setor padrão do bot
- [x] **Migration 0006_teams_and_assignment** — Aplicada em produção (apenas adições, FKs com ON DELETE SET NULL, zero impacto em dados existentes — 109 leads legados preservados na fila geral)
- [x] **Backup pré-migration** — `/var/backups/bychat-beyond/pre_0006_teams_*.sql.gz`
- [x] **Seed inicial** — 3 setores default (Comercial 🟢 #10B981, Financeiro 🟠 #F59E0B, Suporte 🔵 #3B82F6) + todos os SUPERADMINs vinculados como líderes em cada equipe (idempotente)

#### Backend — endpoints novos (14)
- [x] **CRUD de equipes** — `GET/POST/PUT/DELETE /api/admin/teams`, `PUT /api/admin/teams/reorder`
- [x] **Listagem pública (autenticada)** — `GET /api/teams` (apenas ativas) para preencher selects no frontend
- [x] **Gestão de membros** — `GET/POST/PUT/DELETE /api/admin/teams/:id/members[/:userId]` com toggle de líder
- [x] **Equipes do operador** — `GET /api/atendimento/my-teams` para o usuário logado consultar seus setores
- [x] **Atribuição de tickets** — `POST /api/atendimento/tickets/:id/assign` (transferir para setor/operador), `/claim` (operador assume), `/release` (devolve à fila)
- [x] **Eventos de auditoria** — Toda atribuição/transferência gera `LeadEvent` tipo `operator_assigned` com `oldValue`/`newValue` formatados como `"{operador} / {setor}"` e metadata estruturada (assign/claim/release/force)

#### Backend — controle de acesso e roteamento
- [x] **Helper `lib/teamAccess.ts`** — `getUserTeamIds`, `getUserLeaderTeamIds`, `canUserAccessLead`, `buildLeadAccessWhere`. Centraliza regra: SUPERADMIN/ADMIN veem tudo, demais veem apenas leads próprios + fila dos setores que pertencem
- [x] **Service `services/teamRouting.ts`** — `resolveDefaultTeamId({chatbotId, instanceName})` deriva setor a partir de chatbot ou instância WhatsApp
- [x] **`assertTicketAccess` em endpoints sensíveis** — Mensagens, info, close, reopen, delete, claim, release agora verificam acesso (não-admin não pode mexer em lead de outro setor via URL direta)
- [x] **Filtro `scope` no GET /tickets** — Aceita `scope=mine|team|all`. Para não-admin, força `mine + team`. Retorna `assignedUser` e `team` em cada ticket. Contadores expandidos: `{ mine, teamQueue, waiting, attending, resolved }`
- [x] **Herança automática de setor** — chatbotFlow.ts (WhatsApp via chatbot) e whatsapp.ts (WhatsApp direto) herdam `defaultTeamId` automaticamente. publicApi.ts, make.ts e POST manual em leads.ts aceitam `teamId`/`assignedUserId` no body
- [x] **PUT /api/admin/chatbots aceita defaultTeamId** — Whitelist do PUT atualizada

#### Frontend — novos módulos e UI
- [x] **`modules/teams.js`** — CRUD admin de equipes (criar, editar, excluir, reordenar) com seletor de cor (12 cores), ícone, descrição. Modal de gestão de membros com adicionar/remover usuários e toggle de líder. Item "Equipes" no menu lateral (ícone de pessoas)
- [x] **`modules/atendimento.js` — abas de scope** — Linha extra de tabs "Meus | Fila do setor | Todos" acima das tabs de status, com badges de contagem (`mine`/`teamQueue`)
- [x] **`modules/atendimento.js` — badges nos cards** — Cada ticket exibe badge de setor (cor da equipe) + nome do operador dono ("👤 Nome" ou "na fila" em itálico)
- [x] **`modules/atendimento.js` — botões no header do chat** — Assumir (lead sem dono ou admin tomando), Transferir, Devolver à fila. Subtítulo do chat mostra "setor: X · operador Y"
- [x] **`modules/atendimento.js` — modal de transferência** — Seletor de setor (com pré-seleção do atual) → carrega operadores do setor selecionado + opção "sem operador (fila)" + campo de motivo opcional
- [x] **`modules/users.js` — gestão de equipes do usuário** — Botão "Equipes" no menu de actions de cada usuário abre modal com checkbox por setor + flag líder (autosave)
- [x] **`modules/captacao.js` — campo "Setor padrão" no chatbot** — Select dentro do editor de chatbot que define `defaultTeamId`. Leads gerados pelo bot vão direto para a fila do setor

#### Permissões
- [x] **Módulo `teams` em ALL_MODULES** — Adicionado em `seed-permissions.ts`. SUPERADMIN/ADMIN têm CRUD completo, MANAGER/VIEWER bloqueados (mesma regra de `users`)
- [x] **Total de permissões: 84** (21 módulos × 4 roles), 12 novas criadas via seed idempotente

#### Permissão MANAGER granular (2026-04-23)
- [x] **MANAGER com acesso a equipes** — Role `MANAGER` passa a ver e gerenciar apenas equipes das quais é líder (não enxerga usuários/permissões globais, mas assume + transfere leads dos setores que lidera). Regra `isTeamLeader()` aplicada em `assertTicketAccess`

#### Itens avançados da Fase 16.1 já entregues em 2026-04-23
- [x] **Status de operador + heartbeat** — `User.lastSeenAt` atualizado a cada 60s pelo frontend. Helper `presenceDot()` desenha bolinha verde/cinza ao lado do nome nos cards de atendimento e selects de transferência
- [x] **Horário de atendimento por setor** — `businessHours` (JSON) em Team + service `services/businessHours.ts` com `isWithinBusinessHours()`. Fora do expediente, chatbot responde com `offHoursMessage` configurável. Página `Configurações > Horário de atendimento` no frontend
- [x] **Histórico de transferências (UI)** — Aba "Transferências" no detalhe do lead lendo `LeadEvent` tipo `operator_assigned`, com linha do tempo formatada (operador → operador, setor → setor, motivo)
- [x] **Notificações ao operador** — Som (WebAudio `AudioContext`) e alerta no título da aba (`document.title`) quando novo lead entra na fila do setor do operador logado, com toggle "Sons" no header do atendimento

---

### Fase 16.2 — Evolution API v2.3.7 + LID (IMPLEMENTADO 2026-04-23)

> Upgrade da Evolution API para suportar WhatsApp Linked IDs (LID) e correção do bug onde contatos salvos no sistema enviavam mensagem mas contatos novos (privacidade LID) caíam silenciosamente.

#### Infraestrutura
- [x] **Upgrade Evolution 2.2.3 → 2.3.7** — Repositório migrado de `atendai/evolution-api` para `evoapicloud/evolution-api`. Docker compose atualizado, instância reconectada sem perda de histórico
- [x] **Monitor de versão no painel** — `Configurações > Evolution API` passa a mostrar versão em execução + versão mais recente + botão "Atualizar agora" (job em background via `services/evolutionUpgrade.ts` que faz `docker compose pull && up -d`)
- [x] **Sincronização de estado ao boot** — `syncConnectionStateFromEvolution()` roda no startup e quando SSE abre uma conexão com `lastConnectionState='unknown'`, evitando o bug "conectado dizendo off"
- [x] **Migration 0009_lead_wa_lid** — Campo `Lead.waLid` indexado. Backend armazena tanto PN (phone number) quanto LID (JID `@lid`) por lead
- [x] **Helper `toEvoNumber()`** — Ao enviar mensagem pela Evolution, preserva JID completo quando presente; usa `lead.waLid` como remoteJid quando disponível, evitando duplicação de leads por troca de LID ↔ PN
- [x] **Associação por pushName** — Quando LID não resolve para PN, o lead é localizado/atualizado por `pushName`, prevenindo criação de duplicata a cada nova conversa

---

### Fase 17 — Portal de Matrículas (IMPLEMENTADO 2026-04-24)

> Sistema completo de captação + matrícula online superior aos concorrentes (SponteNet, TotalCross, Rubeus). Cria portais públicos com domínio próprio, formulário multi-step, integração de pagamento (Asaas), upload de documentos pelo candidato, recomendação de curso por IA, chat ao vivo, funil analítico e A/B de landing page. Vincula processo seletivo, lead CRM e fluxo de WhatsApp em um ciclo único.

#### Schema e migrations
- [x] **Modelo `EnrollmentPortal`** — Portal público com `slug` único, `customDomain` opcional, branding (cores/logo/favicon), configuração de formulário multi-step em JSON (`formConfig`), configuração de pagamento (`paymentConfig` Asaas), SEO (meta, OG, Twitter, schema.org), pixels (GA4/GTM/Meta/TikTok/LinkedIn), captcha (reCAPTCHA v3 ou hCaptcha), LP sections (reaproveitando builder), quiz IA (`quizConfig`), chat ao vivo, textos/dicas do candidato, funil (`funnelCounters` JSON)
- [x] **Modelo `EnrollmentRegistration`** — Matrícula com `candidateCode` (`MAT-YY-NNNNNN`), vínculo a `EnrollmentPortal`, `SelectionProcess`, `ProcessRegistration` e `Lead`. Armazena `formData` (JSON), status, `paymentStatus` (ASAAS), `asaasPaymentId`, `sessionId` (chat ao vivo), expiração
- [x] **Modelo `EnrollmentDocument`** — Documento enviado pelo candidato (tipo, URL, mime, status `pending/approved/rejected`, reviewer, nota de revisão)
- [x] **`SelectionProcess.slug` UNIQUE** — Migration 0010 + script de backfill via Node (`scripts/backfill-process-slug.mjs`) ao invés de REGEXP_REPLACE nativo (incompatibilidade MySQL)
- [x] **`Chatbot.enrollmentPortalId`** — Migration 0012: chatbot educacional pode ser vinculado a um portal; ao concluir o fluxo, dispara link assinado de pré-matrícula via WhatsApp
- [x] **Migrations 0011 e 0012 aplicadas em produção** — Backup completo via mysqldump `--protocol=TCP -h 127.0.0.1` antes do apply

#### Backend — endpoints públicos (portal do candidato)
- [x] **`GET /p/:slug` (HTML renderizado)** — Render server-side com schema.org `EducationalOrganization` + `Course`, Open Graph, Twitter Cards, pixels injetados, LP sections, formulário multi-step. Hook `onRequest` faz rewrite quando `Host` casa com `customDomain`
- [x] **`GET /api/public/portals/:slug`** — Config pública (branding, formConfig, ofertas ativas, quiz, captcha site key)
- [x] **`POST /api/public/portals/:slug/submit`** — Submete matrícula: valida captcha (server-side), cria/atualiza Lead, cria `ProcessRegistration` + `EnrollmentRegistration`, dispara Asaas (PIX/boleto/cartão) quando `paymentConfig.enabled`, retorna `candidateCode` + link de pagamento + token assinado de acesso
- [x] **`POST /api/public/portals/:slug/track`** — Registra eventos de funil (view, step_1..N, submit, payment) agregando em `funnelCounters` (JSON) via raw SQL `JSON_SET`
- [x] **`GET /sitemap.xml` + `/robots.txt`** — Geração dinâmica por portal (com ou sem `customDomain`)
- [x] **`POST /api/public/portals/:slug/chat/session` + `/message` + `GET /messages`** — Chat ao vivo: cria Lead no CRM com `sessionId` em `formData`, mensagens são escritas como `Message` normais, operador atende pela tela de Conversas
- [x] **`POST /api/public/portals/:slug/quiz/recommend`** — Quiz IA: recebe respostas, pontua ofertas via regras configuradas em `quizConfig`, retorna top 3 cursos recomendados

#### Backend — portal do candidato autenticado
- [x] **`POST /api/candidate/login`** — Login por CPF + código (`MAT-YY-NNNNNN`), retorna JWT-style assinado HMAC-SHA256 (`CANDIDATE_SECRET`)
- [x] **`GET /api/candidate/me`** — Dashboard: matrícula, status, pagamento, próximos passos, timeline de eventos, documentos pendentes
- [x] **`POST /api/candidate/documents`** — Upload de documento (multipart), validação de mime/size, armazena em storage e registra em `EnrollmentDocument`
- [x] **`GET /api/candidate/receipt`** — PDF de comprovante (`renderReceiptHtml()` → PDF via puppeteer) com dados da matrícula, curso, valores, linha digitável PIX

#### Backend — endpoints admin (16)
- [x] **CRUD `/api/admin/enrollment-portals`** — Listar, criar, editar, excluir, duplicar, publicar/despublicar
- [x] **`GET /api/admin/enrollment-portals/:id/registrations`** — Listagem paginada de matrículas com filtros (status, pagamento, período)
- [x] **`GET /api/admin/enrollment-portals/:id/registrations/:regId`** — Detalhe completo (form, pagamento, documentos, timeline)
- [x] **`PUT /api/admin/enrollment-portals/:id/registrations/:regId/documents/:docId`** — Aprovar/rejeitar documento com nota de revisão
- [x] **`GET /api/admin/enrollment-portals/:id/registrations.csv`** — Exportação CSV com UTF-8 BOM (Excel-friendly)
- [x] **`GET /api/admin/enrollment-portals/:id/funnel`** — Analytics do funil (contadores por etapa + taxa de conversão + A/B)
- [x] **`POST /api/admin/leads/:id/enrollment-link`** — Gera link assinado (HMAC) que pré-preenche o formulário da LP com dados do lead
- [x] **`POST /api/webhooks/asaas`** — Webhook de pagamento: valida token, atualiza `paymentStatus` (ASAAS_STATUS_MAP), dispara `sendPaymentConfirmation()` ao candidato

#### Integrações e serviços
- [x] **`services/paymentAsaas.ts`** — Cliente Asaas: `createCustomer`, `createPayment` (PIX/boleto/cartão), parser de webhook, `ASAAS_STATUS_MAP` para normalizar status
- [x] **`services/enrollmentCode.ts`** — Gerador de `candidateCode` formato `MAT-26-000147` (ano + sequencial)
- [x] **`services/enrollmentNotify.ts`** — `sendEnrollmentConfirmation` (confirmação imediata com link Asaas), `sendPaymentConfirmation` (boleto/PIX pago), `sendPaymentReminder` (24h antes do vencimento)
- [x] **`services/enrollmentExpireJob.ts`** — Cron a cada 30min: `runExpireSweep()` (matrículas sem pagamento após N dias → expiradas), `runReminderSweep()` (envia lembrete 24h antes do vencimento)
- [x] **`services/enrollmentLink.ts`** — Geração e validação de token assinado (HMAC-SHA256) com TTL configurável para pré-preencher LP
- [x] **`services/captcha.ts`** — Verificação server-side de reCAPTCHA v3 (score mínimo) e hCaptcha (escolha por `captchaProvider` do portal)
- [x] **`lib/cpf.ts`** — Validação de CPF (dígitos verificadores) + normalização

#### Frontend — admin (módulo `enrollmentPortals.js`)
- [x] **Listagem de portais** — Cards com slug, status (publicado/rascunho), contadores (matrículas, conversão), badge de `customDomain`
- [x] **Modal com 6 abas** — `Básico` (slug, nome, descrição), `Formulário` (builder multi-step drag-and-drop), `Permissões` (quem pode editar), `Pagamento` (Asaas tokens + opções), `SEO` (meta/OG/pixels/schema.org), `Avançado` (customDomain, captcha, quiz, chat, expiração)
- [x] **Analytics do funil** — Modal com contadores por etapa, taxa de conversão, split A/B
- [x] **Matrículas** — Modal com lista paginada, detalhe clicável, exportar CSV, revisar documentos (aprovar/rejeitar com nota)

#### Frontend — público (`assets/enrollment-portal.js` + `assets/candidate-portal.js`)
- [x] **Runtime da LP (`enrollment-portal.js`)** — Formulário multi-step com validação (CPF, CEP auto-fill via viacep, máscaras de telefone), offering picker com filtros (modalidade, período, turno), simulador financeiro inline, quiz IA, captcha, chat ao vivo widget, pré-preenchimento por token assinado, funnel tracking transparente
- [x] **Portal do candidato (`candidate-portal.js`)** — Login CPF+código, dashboard com timeline, upload de documentos (drag-drop), botão de comprovante PDF

#### WhatsApp Enrollment Bot
- [x] **`Chatbot.enrollmentPortalId`** — Quando chatbot educacional conclui o fluxo, dispara link assinado do portal para o WhatsApp do lead (pré-preenchido com nome/CPF/telefone)
- [x] **Template "Educacional" atualizado** — `modules/captacao.js` carrega lista de portais e expõe campo "Portal de Matrículas" no editor de chatbot

#### Documentação
- [x] **`docs/CUSTOM-DOMAIN.md`** — Guia de CNAME + certbot (Let's Encrypt) para domínios próprios dos portais
- [x] **`docs/CLOUDFLARE.md`** — Setup Cloudflare complementar (WAF, DDoS, CDN)

---

### Fase 19 — Maturidade, Acessibilidade e Disciplina de Dados (IMPLEMENTADO 2026-04-25)

> Sprint focada em fechar gaps de produção identificados pelo uso real: separar Lead de Conversa, centralizar mensagens em templates+workflows, transformar telas em listas+busca, blindar deletes educacionais, modo acessível para usuários mais velhos.

#### F1 — Lead lifecycle (qualificação + conversa)
- [x] **Schema `Lead.qualifiedAt` + `qualificationSource`** (migration 0021) — Separa "lead real" de "apenas conversa". null = só conversa (whatsapp ad-hoc); preenchido = lead pra valer (form, portal, ads, manual).
- [x] **Schema `Lead.conversationOpenedAt` + `conversationClosedAt`** (migration 0022) — Estado de atendimento. Conversas em "Caixa Bruta" só viram ticket quando operador abre conscientemente (ou outbound dele).
- [x] **13 pontos de criação de Lead auditados** — cada um marca `qualifiedAt` apropriadamente (form/portal/meta_lead_ads/make/api/manual qualificam; whatsapp ad-hoc/web_chat/portal_chat NÃO).
- [x] **Endpoints `/qualify` e `/unqualify`** (manual) + `/open-conversation` e `/close-conversation`.
- [x] **Hooks**: outbound do operador → abre conversa automaticamente; inbound em conversa fechada → reabre.
- [x] **Filtros**: kanban, dashboard, stats, sales.ts e publicApi listam só `qualifiedAt: { not: null }` por padrão. Conversas mostra todos com badge 🎯 Lead / 💬 Conversa.
- [x] **Painel Conversas com 3 tabs**: 💬 Atendimento (tickets ativos) · 📥 Caixa de entrada (mensagens sem ticket) · ✓ Resolvidos. Botões "Promover a Lead" e "Iniciar atendimento" no drawer direito.
- [x] **Backfill seguro**: 115 leads marcados como qualificados (114 meta_lead_ads + 1 portal); 4 contatos pessoais (banco/amigos/CV) viraram conversas brutas — saíram do funil/dashboard.

#### F2 — Notificações via templates+workflows
- [x] **`MessageTemplate` agora consumido por `WorkflowStep`** — `workflowActions.ts` resolve `templateId` em `send_whatsapp`/`send_email`/`send_sms` e interpola variáveis com lead+triggerData.
- [x] **5 domain events de inscrição/documento**: `enrollment.submitted`, `enrollment.payment_confirmed`, `enrollment.payment_pending_reminder`, `enrollment.document_approved`, `enrollment.document_rejected`.
- [x] **Seed idempotente** (`notificationSeed.ts`) — 10 templates (5 email + 5 WhatsApp) + 5 workflows ativos pré-conectados rodam no startup.
- [x] **`enrollmentNotify.ts` reescrito** — funções deixaram de mandar HTML hardcoded e agora emitem domain events. Workflows seedados (editáveis pelo admin) cuidam do envio.
- [x] **Variáveis disponíveis em template**: `{{nome}}`, `{{empresa}}`, `{{whatsapp}}`, `{{email}}`, `{{candidateCode}}`, `{{candidateUrl}}`, `{{portalNome}}`, `{{courseName}}`, `{{paymentUrl}}`, `{{paymentAmount}}`, `{{paymentDeadline}}`, `{{docName}}`, `{{reviewNote}}`, `{{ctaMessage}}`, `{{data_hoje}}`.
- [x] **UI workflows**: dropdown "Template (recomendado)" no editor de step; novos eventos aparecem no trigger.

#### F3 — Integração SMS Comtele
- [x] **Provider `services/smsProvider.ts`** — POST `https://sms.comtele.com.br/api/v2/send`, header `auth-key`, body `{Sender, Receivers, Content}`. Normaliza número (DDI 55 removido se presente).
- [x] **Fila `wf-sms` + worker** em `lib/queues.ts` e `services/workers.ts` (8 workers no total).
- [x] **`workflowActions.send_sms`** real (não é mais placeholder).
- [x] **Settings em UI** (Configurações → SMS): API Key (auth-key), Sender padrão, botão "Enviar SMS de teste" — endpoint `POST /api/admin/sms/test`.

#### F4 — Análise de Documentos (painel acadêmico dedicado)
- [x] **Nova aba `eduDocReview`** em Educacional → Análise de Documentos.
- [x] **Backend `GET /api/admin/enrollment-documents`** — fila com filtros (status/aiSuggestion/q/sort) + KPIs (pendentes/aprovados/rejeitados).
- [x] **Drawer lateral 720px** — preview do arquivo (img inline / PDF iframe), bloco da sugestão IA com confiança e dados extraídos, contexto do candidato, textarea de motivo, botões aprovar/rejeitar/reanalisar.
- [x] **Validação**: rejeitar exige `reviewNote` (obrigatório). Notificação automática ao candidato (email + WhatsApp via workflow `enrollment.document_rejected`).
- [x] **`SelectionProcessDocumentRequirement`** (migration 0020) — override de docs por SP com flag `useCustomDocuments` e endpoint `clone-from-mode`. Painel candidato lê `effectiveDocumentRequirements` (SP override > EntryMode default).

#### F5 — Soft delete + lixeira no Educacional
- [x] **Bloqueio total**: cada DELETE em Level/Modality/Unit/Campus/Course/Offering/SelectionProcess/EntryMode conta TODAS as dependências. Se >0, retorna 409 com lista detalhada e modal de bloqueio na UI.
- [x] **Lixeira centralizada**: 8 novos `TrashEntityType` (`edu_*`) com snapshot+restore preservando vínculos (campuses em offering, doc reqs em SP/EntryMode).
- [x] **UI**: confirm diz "será movido para a Lixeira (você pode restaurar depois)"; toast "Movido para a Lixeira"; tipos novos no `TRASH_TYPE_LABELS` da página Lixeira.

#### F6 — Listas + busca em todas as telas educacionais e portal
- [x] **Helper `_eduRenderListPage`** — KPI bar + busca normalizada (NFD, case-insensitive) + tabela responsiva. Reutilizado em 9 telas: Cursos, Ofertas, Processos Seletivos, Modos de Ingresso, Níveis, Modalidades, Unidades, Locais de Oferta, Portal de Matrículas.
- [x] **CRUD completo do EntryMode** — Modos de Ingresso deixou de ser "seed read-only". Botão "+ Novo modo" + editor com code/name/icon/description/evaluationType/flags/defaultFormExtras (JSON).
- [x] **Dropdown de ações no Portal de Matrículas** (helper `_eduActionsMenu` reutilizável) com kebab "⋮" abrindo menu posicionado via `position: fixed` clamped ao viewport.
- [x] **Largura 100%** em todas as páginas admin (removido `max-width:1280` do `.admin-body`, `.intel-page`, `.appearance-container` e settings hub).

#### F7 — Configurações de Módulos
- [x] **Removida nomenclatura starter/pro/enterprise** — `defaultPlan` removido de `ModuleDefinition`.
- [x] **Lista + busca + filtros** (categoria, status) na aba Módulos.
- [x] **Educacional não cria mais nada automaticamente ao ativar** — `registerModuleSideEffect` removido. Cliente cadastra por demanda usando o CRUD; tabelas Prisma já existem via migrations.
- [x] **Type-to-confirm na desativação** — quando módulo tem dados (`usage.total > 0`), exige digitação do nome do módulo. Lista o que há cadastrado, explica consequências (dados não são apagados, mas operadores perdem acesso, portais param). Auditoria do toggle gravada em `Setting` (`module_audit.<id>.last_change`).

#### F8 — Acessibilidade (WCAG AA)
- [x] **3 níveis de tamanho de fonte**: Confortável (default), Grande (+15%), Maior (+30%).
- [x] **Botão AA no topbar** (canto superior direito) com dropdown de seleção.
- [x] **Cards em Aparência** → seção "Acessibilidade — Tamanho da fonte".
- [x] **Persistência**: localStorage (cache imediato sem flash) + Setting `a11y.size` (sincroniza entre dispositivos).
- [x] **Implementação CSS via overrides** — attribute selectors (`[style*="font-size:11px"]`) escalam fontes inline, regras específicas escalam classes-chave (`.sidebar-item`, `.sidebar-section-label`, `.admin-page-title`, etc) com `!important`. NÃO usa `zoom`/`transform: scale` (quebravam posicionamento de dropdowns).
- [x] **WCAG AA**: focus-visible (outline 2px azul) em todos interativos, contraste reforçado (cinzas tímidos #9aa0a6 → #5f6368), touch targets ≥36px (Grande) / ≥44px (Maior).

---

### Fase 18 — Modos de Ingresso + Análise Documental IA + ENEM (IMPLEMENTADO 2026-04-24)

> Evolução do Portal de Matrículas para paridade com Rubeus/CRM Educacional: processo seletivo agora tem um Modo de Ingresso que define workflow, documentos exigidos e tipo de avaliação. Documentos são pré-analisados por Claude Sonnet 4.5 com visão. Boletim do ENEM é extraído automaticamente e o candidato é classificado conforme nota de corte da oferta ou do processo.

#### F1 — Fundação: modelos de Ingresso e Documento
- [x] **Modelo `EntryMode`** (migration 0016) — Catálogo de 8 modos seed: `vestibular_online`, `vestibular_presencial`, `enem`, `transferencia`, `segunda_graduacao`, `pos_graduacao`, `extensao`, `bolsa`. Campos: `code` (unique), `name`, `icon`, `description`, `evaluationType` (`none|docs|enem|exam_online|exam_presencial`), `requiresPayment`, `requiresClassification`, `defaultFormExtras` (JSON com campos extras sugeridos ao formulário do portal).
- [x] **Modelo `DocumentType`** (migration 0016) — Catálogo master de 13 tipos (RG, CPF, Histórico Escolar, Diploma, Boletim ENEM, Comprovante de Residência, etc). Campo `aiAnalysisTemplate` define qual prompt a IA usa (null = revisão só humana).
- [x] **Modelo `EntryModeDocumentRequirement`** (migration 0016) — Junção N×N: quais documentos cada modo exige, com `required`, `ordem` e `helpText`. 28 requisitos seed.
- [x] **`SelectionProcess.entryModeId` FK + `notaCorte`** (migration 0016) — Processo seletivo agora escolhe um modo. Nota de corte geral do processo para ENEM/provas futuras.
- [x] **`CourseOffering.notaCorte`** (migration 0019) — Override opcional da nota de corte por oferta (Medicina 700, Pedagogia 450 no mesmo processo ENEM).
- [x] **Seeds idempotentes** em `services/educational.ts` + função `seedEntryModesAndDocuments()` chamada no seedDefaults.
- [x] **Backfill heurístico** (`backfillSelectionProcessEntryModes`) — Processos já cadastrados recebem modo inferido pelo nome (vestibular, ENEM, transferência, etc).
- [x] **Endpoints admin**: `GET /api/admin/educacional/entry-modes` e `GET /api/admin/educacional/document-types` (catálogo read-only via seed).
- [x] **POST/PUT Processo Seletivo** agora exige `entryModeId` e aceita `notaCorte`.
- [x] **Endpoint público** `/api/public/selection-processes/:slug` e `/api/public/portals/:slug` expõem `entryMode` com os `documentRequirements` por oferta.

#### F1 — Frontend admin
- [x] **Editor de Processo Seletivo** — dropdown "Modo de Ingresso" obrigatório, preview com descrição + tipo de avaliação + badges (taxa/classifica) + chips de documentos exigidos, campo "Nota de corte" condicional (só se `requiresClassification`).
- [x] **Editor de Oferta** — campo "Nota de corte específica desta oferta" com hint explicando o override.
- [x] **Listagem de Processos** — badge do modo com ícone; alerta ⚠ pra processos sem modo.
- [x] **Editor do Portal → aba Formulário** — botão 🎯 por campo expande painel de chips pra escolher em quais modos ele fica visível (regra `visibleWhen.entryMode`); botão ⚡ "Injetar campos do modo X" cria novo step com `defaultFormExtras` + regra já configurada; dropdown 👁 "Pré-visualizar como" esmaece os campos ocultos no modo selecionado sem alterar dados.

#### F1 — Frontend público e validação
- [x] **Portal público** — Campos com `visibleWhen.entryMode` só aparecem depois da escolha da oferta (quando o modo fica conhecido). Validação cliente ignora campos ocultos.
- [x] **Validação server-side** — `POST /api/public/portals/:slug/register` resolve o modo via oferta e percorre `formConfig`: campos `required` visíveis no modo ativo que estejam vazios retornam 400 com lista de `missingFields`. Fecha bypass de submit direto.

#### F2 — Análise documental com IA (Claude Sonnet 4.5 visão)
- [x] **`EnrollmentDocument` evoluído** (migration 0017) — `typeId` FK para `DocumentType` (nullable, compat com legado), `typeCode` (antigo `type` renomeado), `aiStatus` (`pending|processing|done|failed|skipped`), `aiSuggestion` (`approve|review|reject`), `aiConfidence` (0–1), `aiAnalysis` (JSON com dados extraídos + reasoning + tokens), `aiCostUsd`, `aiProcessedAt`.
- [x] **Fila `wf-document-review`** (`lib/queues.ts`) + worker `createDocumentReviewWorker` (concurrency 2, rate 10/min, 3 retries exponencial).
- [x] **Service `aiDocumentReview.ts`** — Modelo `claude-sonnet-4-5-20250929` com visão (imagens + PDF). 5 templates de prompt estruturado: `rg_cpf`, `academic_history`, `diploma`, `address_proof`, `enem_score`. Cada template recebe contexto do `formData` pra checar se nome/CPF/inscrição batem com o que o candidato informou. Parse robusto (limpa markdown), threshold de confiança 0.7 (abaixo disso força `review`). Proteção de tamanho: arquivos > 5MB são marcados `skipped`. Guarda `aiAnalysis` completo pra auditoria. Captura exceção no GlitchTip.
- [x] **Integração no upload do candidato** — `POST /api/candidate/documents` resolve `typeId` pelo `code` informado e, se o tipo tem `aiAnalysisTemplate`, enfileira o job.
- [x] **Endpoint admin** `POST /api/admin/enrollment-documents/:id/reanalyze` pra forçar nova análise (útil para retries manuais após ajuste de chave/prompt).

#### F2 — UI review com sugestão IA
- [x] **Detalhe da inscrição (admin)** — Cada doc mostra status humano + sugestão IA (aprovar/revisar/rejeitar) com badge de confiança, botão 🔄 Reanalisar em docs `done`/`failed`, painel expansível "Ver análise da IA" com dados extraídos formatados e reasoning. Divergências (nome/CPF não batem) destacadas em vermelho.
- [x] **Portal do candidato** — Seção de documentos vira checklist dinâmica baseada em `EntryMode.documentRequirements`: 1 linha por tipo esperado, status visível, motivo de rejeição destacado em vermelho com botão **🔄 Reenviar**. Documentos extras não listados aparecem em seção secundária. `helpText` do requirement mostrado como instrução ao candidato.

#### F3 — ENEM: extração + classificação automática
- [x] **Modelo `EnemScoreImport`** (migration 0018) — Auditoria de uploads de boletim ENEM. Armazena 5 notas (`cienciasHumanas`, `cienciasNatureza`, `linguagens`, `matematica`, `redacao`), `mediaSimples`, `mediaPonderada` (reservado), validações cruzadas com formData (`nomeBateComForm`, `inscricaoBateComForm`, `anoBateComForm`), snapshot do `cutoffScore` aplicado, `passed` (null=sem avaliar), `source` (`ai|manual`), `aiConfidence`, `rawAnalysis`, campos de override humano.
- [x] **Service `enemClassification.ts`** — `processEnemScoreFromDocument(docId)` extrai as 5 notas do `aiAnalysis`, calcula média simples, resolve cutoff (prioridade: oferta > processo > null), cria/atualiza `EnemScoreImport` (upsert por `documentId`). Se passed=true atualiza `ProcessRegistration.status='classificado'` + `classificadoEm`; se passed=false marca `'reprovado'`. Registra mudança no `ProcessRegistrationStatusLog` com reasoning.
- [x] **Disparo automático** — Quando o worker de IA conclui um doc com template `enem_score`, chama `processEnemScoreFromDocument` em sequência (não-fatal se falhar).
- [x] **Override humano** — `validateEnemImport()` permite admin corrigir as 5 notas e forçar `passed`. Marca `source='manual'`.
- [x] **Endpoint `PUT /api/admin/enem-imports/:id`** — Recebe notas + decisão de classificação + `validationNote`; recalcula média; propaga pra `ProcessRegistration` com StatusLog de "Override humano de notas ENEM".

#### F3 — UI ENEM
- [x] **Portal do candidato** — Card "📝 Nota do ENEM" com as 5 notas, média, corte, badge de aprovação/reprovação, aviso de treineiro, indicador "conferido manualmente" quando aplicável. Só aparece pra modos `enem`.
- [x] **Detalhe da inscrição (admin)** — Mesmo card + botão "✎ Editar notas" abre modal com as 5 notas editáveis + select de classificação (automático/forçar aprovado/forçar reprovado) + textarea pra `validationNote` que fica registrada no card.

#### Gaps conhecidos (fora do sprint, no roadmap futuro)
- Catálogos `EntryMode`/`DocumentType` read-only via seed (CRUD admin pendente se houver demanda de customização por cliente)
- Templates IA hardcoded (não editáveis por tenant)
- Sem fallback OpenAI no worker IA (só Anthropic)
- Sem notificação ao candidato quando doc é rejeitado ou resultado ENEM sai (portal só visível ao retornar)
- Múltiplos boletins ENEM: `ProcessRegistration.notaClassificacao` reflete o último, não "melhor dos dois"
- Storage local (não funciona com S3 sem ajuste em `loadFileBase64`)
- Adiados: F5 prova presencial, F6 prova online + LLM redação (rubrica ENEM), F7 bolsa + relatórios educacionais

---

#### Top 5 Urgente — Próximos Passos (atualizado 2026-04-12)

> Revisão 2026-06-08: dos 5 itens originais, **4 já foram entregues** (Cloudflare ativo, Jornada de Compra IA, Auditoria de Conversas IA, Observabilidade). Resta apenas **Multi-Tenant + Billing**.

| # | Item | Fase | Status |
|---|------|------|--------|
| 1 | **Cloudflare (WAF + DDoS + CDN)** | 14 | ✅ Ativo — NS `*.ns.cloudflare.com`, tráfego proxied (104.21 / 172.67) |
| 2 | **Jornada de Compra Automática por IA** | 9 | ✅ Entregue 2026-05-11 (migration 0055) |
| 3 | **Auditoria de Conversas por IA** | 9 | ✅ Entregue 2026-05-11 (migration 0054) |
| 4 | **Observabilidade (GlitchTip + Uptime Kuma + Prom/Grafana)** | 14.1 | ✅ Entregue 2026-04-13 |
| 5 | **Multi-Tenant + Billing** | 12 | ⬜ **Pendente** — único restante (Fase 15 já preparou permissões e TenantModuleAccess) |

**Contexto da revisão** — `Vendas IA` (já implementada) cobre apenas o evento terminal de venda e move para uma única etapa. A `Jornada de Compra por IA` (Fase 9) é complementar: detecta múltiplos estágios (descoberta → interesse → proposta → negociação) com prompt por etapa. As duas coexistem.

**Observabilidade (item #4)** — Substitui o Make no Top 5 (implementado em 2026-04-12). Três pilares: error tracking (GlitchTip self-hosted), uptime monitoring (Uptime Kuma), métricas + dashboards (Prometheus + Grafana). Essencial para SLA mensurável — pré-requisito para Fase 12 (Multi-Tenant + Billing). Instrumenta Fastify, Prisma, BullMQ (5 filas) e frontend.

---

*Última atualização: 2026-04-25*
*2026-04-25 — Fase 19 (Maturidade, Acessibilidade e Disciplina de Dados) implementada — separação Lead vs Conversa (qualifiedAt + conversationOpenedAt/closedAt, migrations 0021/0022, 13 pontos de criação auditados, 3 tabs em Conversas: Atendimento/Caixa Bruta/Resolvidos), notificações via templates+workflows editáveis (5 events de inscrição/doc, seed de 10 templates + 5 workflows, enrollmentNotify reescrito para emitir eventos), integração SMS Comtele (provider + worker + queue + UI settings), painel "Análise de Documentos" dedicado (drawer com preview + sugestão IA + ações), override de docs por SP (migration 0020 com clone-from-mode), soft delete educacional total (8 entidades vão pra lixeira com bloqueio por dependências), 9 telas educacionais e Portal convertidas para lista+busca via _eduRenderListPage, CRUD completo do EntryMode (Modos de Ingresso deixou de ser seed read-only), dropdown ⋮ no Portal de Matrículas, largura 100% em todas páginas admin, configurações Módulos como lista+busca sem nomenclatura starter/pro, ativação do Educacional não cria mais nada automaticamente, type-to-confirm na desativação de módulo em uso (auditoria em Setting), 3 níveis de acessibilidade (Confortável/Grande/Maior) com WCAG AA via overrides CSS (attribute selectors + classes-chave; NÃO usa zoom que quebrava dropdowns)*
*2026-04-24 — Fase 18 (Modos de Ingresso + Análise Documental IA + ENEM) implementada — EntryMode + DocumentType + EntryModeDocumentRequirement (migration 0016, 8 modos + 13 docs + 28 requisitos seed). SelectionProcess.entryModeId obrigatório no POST + backfill heurístico dos existentes. CourseOffering.notaCorte como override opcional (migration 0019) — Medicina 700 vs Pedagogia 450 no mesmo processo ENEM. Formulário do portal com regras visibleWhen.entryMode (validação client+server). Worker wf-document-review com Claude Sonnet 4.5 visão + 5 templates estruturados (rg_cpf, academic_history, diploma, address_proof, enem_score) — EnrollmentDocument ganhou aiStatus/aiSuggestion/aiConfidence/aiAnalysis (migration 0017). UI admin mostra sugestão IA + dados extraídos + reanalisar. Checklist dinâmica por EntryMode no portal do candidato com motivo de rejeição e reenvio. EnemScoreImport (migration 0018) criado auto pelo worker quando template=enem_score; média comparada com cutoff (oferta > processo) e ProcessRegistration.status atualizado pra classificado/reprovado com StatusLog. Override humano das notas via PUT /api/admin/enem-imports/:id + modal "Editar notas". 3 gaps críticos pós-sprint fechados: validação server-side do visibleWhen (bypass), cutoff por oferta, UI de override humano. ANTHROPIC_API_KEY é dependência runtime*
*2026-04-24 — Fase 17 (Portal de Matrículas) implementada — Sistema completo de captação + matrícula online com portal público por slug e customDomain, formulário multi-step com validação (CPF/CEP/mask), integração Asaas (PIX/boleto/cartão) + webhook, upload de documentos pelo candidato, revisão admin (aprovar/rejeitar com nota), recomendação por quiz IA, chat ao vivo (Lead criado no CRM), funil analítico com A/B, comprovante PDF, exportação CSV, lembrete 24h e expiração automática via cron. Captcha server-side (reCAPTCHA v3 + hCaptcha). Link assinado HMAC para pré-preencher LP a partir do lead. Migrations 0010 (slug único no SelectionProcess), 0011 (3 tabelas do portal) e 0012 (Chatbot.enrollmentPortalId) aplicadas em produção. Chatbot educacional dispara link do portal no fim do fluxo. Documentação CUSTOM-DOMAIN + CLOUDFLARE. Superior a SponteNet/TotalCross/Rubeus em: LP builder reaproveitando 27 seções, chat ao vivo real integrado ao CRM, IA embutida, pixels multi-canal, schema.org/sitemap/robots dinâmicos, custom domain por portal*
*2026-04-23 — Fase 16.2 (Evolution API 2.3.7 + LID) implementada — Upgrade do repositório `atendai` → `evoapicloud`, suporte a WhatsApp Linked IDs (JID `@lid`), `Lead.waLid` indexado (migration 0009), helper `toEvoNumber()` preserva JID no envio, associação por pushName evita duplicatas. Monitor de versão no painel com botão "Atualizar agora" via docker compose. `syncConnectionStateFromEvolution()` corrige bug "conectado dizendo off". Resolve caso do contato "Adson" (LID 273228723392569) que antes falhava no envio*
*2026-04-23 — Fase 16.1 parcial entregue — Status de operador + heartbeat (User.lastSeenAt, helper presenceDot), horário de atendimento por setor (Team.businessHours JSON + offHoursMessage), histórico de transferências com UI dedicada lendo LeadEvent, notificações (som + title alert) quando novo lead entra na fila do setor do operador logado. MANAGER granular: vê/gerencia apenas equipes das quais é líder*
*2026-04-23 — Fase 16 (Equipes & Atendimento Multi-Agente) implementada — Modelos Team/TeamMember + Lead.assignedUserId/teamId/assignedAt + Chatbot.defaultTeamId. Migration 0006 aplicada em produção (109 leads preservados). 3 setores seed (Comercial/Financeiro/Suporte). 14 endpoints novos (CRUD teams + members + my-teams + assign/claim/release). Filtro scope=mine|team|all no GET tickets. Guards assertTicketAccess. Helper teamAccess + teamRouting. Frontend: módulo teams.js (CRUD admin), abas de scope no atendimento, modal de transferência setor+operador+motivo, badges de setor/dono, gestão de equipes do usuário, campo "setor padrão" no chatbot. Permissão teams adicionada em ALL_MODULES (SUPERADMIN/ADMIN). Fase 16.1 (avançado: round-robin, SLA, métricas, status, horário, chat interno) ficou para depois de dados reais. Pré-requisito para venda do sistema com >1 atendente cumprido*
*2026-04-13 — Fase 14.1 (Observabilidade) implementada — Stack Docker com GlitchTip (error tracking Sentry-compatible), Uptime Kuma (uptime + status page), Prometheus (métricas) e Grafana (dashboards). Backend Fastify instrumentado com @sentry/node + prom-client: setErrorHandler captura 5xx, hook onResponse emite métricas HTTP, workers BullMQ com listeners failed/completed, endpoint /api/metrics. Frontend com Sentry browser SDK via CDN. Nginx com 3 subdomínios (errors/status/metrics) — pendente DNS + certbot*
*2026-04-12 — Top 10 substituído por Top 5 Urgente após auditoria: Google Calendar/Sheets/API Pública/Drive/GA4/Gmail/Tasks/Looker já implementados. Distinção entre Vendas IA (fechamento) e Jornada de Compra por IA (estágios do funil) documentada*
*2026-04-12 — Make.com oficial implementado (Fase 13.5): namespace /api/make com ping, 4 triggers (lead.created, lead.stage_changed, sale.detected, message.received), 5 actions (create/update lead, move stage, add tag, send whatsapp), 1 search (find lead). App definitions IML em installer/make-app/. Página Integrações > Make no admin. Reaproveita API Key (Fase 8.6) e OutboundWebhook (Fase 8.7)*
*Fase 7 (Rastreamento Inteligente) implementada em 2026-04-07 — Links rastreáveis, detecção de origem e vendas por IA*
*Fase 8 (Feedback para Ads + ROI) implementada em 2026-04-08 — Meta CAPI, Google Ads Offline, Atribuição Multi-Touch, Dashboard ROI, Relatórios PDF*
*Fase 6.6 (UX/UI e Experiência do Operador) implementada em 2026-04-08 — Sidebar accordion, grid de funis, filtros com Apply, filtro de etapa, anotação no card, SUPERADMIN irrestrito*
*2026-04-09 — Configurações de inatividade movidas para dentro de cada chatbot (personalização por bot)*
*2026-04-09 — Fase 8.5 (Workflow Engine + Filas) implementada — Event Bus, Workflow Engine com 6 tipos de step, 5 filas BullMQ com workers, painel de monitoramento*
*2026-04-09 — Chatbot SDR humanizado criado, prompts carregados do banco, nome do atendente puxado da Evolution API, extração automática para custom fields*
*2026-04-09 — 10 templates de chatbot pré-cadastrados (SDR, SAC, RH, Financeiro, Agendamento, Vendas, Suporte, Educacional, Saúde, Imobiliário)*
*2026-04-09 — Evolution API Monitor, perfil WhatsApp editável pelo painel, conexão QR em tempo real, proteção contra leads de teste, vínculo instância→chatbot para envio*
*2026-04-10 — Fase 13 (Integrações Nativas) planejada — 40+ integrações em 10 categorias: Calendário, Colaboração, CRMs, Pagamentos, Conectores, Telefonia, Documentos, Marketing, Suporte, Infraestrutura*
*2026-04-10 — Seletor de Kanban por funil, coluna Funil na tabela de leads, menu contextual em atividades com proteção de histórico*
*2026-04-10 — Fase 6.1 (Auditoria de Segurança) implementada — JWT forte, Redis rate limit, CSRF, sanitização, CSP/HSTS, backup cron, hardening MySQL/firewall, JWT blacklist*
*2026-04-11 — Fase 15 (Modularização + Permissões) implementada — app.js dividido em 18 módulos (21k→2.9k linhas), sistema CRUD por módulo com 72 permissões, UI de gestão, enforcement backend*
*Análise competitiva: Tintim.app — funcionalidades de rastreamento e feedback para ads incorporadas nas Fases 7 e 8*

### Fase 20 — Modernização do Frontend (Vite + Preact + Radix) — IMPLEMENTADO 2026-04-27/28

> Decisão registrada em [ADR-001](docs/adr/0001-frontend-modernization.md). Estratégia strangler: legado (`/admin`, `frontend/`) e app novo (`/app/*`, `frontend-app/`) convivem com auth e dados compartilhados. Cutover gradual feature a feature.

#### Stack
- Vite 5 + Preact 10 (alias `react → preact/compat`)
- TypeScript estrito (`exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`)
- Tailwind v4 CSS-first com tokens (`tokens.css`, `shell.css`)
- Radix UI primitives (Dialog, DropdownMenu, Popover, Tooltip, VisuallyHidden)
- TanStack Query v5 + Zustand 5
- Wouter 3 (routing client-side)
- cmdk (Cmd+K paleta) + lucide-preact (ícones)
- Lint: ESLint typed + Stylelint banindo `!important` e `px` no shell

#### Fase 0 — Fundação
- [x] Vite + Preact + TS + Tailwind + Lint + Ladle + Playwright funcionando
- [x] `/app/` servindo via `@fastify/static` + SPA fallback no backend (`server.ts`)
- [x] Token JWT compartilhado via `localStorage.bh_token`

#### Fase 1 — App Shell
- [x] Sidebar 3 modos (drawer mobile / rail laptop / expanded desktop) com Radix Dialog
- [x] Topbar com busca, dropdown de usuário (Radix), atalho ⌘K
- [x] AuthGate com `/admin/me` e fallback para `/admin` se não autenticado
- [x] CommandPalette (cmdk) com favoritos, recentes e todas as páginas
- [x] Stores Zustand (sidebar mode, user, favorites, recents) com persist
- [x] Hook `useShellLayout` reativo a resize

#### Fase 2 — Bridge (convivência com legado)
- [x] Migration registry compartilhado (`migration.config.ts` + espelho em `frontend/modules/migration-config.js`)
- [x] Botão "Novo app · BETA" na topbar do `/admin`
- [x] Item "Voltar ao app antigo" no DropdownMenu do Topbar do app novo
- [x] Sync de auth via `storage` event — logout em qualquer lado limpa o outro

#### Fase 3 — Migração inicial (11 telas)
- [x] **Dashboard / Leads / Kanban / Funis / Atividades / Tags / Formulários / Chatbots / Landing Pages / Templates / Conversas**
- [x] Placeholder enriquecida para 17 telas restantes com CTA "Abrir no app antigo"

#### Fase 20.1 — Feature parity das listagens (componentes base CRUD)
- [x] **Modal/Input/Textarea/Select/ColorPicker/ConfirmDialog/toast** — building blocks de form
- [x] **Tags** CRUD com cor, **Funis** CRUD (criar com copy stages, editar, excluir respeitando default + leads)
- [x] **Atividades** create + completar + cancelar + excluir, **Forms** toggle ativo + create/edit metadata + excluir
- [x] **Leads** com filtros (funil/score/data/tags multi-select), modal de detalhe, modal "Novo lead manual"

#### Fase 20.2 — Kanban DnD + Dashboard avançado
- [x] **`@dnd-kit`** + `useMoveLeadStage` com optimistic update e rollback
- [x] **Kanban DnD** entre stages com permission check e DragOverlay
- [x] **Dashboard** filtros (range data + funil), `LineChart` SVG zero-deps, customização de widgets visíveis (Zustand persistido)

#### Fase 20.3 — Captação avançada
- [x] **Templates** editor com canal/categoria/assunto/body + 12 variáveis dinâmicas clicáveis
- [x] **Chatbots** modal com 3 abas (Geral/Prompts IA/Inatividade) — system/extraction/analysis prompts + reengajamento
- [x] **Pages** create/edit metadata, slug, meta SEO, custom HEAD/CSS, publicar/duplicar

#### Fase 20.4 — Conversas real-time
- [x] **ConversationsPage** split-view (lista + chat) com 3 buckets (atendimento/caixa/resolvidas)
- [x] Polling 5s nas mensagens, **Composer** com Enter envia / Shift+Enter quebra linha, auto-mark-as-read, auto-scroll
- [x] Ações contextuais: Atender (raw) / Resolver (inbox) / Reabrir (resolved), MessageBubble com mídia + nota interna + ack ✓✓

#### Fase 20.5 — BI & Analytics (6 telas)
- [x] **ROI** KPIs + chart de gasto diário + tabela de campanhas
- [x] **Reports** download de PDFs (ROI + leads) com range de data
- [x] **Tracking** visitantes/sessões/pageviews + top pages + referrers + devices + visitantes recentes
- [x] **Sources** distribuição de origens + taxa de rastreio
- [x] **Trackable Links** CRUD completo com UTMs + copiar URL
- [x] **Intelligence** leaderboard hot/cold com **círculo SVG de score**

#### Fase 20.6 — Marketing & Ads
- [x] **Meta Ads** lista de integrações + status do token + formulários sincronizados
- [x] **Google Ads** contas + leads com GCLID + envio de conversões offline
- [x] **Vendas IA** dashboard + chart + top campanhas + histórico com confirmar/rejeitar

#### Fase 20.7 — Automação
- [x] **Workflows** CRUD com toggle play/pause + duplicar + modal de histórico de execuções
- [x] **Filas & Monitor** counters por status + drill-down + retry-all-failed + clean

#### Fase 20.8 — Canais
- [x] **WhatsApp** instâncias Evolution API com QR code modal + connect/disconnect/restart
- [x] **Cloud API** connections WABA + status do token + envio de teste + sync de templates HSM
- [x] Telegram/Instagram/Integrations seguem como placeholder (sem backend ainda)

#### Fase 20.9 — Settings completo (8 abas)
- [x] **Geral** settings genéricos polimórficos (boolean/textarea/number/text)
- [x] **Aparência** branding com 3 ColorPickers
- [x] **Custom Fields** CRUD com 11 tipos × 4 grupos
- [x] **Equipes** CRUD com cor
- [x] **Segurança** read-only (KPIs + IPs bloqueados + eventos)
- [x] **Webhooks** CRUD + test + lista de eventos via API
- [x] **API Keys** CRUD com **token revelado uma vez** (warning + copy)
- [x] **Módulos** toggle agrupado por categoria, required = lock

#### Fase 20.10 — Cutover gradual
- [x] Migration registry populado com 18 entries — `/admin#<feature>` redireciona para `/app/<feature>` automaticamente
- [x] Suporte a `?legacy=1` no `/admin` para edições avançadas (editor visual de blocos, OAuth, Embedded Signup, upload de logo)
- [x] Frontend legado **mantido** como fallback até parity total de:
  - Editor visual de blocos (Pages)
  - Editor de steps (Workflows)
  - Embedded Signup (Cloud API)
  - OAuth flow (Meta Ads)
  - Upload de mídia em chat (Conversations)
  - Logo upload + custom HEAD/BODY (Aparência)

#### Componentes UI base (`src/components/ui/`)
- [x] `Card/CardHeader/CardTitle`, `KpiCard`, `Button`, `Badge`, `SearchInput`, `Pagination`, `Skeleton`, `EmptyState`, `Page`
- [x] `Modal`, `Input/Textarea/Select`, `ColorPicker`, `ConfirmDialog`, `toast()`
- [x] `LineChart` SVG zero-deps

#### Hooks (`src/hooks/`)
- [x] 28 hooks tipados via TanStack Query — `useDashboard`, `useLeads`, `useKanban`, `useFunnels`, `useActivities`, `useTags`, `useForms`, `useChatbots`, `usePages`, `useTemplates`, `useChat`, `useRoi`, `useTracking`, `useOrigins`, `useTrackableLinks`, `useMeta`, `useGoogleAds`, `useSales`, `useWorkflows`, `useQueues`, `useInstances`, `useCloudApi`, `useSettings`, `useTeams`, `useCustomFields`, `useSecurity`, `useWebhooks`, `useApiKeys`, `useModules`

#### Validação
- [x] `npm run ci` passa limpo (typecheck estrito + eslint + stylelint + vite build)
- [x] Bundle: 38.89 kB CSS / 1.31 MB JS (279 kB gzip), 1957 módulos
- [x] Smoke HTTP em todas as 28 rotas do `/app/*` retornam 200

*2026-04-27/28 — Fase 20 (Modernização frontend) implementada — 25 telas migradas com MVP funcional, bridge bidirecional legado↔novo, 18 features com auto-redirect, 3 telas placeholder (Telegram/Instagram/Integrations sem backend ainda)*

---

### Fase 21 — Hardening de produção (2026-05-05)

Sessão concentrada em corrigir comportamentos divergentes da UX esperada, refatorar módulos cuja "primeira versão" estava simples demais, e fechar lacunas de feedback ↔ Meta Ads pra otimização real de campanhas.

#### Fase 21.1 — Conversas: lifecycle real das 4 tabs
- [x] **Atendimento / Caixa / Aguardando / Resolvidos com transições reais** — antes os filtros eram parciais; o claim do operador não tirava o lead da Caixa, "Aguardando" só mostrava snooze. Refatoração:
  - Endpoint `POST /atendimento/tickets/:id/claim` chama `ensureConversationOpen({ reason: 'claim' })` após o assign — clicar **Assumir** move o lead da Caixa para Atendimento na hora.
  - Filtro `raw` (Caixa) ganhou `assignedUserId: null` — leads já assumidos somem da fila pública.
  - Filtro `snoozed` (Aguardando) virou OR de `(snoozedUntil > now) OR (assignedUserId NOT NULL AND conversationOpenedAt IS NULL)` — cobre snooze + claimed-sem-abertura (atribuição manual via /assign sem claim).
  - Contadores `inbox/raw/snoozed` reescritos para bater com os filtros novos.
  - Frontend: shortLabel da aba "Aguardando" virou "Aguard." (era "Soneca"); empty states específicos por bucket; toast de sucesso no Assumir.
- [x] **Botão "Assumir" muda quando lead é assumido** — `isResolved/isRaw/isAssigned` agora priorizam `lead` (de `useTicketInfo`, sempre por leadId) sobre `ticket` (de `useTickets` filtrado por bucket). Sem isso, o botão Assumir reaparecia depois do claim porque o lead saía da lista do bucket atual e `ticket` virava `undefined`. Botão também ganha guard `!isAssigned` (não aparece se lead já tem dono) e troca pra "Assumindo…" enquanto pendente.
- [x] **Botão Resolver aparece também em Caixa** — antes só aparecia com `!isResolved && !isRaw` (precisava clicar Assumir antes pra poder Resolver). Agora aparece sempre que `!isResolved`. No backend, `closeConversation` ganhou caminho pra fechar lead que nunca teve `conversationOpenedAt` (seta open + close no mesmo instante), permitindo descartar spam direto da Caixa. Toast e tooltip mudam por contexto ("Descartar lead da Caixa" vs "Encerrar atendimento").
- [x] **Modal "Promover a Lead" pós-Assumir** — após claim com sucesso, se `ticket.qualifiedAt == null`, abre o `PromoteLeadDialog` (já existente) com seletor de funil + etapa. Se já é Lead qualificado (qualifiedAt setado), nada interrompe o operador. Modal usa estado local em `ChatPanel` (`promoteAfterClaimOpen`).

#### Fase 21.2 — Multi-instância WhatsApp: roteamento por payload
- [x] **Bug: todos os leads iam pro team da instância padrão** — `whatsapp.ts:730` e `:741` usavam `evoInstance()` que sempre retorna `process.env.EVOLUTION_INSTANCE`. Em ambiente multi-instância (Pedro Henrique entrou pelo `whats_adson` mas foi parar em Comercial em vez de Suporte), o lookup de `WhatsAppInstance.defaultTeamId` rodava sempre contra a instância padrão. Fix: novo `inboundInstance` extrai do payload (`body.instance || data.instance || data.instanceName`) e propaga a:
  - Lookup do chatbot vinculado (`prisma.whatsAppInstance.findFirst({ where: { instanceName: inboundInstance } })`)
  - `resolveDefaultTeamId({ instanceName: inboundInstance })`
  - `fetchProfilePictureUrl/${inboundInstance}` (foto via API correta da conta)
- [x] **`processChatbotMessage` aceita `instanceName`** — `chatbotFlow.ts:259` repassado a `resolveDefaultTeamId({ chatbotId, instanceName })`. Cascata fica: chatbot.defaultTeamId → instância.defaultTeamId → instância.chatbot.defaultTeamId → setting global.
- [x] **Backfill manual lead Pedro Henrique (id=194)** — `teamId=1 (Comercial) → teamId=3 (Suporte)`. Outros 5 leads históricos `source='whatsapp'` ficaram em hold (sem como inferir a instância passada — não é gravada no Lead nem no Message do passado).

#### Fase 21.3 — Relatório Meta Ads (ex-ROI): refatoração + rename
- [x] **6 bugs críticos corrigidos** (relatório que "não batia"):
  1. `createLeadFromMeta` agora usa `cd.created_time` (`@default(now())` antes fazia 134 leads importados em 05/04 ficarem todos com createdAt=05/04, distorcendo relatórios diários). Backfill via `JOIN bychat_meta_lead_logs`.
  2. Removido fallback `c.spend > 0 ? c.spend : tot.spend` — não vaza all-time pra período vazio. `totalSpend` exposto como coluna separada.
  3. Reach com `MAX` em vez de `SUM` (não-aditivo entre dias/campanhas — mesma pessoa em N dias = 1 pessoa).
  4. Filtro de leads passou a aceitar `campaignId IS NOT NULL` (era `source='meta_lead_ads'` restritivo, perdia leads via web_form/CTWA com campanha atribuída).
  5. Janela de data com timezone Brasil explícito (`parseBrazilDate('start'|'end')` → `T00:00:00-03:00` / `T23:59:59.999-03:00`). Antes a janela ficava enviesada em até 3h em cada ponta (`new Date('YYYY-MM-DD')` é UTC midnight; `T23:59:59` sem TZ depende do servidor).
  6. `bestLeads = max(realLeads, metaLeads)` removido — CPL principal usa `realLeads` (DB); `metaLeads` exposto como diagnóstico (`leadsDivergence` no summary, "+N Meta" na linha quando webhook está atrasado).
- [x] **`/dashboard` ganhou Vendas/Receita/ROAS/CPC/Conversão** — campos `sales`, `revenue`, `roas`, `cpc`, `cpv`, `conversionRate` por campanha; summary com `roas`, `avgCPL`, `avgCPC`, `conversionRate`. Daily breakdown usa Lead.createdAt (era `actions.lead` da Meta — não batia com KPI).
- [x] **`/full` aceita `dateFrom/dateTo`** — paridade com `/dashboard` (era só `days`); ambos endpoints respondem mesma janela.
- [x] **Sync Meta Insights mais robusto** — cleanup `deleteMany({ source: 'meta_api', notIn: synced })` só roda quando AO MENOS uma integração foi 100% bem-sucedida (era all-or-nothing, perdia dados se token de outra integração expirava). Paginação migrada de `fetch(url)` cru pra `metaFetch(path, token)` — token sempre presente.
- [x] **Frontend: 12 KPIs + colunas Vendas/Receita/ROAS/CPC** — cards Leads/Vendas/Receita/ROAS/Investimento/CPL/CPC/CTR/Impressões/Cliques/Alcance/Campanhas. Tabela ganhou colunas Vendas (com taxa conversão), Receita, ROAS (verde se ≥1, laranja se <1), CPC. "Meta reporta +N" quando webhook divergente.
- [x] **Renomeação completa "ROI" → "Relatório Meta Ads" no codebase** — pra liberar o nome ROI pra uma página futura sem conflito:
  - `routes/roi.ts` → `routes/metaAdsReport.ts`; export `roiRoutes` → `metaAdsReportRoutes`
  - Endpoints `/api/admin/roi/*` → `/api/admin/meta-ads-report/*`
  - PDF `/api/admin/reports/roi-pdf` → `/api/admin/reports/meta-ads-report-pdf`
  - Frontend: `useRoi.ts` → `useMetaAdsReport.ts`; `RoiPage` → `MetaAdsReportPage`; tipos `Roi*` → `MetaAdsReport*`
  - Sidebar id `roi` → `meta-ads-report`; href `/app/roi` → `/app/meta-ads-report`; legacy hash `#roi` mantido em migration.config pra compat
  - moduleRegistry: pages `roi` → `meta-ads-report`; routePrefix idem; nome do grupo "Vendas & ROI" → "Vendas & Anúncios"

#### Fase 21.4 — Páginas/módulos
- [x] **Página "Exportar Dados" removida** — só tinha botão de export CSV de leads que já existe na página de Leads. Sumiu do sidebar/router/migration. Endpoint `/bychat/leads/export/csv` mantido (LeadsPage usa).

#### Fase 21.5 — Filas & Monitor: aprimoramento completo
Antigo monitor era simples demais (5 filas, sem rastreio histórico, BullMQ remove completed). Refeito:
- [x] **Schema novo `OutboundSend`** (`bychat_outbound_sends`) — rastreio persistente de TODOS os envios outbound (whatsapp/email/sms/webhook) com timeline (created→processing→sent→delivered→read→failed), latência em ms, retentativas, externalId, error, source/sourceId. Índices em (channel,status,createdAt), (leadId,createdAt), (jobId), (status,createdAt), (source,sourceId).
- [x] **Helper `services/outboundSendTracking.ts`** com `trackedSend(meta, fn)` envolvendo a chamada de envio. Workers WhatsApp/Email/SMS/Webhook gravam em `OutboundSend` automaticamente (start/sent/failed).
- [x] **Backend `routes/queues.ts` expandido** — todas as **11 filas expostas** (era 5; SMS/enrichment/document-review/essay-correction/cadence-scheduler/priority-score estavam invisíveis). Endpoints novos: `/queues/stats?hours=24` (KPIs por canal + top erros + timeseries), `/queues/sends` (lista filtrada), `/queues/sends/:id` (detalhe), `/queues/:name/jobs/:id` (detalhe job + stack trace), `/queues/:name/jobs/:id/retry`, `DELETE /queues/:name/jobs/:id`, `/queues/:name/pause`, `/queues/:name/resume`.
- [x] **JobsPage reescrita com 4 abas:**
  1. **Visão Geral** — KPIs 24h por canal (Enviados/Falhas/Latência), top 5 erros, cards das 11 filas com pausar/retomar inline.
  2. **Envios** — filtros (canal/status/período/busca) + tabela `OutboundSend` com drawer de timeline detalhada (preview, externalId, metadata, link pro lead).
  3. **Vendas** — consolida o módulo Sales: KPIs (detectadas/confirmadas/receita/ticket médio) + lista com Confirmar/Rejeitar inline.
  4. **Jobs Avançado** — modo legado preservado (selecionar fila, jobs por status, retry-all, retry individual, delete, clean concluídos).
- [x] **Drawer de detalhe** (job ou envio) com timeline visual, payload, retorno, stack trace, ações (retry/remover).
- [x] **Auto-refresh:** filas a cada 10s, stats a cada 60s, envios a cada 15s.

#### Fase 21.6 — IA: chave do banco + modelo configurável + badge origem do tema
- [x] **Bug: gerar tema da redação com IA falhava em produção** — 3 serviços (`aiEssayTopicGenerator.ts`, `aiEssayReview.ts`, `aiDocumentReview.ts`) usavam `process.env.ANTHROPIC_API_KEY` direto. PM2 não exporta a env, e admin tinha key salva em `bychat_settings.ai.anthropic_api_key` via Configurações > APIs — era ignorada. Fix: migração pra `getAnthropicKey()` + `getAnthropicModel()` do `lib/aiKeys.ts` (cascata DB → env). Modelo também resolvido em runtime (era hardcoded). Mensagens de erro humanas: "Configure a chave Anthropic em Configurações > APIs antes de…".
- [x] **Badge de origem do tema da redação (ai/enem/manual)** — schema `EssayTopic` ganhou colunas `source` (default `manual`) e `sourceMeta` (Json com year da prova ENEM ou contexto/audience/area da geração IA). POST aceita `source` (whitelist `ai|enem|manual`) e `sourceMeta`. PUT aceita reclassificação. Frontend: componente `SourceBadge` com 3 variantes (Sparkles azul / FileText verde / Hand cinza) clicável — abre dropdown pra reclassificar. Fluxos de criação propagam origem corretamente: AiGenerateModal → `source: 'ai'` + meta com timestamp/contexto; ImportEnemModal → `source: 'enem'` + meta com year; "Novo tema" → `manual`. Backfill cirúrgico em produção: id=1 (match com catálogo INEP 2024) → `enem`; id=3 (confirmado pelo user) → `ai`.

#### Fase 21.7 — Conversões / Meta CAPI completo
Backend CAPI já existia; faltava UI, gatilhos e qualidade de match. Implementação completa em 3 fases:
- [x] **UI: nova página `/app/conversions` com 3 abas:**
  - **Configuração** — pixelId, accessToken **mascarado** (backend só retorna `hasToken: boolean`), testEventCode, botão Enviar Evento de Teste com feedback de trace_id.
  - **Mapeamento de etapas** — tabela editável por funil ativo (etapa → evento CAPI) + botão "Sugerir mapeamento padrão" (heurística: NOVO/QUALIFICADO→Lead, GANHO/VENDA→Purchase, MATRICULADO→Subscribe…).
  - **Eventos enviados** — KPIs (total/sent/failed/pending), tabela "por evento" com taxa de sucesso, lista filtrada (período/plataforma/status), drawer de detalhe com timeline + payload + erro + resposta da API.
- [x] **Hook `useConversions.ts`** com config/test/send/retry/events/stats. Constante `CAPI_EVENTS` com 10 eventos suportados (Lead, Purchase, CompleteRegistration, Subscribe, AddToCart, InitiateCheckout, Contact, StartTrial, Schedule, SubmitApplication).
- [x] **Gatilhos automáticos** (todos fire-and-forget, dedup por (leadId, eventName, status='sent')):
  - `qualifyLead()` → CAPI **Lead** (qualquer fonte: form, chatbot, manual, ads)
  - `sale.confirm` → CAPI **Purchase** com value real
  - `onChatbotComplete()` → CAPI **CompleteRegistration** + maturity/score em customData
  - `onLeadStageChanged()` (já existia) → evento mapeado
  - Click em Trackable Link (já existia) → CAPI **Lead** ad-hoc com fbclid + IP + UA
- [x] **Cron `startCapiRetryScheduler()`** (em `server.ts`) — a cada 10min reprocessa até 10 falhas/ciclo (limite 3 tentativas/evento, backoff 1s entre eventos). Skip silencioso quando CAPI não configurado.
- [x] **Match quality elevado**:
  - Advanced matching: `external_id = sha256(lead.id)` (vincula CAPI server-side com pixel browser por outro caminho que não só o eventId), `ct` (cidade hash), `zp` (CEP do customFields).
  - `fbc` reconstruído quando lead tem `ctwaClid` (Click-to-WhatsApp): formato `fb.1.<ts>.<clid>` que a Meta espera — eleva muito match quality em campanhas CTWA.
  - Value inteligente: usa `priorityScore` como fallback quando não tem `saleValue` (`value_source: 'priority_score'` na metadata pra transparência).
- [x] **Sidebar:** "Conversões" (ícone Send) em "Vendas & Anúncios", após "Relatório Meta Ads".
- [x] **Botão "Atualizar funis" na aba Mapeamento** — `useCapiConfig` tem `staleTime: 30s` + `refetchOnWindowFocus`, então funil criado em outra aba aparece automaticamente ao focar. Pra criação na mesma aba (modal SPA), botão explícito ao lado do banner explicativo dispara `refetch()` com toast de feedback ("X funil(is) · Y etapa(s) carregadas") — ícone RefreshCw que gira durante o fetch.

*2026-05-05 — Fase 21 entregue: 7 sub-fases com 30+ correções/refatorações em Conversas, Roteamento Multi-instância, Relatório Meta Ads, Filas & Monitor, IA (chave do banco) e Conversões CAPI. Nenhuma migração destrutiva — backfill cirúrgico onde os defaults da migration distorciam dados existentes.*

#### Fase 21.8 — Relatório Meta Ads: Funil + Semanal + Adsets/Ads + ROI/Perdas (Fase A — backend, 2026-05-05)
Inspirado no dashboard "Pipedrive + Meta" estilo Looker (referência em `docs/relatorio-roi.png`). Backend recebeu todos os campos novos; frontend será consumido nas Fases B/C.
- [x] **Funil por etapas do funnel selecionado** — `GET /dashboard?funnelId=N` retorna `funnel: { id, name, top, stages: [{ id, key, name, color, position, terminalKind, count, conversionFromTop, conversionFromPrev, ticketAvg, revenue, sales }] }`. `count` = leads únicos do conjunto filtrado que **passaram** pela etapa (LeadEvent `status_changed.newValue=key` em qualquer momento + leads atualmente nessa stage). Conversões em %.
- [x] **`lost`/`won` em todos os níveis** — `Lead.outcome='won'|'lost'` agora agregado em campaign/adset/ad e summary. `winRate = won / (won+lost) * 100`. Coluna "Perdas" do modelo TERRAM agora viável.
- [x] **`weekly` breakdown ISO 8601** — paralelo ao `daily`, agrupando segunda→domingo via `brazilIsoWeek()` (ano da quinta-feira da semana, regra ISO). Cada bucket: `{ weekKey, weekStart, weekEnd, leads, sales, revenue, won, lost, spend, impressions, clicks }`.
- [x] **Flat-lists `adsets[]` e `ads[]`** — para tabelas dedicadas estilo TERRAM (separadas, não só drill expansível). CPL por adset/ad é estimativa proporcional (`spend_campanha * leads_adset/leads_campanha / leads_adset`) — spend real só virá com sync por level=adset/ad em fase futura. Ordenação: leads desc, revenue desc.
- [x] **`roi` (%) distinto de ROAS** — fórmula `(revenue - spend) / spend * 100` exposta no summary e em cada campanha. ROAS (multiplicador `revenue/spend`) mantido.
- [x] **Daily com `won`/`lost`** — bucket diário ganhou os dois campos; weekly herda. Desempenho diário/semanal pode mostrar volume de fechamentos.
- [x] **Filtros adicionais** — `funnelId` no query string. Quando ausente, funnel retorna `null` e relatório se comporta como antes.
- [x] **Helper `brazilIsoWeek(dayStr)`** em `routes/metaAdsReport.ts` — produz `{ weekKey: 'YYYY-WW', weekStart, weekEnd }` com fuso Brasil + ano ISO (regra da quinta-feira). Reutilizável em outros relatórios futuros.
- [x] **Frontend types atualizados** — `useMetaAdsReport.ts` ganhou `MetaAdsReportFunnel`, `MetaAdsReportWeekly`, `MetaAdsReportAdsetFlat`, `MetaAdsReportAdFlat`. Summary inclui `totalWon`, `totalLost`, `roi`, `winRate`. Filter aceita `funnelId?: number`. Backward-compat preservada (campos novos opcionais não quebram componentes existentes).

#### Fase 21.9 — Relatório Meta Ads: Fase B (frontend, 2026-05-05)
Reescrita completa do `MetaAdsReportPage.tsx` consumindo os campos da Fase A. Layout inspirado no relatório TERRAM (Pipedrive + Meta).
- [x] **Seletor de Funil no filtro** — dropdown com funis ativos via `useFunnels()`. Quando vazio, relatório se comporta como antes; quando selecionado, ativa o bloco "Funil Detalhado" e restringe leads ao funnel.
- [x] **KPIs reordenados** — Investimento → Leads → Vendas → Faturamento → ROI → ROAS → CPL → Perdas → CPC → CTR → Impressões → Cliques → Alcance → Campanhas. ROI ganhou card próprio (% diferente do ROAS multiplicador). Perdas aparecem com win-rate como hint.
- [x] **`<FunnelDetailed>`** — barra horizontal por etapa (largura proporcional ao count em relação ao topo), com cor da Stage, contagem grande, ticket médio e receita inline; coluna direita mostra taxa de conversão em modo "% topo" ou "% etapa anterior" (toggle). Etapas terminais (`won`/`lost`) ganham cor verde/vermelha no número.
- [x] **`<DailyHeatmapTable>` + `<WeeklyHeatmapTable>`** — tabelas com células coloridas em escala de intensidade (hsla com hue por tonalidade: âmbar=invest, azul=leads, verde=vendas/receita, vermelho=perdas). Layout 2-colunas em desktop, 1-coluna em mobile. Diária renderiza linha por dia ('DD/MM'); Semanal mostra weekKey + range 'DD/MM – DD/MM'. Sticky header, scroll vertical com max-height.
- [x] **Tabs Campanhas / Conjuntos / Anúncios** — substitui drill expansível por 3 tabelas dedicadas (estilo TERRAM). Toggle no header com pill de contagem por aba.
- [x] **`<CampaignsTable>`** — colunas: Campanha, Investimento, Leads (com fallback metaLeads), Vendas (+conversão), Receita, **ROI%**, ROAS, CPL, CTR, **Perdas**. ROI verde se ≥ 0, laranja se negativo.
- [x] **`<AdsetsTable>` / `<AdsTable>`** — flat-lists com Conjunto/Anúncio + breadcrumb (campanha, e adset no caso de ads). CPL marcado como "estimativa" via title (proporcional ao share de leads na campanha — spend real por adset/ad é roadmap futuro).
- [x] **TabBtn / Pill / HeatCell** — micro-componentes locais para reaproveitamento; HeatCell encapsula format (int/brl/pct) + escala de cor + tratamento de zero.
- [x] **Banner explicativo** quando funnelId está vazio: card info "Selecione um funil para ver o funil detalhado".

- [x] **Linha "Total geral" (`<tfoot>`)** em cada tabela — modelo TERRAM. Investimento/Leads/Vendas/Receita/Perdas somados; ROI/ROAS/CPL/CTR **recalculados** sobre os totais (não média de %s, evita Simpson's paradox).

- [x] **`<TrendChart>` (SVG nativo)** — gráfico de linha + área com 6 métricas alternáveis (Investimento / Leads / Vendas / Receita / ROAS / ROI%). Eixo Y com 4 ticks formatados, eixo X com até 8 labels equidistantes, tooltip via `<title>` SVG nos pontos.
- [x] **PDF estendido** (`/api/admin/reports/meta-ads-report-pdf`) — aceita `dateFrom`/`dateTo`/`funnelId` (paridade com `/dashboard`); 12 KPIs (4×3 grid: Investimento, Leads, Vendas, Faturamento, ROI%, ROAS, CPL, Conversão, CPV, Ganhos, Perdas, Win Rate); bloco "Funil Detalhado" com barras coloridas + ticket médio + conversão por etapa quando funnelId fornecido; tabela "Top 10 Campanhas" com Investimento/Leads/Vendas/Receita/**ROI%**/**Perdas**; tabela "Performance por Origem" ganhou coluna Perdas; page-break automático.
- [x] **Botão "Exportar PDF"** no header da página — respeita filtros atuais (dateFrom/dateTo/funnelId), download via fetch + Blob, nome do arquivo com período.

#### Fase 21.10 — Relatório Meta Ads: paridade 100% (2026-05-05)
Polimentos finais — fechando os últimos itens da referência TERRAM (`docs/relatorio-roi.png`).

**Sparklines por KPI:**
- [x] **`<KpiCard>` aceita `sparkline?: number[]`** — renderiza mini SVG line+área embutido (100×22, preserveAspectRatio none). 6 KPIs principais (Investimento/Leads/Vendas/Faturamento/ROI/ROAS) recebem série diária derivada de `daily[]`. Cada um com cor própria (âmbar/azul/verde/verde/rosa/roxo) coerente com o `<TrendChart>`.

**CPL real por adset/ad:**
- [x] **Migration `0042_campaign_cost_level`** — `bychat_campaign_costs` ganhou `costKey UNIQUE`, `level` (campaign/adset/ad), `adsetId/adsetName/adId/adName` opcionais. Backfill: 207 registros existentes viraram `level='campaign'` com `costKey='campaign:CID:DATE'`. UNIQUE antigo `(campaignId, date)` removido (problemático com NULLs em adset/ad — substituído por `costKey` gerado por código).
- [x] **Helper `costKeyFor(level, campaignId, adsetId?, adId?, dateStr)`** em `routes/metaAdsReport.ts` — gera `campaign:CID:DATE | adset:CID:ASID:DATE | ad:CID:ASID:ADID:DATE`. Usado em todos os 3 upserts (manual, bulk, sync) + ad-hoc futuro.
- [x] **Sync Meta agora puxa os 3 níveis** — `fetchInsightsByLevel(actId, 'campaign'|'adset'|'ad', token)` faz request Meta API com `level=...&fields=...&time_increment=1`. 3 chamadas paginadas por ad account (vs 1 antes). Helper `upsertInsightRow(level, row)` centraliza persistência. Cleanup `notIn` agora opera sobre `costKey` (cobre os 3 níveis sem deletar custo de campanha quando só falhou adset).
- [x] **Agregador `/dashboard` consome custos reais** — busca separada `level='campaign'` (alimenta `campaigns[].spend`), `level='adset'` (alimenta `spendByAdset`), `level='ad'` (alimenta `spendByAd`). `adsetsFlat[]` e `adsFlat[]` ganham `spend`, `roas`, `roi` reais quando custo do nível existe; fallback proporcional permanece com `spendKind: 'estimated'`. Campo `spendKind: 'real' | 'estimated' | 'none'` exposto pra UI distinguir.
- [x] **UI Adsets/Ads**: nova coluna **Investimento** (com badge "est." em itálico quando proporcional, tooltip explicativo nas duas variantes); novas colunas **ROI%** e **CPL** (real); rodapé "Total geral" só soma `spend` real (totals.spend ignora estimados pra ROI/CPL agregados não inflarem).
- [x] **Endpoints manuais (POST /costs, POST /costs/bulk)** atualizados — populam `costKey` + `level='campaign'`.

*2026-05-05 — Fase 21.10 entregue: paridade 100% com a referência TERRAM. Sparklines individuais por KPI ✓. CPL/ROI/ROAS reais por adset/anúncio ✓. Cleanup do sync e migration sem perda de dados (backfill cirúrgico).*

### Fase 25 — Google Ads simplificado: login + dropdowns (IMPLEMENTADO 2026-05-06)

> Antes: operador leigo precisava colar Customer ID + Developer Token + nome da conversion action — 3 campos técnicos sem acesso fácil. Agora: token global no admin, login OAuth, e 2 dropdowns auto-preenchidos via Google Ads API.

#### Backend
- [x] **Setting global `google.ads.developer_token`** em `routes/googleAds.ts` (auto-seed vazio no boot, fieldType `password`, grupo `integrations`). Cache in-memory 60s. Invalidação automática quando admin altera via `PUT /admin/settings` (settings.ts).
- [x] **Helper `getDeveloperToken()`** + `callGoogleAdsApi(connectionId, path, init)` — unifica chamadas com OAuth + dev token. Trata 412 (token missing), 401 (oauth missing) e extrai mensagem aninhada dos errors via `extractGoogleAdsError()`.
- [x] **`GET /api/admin/google/ads/dev-token-status`** — diz se admin já configurou (UI usa pra exibir banner / desabilitar botão).
- [x] **`GET /api/admin/google/ads/list-accessible-customers?connectionId=X`** — chama `customers:listAccessibleCustomers` + 1 query GAQL por conta pra puxar `descriptiveName`, `currencyCode`, `manager`. UI mostra dropdown com nome amigável + ID formatado.
- [x] **`GET /api/admin/google/ads/list-conversion-actions?connectionId=X&customerId=Y`** — GAQL `SELECT FROM conversion_action WHERE status='ENABLED'` retornando id/name/category/type. UI mostra dropdown.
- [x] **`POST /api/admin/google/ads/config`** refatorado — não aceita mais `developerToken` no body; valida que Setting global existe (412 se não); aceita `conversionAction` como ID OU resource name `customers/X/conversionActions/Y` (regex normaliza).

#### Frontend
- [x] **`hooks/useGoogleAds.ts`** — novos hooks `useGoogleAdsDevTokenStatus`, `useListAccessibleCustomers(connectionId)`, `useListConversionActions(connectionId, customerId)`. Tipo `AccessibleCustomer` e `ConversionActionItem` exportados. `GoogleAdsConfigInput` perdeu `developerToken`.
- [x] **`GoogleAdsConfigModal` reescrito** como wizard 3 passos com `<WizardStepper>` no topo: (1) escolher conta Google, (2) escolher conta Google Ads, (3) escolher conversion action + auto-envio. Avança automaticamente ao clicar; botão "Voltar"; cards estilo radio. Loading skeletons entre etapas, `<ApiErrorBanner>` quando API falha.
- [x] **MCC desabilitado** na lista de Customers (badge "MCC" + opacity-60 + disabled) — Manager Accounts não recebem conversões diretas, evita o leigo escolher errado.
- [x] **Banner em `/app/google-ads`** quando dev token não cadastrado: card amarelo com `<KeyRound>`, descrição em pt-BR, botão "Ir para Configurações" → `/app/settings?tab=integrations`. Botão "Conectar conta Google Ads" desabilitado até token estar configurado.
- [x] **Settings > Integrações** (`IntegrationsSettings`) — nova aba (ícone Plug) com card pro Developer Token: Input password com toggle Eye/EyeOff, badge Configurado/Não configurado, link pro Google Ads API Center, botão Salvar/Descartar (dirty-aware), botão Remover (com confirm). Salva via `useUpdateSettings`.
- [x] **Deep-link `?tab=X`** em SettingsPage — `readTabFromUrl()` no init + `useEffect` mantém URL sincronizada quando usuário troca tab; suporta back/forward do navegador.

#### Fluxo do operador leigo (zero campos técnicos)
1. `/app/google` → login OAuth Google (já existe)
2. `/app/google-ads` → "Conectar conta Google Ads"
3. Passo 1: pick conta Google da lista
4. Passo 2: pick conta Google Ads (dropdown auto-fetch)
5. Passo 3: pick conversion action (dropdown auto-fetch) + toggle auto-envio
6. Conectar. Pronto.

#### Pré-requisito operacional (UMA VEZ pela admin)
Beyond solicita Developer Token em `https://ads.google.com/aw/apicenter` (logada na MCC) → aprovação Google em ~1-3 dias úteis → cadastra em Configurações > Integrações > Google Ads.

*2026-05-06 — Fase 25 entregue: 0 campos técnicos pro operador leigo. Schema mantido (developerToken column unused, sem migration). Build verde, settings auto-seedado, endpoint `/dev-token-status` registrado e respondendo 401 com token fake.*

### Fase 24 — Dedup preventivo: Categoria A (Captura) sempre cria novo lead (IMPLEMENTADO 2026-05-06)

> Antes: Form/Meta/Portal/API/Make faziam upsert silencioso por whatsapp/email — cada inscrição "sumia" no lead existente, sem rastro de re-engajamento. Agora: cada submissão é uma oportunidade nova e o sistema sinaliza pra revisão humana quando casa com lead anterior.

#### F1 — Schema + serviço (migration `0043_lead_dedup_pending_review`)
- [x] **Lead.{possibleDuplicateOfId, duplicateStatus, duplicateMatchedBy, duplicateFlaggedAt, duplicateResolvedAt}** + indexes — sem UNIQUE, duplicidade é estado válido até decisão humana.
- [x] **`flagDuplicate(newLeadId, channel)`** em `services/dedup.ts` — busca master por whatsapp (digits ≥ 8) > email; segue cadeia `possibleDuplicateOfId` pra raiz; herda `assignedUserId/teamId` quando novo está sem dono; cria 2 `LeadNote` ("Possível duplicado de #X" no novo, "Nova inscrição duplicada criada" no master); dispara 2 `LeadEvent` (`duplicate_detected`).
- [x] **`mergeLeads()` atualizado** — limpa `duplicateStatus/possibleDuplicateOfId/MatchedBy/ResolvedAt` no master após absorção; rebind de leads cujo master foi absorvido pra novo master.

#### F2 — Pontos de captura (Categoria A)
- [x] **`forms.ts`** — removido upsert por email/whatsapp; cria sempre novo + `flagDuplicate({ channel: 'forms' })`.
- [x] **`meta.ts:createLeadFromMeta`** — removido branch `if (existingLead) update + return`; cria sempre novo + `flagDuplicate({ channel: 'metaLeadAds' })`.
- [x] **`enrollmentPortals.ts` (`/register` e `/interest`)** — removidos lookups `prisma.lead.findFirst`; magic-link de continuação preserva o lead original (mesma inscrição); `flagDuplicate({ channel: 'enrollmentPortal' })` em ambos. **Portal-chat** (`/chat/start`, sessionId) NÃO mexido — é Categoria B.
- [x] **`publicApi.ts:POST /api/v1/leads`** — adicionado `flagDuplicate({ channel: 'publicApi' })` pós-create.
- [x] **`make.ts:POST /api/make/leads`** — adicionado `flagDuplicate({ channel: 'make' })` pós-create.
- [x] **Categoria B preservada** — WhatsApp/Telegram/Instagram seguem com upsert por identidade (inbox/conversação contínua).

#### F3 — Tela `/app/leads/duplicates`
- [x] **Backend**: `GET /api/bychat/leads/duplicates/groups` (agrupa por master, filtros `matchedBy|funnelId|channel`); `GET /duplicates/count` (badge); `POST /duplicates/:masterId/keep-separate` (marca `kept_separate` em todos pendentes do grupo + audit nos 2 lados).
- [x] **Hooks**: `useDuplicatesGroups`, `useDuplicatesCount`, `useKeepDuplicatesSeparate` em `useLeads.ts`.
- [x] **`LeadsDuplicatesPage`** — grupos lado a lado; cada lead com radio (definir master) + checkbox (selecionar pra merge); ações **Mesclar** (reusa `mergeLeads`) e **Manter separados**; filtros por chave de match, funil e canal; link rápido pro lead.
- [x] Sidebar item **Duplicados** com ícone `Copy` em CRM; rota explícita registrada antes de `/leads/:id` pra não cair no detail.

#### F4 — Settings `dedup.mode.<channel>` por canal
- [x] **Auto-seed em `leadsRoutes`** — 5 chaves criadas em boot: `dedup.mode.{forms|metaLeadAds|enrollmentPortal|publicApi|make}`, default `'always_new'`, grupo `dedup`, fieldType `select_dedup_mode`.
- [x] **`getDedupMode(channel)` + cache 60s** em `dedup.ts`. `flagDuplicate` checa modo: `update_existing` retorna sem flag (silencioso). Invalidação automática quando `PUT /admin/settings` mexe em `dedup.mode.*`.
- [x] **`DedupSettings` UI** em `Configurações > Duplicação` — descrição por canal, select com 2 opções (`always_new (recomendado)` | `update_existing (silencioso)`), salva em bulk com diff vs server.

#### F5 — Badge no topbar
- [x] **`<DuplicatesBadge>`** ao lado de FontSize/Locale/Theme — só aparece quando há `count > 0`; ícone `Copy` + contador no canto (cap `99+`); refetch a cada 60s; clique navega pra `/app/leads/duplicates`.

#### F6 — KPIs Inscrições vs Leads únicos
- [x] **Backend `/admin/dashboard`** — adicionado `submissions` (total de leads no período = total inscrições), `uniqueLeads` (`submissions - duplicatesPending`), `duplicatesPending`, `duplicatesKeptSeparate`.
- [x] **Widgets novos** em `WidgetCatalog`: `leads_submissions` (📥 Inscrições), `leads_unique` (👤 Leads únicos), `leads_duplicates_pending` (🔁 Duplicados pendentes). Computados em `userDashboards.ts`.
- [x] **Overview (`/app/dashboard`)** — KPIs principais ganharam **Inscrições** + **Leads únicos** (substituiu `meta_leads`); seção "Precisa de atenção" ganhou **Duplicados pendentes**.

#### Conceitos & decisões (2026-05-06)
- **Duplicado recebe tudo**: cadência/automação rodam normalmente; só nota de observação. Não pausa nada.
- **Herda dono**: lead novo herda `assignedUserId/teamId` do master quando ainda sem dono.
- **Sem auto-merge**: decisão sempre humana — `kept_separate` é ação válida, não erro.
- **WhatsApp + Form do mesmo nº coexistem** até decisão; tela `/leads/duplicates` mostra canal do match.

*2026-05-06 — Fase 24 entregue: 6 fases F1–F6, migration aplicada, 5 entry points refatorados, tela de revisão funcional, settings por canal, badge live, KPIs no Overview. Default global: `always_new` em todos os canais. Bypass por canal disponível em Configurações > Duplicação.*

### Fase 23.1 — Objeções como cidadã de primeira classe (IMPLEMENTADO 2026-05-05)

> Renomeação de "Motivos de perda" → "Objeções" (terminologia comercial) e integração transversal: gatilho de workflow, condição de step, auto-enroll de cadência de recuperação, widgets de dashboard, agregação de relatório e detecção de spike via webhook.

#### Schema (migrations 0039 + 0040)
- [x] **Index** composto `(outcome, lostReasonId, outcomeAt)` em `bychat_leads` — agregações no relatório.
- [x] **`SalesCadence.entryOnLossReasonIds`** (Json `number[]`) — cadência de recuperação configurada por objeção.

#### Backend
- [x] **Filtro** `?lostReasonId=N` ou `?lostReasonIds=1,3,5` em `GET /api/bychat/leads`; select inclui `lostReasonId` + `lostReason{id,name,color}`.
- [x] **WorkflowEngine** — `matchesTriggerConfig` aceita `reasonIds[]` (array) e `reasonId` (single) em `triggerConfig` para `lead.lost`. `lead.won` também passa a ser exposto.
- [x] **`evaluateCondition`** — novos types `lost_reason_in` e `lost_reason_not_in` (config tem `reasonIds: number[]`); `getLeadField` resolve `lead.lostReason.name`/`.id` para condições genéricas.
- [x] **Endpoint** `GET /api/admin/reports/loss-reasons?from&to&funnelId&teamId&lostReasonIds` — breakdown com `count`, `totalSaleValue`, `percentOfLost`, `percentOfClassified` + tendência semanal das top 5 objeções.
- [x] **Cadência auto-enroll** (`cadenceScheduler.ts`) — listener `lead.lost` busca cadências ativas com `entryOnLossReasonIds` contendo a objeção e cria/reativa `CadenceEnrollment` (dedup pelo unique `(cadenceId, leadId)`; reativa enrollment encerrado em re-perda).
- [x] **Widgets `userDashboards.ts`** — métricas novas `leads_loss_reasons` (donut/bar de contagem) e `leads_lost_revenue_by_reason` (soma `saleValue`).
- [x] **Spike watcher** (`services/lossReasonSpike.ts`) — cron horário compara últimas 24h vs média diária dos 30d anteriores (excluindo as últimas 24h); emite `loss_reason.spike` no eventBus se variação > threshold (setting `alerts.loss_reason_spike_pct`, default 50%); cooldown 24h por objeção; baseline mínimo de 10 ocorrências em 30d pra evitar ruído. Toggle via setting `alerts.loss_reason_spike`.
- [x] **Evento novo** `loss_reason.spike` registrado em `WEBHOOK_EVENTS` + label "Pico de objeção detectado" — gestores podem ouvir via outbound webhook ou Sheets.

#### Frontend
- [x] **WorkflowsPage** — `TRIGGER_EVENTS` ganha `lead.won` (🏆) e `lead.lost` (❌); novo `LossReasonsTriggerEditor` (chips multi-select com cores das objeções) aparece quando trigger é `lead.lost`.
- [x] **WorkflowStepsEditor** — `CONDITION_TYPES` ganha "Lead perdido por uma destas objeções" / "Lead NÃO perdido por estas objeções"; novo `LossReasonsConditionField` reusável com link "Gerenciar" para `/app/settings`.
- [x] **WidgetCatalog** — 2 metas novas em "Leads": "Objeções (Leads perdidos)" e "Receita perdida por objeção". Ambas funnel-aware.

#### Casos de uso desbloqueados
- **Cadência de recuperação automática**: lead perdido por "Sem orçamento" → enrolla em cadência trimestral de nurturing; "Concorrente" → cadência de win-back de 6 meses; "Sem fit" → não enrolla nada.
- **Workflow contextual**: ao classificar como Perdido com objeção `[2,5]`, dispara workflow que adiciona tag `nurture-bp` + cria atividade de follow-up em 90 dias.
- **Step com condição**: dentro de um workflow, ramificar tratamento "se objeção foi Concorrente, mandar e-mail de comparativo; senão, e-mail genérico".
- **Dashboard executivo**: gestor vê em uma piscada "top 3 objeções no mês" e "R$ deixados na mesa por categoria".
- **Alerta de spike**: webhook avisa o time de marketing/produto quando uma objeção sobe muito (sinal de mudança de mercado, problema de pricing, etc.).

### Fase 23 — Ganho/Perdido (Lead Outcome) (IMPLEMENTADO 2026-05-05)

> CRMs precisam de fonte da verdade explícita para "fechei essa venda" e "esse não fecha". Antes: o sistema inferia conversão por DetectedSale (IA) + nome de etapa. Agora há um campo formal `outcome` no Lead com 3 estados (em andamento / ganho / perdido). Classificar é um clique e tem efeitos colaterais consistentes.

#### Schema (migrations 0037 + 0038)
- [x] **`Lead.outcome`** (`'won'|'lost'|null`) + `outcomeAt`/`outcomeBy`/`outcomeNote`/`lostReasonId`. Aditiva: leads existentes ficam com outcome NULL.
- [x] **Modelo `LossReason`** (catálogo configurável) com 6 motivos seed (Sem orçamento / Sem fit / Concorrente / Não respondeu / Decidiu não comprar agora / Outro).
- [x] **`Stage.terminalKind`** (Fase F): flag opcional `'won'|'lost'|null` em etapa do funil. Quando preenchida, classificar lead move ele para essa etapa automaticamente.

#### Backend
- [x] **`services/leadOutcome.ts`** — orquestra `markLeadWon` / `markLeadLost` / `reopenLead`: persiste outcome, cancela activities pendentes (`status=cancelled`+`cancelReason='lead_won'/'lead_lost'`), reconcilia `DetectedSale` (Ganho com valor cria/confirma `DetectedSale`), faz auto-move se `Stage.terminalKind` definido, emite eventos.
- [x] **Endpoints** `POST /api/bychat/leads/:id/{won,lost,reopen}` + `POST /api/bychat/leads/bulk/{won,lost}` (até 500 ids por chamada). Resposta inclui `cancelledActivities`.
- [x] **Filtro `outcome`** no `GET /api/bychat/leads` (`open` | `won` | `lost` | `classified`).
- [x] **CRUD `/api/loss-reasons`** — listagem para qualquer operador autenticado, mutações adminOnly. Delete vira soft-delete se houver leads usando o motivo.
- [x] **Eventos novos no domain bus**: `lead.won`, `lead.lost`, `lead.outcome_cleared` + EVENT_TYPES correspondentes (`LEAD_WON`/`LEAD_LOST`/`LEAD_OUTCOME_CLEARED`) e adicionados ao `WEBHOOK_EVENTS` (admin pode subscrever em outbound webhooks e Sheets).
- [x] **Cadências reagem**: `cadenceScheduler` ouve `lead.won`/`lead.lost` e desenrolla todos enrollments ativos/pausados (`exitReason='won'/'lost'`). Defesa adicional em `checkExitConditions`: outcome do lead prevalece sobre `exitOnStatuses`.
- [x] **Inactivity checker** ignora leads com `outcome != null` (não cobra mais lead já fechado).
- [x] **CAPI auto-send no Ganho** (Fase G): toggle `capi.auto_send_on_lead_won` em **Configurações > Conversões**. Quando ativo, marcar Ganho dispara evento `Purchase` no CAPI com dedup pelo `ConversionEvent.eventName='Purchase'`. Mapeamento por etapa continua funcionando em paralelo.
- [x] **GET `/api/bychat/leads/:id`** retorna `lostReason` (incluído via Prisma).

#### Frontend
- [x] **LeadDetailPage** — header com botões grandes Ganho 🏆 / Perdido ❌; modais com valor (Ganho, opcional) ou motivo (Perdido, dropdown carregando `LossReason`) + observação opcional; badge de outcome visível ao lado do status; botão Reabrir quando classificado (com confirm + aviso de que cadências NÃO retomam).
- [x] **Kanban** — kebab do card ganha "Marcar como Ganho/Perdido"; **2 colunas virtuais** ao final (Ganhos/Perdidos) renderizadas em `__won__`/`__lost__` (não vinculadas a Stage real); drag para essas colunas abre modal de outcome em vez de mudar status; cards classificados ganham faixa lateral colorida + badge; coluna virtual tem botão de Reabrir por card.
- [x] **LeadsPage** — filtro novo "Resultado" (Em andamento / Ganhos / Perdidos / Classificados); bulk **Ganho** e **Perdido** na barra de seleção (modal único com valor ou motivo aplicado a todos); badge de outcome ao lado do status na coluna "Status".
- [x] **Settings → Motivos de perda** — CRUD admin completo (criar/editar/desativar/excluir, incluindo seletor de cor com 10 sugestões).
- [x] **Conversões — toggle CAPI no Ganho**: checkbox em Configuração da Meta CAPI controla `capi.auto_send_on_lead_won`.

#### Defaults (decididos no escopo)
- **Reabrir**: só limpa outcome — não retoma cadências automaticamente.
- **Ganho sem valor**: aceito (alguns negócios não rastreiam ticket).
- **Catálogo de motivos**: CRUD completo desde a Fase E + 6 seed.
- **Auto-move por terminalKind**: Fase F (separada de A) pra não acoplar.
- **CAPI no Ganho**: toggle (off por padrão) pra não duplicar com mapeamento por etapa.

### Fase 22 — Google híbrido por operador (IMPLEMENTADO 2026-05-05)

> Antes: 1 conta Google global do admin atendia tudo — reuniões, tasks e e-mails caíam na agenda do admin, não na do operador que criou. Agora cada recurso é roteado pelo dono da activity:
> - **Pessoal do operador**: Calendar, Google Tasks, Gmail → conexão própria do operador.
> - **Centralizado da empresa**: Drive (pasta "ByChat CRM") e Sheets (planilhas de log) continuam na conexão da empresa.
> - **Fallback**: operador sem Google conectado cai automaticamente na conexão da empresa.

#### Schema (migration 0035 + 0036)
- [x] **`GoogleConnection.kind`** (default `OPERATOR`) + **`userId`** (FK opcional, unique). Backfill: tudo que existia vira `COMPANY`.
- [x] **FK física Drive/Tasks/Gmail → GoogleConnection** (lacuna histórica do schema; necessário pro `include: { connection }` do roteamento).

#### Backend
- [x] **`lib/googleConnections.ts`** — resolver `resolveOperatorConnection(userId)` com fallback empresa + `resolveCompanyConnection()`.
- [x] **`routes/integrationsGoogle.ts`** — endpoints user-level: `GET /api/integrations/google/me`, `GET /api/integrations/google/auth-url` (state=`user:<id>`), `POST /api/integrations/google/disconnect` (desativa também Calendar/Tasks/Gmail integrations do operador).
- [x] **OAuth callback unificado** — `/api/admin/google/callback` agora inspeciona `state`: se `user:<id>`, marca `kind=OPERATOR` + `userId` e auto-provisiona Calendar (primary, Meet automático), Tasks (`@default`) e Gmail (sender = nome do user); senão, `kind=COMPANY`.
- [x] **`syncActivityToCalendar` refatorado** — escolhe integração pelo `activity.userId`; se operador não tem conexão Google, usa as `kind=COMPANY` (sem duplicar evento). Persiste `googleCalendarConnectionId` em metadata pra unsync correto.
- [x] **`syncActivityToGoogleTasks` refatorado** — mesmo roteamento por operador → fallback empresa.
- [x] **Gmail send refatorado** — `POST /api/admin/google/gmail/send` prefere `GmailConfig` do operador autenticado; cai na config da empresa quando ausente. From/Reply-To herdam o e-mail real da conexão usada.

#### Frontend
- [x] **Tab "Minha conta Google" em `/app/settings`** — operador vê status da conexão, botão Conectar/Desconectar, explicação de o que muda (Calendar/Tasks/Gmail vão pro Google dele) e o que continua na empresa (Drive/Sheets); destaca conta da empresa como fallback. Componente novo `GoogleAccountSettings.tsx` + hooks `useMyGoogleStatus / useMyGoogleAuthUrl / useDisconnectMyGoogle`.
- [x] **Admin GoogleSuitePage com seções separadas** — "Conexão da empresa" (Drive/Sheets/fallback) acima, "Conexões dos operadores" abaixo (read-only para o admin, com nota apontando pra Configurações > Minha conta Google).

#### Comportamento (defaults adotados)
- **Workspace ou Gmail pessoal**: ambos suportados via OAuth padrão (sem Domain-Wide Delegation).
- **Drive/Sheets**: centralizado na empresa (sem mudança).
- **Transfer de lead**: futuras activities seguem o operador atual; eventos passados ficam no Google de quem criou (audit trail). Sem cancelamento automático.
- **Operador sem Google**: fallback silencioso na empresa — não bloqueia a ação.

### Fase F1 — Checkout Transparente: Fundação (IMPLEMENTADO 2026-05-11)

> Toggle por portal entre PaymentLink (redirect) e Checkout Transparente (PIX/boleto/cartão no portal). Fundação para as fases 2-7.

#### Schema (migration 0056)
- [x] **EnrollmentPortal.paymentMode** (`link` | `transparent`, default `link`) — toggle por portal.
- [x] **PaymentProviderConnection.publicKey** — Text criptografada (Pagar.me `pk_…`), opcional. Libera tokenização de cartão no frontend (PCI SAQ A) na fase 5.
- [x] **EnrollmentPaymentMethod** — 1 linha por método ativo (PIX/boleto/cartão), permite candidato trocar de método sem perder histórico. Campos por método: qrCode/qrCodeUrl (PIX), boletoLine/boletoPdfUrl (boleto), cardLastDigits/cardBrand (cartão, sem PAN).

#### Backend
- [x] **paymentProviders.ts** — POST/PUT aceita `publicKey` (encryptToken simétrico ao apiKey), summarize expõe `publicKeyMasked` + `hasPublicKey`. Helper `getConnectionPublicKey(connectionId)` exportado.
- [x] **enrollmentPortals.ts** — POST/PUT aceita `paymentMode`, default `link`, valida `'transparent' | 'link'`.

#### Frontend
- [x] **PaymentsPage** — campo `publicKey` (password, só Pagar.me), com hint explicando PCI/cartão.
- [x] **PortalConfigTab** — select "Modo de cobrança" abaixo do prazo, com hints diferenciando os dois modos.
- [x] **hooks** — `PaymentConnection.publicKeyMasked`/`hasPublicKey`, `PaymentMode` type, `EnrollmentPortal.paymentMode`.


### Fase F2 — Checkout Transparente: Backend + PIX/Boleto (IMPLEMENTADO 2026-05-11)

> Endpoints públicos do checkout transparente, com ramificação por paymentMode no POST /register e PIX/boleto/cartão simétricos para Pagar.me + Asaas.

#### Backend
- [x] **paymentPagarme.ts → createPagarmeOrder** — `POST /core/v5/orders` para PIX/boleto/cartão. Extrai qr_code, qr_code_url, line, barcode, pdf, last_four_digits. Trata charge.status=failed com gateway_response.errors (era retornar OK silencioso).
- [x] **paymentAsaas.ts → createAsaasOrder** + **fetchAsaasPixQr** — `POST /payments` direto (não usar checkout do Asaas) + GET /payments/:id/pixQrCode pra PIX. Shape unificado com Pagar.me.
- [x] **POST /api/public/portals/:slug/register** — ramifica por `portal.paymentMode`: 'link' cria cobrança aqui (fluxo atual), 'transparent' só marca pending e retorna `paymentMode` na resposta. Token candidateToken já existente serve de auth.
- [x] **POST /api/public/registrations/:code/payment-init** — body `{ method, cardToken? }`, auth Bearer candidateToken. Cria order no provedor, persiste EnrollmentPaymentMethod, atualiza EnrollmentRegistration.paymentStatus.
- [x] **GET /api/public/registrations/:code/payment-status** — auth Bearer, retorna { paymentStatus, methods[] } pra polling.
- [x] **Webhooks Pagar.me + Asaas atualizam EnrollmentPaymentMethod** — updateMany pelo externalId, ignora silenciosamente quando não há row (modo link antigo).
- [x] **Items[].code obrigatório pra Pagar.me boleto** (descoberto via teste live: error 412 The item Code is required).

#### Validação live (Pagar.me production)
- PIX gerou QR copy-paste + URL imagem + expira em 48h ✓
- Boleto: gateway recusou (issue de CPF/antifraude, não do código). Erro real propagado pro caller via 502.


### Fase F3 — Checkout Transparente: PIX no portal candidato (IMPLEMENTADO 2026-05-11)

> Checkout PIX 100% dentro do /candidato/:code, com QR + copy-paste + polling 5s; boleto e cartão renderizados (boleto idem PIX; cartão depende de Fase 5).

#### Backend
- [x] **/api/candidate/me** retorna `portal.paymentMode` + `portal.paymentConnection.{provider,hasPublicKey}` (sanitizado — não vaza publicKey criptografada) + `paymentMethods[]`.

#### Frontend (candidate-portal.js)
- [x] **renderPaymentSection(d)** — ramifica por paymentPaidAt / paymentMode='link' (legacy) / paymentMode='transparent' (novo).
- [x] **Tabs PIX/Boleto/Cartão** — aba Cartão desabilitada quando `hasPublicKey=false` com tooltip explicando.
- [x] **PIX**: botão "Gerar QR PIX" → POST /payment-init → imagem QR (qr_code_url) + input copy-paste do qr_code + countdown até expiresAt.
- [x] **Boleto**: botão "Gerar boleto" → POST /payment-init → linha digitável (copy) + PDF download.
- [x] **Polling 5s** do GET /payment-status enquanto pending; reload do dashboard inteiro quando vira paid (atualiza timeline + badges).
- [x] **Switch entre métodos** mantém histórico — usa último método pending da aba ou oferece geração se ainda não tem.


### Fase F4+F5 — Cartão tokenizado + Boleto polish (IMPLEMENTADO 2026-05-11)

> F4 (boleto) já fechada na F3. F5 traz cartão de crédito 100% PCI SAQ A — PAN tokenizado direto no navegador pela API do Pagar.me, sem passar pelo nosso servidor.

#### Backend
- [x] **GET /api/public/registrations/:code/payment-public-key** — auth Bearer candidateToken, retorna { provider, publicKey } com a pk descriptografada (Pagar.me); Asaas retorna null no campo.

#### Frontend (candidate-portal.js)
- [x] **Aba cartão**: form com 4 campos (número/validade/CVV/nome) + máscaras.
- [x] **Tokenização browser-side**: POST direto pra `api.pagar.me/core/v5/tokens?appId=<pk>` com fetch. PAN nunca toca no nosso backend.
- [x] **Fluxo completo**: busca pk → tokeniza → POST /payment-init com cardToken → poll status. Estados visuais: idle / tokenizando / cobrando / processando / aprovado / recusado.
- [x] **Erros de cartão recusado** mostram a mensagem real do gateway (já tratada na F2 via charge.status='failed').
- [x] **Aba Cartão desabilitada** pra Asaas (sem chave pública separada) e pra Pagar.me sem publicKey (tooltip explica).

#### Como ativar
1. Em /app/payments, editar a conexão Pagar.me e colar a **Public Key** (`pk_…` — Pagar.me → Configurações → Chaves de API → copiar a chave pública).
2. Salvar. `hasPublicKey` vira true e a aba Cartão aparece habilitada no portal candidato.


### Fase F6+F7 — Checkout inline + polimento (IMPLEMENTADO 2026-05-11)

> Pós-submit do portal de inscrição vai direto pra tela de checkout no portal do candidato (auto-login). Expiração de método tratada no UX. Admin vê histórico de cobranças por inscrição.

#### F6 — Frontend público (enrollment-portal.js)
- [x] **Auto-login pós-submit**: quando paymentMode='transparent', renderSuccess salva candidateToken em sessionStorage (mesma TOKEN_KEY do candidate-portal.js) e redireciona pra /candidato/:code. Candidato cai direto no checkout sem nova autenticação.
- [x] **Fluxo ENEM**: na phase=done, mesma lógica de auto-login; CTA muda pra 'Ir para pagamento da taxa →' quando transparente.

#### F7 — Polimento
- [x] **isMethodAlive(m)** helper checa expiresAt > now além do status='pending'. Métodos expirados disparam UI de retry com mensagem clara.
- [x] **Painel admin** (EnrollmentRegistrationDetailPage): novo bloco 'Cobranças (N)' lista EnrollmentPaymentMethod com badge de status (paid/pending/failed/expired), valor, externalId, último erro, link pra PDF do boleto. Útil pra debug/suporte.
- [x] **Backend admin** (/api/admin/enrollment-registrations/:id) inclui paymentMethods no detalhe.
- [x] Tipo EnrollmentPaymentMethodAdmin em useEnrollmentPortals.ts.

#### Checkout transparente — fechado 🎉
7 fases entregues; fluxo end-to-end PIX/boleto/cartão funcionando para Pagar.me + Asaas (cartão Asaas não suportado em transparente).


### Fix — Webhook não configurado + recovery sync (2026-05-12)

> Inscrição #6 pagou mas o sistema não refletiu porque o webhook do Pagar.me nunca foi cadastrado no painel deles. Sincronização manual feita; novo endpoint admin de sync forçado pra evitar repetição.

#### Sincronização manual da inscrição #6
- registration.paymentStatus = 'paid' + paymentPaidAt + status = 'paid' + paymentMethod = 'PIX'
- EnrollmentPaymentMethod criado com externalId=ch_G4YVwyphqMckgpJD, status='paid'
- portal.conversions incrementado

#### Novo endpoint admin (recovery)
**POST /api/admin/payment-providers/:id/sync-charge** body { externalId }
- Funciona com ch_* (charges Pagar.me), or_* (orders Pagar.me) e payment IDs do Asaas
- Busca status atual no provider, normaliza, atualiza EnrollmentRegistration + EnrollmentPaymentMethod + counter
- Dispara logEvent('payment_received') + sendPaymentConfirmation só na transição pending→paid (idempotente)
- Linka pela externalReference 'enrollment-<id>' ou fallback pelo paymentId

#### Webhook NÃO configurado no Pagar.me
URL que precisa ser cadastrada no painel do Pagar.me → Configurações → Webhooks:
`https://bychat.ia.br/api/public/payment-webhook/pagarme/ccf125027ff7889071f724611dd6d598e2b0049e1269e39b`

Eventos a marcar: charge.paid, charge.payment_failed, order.paid, charge.refunded, charge.canceled.


### Sync automático + manual de pagamentos (IMPLEMENTADO 2026-05-12)

> Garantia de sincronização mesmo quando webhook do Pagar.me/Asaas não chegou: cron a cada 60s + botão admin 'Sincronizar agora'.

#### services/paymentSync.ts (novo)
- [x] **syncChargeFromProvider(conn, externalId)** — função core idempotente reutilizada por todos os caminhos. Faz GET na API do provider, normaliza status, atualiza EnrollmentRegistration + EnrollmentPaymentMethod + counter, dispara logEvent + sendPaymentConfirmation só na transição pending→paid.
- [x] **startPaymentReconciliationScheduler()** — cron interval 60s, batch 30 methods, throttle 1s entre requests, janela 48h. Só loga quando há transição ou erro.

#### Endpoints admin
- POST /api/admin/payment-providers/:id/sync-charge body { externalId } — sync de cobrança específica
- **POST /api/admin/enrollment-registrations/:id/sync-payment** (novo) — alto-nível: descobre conexão + métodos pending automaticamente, tenta todos até achar transição pra paid.

#### Frontend admin
- [x] **useSyncRegistrationPayment(registrationId)** hook
- [x] **Botão 'Sincronizar agora'** no PaymentMethodsBlock, aparece só quando há pending; spinner + toast com resultado (paid / mantido / erro)
- [x] Card de cobranças aparece mesmo sem methods (modo link) com link pro paymentUrl direto.

#### Camadas de defesa (defesa em profundidade)
1. **Webhook do provider** — fonte primária (instant)
2. **Polling do candidato** no /candidato/:code — 5s enquanto a tela está aberta
3. **Cron de reconciliação** — 60s no backend, varre methods pending das últimas 48h
4. **Botão admin** — recovery manual on-demand

Mesmo se webhook nunca for cadastrado, o cron captura em até 60s. Mesmo se o candidato fecha o portal, o cron continua sincronizando.


### Fase G — Painel gerencial de pagamentos (IMPLEMENTADO 2026-05-12)

> Tela /app/payments expandida com 5 abas. Visão completa: KPIs, cobranças, conexões, webhooks, cupons.

#### Schema (migration 0057)
- [x] **PaymentWebhookHit** — audit de cada POST recebido nos webhooks (provider, eventType, externalId, payload JSON, status, errorMessage, IP, UA, receivedAt).
- [x] **Coupon** — code unique, type (percent|fixed), value Decimal, minAmount/maxDiscount, usageLimit/usageCount/perUserLimit, portalIds scope, validFrom/Until, active.
- [x] **CouponRedemption** — snapshot do uso (amountBefore/discountValue/amountAfter + couponSnapshot JSON imutável).

#### Backend
- [x] **paymentSync.ts.recordWebhookHit/updateWebhookHit** — webhooks Pagar.me + Asaas persistem cada hit antes de processar + atualizam status final.
- [x] **routes/paymentsDashboard.ts** — 6 endpoints:
  - GET /api/admin/payments/overview — KPIs (revenue, growth, conversion, ticket médio)
  - GET /api/admin/payments/methods — lista paginada com filtros
  - GET /api/admin/payments/timeseries — série diária paid/pending/failed
  - GET /api/admin/payments/breakdown — por método/provider/portal
  - GET /api/admin/payments/webhook-hits — auditoria com counts por status
  - GET /api/admin/payments/webhook-hits/:id — detalhe (com payload)
- [x] **routes/coupons.ts** — CRUD admin + GET /api/public/coupons/validate (calcula desconto sem aplicar).

#### Frontend (/app/payments)
- [x] **5 abas** no topo: Visão Geral, Cobranças, Conexões (sub-tabs Asaas/Pagar.me), Webhooks, Cupons.
- [x] **Visão Geral**: 4 KPIs (receita+growth, a receber, conversão, ticket médio); breakdown por status com barras; breakdown por método; gráfico timeseries paid/pending/failed stacked por dia; top portais; contador de webhooks.
- [x] **Cobranças**: filtros (busca, status, método, provedor, período); tabela com inscrição/lead/método/valor/status/criado; botão sync por linha (chama /sync-payment); link pra detalhe da inscrição + boleto PDF.
- [x] **Webhooks**: filtros (período, provedor, status); tabela com timestamps relativos; counts agregados por status; modal de detalhe com payload JSON completo + erro.
- [x] **Cupons**: CRUD com modal de edição (código, descrição, tipo percent/fixed, valor, min/max, limites, validade, ativo). Banner avisando que aplicação no checkout é fase futura.

Status final: painel completo end-to-end. Próximo passo natural: integrar cupom no /payment-init (incrementa usageCount + cria CouponRedemption + aplica desconto no valor enviado pro provider).


### Validação do Webhook + Fixes pós-painel (2026-05-12)

#### Webhook do Pagar.me validado live
- [x] **6 hits do IP 52.186.34.84 (Pagar.me / RestSharp/106.6.7.0)** confirmados em /api/public/payment-webhook/pagarme/<token>.
- [x] Eventos processados: customer.created (ignored), charge.payment_failed, order_item.created.
- [x] Idempotência confirmada: 4 retentativas do mesmo charge.id retornaram notFound (era teste fake) sem duplicar efeitos.

#### Tradução de status PT-BR (centralizada)
- [x] **frontend-app/src/lib/paymentLabels.ts** — helpers `paymentStatusLabel`, `paymentStatusTone`, `paymentMethodLabel`, `paymentProviderLabel`. 9 status traduzidos (Pago, Pendente, Falhou, Vencido, Expirado, Reembolsado, Recebido, Cancelado, Processando).
- [x] Aplicado em: PaymentMethodsTab (aba Cobranças), EnrollmentRegistrationDetailPage (header + bloco Cobranças), EnrollmentPortalDetailPage (lista de inscrições).
- [x] **Backend renderReceiptHtml** com helpers PT-BR (`paymentStatusLabelPt`, `paymentMethodLabelPt`).
- [x] **candidate-portal.js** `getPaymentBadge` cobre 9 status (era 4).

#### Status da inscrição completos
- [x] Tipo `RegistrationStatus` expandido pra 14 valores: draft, pending, submitted, paid, docs_uploaded, docs_reviewing, docs_approved, docs_rejected, reviewing, approved, enrolled, rejected, cancelled, expired.
- [x] `REGISTRATION_STATUS_LABELS` traduzidos em EnrollmentRegistrationDetailPage + EnrollmentPortalDetailPage.
- [x] STATUS_COLORS atualizado com cores apropriadas para os novos status.
- [x] Bug fix: link da coluna "Inscrição" na aba Cobranças (PaymentMethodsTab) corrigido de `/app/enrollment-registrations/:id` (rota inexistente) para `/app/enrollment-portals/:portalId/registrations/:regId`.

#### Header da inscrição em badges visuais
- [x] **StatusBanner** refatorado em `/app/enrollment-portals/:p/registrations/:r`: candidateCode + 4 badges coloridos (status inscrição, status documentos, status redação se entryMode='essay', status pagamento se houver).
- [x] Backend `GET /api/admin/enrollment-registrations/:id/document-review` agora retorna:
  - `registration.paymentStatus/paymentMethod/paymentAmount/paymentPaidAt`
  - `essay: { status, score, required }` agregado (entryMode.evaluationType='essay' + último essaySubmission)
- [x] EssayStatus: not-required / pending / submitted / reviewing / approved / rejected — com ícones e cores diferenciados.

#### Timeline do lead — eventos de pagamento
- [x] **Backfill** do lead 214: evento `payment_received` inserido manualmente para a inscrição #6 que foi sincronizada via SQL antes do endpoint /sync-charge existir.
- [x] **Novo evento `payment_initiated`** registrado em:
  - `/payment-init` (modo transparent) — quando PIX/boleto/cartão é gerado.
  - `POST /register` (modo link) — quando paymentlink é gerado.
- [x] **Novo evento `payment_failed`** registrado quando criação da cobrança falha (gateway recusa, erro de rede).
- [x] **`payment_received`** já existia nos webhooks Asaas/Pagar.me + syncChargeFromProvider — agora cobre TODOS os caminhos (webhook, cron 60s, sync manual admin).
- [x] **Filtro "Pagamento" adicionado** ao HISTORY_CHANNELS na TimelineTab — operador pode filtrar timeline só por eventos de pagamento.

#### Status do checkout transparente — pronto pra produção 🎉

| Camada | Status |
|---|---|
| Schema (paymentMode, publicKey, EnrollmentPaymentMethod, PaymentWebhookHit, Coupon, CouponRedemption) | ✅ |
| Backend (createOrder/Order PIX+Boleto+Cartão, /payment-init, /payment-status, /sync-charge, /sync-payment) | ✅ |
| Webhooks (Asaas + Pagar.me, audit hits) | ✅ validado live |
| Sync automático (cron 60s reconciliação) | ✅ |
| Sync manual (botão admin) | ✅ |
| Frontend portal candidato (PIX/boleto/cartão + polling 5s) | ✅ |
| Frontend portal inscrição (auto-login pós-submit) | ✅ |
| Painel admin /app/payments (5 abas: Overview/Cobranças/Conexões/Webhooks/Cupons) | ✅ |
| Tradução PT-BR centralizada | ✅ |
| Header da inscrição em badges (com redação + pagamento) | ✅ |
| Eventos de pagamento na Timeline do lead | ✅ |
| Tabela `EnrollmentPaymentMethod` no detalhe admin da inscrição | ✅ |
| Estrutura de cupom (CRUD admin + endpoint validate) | ✅ Aplicação no checkout futuro |

---

## Módulo Resumo (status_summary) — paridade com o motor de "resumos" do Rubeus

Inverte o kanban: o operador **classifica a situação** do atendimento escolhendo um
Resumo (ex.: `AT-200 SOLICITOU MATRICULA`) e o motor deriva o resto — move etapa/funil,
conclui pendências, cria as atividades certas com prazo e responsável, marca ganho/perdido
e exige a objeção. Dois consultores na mesma situação produzem o mesmo estado no CRM.

Módulo nasce **desligado** (`defaultEnabled: false`). Catálogo é **por funil**, com fallback global.

- [x] **F1 — Fundação.** Migration `0108_status_summary_module`: `StatusSummary`,
      `ActivityTemplate`, `StatusSummaryActivity`, `LeadStatusHistory`;
      `Lead.statusSummaryId/At`, `Activity.assignedUserId/assignedTeamId/templateCode`,
      `Stage.slaHours/temperature`.
- [x] **Motor** `services/statusSummaryEngine.ts` — ponto de entrada único
      `applyStatusSummary()`. Todo caminho (painel, workflow, chatbot, API, cron) passa por ele.
- [x] **Helper central** `services/leadStageMove.ts` — paga a dívida do
      `recordLeadStageMovement` que o schema prometia e nunca existiu (o par
      "update status + grava movimento + emite evento" estava replicado inline).
- [x] **F2 — API + painel.** `routes/statusSummaries.ts` (CRUD resumos/templates,
      aplicar resumo, histórico, relatório) + tela Cadastros › Resumos com as duas abas
      e o seletor de Resumo no detalhe do lead (mostra ANTES o que vai acontecer).
- [x] **F3 — Atividades com dono.** `Activity.assignedUserId/TeamId` + filtros
      (`assignedUserId`, `assignedTeamId`, `unassigned`, `templateCode`);
      `create_task` do workflow ganhou prazo e responsável; nova ação `set_summary`;
      novo gatilho `lead.summary_changed`.
- [x] **F4 — Escada automática.** `services/statusSummaryAdvanceJob.ts` (tick 15 min):
      atividade vencida + lead sem responder ⇒ aplica `nextSummaryCode`. É o que o
      Rubeus faz na mão. Pausa quando o lead responde.
- [x] **F5 — Seed comercial + relatório.** `scripts/status_summary_seed_comercial.ts`
      (9 etapas, 11 atividades padrão, 31 resumos — idempotente) e
      `GET /api/status-summaries/report` (aplicações, leads parados, para onde foram).

- [x] **F6 — Relatório por resumo.** `StatusSummaryReportPage` em Relatórios ›
      Relatório por Resumo: aplicações, leads parados, "ainda no resumo" e para onde
      seguiram (com %), filtro por funil e período.
- [x] **F7 — Badge do resumo.** `StatusSummaryBadge` no card do Kanban e na coluna
      Status da lista de Leads (`kanban.ts` e `leads.ts` passaram a devolver a relação).
- [x] **F8 — Aba Resumos no lead.** `LeadStatusHistoryTab` com a trilha de transições e
      o que cada uma provocou. O gating por módulo das seções do lead virou
      `useVisibleLeadSections()` — antes o filtro era hardcoded no módulo de Negociação
      e uma segunda seção com `module` herdaria o gate errado.
- [x] **F9 — Fila por responsável/setor.** Filtros Responsável (todos / minhas /
      sem responsável / pessoa) e Setor na tela de Atividades, com o responsável
      exibido na linha ("na fila" quando o setor tem a tarefa e ninguém puxou).
- [x] **Herança do responsável na escada.** Degrau aplicado pelo cron (sem operador)
      com lead sem dono gerava atividade órfã; agora carrega o responsável da anterior.

- [x] **F10 — Jornada da Secretaria.** `scripts/status_summary_seed_secretaria.ts`:
      funil "Secretaria · Inscrições" (8 etapas), 20 atividades padrão, 20 resumos e
      4 CustomFields (quitado em, experiência, forma de envio, rastreio).
      Cabe inteira em resumos + tarefas porque as checagens externas (sistema
      acadêmico, AVA, SISTEC, frete) já são feitas por uma pessoa que registra o
      resultado — o CRM nunca as consultou sozinho. Quando o ERP entrar, esses
      campos passam a vir por integração e o catálogo não muda de forma.
      - Handoff entre processos: `SE-001` vive no catálogo do Comercial e troca o
        lead de funil — responde ao "transferência de registro entre processos".
      - Escada da taxa de correios (`SE-015 → SE-017 → SE-018 → SE-019 → SE-020`)
        roda sozinha até o arquivamento.
- [x] **Trava de objeção no avanço automático.** Resumo com `requireLossReason` e
      sem objeção padrão não é mais aplicado pelo cron: o lead viraria Perdido sem
      motivo e o relatório de objeções ganharia um buraco justamente nas perdas
      automáticas. Agora suspende e registra no log, esperando decisão humana.

### Pendente
- [ ] IA sugerir o resumo a partir da conversa (1 clique para confirmar).
- [ ] Emissão do diploma em si (livro de registro, Diário Oficial, assinatura) —
      continua no ERP acadêmico; aqui só existe a tarefa que a acompanha.
- [ ] Contato × Oportunidade (hoje `Lead` é os dois) — refactor estrutural, adiado.
- [ ] Replicar para os tenants (nada replicado; só o beyond).

---

## Negociação · Mensalidade vs. pagamento único (2026-08-03)

**Problema** — a proposta somava tudo num número só. Implantação, site e landing
page (cobrança única) entravam no mesmo total que a mensalidade, e os KPIs de
Negociação da Visão Geral misturavam os dois: um mês com uma venda grande de
implantação virava "crescimento", e o mês seguinte, sem ela, virava "queda" —
sem que a recorrência tivesse mudado.

- [x] **Migration `0111_negotiation_billing_type`.** `NegotiationItem.cobranca`
      (`unico` | `recorrente`), `parcelas` (item único parcelado) e
      `recorrenciaMeses` (prazo do contrato); `Negotiation.valorUnico` e
      `valorRecorrente` desnormalizados dos itens; `Product.cobranca` como padrão
      do catálogo. Backfill: negociações existentes viram 100% pagamento único —
      `valorFinal` inalterado e nenhum MRR inventado retroativamente.
- [x] **Toggle por item** na aba Negociação (Pagamento único | Mensalidade), com
      parcelamento próprio do item único ("Implantação em 6× de R$ 1.000") e prazo
      de contrato opcional no recorrente.
- [x] **Rateio do desconto.** O desconto geral é dividido entre os dois blocos na
      proporção do subtotal de cada um; acréscimos (frete/taxas) caem inteiros no
      pagamento único. `valorFinal` = único + 1 mensalidade (1º ciclo) — é o que o
      lead recebe como valor de venda ao fechar como ganha.
- [x] **6 KPIs novos** em `widget-data`: `negotiations_mrr_open|won|avg_ticket` e
      `negotiations_onetime_open|won|avg_ticket`. Os três antigos (total) seguem no
      catálogo de widgets para não quebrar painel personalizado salvo.
- [x] **Visão Geral** com a seção Negociações em duas linhas: Recorrência (mensal)
      e Pagamento único. Ticket médio de cada lado divide só pelas negociações que
      têm aquele componente.
- [x] **Catálogo de produtos** com o tipo de cobrança (formulário, listagem, modelo
      e importação XLSX — aceita "mensal", "mensalidade", "assinatura"). O item
      puxado para a proposta já nasce classificado.
- [x] **Reabrir devolvia o `saleValue`.** O `/close` gravava o valor da venda no
      lead e o `/reopen` não limpava — a "Receita ganha" seguia contando venda
      desfeita. Agora limpa quando o valor ainda é o daquela negociação.

## Negociações · módulo com tela própria (2026-08-03)

O módulo existia só como aba dentro do lead: para saber quanto havia na mesa era
preciso abrir lead por lead. Virou módulo completo, na anatomia do Inteligência —
tela no menu + seção no detalhe do lead.

- [x] **`GET /api/admin/negotiations/overview`** — lista paginada + totais por
      status (colunas do pipeline) + KPIs, tudo do mesmo recorte numa volta só.
      Filtros: busca (lead ou título), resultado, tipo de cobrança, funil,
      responsável, período e ordenação. `?format=csv` exporta o mesmo recorte
      (BOM + `;`, abre no Excel pt-BR sem assistente).
      Período: fechadas contam pela data de FECHAMENTO, abertas pela de criação.
- [x] **`NegotiationsPage`** (`/app/negotiations`) com duas visões do mesmo
      recorte: tabela (valor único e mensalidade em colunas separadas, ordenável,
      exportável) e pipeline por status com arrastar-e-soltar (@dnd-kit).
      Ganha/perdida NÃO se arrasta — mexe no desfecho do lead e exige o motivo da
      perda, então passa pelo "Fechar negociação" dentro da proposta.
- [x] **Modal com o editor completo.** `NegotiationEditor` foi exportado do
      `LeadNegotiationTab` e é o mesmo formulário nas duas telas — a proposta é a
      mesma, mudou só de onde se chega nela.
- [x] **Registro do módulo:** `pages: ['negotiations']` no moduleRegistry, item
      "Negociações" no grupo CRM do sidebar (ícone Handshake) e rota no Router —
      atrás do `ModuleGate`, como todas as telas catalogadas.
- [x] KPIs da tela: na mesa (único e mensal), fechado (único e mensal) e, abaixo,
      aproveitamento + ticket médio do 1º ciclo. Recorrência nunca somada ao único.

- [x] **Replicado nos 10 + pushed** (03/08/2026): beyond 671edf8 · terram fad1396 ·
      vantari 4bc6eda · ineprotec 1d64ee5 · realeza 6201cdc · venda360 d80be74 ·
      severiano 845ed66 · habitat 3bfc4c8 · unialfa 00642f2 · demo (sem git).
      13 dos 17 arquivos eram idênticos à base em todos os tenants (cp direto);
      schema/moduleRegistry/sidebar/Router receberam patch por âncora. No
      ineprotec a migration virou `0124` (numeração própria). `installer/build.sh`
      regerado — instalação nova já nasce com o módulo.

- [x] **Desconto e condições por bloco** (migration `0112`, replicada nos 10):
      cada bloco tem o seu desconto (R$ ou %) — dá para ceder na implantação sem
      mexer na mensalidade e vice-versa. Forma de pagamento, entrada e parcelas
      são do único; forma de cobrança e dia de vencimento, da mensalidade. Os
      descontos já lançados foram migrados sem mudar nenhum total: percentual
      vira o mesmo % nos dois blocos, valor fixo é dividido na proporção que o
      rateio antigo aplicava.
- [x] **Catálogo como fonte dos itens**: seletor que lista o catálogo por
      categoria com marcação múltipla, chip de origem em cada linha
      (Catálogo com preço de tabela e botão de desvincular, ou Digitado) e os
      dois convivendo na mesma proposta. `GET /api/admin/catalog` passou a
      liberar para quem tem "Ver" em Catálogo **ou** em Negociações — quem monta
      a proposta precisa da lista, e o seletor vinha vazio para o vendedor.

- [x] **Responsável da proposta = dono do lead** (migration `0113`, replicada nos
      10): quem criava a proposta virava responsável por ela. Agora a criação
      herda o `assignedUserId` do lead, a troca de dono propaga para as
      negociações em aberto por middleware do Prisma (ponto único por onde passam
      os ~12 caminhos de atribuição) e a exibição/filtro saem do lead. Proposta
      fechada não é tocada — ali o responsável é registro da venda.

### Pendente
- [ ] Relatório de Funil ainda soma `valorFinal` (total do 1º ciclo) nos KPIs de
      negociação — separar MRR ali é a próxima frente.
- [ ] Módulo nasce desligado: ativo em beyond/terram/ineprotec/severiano/demo,
      OFF em vantari/realeza/venda360/habitat/unialfa (decisão comercial).

---

## Segurança · Bloqueio de entrada de leads (2026-08-03)

**Problema** — um contato se inscrevia toda semana e nunca respondia. A única
saída era apagar o lead de novo e de novo, e a base seguia suja.

- [x] **Migration `0114`** (`0127` no ineprotec): `LeadBlockRule` com e-mail,
      domínio inteiro, WhatsApp e IP; uma regra barra quando QUALQUER critério
      casa, porque quem abusa troca um dado e mantém o outro. Guarda `hits` e
      `lastHitAt` — sem isso não dá para saber se a regra ainda faz sentido.
- [x] **Bloqueio silencioso**: o formulário responde "enviado com sucesso" e o
      lead não nasce. Recusar com erro avisaria a pessoa, que trocaria de e-mail.
- [x] **Alcance**: formulário, landing page, Lead Ads, API pública, Make e
      webhooks de entrada. Mensagem recebida no WhatsApp/Instagram/Telegram
      continua criando lead (cliente real que caísse numa regra sumiria do
      atendimento sem ninguém notar) e o cadastro manual pelo operador passa.
- [x] **UI** em Configurações › Segurança (CRUD, contador de entradas barradas,
      aviso sobre IP compartilhado) e ação "Bloquear entrada deste contato" no
      menu do lead, que cria a regra com o e-mail e o WhatsApp dele.
- [x] Cada tentativa vira evento `lead_blocked` no log de Segurança, com o canal
      por onde a pessoa insistiu.
- [x] Replicado nos 10 + pushed.

### Pendente
- [ ] O form `captacao-de-leads` do beyond aponta para um funil que não existe
      (`funnelId=3`): todo lead que chegar por ele falha em silêncio. Nunca
      recebeu submissão real — corrigir o funil antes de publicá-lo.

---

## Negociações · etapa do funil na tabela, pipeline removido e paginação (2026-08-04)

**Problema** — a coluna "Status" mostrava o status INTERNO da proposta
(Rascunho/Enviada/…), que não é onde o negócio está na operação; e a tela só
tinha "Anterior/Próxima" para percorrer as propostas.

- [x] **Coluna "Etapa do funil"**: mostra a etapa em que o LEAD está agora, com o
      selo Ganho/Perdido ao lado quando há desfecho. `Lead.status` guarda a CHAVE
      da etapa — nome e cor vêm de `Stage` por par `funnelId:key` (a mesma chave
      pode ter nome diferente em cada funil), resolvido numa consulta só
      (`stageLabelMap`). Desfecho exibido = `negotiation.resultado ?? lead.outcome`.
- [x] **Modo Pipeline removido**: com a coluna mostrando etapa do funil, um quadro
      por status da proposta virava uma segunda noção de "etapa" na mesma tela.
      Saíram o alternador, o `@dnd-kit` da página e o `groupBy(['status'])` do
      backend. Mudar o status da proposta continua existindo dentro do editor.
- [x] **Paginação de verdade**: números com reticências, saltos primeira/última,
      "Mostrando X–Y de N" e seletor 25/50/100/200 salvo por navegador. Dois
      achados do teste: página órfã (recorte que encolheu deixava a tela sem
      rodapé, sem caminho de volta → efeito reclampa a página) e troca de tamanho
      disparando duas requisições (o reset da página agora é no mesmo render).
- [x] CSV do módulo ganhou a coluna "Etapa do funil" antes de "Status da proposta".

---

## Metas & Comissões · módulo (2026-08-04)

**Problema** — a operação sabia quanto vendeu (módulo Negociações) mas não quanto
disso vira comissão nem quem está perto da meta. Isso vivia em planilha, e
planilha diverge do sistema no primeiro ajuste de valor da proposta.

- [x] **Migration `0116`**: `CommissionRule` + `CommissionTier` (faixas do
      acelerador) + `CommissionRuleUser` (regra × agente), `Goal` (meta por
      agente/funil/indicador/mês) e `CommissionEntry` (um lançamento por venda,
      cascade da negociação). Sem backfill: comissão de venda antiga não é
      inventada — a regra daquele mês não existia no sistema.
- [x] **Comissão por bloco**: percentual OU valor fixo, com taxa separada para o
      pagamento único e para a mensalidade (e quantas mensalidades entram). Um
      percentual só sobre o total esconderia a diferença entre caixa avulso e
      recorrência, que é a razão de os dois viverem separados na proposta.
- [x] **Escopo por especificidade**: agente+funil > agente > funil > geral, com
      `prioridade` como desempate. Sem isso, a exceção de um vendedor obrigaria
      a cadastrar uma regra por pessoa.
- [x] **Acelerador**: faixas por atingimento da meta (ex.: 0–79% → 3%, 80–99% →
      5%, 100%+ → 7%). A faixa vale para TUDO o que o agente fechou no mês — por
      isso fechar uma venda dispara `recalcAgentMonth`. Sem meta cadastrada, vale
      a taxa base: acelerador não pode ser dado de graça.
- [x] **Gatilho**: a comissão nasce ao fechar a proposta como Ganha e é desfeita
      ao reabrir. Lançamento já **pago** não é apagado nem reescrito — vira
      `cancelada` (o dinheiro que saiu não some do histórico) e a divergência
      aparece na conferência.
- [x] **Ganchos em Negociações**: `/close`, `/reopen`, `PUT` de proposta fechada
      e `DELETE` chamam o motor; o `DELETE` ainda recalcula o mês do agente,
      senão a faixa continuaria contando uma venda que saiu.
- [x] **Tela** `/app/goals-commissions` (grupo Vendas & Automação) com quatro
      abas sobre o mesmo mês: Painel (meta × realizado × comissão por agente,
      mais a linha da Operação), Metas (grade agente × indicador, campo vazio =
      sem meta), Regras e Lançamentos (CSV, marcar paga em lote, conferência).
- [x] **Recorte por papel**: gestor vê a operação, agente vê só a própria linha —
      inclusive na estimativa dentro da proposta.
- [x] **Conferência** (`/commissions/reconcile`): venda ganha sem responsável,
      sem regra aplicável, valor lançado ≠ recalculado e lançamento de proposta
      que não está mais ganha.
- [x] **Comissão à vista do vendedor**: o Resumo da proposta mostra a comissão
      estimada com a regra que se aplica àquele agente — desconto dado tem preço
      visível na hora.
- [x] E2E completo (regra + meta + proposta 10.000 único + 1.000/mês): faixa base
      400 → faixa alta 950 após bater a meta, painel, CSV, paga preservada pelo
      recálculo, reabrir cancela a paga e remove a não paga. Dados de teste
      removidos do banco.

- [x] **Replicado nos 10 + pushed**: beyond 05a1dd4 · terram b6af0de · vantari
      0a5ea97 · ineprotec f31b329 (migration renumerada para `0129`) · realeza
      dce3fd3 · venda360 4850826 · severiano c6fb1aa · habitat 6bf3d3b · unialfa
      2fddcd8 · demo (sem git). Validado com volume real no ineprotec: 98 vendas
      de julho recalculadas em 3,7s, painel em 0,09s, R$ 11.938,75 de comissão
      (5% de R$ 238.775) e zero divergência na conferência. `installer/build.sh`
      regerado — instalação nova já nasce com o módulo.
- [x] Módulo ATIVO só no beyond; nasce desligado nos demais (decisão comercial).

### Pendente
- [ ] Comissão por pagamento confirmado (Asaas/Pagar.me) — hoje o gatilho é o
      fechamento da venda.
- [ ] Divisão de uma venda entre mais de um agente (SDR + closer).
- [ ] Widget de comissão/atingimento na Visão Geral e em Meus Painéis.

---

## Replicação · coexistência Cloud API e Disparos Inteligentes (2026-08-05)

**Problema** — a coexistência (`6494986` + `523e22c`, 03/08) e os arquivos de
migration dos Disparos Inteligentes tinham ficado só no beyond: quem conectasse
um número em coexistência num tenant não via o que o vendedor respondeu pelo
celular, e instalação nova a partir do repo do tenant nasceria sem as colunas de
`0109`/`0110` (elas existiam no banco por `db push`, sem arquivo).

- [x] **Coexistência replicada nos 10**: `cloudApiCoexistence.ts`, os handlers
      `smb_message_echoes`/`smb_app_state_sync`/`history` no webhook, o
      `FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING` no signup e o selo na UI.
- [x] **`BroadcastPage` passou a usar o `LeadsAudiencePicker` compartilhado** —
      a cópia inline no Disparo em Massa fazia correção de um lado não chegar no
      outro.
- [x] **Migrations `0109`/`0110`** (`0130`/`0131` no ineprotec) versionadas nos
      tenants; já estavam aplicadas nos bancos, marcadas com `migrate resolve`.
- [x] Commits: terram 6e50bfd · vantari b229e6e · ineprotec c146021 · realeza
      cfef3a7 · severiano f1b2a9d · habitat 18c2f6d · unialfa 0beecae ·
      venda360 a9b24ee · demo (sem git). `tsc` e `vite build` nos 8, pm2
      reiniciado, `/api/cloud-api/webhook` e `/connection` respondendo.
- [x] **venda360 alinhado com o núcleo** (estava no beyond de 24/07): 98
      arquivos por merge de 3 vias, preservando o overlay v360. Entram Radar de
      Reputação, Radar de Concorrentes, Mercado de Ensino Superior, Supervisão,
      Grupos do WhatsApp, CRM Educacional, configuração do Relatório de Funil e
      o atalho de template, com as migrations `0097`–`0105`. O merge empilhou os
      dois lados em 3 pontos (middleware de segredos, trio de presença do
      `whatsappProvider`, include `statusSummary`) — corrigidos; o `tsc` fecha
      com os mesmos 30 erros pré-existentes do beyond.

---

## Sincronização · o núcleo dos 10 volta a bater com o beyond (2026-08-06)

**Problema** — depois de meses replicando feature a feature, cada instalação
tinha ficado com um retalho diferente do núcleo: 19 a 35 arquivos divergentes,
misturando customização de verdade com atraso puro. Ninguém sabia dizer, olhando
um arquivo, se a diferença era intencional.

- [x] **Método**: para cada par (arquivo, instalação), as linhas que só existiam
      no tenant viraram uma assinatura. Assinatura repetida em 3+ instalações é a
      versão ANTIGA comum → entra a do beyond; assinatura única é customização
      local → merge de 3 vias com a versão do beyond mais parecida como base, e
      conflito real não é gravado (fica para decisão à mão).
- [x] **Resultado**: vantari, habitat, unialfa e demo ficaram **idênticos** ao
      beyond; venda360 mantém 2 arquivos (sidebar e Router do overlay v360);
      realeza 3 (widget e fluxo do chatbot); severiano 16, terram 17 e ineprotec
      20, todos customização classificada — ERP acadêmico, chatbot roteirizado,
      aiJourney, workers, override de callback da Meta.
- [x] **Rotas órfãs no vantari**: Radar de Reputação, Mercado (Ensino Superior),
      CRM Educacional, Conector de BD e o Configurador do Relatório de Funil
      estavam no menu (ou eram alcançados por botão) sem rota registrada — a tela
      existia no repo e não abria.
- [x] **Menu do ineprotec** ganhou Radar de Reputação, Mercado (Ensino Superior),
      Relatório por Resumo, Resumos e CRM Educacional, que já tinham tela.
- [x] **Três duplicações silenciosas do merge de 3 vias**, que nem o `tsc` nem o
      `vite build` acusam: `startSmartBroadcastWorker()` subindo DUAS vezes no
      boot do terram, ineprotec e venda360 (dois consumidores na mesma fila, com
      risco de disparo repetido), o mapa de páginas do Router com
      'cad-status-summaries'/'status-summary-report' em dobro (ineprotec e
      venda360) e o `include: statusSummary` duplicado no detalhe do lead
      (terram). Achadas por varredura de linha de efeito colateral e de chave de
      objeto repetida em relação ao beyond.
- [x] **Multi-setor por número** alinhado nos 10 e o import morto de
      `channelTeamIds` removido do `cloudApiSetup` (segue em uso nas instâncias
      Evolution).
- [x] Commits: beyond 32cca5e · terram 288746b · vantari a277597 · ineprotec
      f4712ce · realeza 18103fc · severiano f1c2b8c · habitat 146a114 · unialfa
      7b55321 · venda360 162fc71 · demo (sem git). `tsc` do backend e do
      frontend, `vite build`, pm2 reiniciado e rotas conferidas nos 10.

### Pendente
- [ ] `routes/chatbots.ts` do severiano segue divergente de propósito: o widget
      dele usa journey/sessionKey e o do beyond isPreview/sessionId. Unificar
      exige decidir um dos dois caminhos para o preview do chatbot.

---

## Instalações · elementus e kobogo (2026-08-06)

- [x] **11º e 12º tenants** instalados pelo instalador, um após o outro, sem
      intervenção manual: elementus.bychat.ia.br (PM2 :3111, MySQL 3317, Redis
      6391) e kobogo.bychat.ia.br (:3112, 3318, 6392), com SSL Let's Encrypt e
      DNS A DNS-only apontando para o VPS.
- [x] Artefato **regerado na hora** a partir do beyond em `49b1117`: as duas
      nasceram com zero arquivo divergente do beyond e limpas no `dup-scan.py` —
      é a primeira instalação que corresponde a um commit de verdade desde a demo.
- [x] Admin SUPERADMIN criado e login validado de ponta a ponta; 122 migrations,
      schema em dia.
- [ ] Pendente por instalação: chaves de IA (vivem no banco), canal de WhatsApp,
      times e o repo git do tenant (depende de criar no GitHub e cadastrar a
      deploy key com write access).

---

## Tela inicial · porta de entrada configurável por papel (2026-08-07)

> A Visão Geral deixa de ser a única porta de entrada. Em **Configurações › Tela
> inicial** o administrador monta telas como uma pilha de blocos e decide quem
> recebe cada uma — por cargo, com exceção por usuário. Quem não tem regra
> continua caindo na Visão Geral: ninguém fica com tela em branco.

- [x] **Modelo** (migration `0118_home_screens`): `HomeScreen` (nome, descrição,
      `blocks` Json, ativa, `isSystem`) e `HomeScreenAssignment` (`role` único e
      anulável, `userId` único e anulável). Precedência ao resolver: **exceção do
      usuário → regra do cargo → nenhuma tela**.
- [x] **Cinco tipos de bloco**: `notice` (texto + links), `kpis` (métricas do
      `WIDGET_CATALOG`), `shortcuts` (cartões de acesso), `my_day` (atividades de
      hoje, reuniões, atrasadas e leads parados) e `leaderboard` (ranking de
      ganhos no período).
- [x] **Backend `routes/homeScreens.ts`**: `GET /api/home-screen/me` resolve a
      tela e **poda** o que o usuário não pode ver (atalho de módulo sem
      `canView` some; o bloco de KPIs exige acesso ao dashboard) devolvendo
      `pruned`; `/my-day` e `/leaderboard` passam por `buildLeadAccessWhere` (o
      agente só vê a própria linha); CRUD em `/api/admin/home-screens`, `PUT
      .../assignments` e `GET .../:id/preview?role=` para ver como outro cargo
      veria. `sanitizeBlocks` descarta bloco de tipo desconhecido.
- [x] **KPIs no escopo de quem olha**: `POST /api/admin/widget-data` ganhou a
      flag `cfg.scoped`, que aplica `buildLeadAccessWhere` no `leadWhere` em um
      ponto único. Só o bloco `kpis` da tela inicial manda a flag — Meus Painéis
      e a Visão Geral seguem globais, sem mudança de número. Métricas que não
      passam pelo `leadWhere` (visitantes, resumo de atividades, negociações)
      não são recortadas.
- [x] **Gate de permissões**: `/api/home-screen/` entrou em
      `HOOK_BYPASS_PREFIXES` — a porta de entrada precisa abrir para qualquer
      cargo, e a própria rota autentica e poda. A administração ficou catalogada
      no módulo **settings**.
- [x] **Frontend**: `HomeScreenPage` virou a rota `/` (era um redirect para
      `/dashboard`) e o login passou a cair em `/`; sem tela atribuída ela
      renderiza a `OverviewPage`. Editor e "Quem vê o quê" em
      `settings/HomeScreenSettings.tsx`; o catálogo de destinos dos atalhos é o
      próprio menu lateral (`flattenItems()`).
- [x] **"Mudo e nada muda"** — quem configura costuma ser SUPERADMIN, cargo que
      não tinha regra: as edições salvavam certo mas não mexiam na entrada dele.
      A tela agora diz qual é **a sua** entrada hoje e por quê (cargo ou
      exceção), marca a própria linha com "(você)" e, quando o cargo de quem
      edita está em "Visão Geral (padrão)", mostra um aviso explicando que é por
      isso que nada muda.
- [x] **Sete telas de exemplo** semeadas nos 12 (uma por tipo de bloco + duas
      compostas), **sem nenhuma atribuição** — cada tenant decide quando ligar.
- [x] Replicado nos 12 tenants, migration aplicada, frontends buildados e
      `pm2` reiniciado; smoke test 200 em `/me`, `/my-day`, `/leaderboard` e
      `/admin/home-screens`. Commits: beyond 657f2a4 · habitat 92342f4 ·
      ineprotec 9a927da · realeza a418e32 · severiano 1760b49 · terram aecc246 ·
      unialfa 143e0f5 · vantari c4e2316 · venda360 dd09a8d; demo, elementus e
      kobogo só no filesystem (sem repo git).

- [x] **A entrada se chama sempre "Visão Geral"** (2026-08-07) — o título vinha
      do nome da tela, então quem entrava lia rótulo de administração ("6.
      Composta — Tela do Agente"). O nome serve para o admin achar a tela na
      lista; o título da página virou fixo nos dois estados (carregando e
      pronto) e o campo Nome no editor avisa que só é visto ali. A descrição da
      tela, essa sim escrita para o usuário, segue aparecendo abaixo do título.
      As descrições das 7 telas de exemplo, que descreviam a montagem ("Aviso +
      meu dia + atalhos (blocos combinados)"), foram apagadas nos 12 bancos: a
      entrada agora abre só com o título. O campo continua no editor, vazio,
      para quem quiser escrever um subtítulo de verdade.
      Replicado nos 12 e buildado; commits: beyond 49096af · habitat 294d94c ·
      ineprotec b27e580 · realeza 7e262b2 · severiano 0b99d40 · terram 5b96237 ·
      unialfa 4330f8e · vantari 9b8498a · venda360 0e619e5; demo, elementus e
      kobogo só no filesystem.

### Achados

- No **unialfa** o cargo AGENT não tem `canView` em módulo nenhum, então a tela
  de atalhos fica sem destino e o bloco some. Não é do módulo: é a configuração
  de permissões daquele tenant.
- **VIEWER não carrega KPI em lugar nenhum** (bug pré-existente): o gate deriva
  a ação do método HTTP, então o `POST /api/admin/widget-data` conta como
  `create` e VIEWER só tem `canView`. Na tela inicial a poda passou a exigir
  `canView && canCreate` no dashboard, para o bloco sumir em vez de virar uma
  fileira de erros. A correção de raiz (mapear a rota para `view`) ficou de
  fora de propósito: passaria a expor os KPIs globais ao VIEWER na Visão Geral.

### Pendente

- [ ] Atribuir as telas no beyond: hoje ADMIN, MANAGER, AGENT e VIEWER têm
      regra, mas **SUPERADMIN não** — quem é superadmin continua entrando pela
      Visão Geral.

---

## Período dos KPIs — 7/30/90/personalizado em toda tela com indicador (2026-08-08)

- [x] **Seletor único** — `PeriodPicker` + `usePeriod` (front) e `resolvePeriod`
      (back). Cada tela tinha o seu (`days=`, `range=`, ou só presets), e várias
      descartavam o intervalo personalizado; agora "últimos 30 dias" quer dizer a
      mesma coisa em qualquer lugar. `to` ancora em 23:59:59.999 — antes o dia
      final ficava de fora da conta.
- [x] **Telas alinhadas**: Visão Geral, Visão Geral Educacional (só tinha
      7/30/90), Helpdesk relatórios + CSAT (o CSV exportado passou a seguir o
      período da tela), Conversões, Tracking, Pagamentos, Supervisão (não tinha
      seletor: 7 dias fixos) e o SLA da Performance por Equipe, que tinha um
      7/30 próprio respondendo diferente do topo da mesma tela.
- [x] **Widgets que ignoravam a data** passaram a respeitá-la: atividades,
      páginas e formulários (via eventos — os contadores do registro são
      acumulados e não sabem o que é período), tracking por dispositivo/origem,
      Meta Leads, tags, portais, chatbots, recursos do sistema, negociações em
      aberto e todos os de helpdesk (presos em 30d porque usavam preset próprio).
- [x] **`templates_usage` fica de fora, por falta de dado** — o uso de template
      só existe como contador incrementado no envio, sem linha datada. Recortar
      pelo único evento com data (`Activity.templateId`) cobriria só o envio
      manual e devolveria zero nos automáticos. Devolve `periodScoped:false` e o
      card avisa "Total acumulado". Para resolver: gravar uma linha por uso.
- [x] **Ganhos, receita e perdidos** contam pela data do clique em Ganho/Perdido
      (`outcomeAt`).
- [x] **Taxa de conversão reescrita** — ganhos ÷ leads que chegaram à negociação
      com valor lançado, coorte pela abertura da negociação. O denominador
      inclui as propostas em aberto de propósito: `won/(won+lost)` colapsa em
      100% porque ninguém marca Perdido depois de negociar (foi o que aposentou
      o card "Aproveitamento" em julho).
- [x] **Fallback medido antes de replicar** — terram tem 3.245 encerrados e
      ZERO negociações; a fórmula nova esvaziaria o card dele. Tenant que nunca
      abriu negociação mantém ganhos sobre encerrados. O flag do módulo não
      serve de teste: o terram está com Negociação ativo e mesmo assim não usa.
      Medição: ineprotec 41%→52%, demo 48%→51%, severiano 0%→0%, terram
      preservado, os demais sem dado dos dois lados.
- [x] **Cada card imprime a data que usa** (`basis`) — sem isso os números
      parecem não fechar entre si.
- [x] Replicado nos 11 tenants, buildado e reiniciado; commitado e pushado nos
      9 repos versionados (demo, elementus e kobogo não têm git).

### Pendente

- [ ] Validação visual das telas pelo usuário.
- [ ] Tornar `templates_usage` recortável por período (exige tabela de uso).

---

## Conversas · o número de envio é o da conversa, não o do dono (2026-08-10)

> **Bug relatado:** no Conversas, mesmo respondendo um lead que entrou por um
> número Evolution, o sistema deixava o número da **API oficial (Cloud API)**
> como padrão de envio. O contato só conhece o número por onde falou — responder
> por outro abre um segundo fio no aparelho dele, vindo de um desconhecido, e a
> resposta dele volta para uma linha que não é a da conversa.
>
> **Causa raiz** (`services/whatsappProvider.ts`): a ordem de prioridade era
> dono do lead → remetente → setor → *espelho do canal de entrada*. O espelho era
> o ÚLTIMO degrau, então quase nunca era alcançado. No beyond a Cloud API #1 é o
> único canal com `ownerUserId` (=1, Adson), enquanto `beyond-main` e `by_n2` não
> têm dono — qualquer lead do usuário 1, ou enviado por ele, travava no 1º degrau
> e saía pela oficial. Isso reverte a regra "dono-first" de 2026-06-30.

### Regra nova

- [x] **Degrau 0 em `getProviderForSender`: canal de ENTRADA manda em tudo.**
      Novo `inboundChannelForLead(leadId)` resolve o número pelo qual o contato
      falou (última msg `fromMe=false`; na falta, a última enviada, porque uma
      conversa que nós abrimos também já expôs um número). Só conta se o canal
      ainda estiver **ativo**.
- [x] **`lockedChannelForLead(leadId, sender)`** — o canal de entrada só trava se
      o operador tiver acesso a ele. Lead transferido para outro setor não deixa
      o atendente preso num número que o `canSendVia` recusaria (403).
- [x] **`suggestChannelForLead` devolve `{ channelId, locked }`** — com conversa
      em andamento vem travado; **sem conversa vem `null` de propósito**, para a
      escolha da primeira interação ser explícita em vez de um padrão silencioso.
- [x] **`GET /api/whatsapp/sender-channels` expõe `lockedChannelId`** ao lado do
      `suggestedChannelId`.
- [x] **`POST /atendimento/tickets/:leadId/messages` recusa canal divergente** —
      409 `CHANNEL_LOCKED` com o número correto no texto. Cobre o frontend com
      cache velho do seletor.
- [x] **Fallback do admin sem canal deixou de rotular msg Cloud com instância
      Evolution** — vinha do `EVOLUTION_INSTANCE` do env e gravava um canal de
      origem errado, o que impediria a trava de funcionar na mensagem seguinte.

### UI

- [x] **Rodapé do Conversas**: com conversa, badge com cadeado "**da conversa**"
      e o botão "Trocar" some. Sem conversa, nada pré-marcado, botão âmbar
      "Escolher número" e a frase "Primeira mensagem: escolha por qual número
      falar com este contato".
- [x] **Envio bloqueado** (texto e áudio) enquanto a escolha obrigatória não for
      feita — toast em vez de mandar por um número arbitrário.
- [x] **Modal `WhatsappSend`**: passo 1 (escolher número) só aparece na primeira
      interação; com conversa, já abre no número travado. Some o auto-select do
      "1º número da lista", que era o padrão silencioso mais perigoso.

### Verificação ao vivo (beyond)

- [x] lead 501 (entrou por `beyond-main`) → travado e enviado por
      `evolution:beyond-main` para Adson (dono da Cloud) e para Benedito. Antes
      sairia pela Cloud oficial.
- [x] lead 30 (entrou por Cloud #1) → travado em `cloud:1`.
- [x] lead 543 (sem conversa) → `locked=null`, `suggested=null` → escolha do
      operador.
- [x] lead descartável 556 (entrada `by_n2`, WhatsApp inválido) → POST com
      `channelId=cloud:1` devolveu **409 CHANNEL_LOCKED** sem enviar nada; lead e
      mensagem removidos depois.

### Exceção do SUPERADMIN (2026-08-10)

- [x] **Só o SUPERADMIN pode responder por número diferente do da conversa.**
      `canOverrideConversationChannel(role)` no `whatsappProvider`. O padrão NÃO
      muda para ele: o seletor abre no canal de entrada e `getProviderForSender`
      segue usando esse canal quando ninguém escolhe nada — o que ele ganha é a
      saída manual (instância caída, janela de 24h fechada na Cloud).
      ADMIN/MANAGER/AGENT continuam presos ao número que o contato conhece.
- [x] **`sender-channels` devolve `canOverrideChannel`** e zera `lockedChannelId`
      para o SUPERADMIN, mantendo o `suggestedChannelId` no canal da conversa.
- [x] **409 `CHANNEL_LOCKED` não se aplica ao SUPERADMIN.**
- [x] **UI:** o selo "da conversa" continua marcando o número certo, no rodapé e
      dentro do dropdown, mesmo destravado. Se o superadmin sai dele, a pílula
      fica âmbar com triângulo de alerta e aparece o aviso "o contato vai receber
      de um número que não conhece" (rodapé do Conversas e modal `WhatsappSend`).
- [x] **Verificado ao vivo:** lead 501 → ADMIN recebe `locked=beyond-main`,
      SUPERADMIN recebe `locked=null` com o mesmo `suggested`. No POST com canal
      divergente: ADMIN levou **409 CHANNEL_LOCKED**; SUPERADMIN passou da trava
      e a Cloud API aceitou o envio (lead descartável 557, WhatsApp inválido
      5500000000000 — nenhum contato real recebeu; lead e mensagens removidos).

### Replicação (2026-08-10)

- [x] **Os 5 arquivos aplicados por patch nos 11 tenants** — nunca `cp`.
      `whatsappProvider.ts`, `useChat.ts` e `ConversationsPage.tsx` estavam
      byte-idênticos ao beyond nos 11; só `atendimento.ts` divergia (terram:
      supportFlow/CSAT; severiano: guard de lead de preview "990") e
      `WhatsappSend.tsx` no severiano (customFields em `applyVars`) — regiões
      distintas das alteradas, dry-run limpo, customizações conferidas depois.
- [x] `tsc` em série (nunca em paralelo) no terram e no severiano, back e front:
      limpo. `npx vite build` nos 11 e `pm2 restart` nos 11 — todos online.
- [x] **Efeito colateral aceito, verificado no terram:** lead 3547 é da Flavia
      (dona do `terram_n2`) mas entrou pelo `terram_n1` (Luiz) — agora responde
      pelo `terram_n1` para Flavia, Luiz e Adson. É o caso que a regra dono-first
      de 30/06 tratava ao contrário; o Adson foi avisado e manteve a decisão.
- [x] Commitado e pushado nos 9 repos versionados: beyond `6b763a1`+`d9dfd73`,
      vantari `d064194`, terram `834247e`, ineprotec `aaa4c02`, realeza
      `16b93ad`, severiano `5256493`, habitat `1cb0248`, unialfa `ca737c1`,
      venda360 `1ab3049` (branch `feat/agendamento-100-bot`). demo, elementus e
      kobogo não têm git — replicados em disco.

### Pendente

- [ ] Validação visual das telas pelo usuário.

---

## Hoje · a tarefa se lê de bater o olho (2026-08-10)

> **Pedido:** as tarefas da tela Hoje precisavam de mais detalhes — hora, entre
> outros — para o operador saber de imediato o que fazer.

### Achado no caminho (corrigido junto)

- [x] **A tela escondia justamente o que estava atrasado.** `processScheduledActivities`
      (`routes/activities.ts:708`) marca `pending`→`overdue` 30min depois da hora,
      e a tela consultava só `status: 'pending'` — toda tarefa vencida sumia do
      Hoje. Agora são duas consultas (`pending` + `overdue`, o status é valor
      único na API) unidas no cliente. Medido no beyond: a tela mostrava **3**
      tarefas, passou a mostrar **8** — 5 do próprio dia estavam invisíveis.

### Detalhes por tarefa

- [x] **Hora do agendamento como primeira coluna**, tabular, em três estados de
      urgência: **vermelho** quando passou da hora (por `status: overdue` ou pela
      hora, o que cobre a janela até o job rodar), **âmbar** na próxima hora,
      neutro no resto do dia — com o rótulo "atrasada"/"agora" abaixo.
- [x] **Canal por extenso** (Ligação, WhatsApp, Reunião, E-mail, Tarefa…) ao lado
      do ícone — só o desenho obrigava a decorar.
- [x] **Responsável** (`assignedUser`/`assignedTeam`, com ícone de pessoa ou de
      setor). Nunca o `userName`, que é quem CRIOU — mostrá-lo faria o operador
      achar que a tarefa é de outro.
- [x] **Contato de destino**: `recipientPhone`/`recipientEmail` e, na falta, o do
      lead; telefone para voz/mensagem, e-mail para e-mail.
- [x] **Código da atividade padrão** (`templateCode`) quando houver.
- [x] **Empresa do lead** no cabeçalho do bloco, quando difere do nome exibido.

### Ordem e resumo

- [x] **Tudo em ordem de relógio**: tarefas dentro do bloco e blocos entre si,
      pelo compromisso mais cedo. "Trabalhe de cima para baixo" virou literal.
- [x] **Faixa de resumo no topo**: nº de tarefas, nº de leads, quantas passaram
      da hora e qual é a próxima (hora + canal + lead).
- [x] **Badge "N atrasadas"** por bloco de lead e legenda do semáforo de hora.
- [x] Passo novo no "Como funciona?" explicando a leitura da hora.

### Verificação

- [x] `tsc` limpo; build do frontend com o bundle novo confirmado.
- [x] Renderizado de verdade (Playwright, sessão autenticada) com 4 atividades de
      teste cobrindo atrasada/agora/futura, com e sem responsável — conferido no
      screenshot e removidas em seguida.

### Replicação

- [x] `TodayPage.tsx` era **byte-idêntico** ao beyond nos 11 — aplicado por patch
      mesmo assim (nunca `cp`), dry-run limpo, arquivo conferido idêntico depois.
- [x] `npx vite build` nos 11 com o texto novo confirmado dentro de cada bundle
      `TodayPage-*.js`, e `pm2 restart` nos 11 — todos online.
- [x] Commitado e pushado nos 9 repos versionados: beyond `1bc66b4`, vantari
      `a076fd9`, terram `c028ef7`, ineprotec `f72ca10`, realeza `aaa240a`,
      severiano `d4cdbee`, habitat `7ff36e6`, unialfa `b60fa48`, venda360
      `edbe2ea`. demo, elementus e kobogo não têm git — replicados em disco.

### Pendente

- [ ] Validação visual pelo usuário.
- [ ] Decidir se atrasadas de dias ANTERIORES entram no Hoje (hoje o recorte é o
      dia corrente; elas só aparecem em Atividades → "Atrasadas").

---

## Agenda · disponibilidade do agente editável pelo gestor (2026-08-10)

> **Pedido:** "Minha disponibilidade" só existia para o próprio dono — os
> endpoints `my-availability` eram fixos no usuário do token. O gerente precisava
> ver e editar a agenda dos agentes sem depender de eles entrarem no sistema.

### Dois horários que não são a mesma coisa

O sistema já tinha **horário de trabalho** (Roteamento → Agentes), que decide
quando o agente *recebe leads*, e agora expõe a **disponibilidade** (Agenda), que
decide quando o cliente *pode reservar reunião* com ele. São conceitos distintos
e a UI passou a dizer isso onde os dois aparecem juntos.

### Backend (`routes/scheduling.ts`)

- [x] `readUserAvailability` / `writeUserAvailability` extraídos — as rotas
      `my-availability` (GET/PUT) passaram a ser cascas deles, sem duplicar regra.
- [x] **`GET`/`PUT /api/admin/scheduling/users/:userId/availability`** — mesma
      agenda, por usuário. Gate: só o próprio dono **ou** SUPERADMIN/ADMIN/MANAGER;
      403 para o resto, 404 para usuário inexistente. O GET devolve também
      `{ user: { id, name, email, active } }` para a UI nomear o modal.
- [x] **Auditoria** `scheduling.availability_changed` no histórico do usuário-alvo
      (quem alterou, quando, regras/fuso/nº de exceções antes e depois). Editar a
      própria agenda não gera ruído no histórico.

### Frontend — três portas para o mesmo modal

- [x] `AvailabilityModal` ganhou o modo `userId`, ao lado de `mine` e
      `meetingTypeId`. Título e descrição mudam conforme o modo; o preview de
      slots continua exclusivo do modo por-tipo.
- [x] **Usuários → Opções → "Disponibilidade"** — item novo entre Equipes e
      Histórico, visível só para gerente/admin/superadmin.
- [x] **Roteamento → Agentes → editar** — seção "Disponibilidade para reuniões"
      com resumo de uma linha (`Seg 09:00–11:00 · Ter 14:00–16:00 …`) e botão que
      abre o mesmo modal, com o aviso da diferença para o horário de trabalho.
- [x] **Agenda → Calendário** — botão ao lado do seletor de operador, que aparece
      quando um operador está filtrado.
- [x] Rótulo "Disponibilidade alterada" no histórico do usuário.

### Verificação ao vivo

- [x] Permissões: SUPERADMIN lê/grava a agenda de outro (200); AGENT recebe 403
      ao ler e ao gravar a de outro, e 200 na própria pela mesma rota; usuário
      inexistente devolve 404. Auditoria conferida no banco.
- [x] As três telas renderizadas de verdade (Playwright, sessão autenticada),
      incluindo o **modal dentro do drawer** de Roteamento — dois diálogos
      empilhados, o de disponibilidade por cima, sem fechar o de baixo.
- [x] "Minha disponibilidade" do próprio operador segue funcionando e sem o
      preview de slots.
- [x] Dados de teste desfeitos: a agenda do user 5 foi devolvida ao estado
      original (sem `AvailabilitySchedule`, como antes) e a entrada de auditoria
      gerada pelo teste foi removida.

### Replicação

- [x] Replicado nos 11 e commitado junto com a correção do agendamento —
      ver o bloco seguinte.

### Pendente

- [ ] Validação visual pelo usuário.
- [ ] Avisar o agente quando o gestor alterar a agenda dele (hoje só fica no
      histórico) — decidir se vale notificação.

---

## Agenda · o agente recebia reunião fora da própria disponibilidade (2026-08-10)

> **Incidente:** o agente Asafe não libera manhã (seg–sex 13:00–18:00) e mesmo
> assim o sistema marcou reunião para ele às 11:00 (booking 93, 10/08).

### Diagnóstico

Não havia bypass no sentido de pular validação: os três caminhos que criam
reunião — página pública, `scriptedChatbotFlow` e `aiJourneyEngine` — passam
todos por `validateSlot`. **A validação consultava a agenda errada.**

No modo **Orquestrar pela Equipe** (`assignmentMode: 'team_routing'`),
`schedulingService.ts` fazia `ownerForAgenda = null`, então:

- os horários ofertados vinham da agenda **do tipo de reunião** (o tipo 9 tem
  `AvailabilitySchedule` próprio, seg–sex 09:00–18:00);
- o agente era sorteado **depois**, por `pickOperatorForTeam(teamId)`, que **nem
  recebe o horário da reunião** — decide por presença agora, capacidade e rodízio;
- no mesmo ramo, **bloqueios manuais** (`CalendarBlock`) e **Google Calendar** do
  agente também eram ignorados;
- reservas eram contadas por `meetingTypeId`, então dois tipos apontando para a
  mesma equipe não bloqueavam o mesmo agente (choque latente, ainda não ocorrido).

O **reagendamento** tinha o mesmo furo, e pior: validava contra a malha do tipo
mantendo o operador já fixado no booking.

Auditoria das 38 reuniões ativas com operador: **1 fora da disponibilidade** (a
93, relatada) e **0 choques** de horário. O estrago era pequeno só porque poucos
operadores tinham agenda pessoal configurada.

### Correção (regra escolhida pelo Adson)

- [x] **Slot só é ofertado se ALGUM operador da equipe estiver livre nele.** A
      agenda do tipo virou **teto**; dentro dele, a oferta é a união das agendas
      pessoais dos operadores, já descontando reuniões, bloqueios e Google de cada um
      (`freeSlotsByOperator`). `visibleSlotsPerDay` passou a ser aplicado DEPOIS
      do cruzamento — cortar antes esconderia horário que alguém atende.
- [x] **O rodízio escolhe só entre quem está livre naquele horário.**
      `operatorsFreeAt(teamId, start, end, tz)` + novo parâmetro
      `pickOperatorForTeam(teamId, { onlyUserIds })`, que reaproveita toda a
      lógica existente (capacidade, modos, fallback suave) apenas estreitando o pool.
- [x] **Remarcar respeita o dono da reunião**: `validateSlot` ganhou
      `{ operatorUserId, excludeBookingId }` e a rota pública passa o operador do
      booking. O próprio booking é excluído da checagem de conflito.
- [x] **Preview do admin usa a mesma função da página pública** — antes calculava
      por conta própria e mostrava horários que a oferta real descartava.

### Armadilha evitada no meio do caminho

Montar a oferta com `getEligibleMembers` (a base do roteamento) teria criado uma
regressão grave: aquela função filtra por **presença agora**, horário de trabalho
agora e `isTeamOpen` agora — a página pública ficaria **sem nenhum horário à
noite e no fim de semana**, quando todos estão offline. Por isso a oferta usa a
nova `listSchedulableOperators`, que filtra só o que é estável (usuário ativo,
papel operacional, perfil de agente ativo, fora de férias). Pelo mesmo motivo, se
o rodízio não devolver ninguém por presença mas houver quem atenda **no horário
da reunião**, ela vai para o de menor carga (`leastLoadedAmong`) em vez de ficar
órfã na fila.

### Verificação ao vivo

- [x] Slot das 10:00 de terça (fora da janela do Asafe): **20 sorteios seguidos →
      sempre Benedito**. Antes, era exatamente aí que caía no Asafe.
- [x] Slot das 14:00 (os dois atendem) → distribui normalmente; slot das 08:00
      (ninguém atende) → não é ofertado e, se forçado, cai na fila sem dono.
- [x] **Invariante nos dois tipos ativos: 0 slot ofertado sem operador disponível**
      (tipo 9: 27 slots; tipo 10: 10 slots).
- [x] Remarcar o booking 101 (Asafe) para 10:00 → a malha do tipo aceitava,
      agora **recusa**; para 15:00 → aceita.
- [x] Oferta não zera fora do expediente (27 slots em 5 dias com todo mundo offline).

### Travas complementares — "nunca ofertar horário indisponível"

Pedido do Adson logo depois: garantir que só apareça horário realmente livre,
sem mexer em nenhuma configuração. Medido antes de aplicar — impacto zero nas
configurações atuais em todas elas.

- [x] **Compromissos do CRM ocupam a agenda.** `operatorBusy` passou a somar
      `Activity` de tipo `meeting`/`call` pendente/atrasada do operador (janela de
      `ACTIVITY_BLOCK_MIN` = 60min, já que atividade não tem hora de término).
      Atividades que nasceram de uma reserva (`booking.activityId`) são puladas
      para não contar duas vezes. A Agenda já mostrava esses compromissos; o motor
      de slots é que os ignorava. Casos existentes na aplicação: 0.
- [x] **Trava anti-corrida.** Entre validar o slot e gravar, outro cliente podia
      fechar o mesmo horário. `createBooking` reconfere conflito do operador
      **antes de tocar em lead ou reserva** (para não deixar lead órfão) e devolve
      "Esse horário acabou de ser reservado. Escolha outro."
- [x] **Férias medidas pela data da reunião.** Antes, quem estava de férias sumia
      de TODA a oferta, inclusive dos dias após o retorno. `listSchedulableOperators`
      passou a aceitar `at`, e `operatorsOnVacationAt` desconta a ausência slot a
      slot.
- [ ] **Modo "Dono fixo": agenda do tipo como teto** — não aplicado (o Adson
      deixou de fora). Nenhum tipo usa esse modo hoje; quando usar, a agenda do
      tipo continuará SOBREPONDO a pessoal do dono, como a UI já avisa.

### Verificação das travas

- [x] Atividade de reunião criada no CRM para o Benedito em 11/08 10:00 (único
      que atende esse horário) → o slot **saiu da oferta** (27 → 26) e voltou ao
      remover a atividade (26 → 27).
- [x] Benedito de férias até 12/08 → 11/08 perdeu 10:00 e 11:00 (ficaram só os
      horários do Asafe), e **13/08 manteve 10:00 e 11:00** porque ele já voltou.
      `vacationUntil` restaurado para `null` ao fim.
- [x] Reserva ocupando 11/08 14:00 do Benedito → a checagem de corrida passa a
      acusar conflito e barra o segundo cliente. Reserva de teste removida.

### Limites conhecidos (operacionais, não são bug)

- O Google Calendar só bloqueia horários de quem **conectou** a conta.
- Quem nunca configurou "Minha disponibilidade" assume seg–sex 09:00–18:00 (hoje
  todos os membros de equipe já têm agenda própria, ninguém depende do padrão).
- Uma página de agendamento aberta há muito tempo pode mostrar horário já tomado;
  a reserva é recusada com mensagem clara em vez de duplicar.

### Replicação (2026-08-10)

- [x] **9 arquivos por patch nos 11 tenants** (4 backend + 5 frontend). Todos
      estavam byte-idênticos ao beyond, exceto `schedulingService.ts`, que nos 11
      tem 4 linhas a MAIS: o bloco `supersedePendingSuggestions`, de outra frente,
      ainda não commitado no beyond. O hunk foi **retirado do patch** e o commit
      do beyond foi montado com `git apply --cached` só com os hunks desta
      frente — o bloco alheio segue no working tree, sem dono trocado.
- [x] `tsc` em série (nunca em paralelo) no terram, severiano e venda360, back e
      front: limpo. `npx vite build` nos 11 e `pm2 restart` nos 11 — 13 processos
      online.
- [x] Invariante conferida no terram: tipo 2 "Diagnóstico da Fazenda"
      (team_routing) → 12 slots, **0 sem operador disponível**.
- [x] Commitado e pushado nos 9 repos versionados: beyond `ffc1b1a`, vantari
      `ee3458e`, terram `9252cf8`, ineprotec `3f06b58`, realeza `0175a67`,
      severiano `f92637b`, habitat `84f0f86`, unialfa `bfd9d7b`, venda360
      `79a446c`. demo, elementus e kobogo não têm git — replicados em disco.

### Pendente

- [ ] Validação visual pelo usuário.
- [ ] Booking 93 (Asafe, 10/08 11:00): mantido como está — a decisão com a
      cliente é da operação.

---

## Chatbots · testar um bot de IA pelo painel (2026-08-10)

> **Relatado no habitat:** "o preview do chatbot não está abrindo".

### O que era

O preview **abria** — o que não havia era conversa. O botão **Testar** usa o
`ChatbotTester`, uma **simulação local** que percorre a fila de `ChatQuestion`
do bot. O chatbot do Habitat ("Taty") é `mode: 'ai_journey'` e por isso tem
**0 perguntas**, então o modal só mostrava *"Adicione perguntas antes de
testar."* — sem caminho nenhum para experimentar o bot de dentro do sistema.

O motor real de preview já existia e funcionava: `chatbotPreview.ts` +
`POST /api/chatbots/:id/preview/start` e `/preview/message`, que é o que o
widget de embed usa. Ele só **nunca tinha sido ligado ao painel** — não havia
uma única chamada a essas rotas no frontend.

Não era específico do habitat: `ChatbotTester.tsx`, `ChatbotsPage.tsx`,
`chatbotPreview.ts`, `chatbots.ts` e `useChatbots.ts` estavam **byte-idênticos**
ao beyond. Qualquer tenant com chatbot de IA tinha o mesmo comportamento.

### Correção

- [x] **`ChatbotTester` ganhou o modo IA.** Com `bot.mode === 'ai_journey'`, abre
      sessão em `/preview/start` e cada envio vai por `/preview/message` — a
      mesma conversa do embed, em memória, sem criar lead nem enviar mensagem.
      Bot roteirizado continua na simulação local, sem alteração.
- [x] **"Adicione perguntas antes de testar" agora só vale para bot roteirizado.**
- [x] Estado de "digitando…", erro visível se a chamada falhar, "Reiniciar"
      recomeça a sessão e o campo bloqueia enquanto a IA responde.
- [x] Cabeçalho e descrição do modal dizem a verdade em cada modo: no bot de IA,
      "conversa com o motor real, em memória: não cria lead nem envia mensagem".

### Verificação ao vivo (habitat)

- [x] Painel → Chatbots → **Testar**: a Taty abre com a saudação, respondeu a
      "Maria" e a "Próximo ano" seguindo o roteiro, com as opções numeradas.
      Sem erro de console e sem HTTP ≥ 400.
- [x] Antes da correção o mesmo caminho parava em "Adicione perguntas antes de
      testar"; o embed público (`/api/chatbots/embed/preview/1`) já funcionava e
      continua funcionando.

### Pendente

- [ ] Replicar nos outros 10 tenants (aplicado só em beyond e habitat).
- [ ] `chatbotPreview.ts:304` engole a exceção real e sempre culpa a chave de IA
      ("Verifique se a chave de IA está configurada"). Vi esse aviso uma vez, sem
      conseguir reproduzir depois — enquanto o `catch` não registrar o motivo, um
      erro intermitente vai continuar apontando para o lugar errado.

---

## WhatsApp · LID entrava no CRM como se fosse telefone (2026-08-10)

> **Relatado:** um contato no Conversas do beyond aparecia com o "número"
> `123093846614261`.

### Diagnóstico

`123093846614261` é um **LID** — identificador de privacidade do WhatsApp, não um
telefone. A mensagem chegou com `addressingMode: "lid"` e, sem conseguir traduzir
o LID, o webhook gravou o próprio LID no campo do telefone (lead 560, `waLid`
preenchido e `phoneKey` nulo).

O tradutor `resolveLidToPhone` funciona por **adivinhação** contra o banco do
Evolution: mesma foto de perfil, correlação de mensagens enviadas, mesmo
`pushName`. Esse contato não tem foto e o `pushName` é só **"J"** — as três
falharam. Na base do Evolution há **11.093 contatos `@lid`**, sendo **5.648 sem
foto** e **3.920 sem nome**: a heurística tende a falhar cada vez mais.

**O dado já vinha pronto e era ignorado.** O payload da Evolution traz o número
real em `key.remoteJidAlt` (`558881690847@s.whatsapp.net` neste caso) e não havia
**nenhuma** referência a esse campo no código.

### Correções

- [x] **`routes/whatsapp.ts` lê `key.remoteJidAlt` primeiro**, validando com
      `phoneKey()`, e só cai nas heurísticas se ele não vier. Verificado com
      payload sintético: `[Webhook] LID 999888777666555@lid → 5500000000000
      (remoteJidAlt)` e o lead nasceu com o telefone certo — antes teria nascido
      com o LID. Lead de teste removido.
- [x] **`services/dedup.ts`: o merge passou a absorver o `waLid`** do lead
      secundário. Sem isso, mesclar duplicata perdia o LID e a mensagem seguinte
      da mesma pessoa criava outra duplicata — desfazendo a mesclagem.

### O lead 560 era duplicata, não um contato novo

Eu havia dito que não existia outro lead com aquele telefone. **Estava errado:**
procurei pela substring `8881690847` e o lead **541 "João"** está gravado como
`5588981690847` — com o nono dígito, que quebra o `LIKE`. A comparação certa é
por `phoneKey`, que normaliza os dois para `5588981690847` (`samePhone` = true).

- [x] Mesclado com `mergeLeads` (a ferramenta da tela de duplicados): **541 João**
      mantido, 560 absorvido e excluído, mensagens preservadas, e o
      `waLid: 123093846614261@lid` agora está no João — então mensagens futuras
      dessa pessoa por LID caem na conversa certa.

### Pendente

- [ ] Replicar nos 11 tenants (correções ainda só no beyond).
- [ ] Varrer os tenants atrás de leads antigos com LID gravado como telefone: no
      beyond havia só 1, mas o `remoteJidAlt` não existia antes e outros tenants
      podem ter acumulado.
