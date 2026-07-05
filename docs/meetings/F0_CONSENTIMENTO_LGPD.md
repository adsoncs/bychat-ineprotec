# Módulo Reuniões (bot de transcrição) — F0: Portão de Consentimento / LGPD

> **Pré-requisito bloqueante das demais fases.** Nenhum acoplamento de produção (F1+) deve ir ao ar sem o F0 concluído e validado pelo Encarregado (DPO)/jurídico.
> Complementa `docs/lgpd/PLANO_ADEQUACAO_LGPD.md` (este módulo é um novo tratamento a inserir no ROPA — A.4 — e provavelmente exige RIPD — A.8).
> **Aviso:** documento técnico-operacional; não substitui parecer jurídico.

## Contexto e por que o F0 existe

O bot entra numa reunião e **grava/transcreve a fala de TODOS os participantes** — inclusive o lead/cliente do outro lado, que **não é usuário do sistema**. Esse é exatamente o núcleo dos processos contra Otter.ai/Fireflies (gravação sem consentimento informado de todos). Sob a LGPD, gravar/transcrever é **tratamento de dado pessoal** e exige **base legal** + **transparência** + **consentimento informado** quando aplicável.

### Vantagem estrutural do nosso desenho (self-host CPU)

Como validado no teste de fumaça (2026-07-04), rodamos **Vexa self-hosted + transcrição faster-whisper em CPU local**: o áudio **nunca sai do servidor**. Isso, em termos de LGPD:

- **Sem suboperador de transcrição** (não há Otter/Recall/Google processando o áudio) → não entra em A.1.2 (suboperadores) nem A.5.
- **Sem transferência internacional** (Res. CD/ANPD 19/2024 **não se aplica**) → contraste direto com todos os concorrentes SaaS.
- Papéis (A.1): **tenant = controlador** (decide gravar), **Beyond = operador** (fornece a ferramenta). Reforça o isolamento multi-tenant.

Esse é um argumento comercial e de conformidade forte — deve constar na comunicação ao cliente.

---

## Tarefas do F0

### F0.1 — Papéis, base legal e ROPA (jurídico + doc)
- Inserir o tratamento "Gravação e transcrição de reuniões online" no **ROPA** (A.4): dados coletados (áudio, transcrição, metadados de participantes, e-mail/nome quando disponíveis), finalidade (registro de atendimento comercial/suporte), **base legal**, retenção, compartilhamentos (nenhum externo — self-host), suboperadores (nenhum p/ transcrição).
- **Base legal sugerida (validar com jurídico):** **consentimento** dos participantes (art. 7º, I) para o registro; para o titular já em relação comercial, pode-se avaliar **execução de contrato/legítimo interesse com RIPD** — mas dada a sensibilidade, **consentimento informado é o caminho recomendado**.
- **RIPD/DPIA (A.8):** elaborar, pois há monitoramento sistemático de comunicações. Se reuniões puderem tratar **dados sensíveis** (art. 11 — saúde, etc., relevante p/ tenants educacionais/clínicos), exigir consentimento **específico e destacado**.
- **Entregável:** entrada no ROPA + RIPD + definição de base legal por tipo de tenant.

### F0.2 — Gate de módulo + opt-in do tenant (código)
- Novo módulo `meetings` no catálogo `Module` (toggle ativo/inativo), **default OFF**.
- `Setting` por tenant `meetings.recording.enabled` (default `false`) — só liga por ação explícita do admin, com **type-to-confirm** (padrão `feedback_module_deactivate_safety`).
- Ao ligar, exibir aceite do admin declarando responsabilidade de controlador pela base legal (checkbox + `UserAudit`).
- **Cuidado conhecido:** `ModuleGate` deve usar o `moduleId` correto do módulo (ver incidente `moduleId 'forms'` vs `'captacao'`) — registrar `meetings` no catálogo central de Trigger Events/Módulos.
- **Pontos de código:** `Module` model + `modulePermissionHook`/`ModuleGate`; painel Configurações (seção dentro de painel existente, não aba solta — `feedback_settings_um_lugar_so`).

### F0.3 — Consentimento na origem: aviso no convite/agendamento (código)
- Injetar aviso de **gravação/transcrição** em todos os pontos onde o convite é gerado:
  - Descrição do evento Google (`createCalendarEvent` em `lib/google.ts`, via `googleCalendarSync.syncActivityToCalendar`).
  - Mensagens de confirmação de agendamento (`MeetingType.confirmationConfig`, `Booking`, `Chatbot.scriptedMessages`/`MessageTemplate` — ver `project_bychatbeyond_scheduling_messages`).
  - Página pública de agendamento (`schedulingPublic`) — texto + checkbox de ciência.
- Texto configurável por tenant (`Setting` `meetings.recording.notice_text`), com default padrão.
- **Entregável:** o titular sabe, **antes de entrar**, que a reunião será registrada, para quê, por quanto tempo e quem acessa (consentimento **informado**, não mera ciência).

### F0.4 — Anúncio do bot dentro da sala (política; implementação técnica no F1)
- Nome do bot **transparente**: `bot_name` do tipo `"Gravando · <Empresa>"` (não um nome disfarçado).
- Ao ser admitido, o bot **posta no chat da reunião** uma mensagem declarando gravação/transcrição e finalidade (API Vexa `POST /bots/{platform}/{id}/chat`).
- **Política F0:** definir os textos e a obrigatoriedade do anúncio; a chamada técnica entra no F1.

### F0.5 — Opt-out e controle por reunião (código)
- Toggle **"Gravar esta reunião"** por `Booking`/`Activity` (`metadata.recordMeeting`), default conforme policy do tenant — espelha o padrão já existente do opt-in `"Avisar o lead"` (`metadata.notifyLead`, ver `project_bychat_meeting_activity_notify_optin`).
- Mecanismo de **recusa**: se um participante não consentir, o operador pode não disparar / encerrar o bot (`DELETE /bots/...`). Registrar a recusa.
- **Entregável:** gravar é sempre uma decisão explícita e reversível, nunca automática silenciosa.

### F0.6 — Minimização, retenção e expurgo (código — B.4)
- `Setting` `meetings.retention_days` por tenant (ex.: 90/180); default conservador.
- **Cron de expurgo** (loop `setInterval` no boot do `server.ts`, molde `voipRecordingSync`): apaga gravação (`/uploads/meeting-recordings/…`) + transcrição vencidas, com log.
- Armazenamento: `LeadAttachment`/model dedicado com `storagePath` em `/uploads/meeting-recordings`; avaliar **cifragem em repouso** e controle de acesso (não servir `/uploads` de gravação sem auth — ver `feedback_spa_fallback` / hardening de `/uploads`).
- **Entregável:** retenção declarada e efetivamente aplicada (não guardar indefinidamente).

### F0.7 — Direitos do titular (código — B.2, art. 18)
- Gravações/transcrições vinculadas a um `Lead` entram no fluxo de **acesso e eliminação** do titular: ao **anonimizar/excluir** um lead (mecanismo LGPD anonymize já existente no Helpdesk/Leads), apagar/anonimizar as gravações e transcrições vinculadas.
- Endpoint de **exportação** deve incluir transcrições ao atender requisição de acesso.
- **Entregável:** um titular consegue exercer acesso/eliminação sobre o que foi dito em reunião.

### F0.8 — Segurança de acesso + auditoria (código — B.3)
- **Permissão de módulo** dedicada: quem pode **ouvir/baixar** gravação e ler transcrição (nem todo agente deve poder).
- **Trilha de auditoria** (`UserAudit` + `logUserAudit`, ver `project_bychatbeyond_user_audit_trail`) para: acesso, download, compartilhamento e exclusão de gravação/transcrição.
- **Entregável:** acesso a conteúdo sensível é restrito e rastreável.

### F0.9 — Documentos legais servidos no sistema (jurídico + código — A.5)
- Atualizar **Política de Privacidade/Aviso de Privacidade** do tenant para descrever a gravação de reuniões.
- Disponibilizar o texto de consentimento e o canal do titular (DPO) nos pontos de agendamento.
- **Entregável:** transparência documental exigida pela LGPD.

---

## Definição de pronto do F0
- [ ] ROPA + RIPD + base legal aprovados pelo DPO/jurídico (F0.1, F0.9)
- [ ] Módulo `meetings` + `Setting` opt-in default OFF com aceite do admin (F0.2)
- [ ] Aviso de gravação em convite/confirmação/página de agendamento (F0.3)
- [ ] Política e textos de anúncio do bot definidos (F0.4)
- [ ] Opt-out por reunião + registro de recusa (F0.5)
- [ ] Retenção configurável + cron de expurgo (F0.6)
- [ ] Integração com direitos do titular (acesso/eliminação) (F0.7)
- [ ] Permissão + auditoria de acesso a gravações (F0.8)

Só após todos os itens o **F1 (acoplamento técnico ao bychat)** pode ir a produção.
