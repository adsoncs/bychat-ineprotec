# Integração Gmail (enviar e receber e-mails de clientes)

Permite ENVIAR e-mails ao cliente pela caixa da empresa e RECEBER as respostas
(somente respostas a e-mails enviados pelo sistema), gravando tudo em Atividades
do lead.

## Arquitetura

- **Caixa única da empresa**: o `GmailConfig` com `syncReplies=true` (ou a 1ª config ativa) é o canal de e-mail do cliente.
- **Envio**: `POST /api/leads/:id/email` → `sendLeadEmail()` → Gmail API → cria `Activity type=email direction=outbound` com `gmailThreadId`/`gmailMessageId`.
- **Recebimento (push)**: Gmail `users.watch` → Google Pub/Sub → `POST /api/webhooks/gmail` → `syncGmailByEmail()` → History API → `ingestInboundGmailMessage()` cria `Activity direction=inbound` (só se a thread foi iniciada por e-mail nosso).
- **Renovação**: o watch expira ~7 dias; `startGmailWatchRenew()` re-registra 1x/dia.

## Pré-requisitos (uma vez)

### 1. Reconsentir a conta Google (escopo de leitura)
Foi adicionado o escopo `gmail.readonly`. A conta da empresa precisa **reconectar** no painel (Integrações Google) para conceder a leitura — senão o recebimento não funciona (envio continua só com `gmail.send`).

### 2. Configurar o Google Cloud Pub/Sub (projeto do OAuth)
No mesmo projeto GCP do `GOOGLE_CLIENT_ID`:
1. Ative a **Cloud Pub/Sub API**.
2. Crie um **tópico**, ex.: `gmail-push`.
3. Dê ao service account do Gmail permissão de publicar no tópico:
   - Conceda o papel **Pub/Sub Publisher** a `gmail-api-push@system.gserviceaccount.com` no tópico.
4. Crie uma **subscription PUSH** no tópico apontando para:
   `https://bychat.ia.br/api/webhooks/gmail?token=<GMAIL_PUBSUB_TOKEN>`
5. No backend (.env ou Settings):
   - `GMAIL_PUBSUB_TOPIC=projects/<PROJECT_ID>/topics/gmail-push` (ou setting `gmail.pubsub_topic`)
   - `GMAIL_PUBSUB_TOKEN=<segredo-aleatório>` (ou setting `gmail.pubsub_token`) — valida o webhook.

### 3. Ativar o recebimento
No painel (aba Gmail) clique **Ativar recebimento** na config da empresa — chama `users.watch` e passa a receber as respostas. (Ou `POST /api/admin/google/gmail/config/:id/watch`.)

## Observações
- Só ingere mensagens cujo `threadId` corresponde a um e-mail enviado pelo sistema (privacidade: não lê a caixa inteira).
- Idempotente: dedup por `gmailMessageId`.
- Se o cursor do History API expirar, rebaseia no `historyId` atual (pode perder uma janela; o watch mantém o fluxo).
- Escopos `gmail.*` são restritos no Google: se o app OAuth for **Interno** (Workspace) ou estiver em **Testing** com os usuários adicionados, funciona sem verificação. Como o `gmail.send` já funcionava, o setup atual deve cobrir o `readonly`.
