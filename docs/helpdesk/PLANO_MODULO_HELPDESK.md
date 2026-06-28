# Módulo Helpdesk / Chamados — Plano de Implementação

> **Objetivo:** entregar um módulo **nativo** de suporte/chamados com paridade funcional ao
> **Zendesk** e ao **Freshdesk**: tickets multicanal, SLA configurável, automações/macros,
> base de conhecimento, portal do cliente, CSAT e analytics — reaproveitando ao máximo a
> infraestrutura já existente no bychat-beyond (roteamento, filas BullMQ, escalonamento,
> templates, tags, anexos, IA).
>
> **Status:** PLANO (nada implementado). Data: 2026-06-16.
> **Repositório base:** `/var/www/bychat-beyond` (replicar nos demais tenants depois).

---

## 1. Análise e Decisões de Arquitetura

### 1.1 O que já existe e será reaproveitado (~70%)

| Capacidade | Onde está hoje | Reuso no Helpdesk |
|---|---|---|
| Roteamento por setor (round-robin / least-loaded / random / skills) | `services/teamRouting.ts`, `services/routing/policyEngine.ts`, model `RoutingRule` | **100%** — fila de tickets usa o mesmo motor |
| Equipes / membros / líderes | models `Team`, `TeamMember` | **100%** — "grupos" do Zendesk = `Team` |
| Horário de atendimento | `TeamWorkingHour`, `AgentWorkingHour` | base do **calendário de SLA** |
| Escalonamento por tempo (cron 5min) | `services/routing/escalation.ts` | estendido para escalonamento de SLA |
| SLA de 1ª resposta (leve) | Setting `routing.sla.firstResponseMinutes`, `Lead.firstResponseAt`, `markFirstResponseIfNeeded` | semente do **SLA Engine** completo |
| Filas assíncronas + delay | BullMQ em `lib/queues.ts`, workers em `services/workers.ts` | **timers de SLA** (job com `delay`) |
| Mensageria WhatsApp (Cloud API + Evolution) | `routes/atendimento.ts`, `routes/cloudApiWebhook.ts`, model `Message` | canal WhatsApp do ticket |
| Templates multicanal | model `MessageTemplate`, `routes/templates.ts` | **macros** e **respostas prontas** |
| Notificações (email/WhatsApp/in-app) | `services/notify.ts`, eventos/workflows | gatilhos de SLA, atribuição, resposta |
| Tags, Campos personalizados, Anotações | `Tag`/`LeadTag`, `CustomField`, `LeadNote` | tags/campos/notas do ticket |
| Anexos | model `LeadAttachment` | anexos do ticket (**100%**) |
| IA (lead score, jornada, geração) | `services/aiLeadScoreService`, `aiJourneyEngine`, Setting de provider | triagem/sugestão/answer-bot |
| Módulos + permissões CRUD + sidebar + ModuleGate | `lib/moduleRegistry.ts`, `lib/permissions.ts`, `sidebar.config.ts`, `ModuleGate.tsx` | registro do módulo `helpdesk` |
| Auditoria por entidade | `LeadEvent`, `UserAudit` | timeline imutável do ticket |

### 1.2 O que é genuinamente NOVO

- Entidade **`HelpdeskTicket`** com **protocolo sequencial** por tenant, status próprio, prioridade, tipo.
- Thread unificada **`HelpdeskComment`** (público vs. interno) sobre múltiplos canais.
- **SLA policies** estruturadas (condições → metas de 1ª resposta / próxima resposta / resolução) com calendário, pausa e breach.
- **Triggers** (event-based) e **Automations** (time-based) próprios do helpdesk.
- **Base de Conhecimento** (Help Center) com artigos/categorias/seções/busca.
- **Portal do Cliente** (self-service) + autenticação do solicitante.
- **CSAT/NPS** (pesquisa pós-resolução).
- **Organizações** (B2B), planos de suporte, agentes light/colaboradores.
- Relacionamento entre tickets: **merge / split / link / parent-child / problem↔incident**.

### 1.3 Decisão central: `Ticket` dedicado (NÃO estender `Lead`)

**Escolhido: modelo `HelpdeskTicket` próprio**, com `requesterLeadId` opcional para vincular ao contato.

Justificativa:
1. **Cardinalidade:** um solicitante abre **N tickets** ao longo do tempo; `Lead` é ~1 por contato. Reusar `Lead` colidiria com dedup, funil e score.
2. **Separação de domínio:** suporte por e-mail/portal não deve poluir o pipeline comercial (Kanban, cadências, CAPI). 
3. **Semântica própria:** status (`open/pending/on_hold/solved/closed`), SLA, protocolo e CSAT não existem em `Lead`.
4. **Reuso sem acoplamento:** o ticket **referencia** `Team`, `RoutingRule`, `User`, `Tag`, `MessageTemplate`, filas e escalonamento — sem duplicar essa infra.

Ponte com o CRM: `HelpdeskTicket.requesterLeadId?` e `organizationId?` permitem ver, no detalhe do Lead, os chamados daquele contato, e abrir ticket a partir de uma conversa.

### 1.4 Paridade Zendesk/Freshdesk → Fase

| Recurso Zendesk/Freshdesk | Fase |
|---|---|
| Ticket (status, prioridade, tipo, assignee, grupo, requester, CC/followers) | F1 |
| Agent workspace (views, filtros, bulk, colisão, atalhos) | F2 |
| Email-to-ticket + reply by email (threading) | F3 |
| Web form / widget de contato | F3 |
| WhatsApp / chat / API / telefone como canal | F3 |
| SLA policies (1ª resposta / próxima / resolução, business hours, breach) | F4 |
| Triggers (event) + Automations (time) | F5 |
| Macros / respostas prontas | F5 |
| Atribuição automática / skills / load balancing | F5 (reusa) |
| Knowledge Base / Help Center | F6 |
| Portal do cliente (self-service) | F7 |
| CSAT / pesquisa de satisfação / NPS | F8 |
| Organizações (companies) + planos de suporte + light agents | F9 |
| Merge / split / link / parent-child / problem-incident | F10 |
| Relatórios, dashboards, SLA compliance, time tracking | F11 |
| IA: triagem, sugestão de resposta, answer-bot, sentimento, resumo | F12 |
| Ticket forms múltiplos, multi-marca, spam/suspended, webhooks/apps | F13 |
| Hardening, LGPD, performance, multi-tenant, testes | F14 |

**MVP recomendado (produção mínima viável):** F0 → F5 + F11(básico).
**Paridade plena:** F0 → F14.

---

## 2. Fases de Implementação

Convenções: tabelas com prefixo `bychat_helpdesk_*`; migrations via `prisma db push` (padrão do
projeto); deploy frontend via `npx vite build`; replicar nos tenants após validar no beyond.
Cada item nasce `[ ]` e vira `[x]` ao concluir (+ atualizar memória).

---

### Fase 0 — Fundação, Modelo de Dados e Navegação ✅ ENTREGUE (beyond, 2026-06-16)

> Registrar o módulo, criar o núcleo do schema e a casca de navegação. Sem regras de negócio ainda.
> **Status:** entregue e validado no beyond (smoke test OK: protocolo #1001, thread, firstResponseAt/solvedAt, timeline, counters). NÃO commitado; NÃO replicado nos outros tenants.

- [x] **Registro do módulo** — `helpdesk` em `lib/moduleRegistry.ts` (`routePrefixes: ['/api/helpdesk','/api/admin/helpdesk']`, `category: 'support'`, `defaultEnabled:false`). Ativado no beyond via `setModuleEnabled` (SUPERADMIN/ADMIN CRUD, MANAGER sem delete, VIEWER nada). **Pendente:** AGENT não recebe permissão (não está em DEFAULT_ROLE_PRESETS) — avaliar na F1.
- [x] **Schema núcleo (`prisma/schema.prisma`)** — `HelpdeskTicket`, `HelpdeskComment`, `HelpdeskTicketEvent`, `HelpdeskSequence`. Vínculos com Lead/User/Team são **escalares indexados (sem @relation)** para manter a migração 100% aditiva; FK relations entram em fases futuras. `db push` aplicado (4 CREATE TABLE, 0 DROP/ALTER em tabelas existentes).
- [x] **Backend casca** — `routes/helpdesk.ts` (registrado em `server.ts`): `GET /meta`, `GET/POST /tickets`, `GET/PATCH/DELETE /tickets/:id`, `POST /tickets/:id/comments`. Já inclui transições de status (solvedAt/closedAt/reopen), firstResponseAt na 1ª resposta pública e timeline de eventos. Serviço `services/helpdesk.ts`.
- [x] **Frontend casca** — `HelpdeskPage.tsx` (lista+filtros+busca, criar via modal, detalhe com thread público/interno, responder, mudar status/prioridade, timeline) + `useHelpdesk.ts` (React Query), rota em `Router.tsx`, grupo "Suporte" no `sidebar.config.ts` (ícone `LifeBuoy`), protegido por `ModuleGate`.
- [x] **Geração de protocolo** — `nextTicketNumber()` (UPDATE ... increment atômico + @unique como defesa final); base 1000 → primeiro = #1001.
- Complexidade: Média | Prioridade: **Crítica** (base de tudo)

---

### Fase 1 — Ticket Core (CRUD + Ciclo de Vida) ✅ ENTREGUE (beyond, 2026-06-16)

> O coração: criar, ler, atualizar e transicionar tickets, com thread público/privado.
> **Status:** entregue e validado no beyond (smoke test F1 verde: claim/assign/release, requester herdando contato do Lead #372, followers, tags, transição inválida→409, reabertura→reopenCount, anexo upload 25MB). NÃO commitado; NÃO replicado.

- [x] **CRUD de ticket** — criar, listar (filtros+busca+counters+paginação), detalhe, atualizar campos (entregue na F0, mantido).
- [x] **Máquina de estados** — `STATUS_TRANSITIONS` + `canTransition()` em `services/helpdesk.ts`; PATCH rejeita transição inválida com **409**; `solved/closed` setam marcos; reabertura incrementa `reopenCount` e limpa solvedAt/closedAt. Cada transição grava `HelpdeskTicketEvent`.
- [x] **Atribuição** — `POST /tickets/:id/claim` (assume + new→open), `/assign` ({userId,teamId}, valida user ativo), `/release` (devolve à fila). Selects de agente/setor via `GET /helpdesk/agents` e `/helpdesk/teams`.
- [x] **Thread + anexos** — comentário público/nota interna (F0) + **anexos** (`HelpdeskAttachment`, upload multipart 25MB em `uploads/helpdesk-attachments/`, servido por `/uploads/*`; reusa padrão de `LeadAttachment`).
- [x] **Requester** — `GET /helpdesk/leads/search` + `POST /tickets/:id/requester` (vincula Lead herdando nome/email/whatsapp, ou contato manual) + `DELETE` desvincula. **CC/followers** (`HelpdeskFollower`: userId OU email) add/remove.
- [x] **Tags & Campos personalizados** — tags do catálogo via `POST /tickets/:id/tags` (valida contra `Tag` ativas) + `GET /helpdesk/tags-catalog`; campos via `GET /helpdesk/custom-fields` (`group:'helpdesk'`) — backend pronto, UI de edição de campos fica para refino.
- [x] **Timeline/Auditoria** — `HelpdeskTicketEvent` para todas as ações (assigned/released/requester_changed/follower_added/tags_changed/attachment_added/status_changed…); UI no painel lateral.
- [x] **Prioridade & Tipo** — editor inline com badges + cor por prioridade (UI).
- Complexidade: Alta | Prioridade: **Crítica**

---

### Fase 2 — Agent Workspace (Caixa de Trabalho do Agente) ✅ ENTREGUE (beyond, 2026-06-16)

> A tela onde o agente vive. Inspirada na inbox de Conversas, adaptada a tickets.
> **Status:** entregue e validado no beyond (smoke test verde: bulk priority/assign/status/delete `updated:3`, filtros priority/assignee, colisão user1↔user2 via Redis). NÃO commitado; NÃO replicado.

- [x] **Views/filtros** — chips por status + filtros responsável (Meus/Não atribuídos), prioridade e setor. Backend `GET /tickets` já aceita status/priority/type/channel/assignedUserId(me|null|id)/teamId/q. *(Views salvas via `SavedFilter` e relógio de SLA ficam para F4.)*
- [x] **Lista + seleção** — lista com checkboxes (selecionar todos), contadores, badges de prioridade/status; abre o detalhe ao clicar.
- [x] **Ações em massa (bulk)** — `POST /tickets/bulk` (status com validação de transição/skip, priority, assign, team, tag append, delete) + barra de ações na UI. *(Aplicar macro fica para F5.)*
- [x] **Detecção de colisão** — `POST /tickets/:id/presence` (heartbeat via Redis hash `hd:viewing:<id>`, TTL 60s, stale 25s) + `usePresence` (polling 12s) → banner "Fulano também está vendo".
- [ ] **Atalhos de teclado** — adiado (nice-to-have).
- [ ] **Aplicar macro** no compositor — depende de F5 (Macros).
- Complexidade: Alta | Prioridade: **Alta**

---

### Fase 3 — Canais de Entrada (Omnichannel Intake) ✅ ENTREGUE PARCIAL (beyond, 2026-06-16)

> De onde os tickets nascem. Cada canal cria/atualiza ticket e alimenta a thread.
> **Status:** núcleo entregue e validado (smoke test verde: API pública #1006, inbound email novo #1007 + threading por `[#1007]`, secret errado→401, WhatsApp→ticket #1008). NÃO commitado; NÃO replicado.

- [x] **Ingestão unificada** — `intakeTicket()` em `services/helpdesk.ts`: gera protocolo, aplica roteamento default (Setting `helpdesk.default_team_id`), evento `created via <canal>`, 1º comentário do solicitante.
- [x] **E-mail → Ticket** — `POST /api/v1/helpdesk/inbound-email` (autentica por `helpdesk.inbound_email_secret`, header `x-inbound-secret` ou `?secret=`; compatível com Mailgun/SendGrid/Postmark inbound parse). Parsing From/Subject/Body. **Threading** por `#<protocolo>` no assunto.
- [x] **Reply-by-email do solicitante** — e-mail com `#protocolo` vira comentário público do `requester`; reabre ticket `solved` (status→open, reopenCount++).
- [x] **API pública** — `POST /api/v1/helpdesk/tickets` com `X-API-Key` (novo scope `helpdesk:write`/`helpdesk:read` em `lib/apiKey.ts`).
- [x] **WhatsApp & Chat → ticket** — `POST /api/helpdesk/tickets/from-lead/:leadId` (canal whatsapp, herda contato do Lead). *(Botão nas Conversas é refinamento cross-module.)*
- [x] **Roteamento na entrada (simples)** — Setting `helpdesk.default_team_id` aplicado na ingestão; UI "Canais" (modal) configura setor default + gera segredo/URL de inbound.
- [ ] **Web form / widget SSR público** — adiado para a F7 (Portal do Cliente); o endpoint público de criação já permite qualquer front consumir.
- [ ] **Telefone/VoIP** — adiado.
- [ ] **Roteamento por regras (`RoutingRule`)** — adiado para F5 (só setor default em F3).
- [ ] **Envio outbound de e-mail do agente** (resposta sai por SMTP com `#protocolo` no assunto) — adiado para F5/Notificações.
- Complexidade: Alta (email é o mais sensível) | Prioridade: **Alta**

---

### Fase 4 — SLA Engine Completo ✅ ENTREGUE (beyond, 2026-06-16)

> Paridade real com Zendesk: políticas por condição, calendário, metas múltiplas, breach e escalonamento.
> **Status:** entregue e validado (smoke test verde, incl. **business hours**: sex 17:30+60min→seg 09:30, pula fim de semana e feriado; pausa/retomada; breach via sweep). NÃO commitado; NÃO replicado.

- [x] **Schema** — `HelpdeskSlaPolicy` (`conditions`: priorities/channels/types/teamIds; `firstResponseMins`/`resolutionMins` por prioridade; `useBusinessHours`; `calendarId`), `HelpdeskBusinessCalendar` (`weekdayHours` 0-6 + `holidays` + `timezone`), campos no `HelpdeskTicket` (slaPolicyId, targetFirstResponseAt/targetResolutionAt, slaFirstResponseStatus/slaResolutionStatus, slaPausedAt, slaPausedMs, slaBreachNotifiedAt).
- [x] **Cálculo de metas** — `applySlaToTicket` casa 1ª política ativa e grava metas; `addBusinessMinutes` (timezone-aware via Intl) respeita expediente/feriados; modo 24/7 quando sem calendário. Recalcula em mudança de prioridade e reabertura.
- [x] **Estados de pausa** — `pauseSla`/`resumeSla`: `pending`/`on_hold` pausam o relógio de resolução; ao retomar, acumula `slaPausedMs` e empurra `targetResolutionAt`.
- [x] **Breach & alertas** — cron `startSlaScheduler` (varredura 60s, `sweepSla`) marca `pending→at_risk→breached`; registra evento `sla_breached` uma vez (`slaBreachNotifiedAt`). *(Opção por cron de varredura no lugar de BullMQ — mais simples e resiliente a mudanças de estado.)*
- [x] **UI** — relógio/badge de SLA na lista e no detalhe (No prazo / Vence em Xh / Atrasado Xh) + modal "SLA" com CRUD de políticas (metas por prioridade, 24/7 vs horário comercial) e criação de calendário padrão.
- [ ] **Escalonamento multinível por SLA** (reatribuir/elevar prioridade no breach) — adiado para refino/F5; hoje o breach gera evento/alerta.
- [ ] **Notificação externa (email/WhatsApp) no breach** — adiada para F5/Notificações (hoje evento na timeline).
- [ ] **Next response SLA** — adiado (cobertos 1ª resposta + resolução).
- Complexidade: **Muito Alta** | Prioridade: **Crítica** (diferencial principal)

---

### Fase 5 — Automação: Triggers, Automations e Macros ✅ ENTREGUE (beyond, 2026-06-16)

> Regras que reduzem trabalho manual — o "cérebro" operacional do helpdesk.
> **Status:** entregue e validado (smoke test verde: trigger urgent→open+tag, macro aplica ações+renderiza resposta, automation pending→solved via cron). NÃO replicado.

- [x] **Executor compartilhado** — `applyTicketActions` (`services/helpdeskAutomation.ts`): setStatus/setPriority/setType/assign/team/addTags/reply, com reações de SLA (recalcular/pausar/retomar) e log. Usado por macros, triggers e automations.
- [x] **Triggers (event-based)** — `runTriggers('created'|'replied'|'status_changed')` nos pontos do fluxo; condições (priorities/channels/types/statuses/teamIds/subjectContains) → ações. Evento `trigger_fired`.
- [x] **Automations (time-based)** — cron `startAutomationScheduler` (2 min): condições (statuses/olderThanMins/noFirstResponse/channels) → ações em lote. Evento `automation_fired`.
- [x] **Macros** — `HelpdeskMacro` + `POST /tickets/:id/apply-macro`: aplica ações e **devolve o texto de resposta** (com variáveis `{{ticket.number}}`/`{{requester.name}}`) para o compositor revisar antes de enviar. Seletor de macro no compositor.
- [x] **UI** — modal "Automação" com abas Macros / Triggers / Automations (CRUD compacto) + aplicar macro no compositor.
- [ ] **Reusar builder visual (ReactFlow)** — não usado; condições/ações via formulário compacto (suficiente; builder visual é refino futuro).
- [ ] **Atribuição automática round-robin/skills na entrada** — adiada (hoje setor default + assign por trigger).
- [ ] **Notificação externa (email/WhatsApp) como ação** — adiada (reusar `notify.ts`).
- Complexidade: Alta | Prioridade: **Alta**

---

### Fase 6 — Base de Conhecimento (Help Center) ✅ ENTREGUE (beyond, 2026-06-16)

> Conteúdo self-service que também alimenta deflection e answer-bot (F12).
> **Status:** entregue e validado (smoke test verde: CRUD, draft oculto do público, publicar, busca tokenizada, voto, viewCount, deflection). NÃO replicado.

- [x] **Schema** — `KbCategory` + `KbArticle` (`title`, `slug` auto, `body` LongText, `excerpt`, `keywords`, `status` draft/published, `visibility` public/internal, `locale`, `votesUp/Down`, `viewCount`, SEO, `publishedAt`). *(KbSection omitido — categorias→artigos em 2 níveis no MVP.)*
- [x] **CRUD admin** — `routes/helpdeskKb.ts`: `/api/admin/helpdesk/kb/categories` e `/articles` (gated pelo módulo). Slug único automático.
- [x] **Navegação pública** — API do Help Center sob `/api/v1/helpdesk/kb/*` (sem auth): categorias, artigos (published+public), artigo por slug (incrementa view), voto 👍/👎. **Busca tokenizada** (casa qualquer palavra ≥3 em título/keywords/excerpt). *(Página SSR `/ajuda` renderizada fica para a F7 — Portal do Cliente; a API já serve qualquer front.)*
- [x] **Artigos internos** — `visibility:'internal'` some do público; visível só no painel.
- [x] **Deflection** — `/api/v1/helpdesk/kb/suggest` (público) + `/api/helpdesk/kb/suggest` (agente); sugestões aparecem ao digitar o assunto no modal de novo chamado.
- [x] **Editor** — modal de gestão (categorias + artigos, status/visibilidade/categoria/excerpt/body/keywords). *(Rich text WYSIWYG é refino; hoje body HTML/markdown via textarea.)*
- [ ] **Multi-idioma** — campo `locale` existe; UI de tradução/fallback adiada.
- Complexidade: Média-Alta | Prioridade: **Média**

---

### Fase 7 — Portal do Cliente (Self-Service) ✅ ENTREGUE (beyond, 2026-06-16)

> Onde o solicitante acompanha e responde seus chamados.
> **Status:** entregue e validado (smoke test verde: abrir/listar/detalhe/responder, exchange magic→sessão, responder em solved reabre). NÃO replicado.

- [x] **Auth do solicitante** — magic link por e-mail com token HMAC dedicado (`lib/helpdeskPortalAuth.ts`, segredo `HELPDESK_PORTAL_SECRET` com fallback em `secrets.ts`). `request-link` (30 min) → `exchange` → sessão de 7 dias. Setting `helpdesk.portal_expose_link` expõe o link quando não há e-mail configurado.
- [x] **Meus chamados** — `GET /api/v1/helpdesk/portal/me` (lista por e-mail) + `/tickets/:number` (thread **só pública**) + `reply` (comentário do requester; **reabre se solved**).
- [x] **Abrir chamado** — `POST /api/v1/helpdesk/portal/tickets` → `intakeTicket(channel='web')`, herda nome de chamado anterior.
- [x] **Status amigável** — Recebido / Em andamento / Aguardando você / Resolvido…
- [x] **Página pública** — SSR `/suporte` (HTML+JS self-contained, servida pelo backend): pedir link, meus chamados, abrir, responder; tema escuro.
- [ ] **Deflection no portal / anexos no portal** — adiados (deflection já no painel; anexos via API existem mas não expostos no portal).
- [ ] **Branding por tenant + domínio próprio** — adiado (página com tema padrão).
- [ ] **CSAT no fechamento** — F8.
- Complexidade: Alta | Prioridade: **Média**

---

### Fase 8 — CSAT / Satisfação e Pesquisas ✅ ENTREGUE (beyond, 2026-06-16)

> **Status:** entregue e validado (smoke test verde: disparo ao resolver, resposta pública 1–5, stats por agente, idempotência). NÃO replicado.

- [x] **Schema** — `HelpdeskSurvey` (`ticketId` unique, `token` público, `rating` 1–5, `comment`, `respondedAt`, `agentUserId`, `teamId`).
- [x] **Disparo** — `createSurveyOnSolve` idempotente ao transicionar para `solved` (PATCH, bulk, automação). *(Envio imediato/portal; job BullMQ com delay é refino.)*
- [x] **Coleta** — página pública `/avaliar/:token` (estrelas 1–5 + comentário) + API `/api/v1/helpdesk/csat/:token`. Integrado ao portal `/suporte` (convite ao ver chamado resolvido).
- [x] **Relatórios** — `/api/admin/helpdesk/csat/stats?range=`: CSAT% (4–5), nota média, taxa de resposta, distribuição, por agente, comentários recentes. Modal "CSAT" no painel + nota no detalhe do ticket.
- [ ] **NPS / envio por email-WhatsApp automático com delay** — adiado (hoje pesquisa via portal/link).
- Complexidade: Média | Prioridade: **Média**

---

### Fase 9 — Organizações (B2B) e Contatos de Suporte ✅ ENTREGUE PARCIAL (beyond, 2026-06-16)

> **Status:** entregue e validado (smoke test verde: auto-link por domínio, SLA override por org, visão, filtro). NÃO replicado.

- [x] **Schema** — `HelpdeskOrganization` (`name`, `domains` [], `supportPlan`, `slaPolicyId`, `notes`, `active`) + `organizationId` no ticket.
- [x] **Vínculo** — auto por domínio do e-mail na ingestão (`resolveOrganizationId`) e na criação manual.
- [x] **Planos de suporte / SLA por org** — `slaPolicyId` força a política no `applySlaToTicket` (override do match por condições). Campo `supportPlan` livre.
- [x] **Visão da organização** — `/api/admin/helpdesk/organizations/:id/tickets` (chamados + por status) + filtro `organizationId` na lista. Modal de gestão (domínios/plano/SLA) + org exibida no detalhe do ticket.
- [ ] **Agentes light / colaboradores** — adiado (toca roles/licenciamento; novo role `COLLABORATOR`).
- [ ] **Horas contratadas / consumo** — adiado.
- Complexidade: Média-Alta | Prioridade: **Média-Baixa**

---

### Fase 10 — Relacionamento entre Tickets ✅ ENTREGUE (beyond, 2026-06-16)

> **Status:** entregue e validado (smoke test verde: link + inverso automático, resolver incidentes, merge, follow-up). NÃO replicado.

- [x] **Link genérico** — `HelpdeskTicketLink` (related/duplicate/blocks/blocked_by/parent/child/problem/incident/follow_up/merged); inverso computado na exibição (`inverseLinkType`). Endpoints add/remove; exibido no detalhe.
- [x] **Merge** — `POST /tickets/:id/merge` move comentários+anexos para o destino, nota interna de mescla, encerra a origem (closed), link `merged`.
- [x] **Problem ↔ Incident** — link `incident`/`problem` + `POST /tickets/:id/resolve-incidents` resolve todos os incidentes vinculados (dispara CSAT).
- [x] **Follow-up** — `POST /tickets/:id/follow-up` cria continuação herdando solicitante, link `follow_up`.
- [x] **Parent ↔ Child** — disponível como tipo de link. *(Cascade de fechar pai→filhos: adiado.)*
- [ ] **Split / Side-conversation** — adiado.
- Complexidade: Alta | Prioridade: **Baixa**

---

### Fase 11 — Relatórios, Dashboards e Time Tracking ✅ ENTREGUE (beyond, 2026-06-16)

> **Status:** entregue e validado (smoke test verde: volume/backlog, SLA%, tempos, por agente, tendência, export CSV). NÃO replicado.

- [x] **Dashboard operacional** — `/api/admin/helpdesk/reports?range=`: criados/resolvidos/backlog/reaberturas, por status/prioridade/canal/tipo, tendência diária (criados vs resolvidos).
- [x] **SLA compliance** — % dentro do SLA de 1ª resposta e de resolução (met vs breached).
- [x] **Performance de agente** — atribuídos, resolvidos, TMA (resolução), reaberturas, CSAT por agente.
- [x] **Tempos** — TMR (1ª resposta) e TMA (resolução) médios, computados de createdAt→firstResponseAt/solvedAt.
- [x] **Export** — CSV `/api/admin/helpdesk/reports/export` (download autenticado via blob). Modal "Relatórios" com KPIs, distribuições, tendência e tabela por agente.
- [ ] **Time tracking manual (timer faturável) / XLSX** — adiado (hoje tempos derivados dos timestamps; export CSV).
- Complexidade: Média-Alta | Prioridade: **Alta**

---

### Fase 12 — Inteligência Artificial (paridade Answer Bot / Freddy) ✅ ENTREGUE (beyond, 2026-06-16)

> Reusa o provider de IA configurado em Configurações › APIs (Anthropic preferido, fallback OpenAI) via `chatWithAI`.
> **Status:** código entregue e endpoints validados (gating + erro gracioso). ⚠️ Teste ao vivo do LLM **bloqueado** por credenciais inválidas no beyond (OpenAI 401, Anthropic 404 modelo) — afeta TODOS os recursos de IA; corrigir chaves em Configurações › APIs. NÃO replicado.

- [x] **Triagem automática** — `POST /tickets/:id/ai/triage` retorna prioridade/tipo/sentimento + resumo (sugestão; agente aplica).
- [x] **Sugestão de resposta** — `POST /tickets/:id/ai/suggest-reply` (rascunho a partir da thread + artigos da KB) → compositor.
- [x] **Resumo do ticket** — `POST /tickets/:id/ai/summarize` (TL;DR para handoff).
- [x] **Análise de sentimento** — incluída na triagem (positivo/neutro/negativo).
- [x] **Robustez** — `GET /helpdesk/ai/status`; 503 quando IA não configurada; 502 com mensagem em falha do provider. UI só mostra botões quando configurado.
- [ ] **Answer-bot / auto-resolução no portal** — adiado (deflection KB já existe).
- [ ] **Detecção de idioma / resposta multilíngue** — adiado.
- Complexidade: Alta | Prioridade: **Média** (forte diferencial)

---

### Fase 13 — Administração Avançada e Extensibilidade ✅ ENTREGUE PARCIAL (beyond, 2026-06-16)

> **Status:** webhooks + spam entregues e validados (smoke verde: evento emitido/casado/despachado via WebhookLog — bloqueio só pelo alvo localhost de teste; spam mark/unmark/filtro). NÃO replicado.

- [x] **Webhooks de saída & eventos** — eventos `helpdesk.ticket.{created,status_changed,solved,replied}` no catálogo de webhooks; emitidos via `emitHelpdeskWebhook`→`dispatchStandaloneEvent` (reusa infra de webhooks existente: HMAC, retries, logs, SSRF). Configuráveis em Integrações › Webhooks de Saída.
- [x] **Spam / Suspended** — campo `isSpam`; `POST /tickets/:id/spam` + bulk `spam`; lista exclui spam por padrão (`?spam=1` mostra só spam). UI: chip Spam, ação no detalhe e no bulk.
- [ ] **Ticket forms múltiplos** — adiado.
- [ ] **Multi-marca** — adiado.
- [ ] **Marketplace / apps internos** — adiado.
- [ ] **Importação Zendesk/Freshdesk** — adiado.
- Complexidade: Alta | Prioridade: **Baixa**

---

### Fase 14 — Hardening, LGPD, Performance e Go-Live ✅ ENTREGUE PARCIAL (beyond, 2026-06-16)

> **Status:** permissões, LGPD e índices entregues e validados (smoke verde: AGENT view/create/edit mas DELETE→403; LGPD redige PII). Replicação nos tenants = passo operacional pendente.

- [x] **Permissões finas** — `ACTION_OVERRIDES`: sub-rotas de `/tickets/:id/*` e `/tickets/bulk` = `edit` (criar=create, excluir=delete). **AGENT** recebeu permissão no módulo (view/create/edit, sem delete, scope all) — validado: AGENT opera tudo menos excluir ticket.
- [x] **LGPD** — `POST /api/admin/helpdesk/lgpd/anonymize {email}` redige nome/e-mail/telefone do solicitante nos chamados + autoria dos comentários; evento `lgpd_anonymized`. Reusa `DataSubjectRequest` do tenant para o fluxo do titular.
- [x] **Performance** — índices `requesterEmail`, `organizationId` (além de status+priority/assignedUserId/teamId/createdAt já existentes).
- [x] **Documentação** — este plano + memória atualizados a cada fase.
- [ ] **Segurança extra / testes automatizados** — rate-limit dedicado nas rotas públicas e suíte de testes: adiados (rotas públicas já sob hardening F0–F5 global; validação via smoke tests por fase).
- [ ] **Replicação multi-tenant** — PENDENTE (operacional): aplicar branch + `db push` + `vite build` + restart + ativar módulo/permissões em terram/vantari/ineprotec/realeza/venda360.
- Complexidade: Média-Alta | Prioridade: **Crítica** (antes do go-live)

---

## ✅ Módulo Helpdesk — F0 a F14 entregues no beyond (2026-06-16)

Branch `feat/helpdesk-module` (pushed). Pendências operacionais: **merge do PR** e **replicação nos demais tenants**. IA depende de chaves válidas (config atual do beyond inválida).

---

## 3. Dependências e Sequenciamento

```
F0 ─► F1 ─► F2 ─┬─► F3 ─► F4 ─► F5 ──► F11(básico)  ◄── MVP de produção
                │
                └─► (F6, F7, F8, F9, F10, F12, F13) em paralelo após F5
F14 fecha cada onda antes do go-live.
```

- **Onda 1 (MVP):** F0, F1, F2, F3, F4, F5, F11-básico, F14-parcial → helpdesk operável internamente.
- **Onda 2 (self-service):** F6, F7, F8 → cliente final usa portal + KB + CSAT.
- **Onda 3 (escala/B2B/IA):** F9, F10, F12, F13 → paridade plena Zendesk/Freshdesk.
- **Onda 4:** F14 completo + replicação nos tenants.

## 4. Estimativa de Esforço (ordem de grandeza)

| Onda | Fases | Esforço aprox. |
|---|---|---|
| 1 — MVP | F0–F5 + F11b | 4–6 semanas |
| 2 — Self-service | F6–F8 | 2–3 semanas |
| 3 — Escala/IA | F9, F10, F12, F13 | 4–6 semanas |
| 4 — Go-live | F14 + replicação | 1–2 semanas |

> Estimativas para 1 dev focado, reaproveitando a infra mapeada. Ajustar conforme validação.

## 5. Riscos e Mitigações

- **Email threading** (F3) é a parte mais frágil — isolar num serviço testável com fixtures reais.
- **SLA com business hours + pausa** (F4) tem muitos edge cases — cobrir com testes unitários desde o início.
- **Acoplamento com `Lead`** — manter `Ticket` autônomo; vínculo sempre opcional (`requesterLeadId?`).
- **Volume/performance** — tickets crescem rápido; índices e arquivamento desde F0.
- **Multi-tenant** — toda config (SLA, KB, portal) precisa ser por tenant; nunca global cruzando tenants (lição do GA único — ver memória LGPD).

---

_Próximo passo sugerido: validar este plano, então abrir a **Fase 0** (schema núcleo + registro do módulo + casca de UI) como primeira entrega._
