# Helpdesk — Roadmap Fases 15+ (paridade Zendesk via INTEGRAÇÃO)

> **Objetivo:** fechar as lacunas restantes para que um cliente migre do Zendesk
> **sem sentir a mudança** — robusto, completo e omnichannel.
>
> **Princípio nº 1 (inegociável):** NÃO reconstruir nada que o bychat já faz
> nativamente. Cada fase **conecta** o helpdesk aos subsistemas existentes e só
> constrói o que genuinamente falta. O helpdesk passa a "conversar com todo o
> sistema": Conversas, canais (WhatsApp/Instagram/Telegram/Email/Voz), roteamento
> de leads, chatbots/IA, workflows, notificações, dashboards, forms, branding.
>
> Base: F0–F14 entregues (branch `feat/helpdesk-module`). Data: 2026-06-16.

## Mapa de reuso (o que já existe e será conectado, não recriado)

| Necessidade Zendesk | Subsistema bychat reutilizado |
|---|---|
| Live chat / WhatsApp / Instagram / Telegram | módulo **Conversas** (`leadConversation.ts`, `Message`, `whatsappProvider.ts`, `atendimento.ts`) |
| Voz / call center | **VoIP** (`routes/voip.ts`) + **WhatsApp Calling** (`waCalls.ts`) |
| Answer-bot / AI agent | **Chatbots** (`aiJourneyEngine.ts`, `scriptedChatbotFlow.ts`) + `chatWithAI` |
| Intelligent triage / Copilot | provider de IA (`chatWithAI`, `helpdeskAi.ts`) |
| QA automático | `conversationAuditAi.ts` (já avalia qualidade de conversa) |
| Roteamento (skills/round-robin/carga/horário/escalonamento) | **Lead Routing** (`teamRouting.pickOperatorForTeam`, `RoutingRule`, `routing/escalation.ts`, `AgentProfile`, `TeamWorkingHour`) |
| Builder visual de regras | **Workflows** (ReactFlow + `WorkflowExecution`) |
| Notificações (email/WhatsApp/in-app) | **Notifications** (`notify.ts`, eventos+workflows+`MessageTemplate`) |
| Relatórios/dashboards custom | **Dashboards** (`userDashboards.ts`, widgets, `team-metrics`, `funnelReport.ts`) |
| Help Center renderizado / branding / domínio | **Landing/Forms/SSR** (`pageRenderer.ts`) + **Aparência** + **Custom Domain** |
| Ticket forms / campos condicionais | **Forms** (`routes/forms.ts`, lógica condicional Typeform) |
| Campos personalizados | **CustomField** + componentes de UI existentes |
| Macros / respostas prontas | **MessageTemplate** |
| Envio de e-mail | **SMTP/Resend** (`notify.sendEmailGeneric`) |
| Permissões / papéis | **Module Permissions** (`permissions.ts`, overrides) |

---

## ONDA 5 — Omnichannel real (maior lacuna)

### Fase 15 — Unificação Ticket ↔ Conversa (WhatsApp/Instagram/Telegram/Chat) ✅ ENTREGUE (beyond, 2026-06-16)
> Um chamado pode "viver" sobre uma conversa real; o agente responde do ticket e
> a mensagem sai pelo canal do cliente. Acaba a separação ticket vs. conversa.
> **Status:** entregue e validado (smoke verde: espelho da conversa real, resposta pública sai pelo WhatsApp via provider, nota interna/ticket manual não enviam). `services/helpdeskChannel.ts` reusa `getProviderForSender`+`Message`+`ensureConversationOpen`. Detalhe do ticket mostra a conversa real + "Abrir no Conversas"; aviso "Envia por WhatsApp" no compositor. NÃO replicado.
- Vincular `HelpdeskTicket.conversationLeadId` ↔ Lead/Conversa; criar ticket a partir de uma conversa (já há `from-lead`) e **abrir a conversa a partir do ticket**.
- Responder no ticket → envia pelo **`whatsappProvider`** (Evolution/Cloud API) / Instagram / Telegram, respeitando janela 24h e templates HSM.
- Espelhar mensagens da conversa na thread do ticket (reusa `Message`), em tempo real (reusa `lib/realtime`).
- **Reusa:** Conversas, `whatsappProvider`, `Message`, realtime. **Novo:** ponte ticket↔conversa + seletor de canal de resposta no ticket.
- Fecha gap: *live chat/messaging, WhatsApp/Instagram/Telegram como canal de ticket*.

### Fase 16 — E-mail bidirecional completo + Voz no ticket ✅ ENTREGUE (beyond, 2026-06-16)
> **Status:** entregue e validado (smoke verde: e-mail outbound via SMTP/Resend `channelSent=True`, calls no detalhe, click-to-call wired). NÃO replicado.
- [x] **Outbound e-mail**: resposta pública do agente em ticket `channel=email` sai por **SMTP/Resend** (`sendTicketEmailReply` reusa `getEmailConfig`/`getFromAddress`/`sendEmailGeneric`) com `[#protocolo]` no assunto (threading do inbound F3). Fecha o loop de e-mail.
- [x] **Voz**: `getTicketCalls` mostra ligações **VoIP** do lead no ticket (com duração + gravação); `POST /tickets/:id/call` faz **click-to-call** ao solicitante reusando `createClickToCall` (voipCallService). Frontend: card "Telefone" + botão "Ligar".
- **Reusa:** SMTP/Resend (`notify`), VoIP (`voipCallService`), `VoipCall`. **Novo:** envio outbound por e-mail + click-to-call + calls no ticket.
- *Adiado:* vínculo automático de chamada entrante→ticket; anexar gravação como `HelpdeskAttachment`.

---

## ONDA 6 — IA de ponta (reusando engine de chatbot + IA)

### Fase 17 — AI Agent / Answer-bot generativo (deflection antes do ticket) ✅ ENTREGUE (beyond, 2026-06-16)
> Bot que resolve no WhatsApp/web/portal usando a KB; abre ticket só quando não resolve.
> **Status:** entregue e validado (smoke verde: `/kb/ask` gera resposta da KB; com IA inválida cai p/ artigos — deflection robusto; assistente no `/suporte`). `aiAnswerFromKb` reusa KB + `chatWithAI`. NÃO replicado. *Resposta generativa ao vivo depende de chaves de IA válidas (beyond inválidas).*
- [x] `services/helpdeskAi.aiAnswerFromKb(question)`: responde APENAS com base nos artigos publicados; retorna `answered=false` ("NAO_ENCONTRADO") quando a KB não cobre.
- [x] `POST /api/v1/helpdesk/kb/ask` (público) com **fallback a artigos** quando IA indisponível/falha — sempre ajuda o cliente.
- [x] Assistente no portal `/suporte`: cliente pergunta → resposta da IA + artigos citados + "Isso resolveu? Sim / ou abra um chamado".
- Reusa **`aiJourneyEngine`/`scriptedChatbotFlow`** + **KB** + `chatWithAI`: responde com base nos artigos, oferece "isto resolveu?", e **escala para ticket** com resumo quando necessário.
- Publicável como chatbot num número WhatsApp ou no widget/portal.
- **Reusa:** chatbot engine, KB, chatWithAI, Conversas. **Novo:** modo "suporte" do bot + handoff→ticket.
- Fecha gap: *AI agents, generative answers/answer-bot*.

### Fase 18 — Copilot avançado do agente ✅ ENTREGUE (beyond, 2026-06-16)
> **Status:** entregue e validado (smoke verde: endpoints wired — triage-apply/rewrite 502 só por chaves IA inválidas; suggest-macro 200 sem macros; rewrite valida text→400; ticket inexistente→404). NÃO replicado. *Resultados ao vivo dependem de chaves de IA válidas.*
- [x] **Triagem auto-aplicada**: `POST /tickets/:id/ai/triage-apply` roda a triagem e **aplica prioridade+tipo** (via `applyTicketActions`) + evento `ai_triage_applied`.
- [x] **Sugerir macro**: `POST /tickets/:id/ai/suggest-macro` (IA escolhe a melhor macro do catálogo); UI aplica automaticamente.
- [x] **Reescrever / traduzir**: `POST /ai/rewrite {text, mode}` (formal/amigável/conciso/expand/`translate:<idioma>`). UI: seletor "Reescrever…" no compositor.
- **Reusa:** `chatWithAI`, `helpdeskAi.ts`, macros, `applyTicketActions`. **Novo:** auto-apply, sugestão de macro, redação.
- *Adiado:* intents customizados, auto-assist multi-ação, detecção de idioma automática na entrada.

### Fase 19 — QA automático de atendimentos ✅ ENTREGUE (beyond, 2026-06-16)
> **Status:** entregue e validado (smoke verde: run wired→502 só por chaves IA; storage/detalhe/stats OK via inserção; +fix de órfãos no DELETE). NÃO replicado. *Pontuação ao vivo depende de chaves de IA válidas.*
- [x] **Schema** `HelpdeskQaReview` (score 0-100, tone, strengths/weaknesses, summary, agentUserId, autoGenerated, reviewerUserId).
- [x] **Scorer** `aiQaTicket` (mesmo `chatWithAI` do resto da IA; funciona p/ qualquer ticket, inclusive email/manual — não só leads, ao contrário do `conversationAuditAi`).
- [x] **Endpoints** `POST /tickets/:id/qa` (audita+grava+evento `qa_reviewed`) + `GET /admin/helpdesk/qa/stats` (média geral + por agente). QA no detalhe.
- [x] **Frontend** card "Qualidade (QA)" no ticket (nota+tom+pontos a melhorar+botão Auditar) + bloco QA nos Relatórios.
- [x] **Fix** órfãos: DELETE do ticket agora remove survey/qa/links (sem FK de cascata).

---

## ONDA 7 — Motor operacional (reusando roteamento/workflows/notificações)

### Fase 20 — Roteamento avançado ✅ ENTREGUE (beyond, 2026-06-16)
> **Status:** entregue e **validado ao vivo** (smoke verde: auto-assign real via pickOperatorForTeam — ticket→setor+dono+evento; toggle OFF respeita; dono explícito respeitado). NÃO replicado.
- [x] **Auto-assign na entrada** reusando o **Lead Routing**: `services/helpdeskRouting.routeTicket` chama `pickOperatorForTeam` (round-robin / menor carga / aleatório, respeitando capacidade `AgentProfile`, horário `TeamWorkingHour`, disponibilidade). Aplicado em `intakeTicket` (API/email/web/whatsapp/portal) **e** na criação manual (quando sem setor/dono → usa setor padrão + roteia).
- [x] **Sweep** `sweepUnassigned` (cron 2 min, `startHelpdeskRoutingScheduler`) atribui tickets que entraram sem dono em setores roteados (cobre entrada sem agente disponível).
- [x] **Toggle** `helpdesk.auto_assign` (default ON) na página **Canais**.
- [ ] **Builder visual (Workflows ReactFlow)** para triggers/automations + condições compostas: adiado (formulários da F5 cobrem o essencial).
- *Adiado:* RoutingRule condicional por canal/keyword; escalonamento multinível dedicado (o SLA F4 já marca breach).

### Fase 21 — Notificações nativas (SLA, atribuição, resposta) ✅ ENTREGUE (beyond, 2026-06-16)
> **Status:** entregue e **validado ao vivo** (smoke verde: atribuir dispara alerta best-effort — falha graciosa com contatos inválidos; toggle funciona). NÃO replicado.
- [x] **`services/helpdeskNotify.notifyTicketAgent`**: avisa o agente responsável por **e-mail** (`sendEmailGeneric`) e **WhatsApp** (`createEvolutionProvider().sendText` ao `User.notifyWhatsapp`, mesmo caminho do `schedulingNotify`/`notify_operator`).
- [x] **Eventos cobertos**: `assigned` (claim/assign/auto-routing), `sla_at_risk` + `sla_breached` (no sweep de SLA), `customer_reply` (inbound e-mail threading + resposta no portal).
- [x] **Toggle** `helpdesk.notify_agents` (default ON) na página **Canais**.
- *Adiado:* in-app (não há model de notificação no bychat), notificar líder do setor, templates editáveis via `MessageTemplate`.

---

## ONDA 8 — Conteúdo & branding (reusando landing/forms/appearance)

### Fase 22 — Help Center renderizado + branding ✅ ENTREGUE PARCIAL (beyond, 2026-06-16)
> **Status:** entregue e validado (smoke verde: `/ajuda` 200, branding aplicado, consome a API pública da KB). NÃO replicado.
- [x] **Site público do Help Center** `/ajuda` (SSR servido pelo backend): header com **logo/nome/cor da Aparência** (`appearance.admin_brand_name`/`admin_logo_url`/`primary_color`/`favicon_url`), busca, categorias→artigos, **votos** (👍/👎), link "Abrir chamado" (→ /suporte). Tema claro de help center. Reusa a API `/api/v1/helpdesk/kb/*`.
- [ ] **Multi-marca** (logo/domínio/e-mail/KB/SLA/portal por marca) — adiado (exige campo de marca no schema da KB + roteamento por domínio).
- [ ] **Seções** (3º nível) + comunidade/fórum — adiados.
- **Reusa:** Aparência (settings de branding), KB pública, padrão SSR do `/suporte`.

### Fase 23 — Campos personalizados no ticket (CustomField group=helpdesk) — ✅ ENTREGUE PARCIAL (beyond, 2026-06-16)
- **Campos personalizados** ponta a ponta a partir do catálogo **CustomField** (`group=helpdesk`):
  - **Validação central** (`sanitizeHelpdeskCustomFields`): só chaves do catálogo, coerção por tipo (number/currency/checkbox/multiselect), checagem de opções em select, obrigatórios; modo `partial` p/ PATCH (merge sem exigir ausentes); modo `portalOnly` (subconjunto `showInForm`).
  - **Agente:** seção *Campos personalizados* editável no detalhe do ticket (PATCH com merge parcial) + descarte de chaves desconhecidas no create.
  - **Cliente (portal `/suporte`):** formulário de abertura renderiza os campos `showInForm` (endpoint público `/portal/custom-fields`), envia no POST e exibe erro de obrigatório.
- **Reusa:** CustomField + componentes Input/Select/Textarea. **Sem schema novo** (`ticket.customFields` Json já existia).
- **Adiado:** *ticket forms múltiplos* (por tipo/marca, lógica condicional via builder de Forms → binding form→ticket) — exige entidade de form-definition; fica para fase dedicada.
- Fecha gap parcial: *custom fields UI (agente + portal)*. Pendente: forms múltiplos/condicionais.

---

## ONDA 9 — Analytics & enterprise (reusando dashboards)

### Fase 24 — Helpdesk nos Dashboards (widgets) — ✅ ENTREGUE PARCIAL (beyond, 2026-06-16)
- Métricas de ticket expostas como **widgets** no sistema de **User Dashboards** (montagem livre nos "Meus Painéis"), **sem recriar BI**:
  - **Fonte única** `computeHelpdeskReport(range)` (services/helpdesk.ts) — extraída da rota `/api/admin/helpdesk/reports` e reusada por ela e pelos widgets.
  - **9 métricas** no switch de `/api/admin/widget-data`: `helpdesk_volume` (stat_grid/kpi), `helpdesk_sla` (stat_grid/gauge), `helpdesk_times` TMA/TMR (stat_grid), `helpdesk_csat` (stat_grid/kpi), `helpdesk_trend` criados×resolvidos (line/area/bar, 2 séries), `helpdesk_by_status`/`by_priority`/`by_channel` (donut/pie/bar/hbar, rótulos PT), `helpdesk_by_agent` (table TMR/CSAT).
  - **Catálogo** (WidgetCatalog.ts): categoria *Helpdesk* com `requiresPermission: 'helpdesk'` (só aparece p/ quem tem canView no módulo; badge "Suporte") + 9 entradas.
  - **Renderer** (WidgetRenderer.tsx): cases em KpiBody/StatGridBody/GaugeBody/TableBody + branch 2-séries no LineAreaBody + helper `fmtMins`.
- **Reusa:** userDashboards, widget-data, todos os tipos de widget. **Sem schema novo.**
- **Adiado:** agendamento de envio de dashboard, drill-down clicável, **time tracking** por ticket (timer), export XLSX. Config de período por widget usa default 30d (UI de range fica p/ refino).
- Fecha gap parcial: *dashboards custom do helpdesk*. Pendente: dashboards agendados, time tracking, XLSX.

### Fase 25 — Light agents / colaboradores — ✅ ENTREGUE (beyond, 2026-06-16)
- **Agente colaborador** = quem tem só **"Ver"** no Helpdesk (canView, sem canEdit) — REUSA o sistema de Module Permissions existente, **sem novo papel/scope/schema**:
  - Pode: **ver** o chamado, adicionar **notas internas**, **seguir/deixar de seguir** (self-follow).
  - Não pode: responder ao solicitante (resposta pública), mudar status/prioridade, atribuir/claim, tags, campos, links, macros, IA, excluir.
  - **Gate** (lib/permissions.ts): `ACTION_OVERRIDES` mais específicos ANTES da regra ampla — `/tickets/:id/comments` e `/tickets/:id/follow` resolvem para `'view'`; o resto do `/tickets/:id/*` continua `'edit'`.
  - **Handler** de comentários: resposta `public` exige canEdit (`helpdeskCanEdit` via `resolvePermissions`) → colaborador recebe 403 e só posta interna.
  - **Endpoints** novos `POST/DELETE /tickets/:id/follow` (self, idempotentes; nível 'view').
  - **UI** (HelpdeskPage): banner "Modo colaborador", compositor forçado a nota interna, botão **Seguir**, e seções de edição (Status/Prioridade/Assign/Requester/Calls/Tags/Campos/Followers/Links/macros/IA/QA) ocultas quando `!canEdit` (via `useCan('helpdesk','edit')`).
- **Adiado:** papéis totalmente customizados por módulo/ação (UI de role builder) — fica como item de plataforma, fora do helpdesk.
- Fecha gap: *light agents* (colaboradores que não consomem licença de agente pleno).

---

## ONDA 10 — Migração & extensibilidade

### Fase 26 — Importador Zendesk/Freshdesk — ✅ ENTREGUE (beyond, 2026-06-17)
> O item decisivo para "migrar sem sentir a mudança".
- **Adapters** Zendesk e Freshdesk (`services/helpdeskImport.ts`): normalizam a exportação/API num formato comum e importam para os modelos NATIVOS. Mapeiam **status/prioridade/canal** (Zendesk textual + Freshdesk numérico), **thread** com visibilidade (público/interno), **datas preservadas** (createdAt/solvedAt/timestamps das mensagens), **organizações** (domínios), **Base de Conhecimento** (categorias→artigos, slug único, publish), **macros** (texto de resposta extraído das ações).
- **Idempotência** por `(externalSource, externalId)` — novos campos aditivos em Ticket/KbCategory/KbArticle/Organization (macros por nome). Re-import não duplica.
- **Dois métodos**: colar **exportação JSON** (`POST /import/upload`) ou **conectar via API** (`POST /import/remote` — Zendesk subdomain/email/token, Freshdesk domain/key, paginado, cap 60 págs/5000 tickets). **Dry-run** por padrão (preview com contagem criar/ignorar) + commit.
- **UI**: aba *Importar* (`/app/helpdesk/import`) — origem, método, JSON/credenciais, pré-visualização e "Importar agora" com relatório por entidade.
- **Reusa:** modelos do helpdesk + `nextTicketNumber`. **Novo:** adapters + engine + campos external.
- Smoke verde (Zendesk + Freshdesk): preview/commit/reimport idempotente, datas/thread/visibilidade/org/KB/macro corretos.
- **Adiado:** anexos binários (Zendesk/Freshdesk hospedam fora), triggers/automations, CSAT histórico, custom fields mapeados.

### Fase 27 — SLA avançado + side conversations — ✅ ENTREGUE (beyond, 2026-06-17)
**(A) SLA de próxima resposta** — relógio que arma quando o CLIENTE responde e para quando o AGENTE responde publicamente (reusa o engine F4, business-hours-aware):
- Schema aditivo: `targetNextResponseAt`/`slaNextResponseStatus` no Ticket + `nextResponseMins` (por prioridade) na política de SLA.
- `armNextResponseSla` (cliente respondeu → portal reply + inbound email) e `clearNextResponseSla` (agente respondeu público → met/breached). `sweepSla` avalia at_risk/breached e notifica. Editor de SLA com coluna "Próx. resp." + badge no card SLA do detalhe.

**(B) Side conversations** — thread paralela com um TERCEIRO (fornecedor/especialista), invisível ao solicitante, por e-mail ou WhatsApp reusando os providers:
- Schema novo: `HelpdeskSideConversation` + `HelpdeskSideMessage`. Serviço `helpdeskSideConversation.ts` (createSideConversation/sendSideMessage/addInboundSideMessage/closeSideConversation) entrega via `sendEmailGeneric`/`createEvolutionProvider`. Rotas REST `/tickets/:id/side-conversations` (gate edit). UI: seção "Conversas paralelas" no detalhe (só canEdit) — nova conversa, mensagens out/inbound, encerrar.
- **Adiado:** OLA interno, update periódico, calendário por marca; threading automático de inbound da side conversation (hoje resposta recebida é registrada manualmente).
- Smoke verde: arm→pending, met após resposta do agente; side conversation create/inbound/outbound/close.

### ~~Fase 27 — SLA avançado + side conversations~~ (descrição original abaixo)
- SLA de **próxima resposta**/update periódico, **OLA** (interno), pausa por estado de espera do cliente; calendários por marca.
- **Side conversations**: thread paralela (ex.: com fornecedor) por e-mail/WhatsApp vinculada ao ticket, reusando providers.
- **Reusa:** SLA engine (F4), providers de canal. **Novo:** metas adicionais + entidade de side-conversation.
- Fecha gap: *next-reply SLA, side conversations*.

---

## Sequência sugerida (por impacto na migração Zendesk)
1. **F15–F16** (omnichannel real) — sem isso, não é "Zendesk".
2. **F17–F18** (AI agent + copilot) — maior diferencial percebido.
3. **F20–F21** (roteamento + notificações) — robustez operacional.
4. **F26** (importador) — destrava a migração de clientes.
5. **F22–F23** (Help Center/branding/forms) — experiência do cliente final.
6. **F24–F25** (analytics + papéis) — enterprise.
7. **F19, F27** (QA, SLA avançado) — refinamento.

> Cada fase segue o mesmo rito das F0–F14: schema aditivo → backend → validação (smoke) → frontend → commit/push. **Nada que o bychat já faz é reescrito** — só conectado.
