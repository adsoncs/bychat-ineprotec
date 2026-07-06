# Plano — Modo Reunião Presencial (bychat Reuniões)

> Complementa o módulo de Reuniões existente (hoje só **online**, via bot Vexa em Meet/Teams/Zoom).
> Objetivo: transcrever + analisar reuniões **presenciais** (sala física, sem URL, sem bot),
> reaproveitando ao máximo a pilha já pronta e mantendo a **soberania** (áudio nunca sai do servidor).
> Data: 2026-07-06.

---

## 1. Como o módulo funciona hoje (online) — baseline

`bot Vexa entra na URL → captura áudio → WhisperLive CPU (diarizado) → poller consolida →
análise IA (resumo/action items/objeções/playbook/scorecard/clipes) → entrega (e-mail/WhatsApp/webhook) +
anexa no lead`. Unidade de cobrança = **seat** (`UserMeetingBot`, licença por usuário). Módulo *gated*, default OFF.

Peças-chave (já existentes):
- Model `MeetingRecording` (`bychat_meeting_recordings`) — guarda status, `transcriptText`/`transcriptSegments`, `audioPath`, `analysis`, etc.
- `routes/meetings.ts` — `POST /dispatch`, `GET /recordings`, `/seats`, `/settings`, `/playbook`, `/report`, `/search`.
- `services/meetingTranscriptPoll.ts` — poller 30s: consolida transcript → `polish` → `analyze` → `deliver`.
- `services/meetingAnalysisService.ts` — `analyzeMeetingRecording()` (resumo, playbook, scorecard, clips).
- `lib/meetingsConfig.ts` — todas as configs `meetings.*`. `lib/meetingBotSeat.ts` — seats/cobrança.

## 2. O problema do presencial

Na reunião presencial **não há URL nem bot para despachar**. O áudio vem de um dispositivo físico na sala.
Precisamos resolver, em ordem de dificuldade:

1. **Capturar o áudio** no dispositivo (navegador/celular) ou receber um arquivo.
2. **Transcrever sem o bot** (whisper local sobre o arquivo).
3. **Diarização de microfone único** ("quem falou") — o ponto genuinamente difícil.
4. **Consentimento LGPD reforçado** — presencial não tem "bot que se anuncia"; o risco jurídico é maior.
5. **Análise / entrega / anexo ao lead** — reaproveitados 100% do fluxo online.

## 3. Benchmark de concorrentes (como fazem)

| Ferramenta | Captação presencial | Diferencial | Limite |
|---|---|---|---|
| **Otter.ai** | App mobile + web recorder, **tempo real**, cache offline se cair a rede; "speaker recognition" em sala de mic compartilhado | Maduro em presencial | Exige internet p/ real-time; dados na nuvem deles |
| **Fireflies.ai** | App mobile dedicado iOS/Android grava presencial na hora, 100+ idiomas | App próprio robusto | Nuvem; presencial ainda usa mic do celular |
| **Granola** | App **desktop (Mac)** captura o áudio da sala local, **sem bot**, foco privacidade | Discrição (nada anuncia) | Sem app mobile (só desktop) |
| **Sembly / Avoma** | Mobile in-person | Amarração a CRM (Avoma) | Nuvem |
| **Plaud Note / NotePin** | **Hardware** dedicado (30h, 112 idiomas, speaker labels), pendant vestível | Gravador físico discreto | Custo por device; sobe pra nuvem deles |
| **Limitless (pendant)** | Hardware "memória" vestível | — | **Descontinuado** (comprado pela Meta, dez/2025) |

**Padrões do mercado:** (a) captação por **mic do celular via app** (Otter/Fireflies) é o mainstream; (b) captação
**desktop local sem bot** (Granola) ganha em privacidade; (c) **hardware** (Plaud) é nicho premium; (d) diarização
de mic único com **whisper + pyannote self-host** entrega **75–85%** de acerto com 3–4 pessoas na sala.

**Nosso diferencial defensável** (nenhum concorrente junta os três):
1. **Soberania real** — whisper CPU local; o áudio **nunca sai do nosso servidor** (Otter/Fireflies/Plaud sobem pra nuvem deles). Forte argumento LGPD para B2B brasileiro.
2. **Amarração ao CRM/lead** — a reunião presencial vira Atividade + resumo no lead + próximos passos no pipeline. Notetaker vira *revenue intelligence*.
3. **Playbook coaching + scorecard** já prontos — coaching de vendas sobre a conversa presencial, algo que os notetakers genéricos não fazem.

## 4. Enabler técnico — JÁ VALIDADO

Descobertas que tornam o presencial **barato** (a maior parte já existe):

- ✅ **Transcrição de arquivo avulso sem bot**: `POST http://localhost:8083/v1/audio/transcriptions`
  (endpoint OpenAI-compatível da nossa `transcription-service` Vexa, whisper CPU) → **HTTP 200** `{text, segments}`.
  Testado hoje. Dispensa completamente o bot Vexa para o presencial.
- ✅ **Fallback local**: `backend/scripts/transcribe.py` (faster-whisper CPU) já transcreve qualquer arquivo,
  invocado via `execSync` (padrão em `routes/whatsapp.ts:263`).
- ✅ **Gravação no navegador pronta**: `frontend-app/src/components/AudioRecorder.tsx` (MediaRecorder,
  `getUserMedia`, timer, gera `File` webm/ogg) — já usado nas Conversas. **Reutilizável direto** para o celular.
- ✅ **Análise/entrega independem do Vexa**: `analyzePendingMeetings()`/`deliverPendingMeetings()` processam
  **qualquer** `MeetingRecording` com `status:'completed'`. Basta preencher `transcriptText`.
- ✅ **Upload multipart**: padrão consolidado em `routes/leadAttachments.ts:103-122` (grava em `/uploads`, cria
  Activity + Attachment). `@fastify/multipart` já registrado globalmente.

**Conclusão:** o modo presencial é, em grande parte, *plumbing* sobre peças existentes. O único investimento
genuinamente novo é a **diarização de mic único** (P4) e o **reforço de consentimento** (P1).

## 5. Arquitetura proposta

Fluxo presencial (novo caminho, ao lado do bot online):

```
[Web Recorder / upload de arquivo]           ← captação no dispositivo (reusa AudioRecorder.tsx)
        │  multipart (FormData)
        ▼
POST /api/admin/meetings/upload              ← novo endpoint (gate seat + gate consentimento)
        │  salva áudio em uploads/meeting-recordings/
        ▼
MeetingRecording (source='presencial',       ← sem dispatchMeetingBot; botId=null
   status='requested', audioPath=…)
        │  fila wf-meeting-transcribe
        ▼
transcription-service :8083 (whisper CPU)    ← transcreve arquivo → segments (timestamps)
   (fallback: scripts/transcribe.py)
        │  preenche transcriptText (formato consolidate: "[mm:ss] Falante: texto") + transcriptSegments
        ▼
status='completed'  ──►  poller já existente: polish → analyze → deliver → anexa no lead
```

Decisão de transcrição: usar a **`transcription-service` :8083** (mesmo whisper "medium" do modo online, retorna
timestamps, mesma infra) como caminho primário; `transcribe.py` ("base") como fallback offline.

## 6. Diarização — o ponto difícil (quem falou)

O whisper puro sobre um arquivo de mic único **não separa falantes** (`transcribe.py` hoje devolve só texto corrido;
o endpoint devolve timestamps mas sem speaker). Opções, em fases:

- **MVP (P0–P3):** transcrição **corrida**, sem separação confiável de falante. Rotular como *"reunião presencial —
  sem separação automática de falantes"*. A análise IA (resumo/action items/playbook) funciona bem mesmo sem diarização.
- **P4:** subir serviço **pyannote** self-host (soberano, sem nuvem) → VAD + embeddings + clustering →
  `speaker A/B/C` nos segmentos (**75–85%** com 3–4 pessoas). Opcional: **cadastrar a voz do dono do seat**
  (embedding) para marcá-lo nominalmente na transcrição.

## 7. LGPD presencial (F0-presencial) — reforço obrigatório

O modo online conta com o **bot que se anuncia**. O presencial **não tem anúncio automático** → precisamos de portão
mais forte (base jurídica BR: gravação lícita quando **uma das partes** consente **e** os presentes são informados;
sala fechada tem expectativa de privacidade → informar é essencial).

- **Portão in-app antes de gravar:** checkbox obrigatório *"Informei os presentes e obtive consentimento para gravar
  e transcrever esta reunião"* — sem isso, não grava.
- Registrar no `MeetingRecording`: `consentAt`, `consentBy` (auditoria).
- **Aviso configurável + QR/cartão** para mostrar/afixar na sala (texto por tenant, reusa `meetings.recording.notice_text`).
- Reaproveita o que já existe: **retenção** (`meetingRetentionPurge`, F0.6), **redação de PII** (`redact_pii`),
  base legal por tenant (F0.2/F0.3), auditoria (`logUserAudit`).
- Atualizar `docs/meetings/F0_CONSENTIMENTO_LGPD.md` com a seção presencial.

## 8. Cobrança / seats

O seat `UserMeetingBot` continua sendo a **unidade de cobrança** — presencial não usa "bot", mas mantém a licença por
usuário (agora cobre online **e** presencial). Sugestão de UX: renomear o conceito visível de *"Bots por usuário"* →
*"Licenças de Reuniões"* (mesma tabela, sem migração). `autoJoin` fica só para o online.

## 9. Fases de entrega

| Fase | Escopo | Reaproveita | Novo |
|---|---|---|---|
| **P0 — Backend fundação (soberano, sem bot)** | Campo `source`/`consent*` no model; `POST /api/admin/meetings/upload` (multipart, gate seat); fila `wf-meeting-transcribe` → transcription-service → preenche transcript → `completed`; nova config `meetings.presencial.enabled`; atualizar descrição do módulo | MeetingRecording, poller/analyze/deliver, multipart de leadAttachments, transcription-service | Endpoint upload + worker de transcrição de arquivo |
| **P1 — LGPD presencial (F0-presencial)** | Portão de consentimento (checkbox obrigatório + `consentAt/By`), aviso/QR configurável, seção no doc F0 | Retenção, redact_pii, base legal, auditoria | Gate de consentimento + registro |
| **P2 — Web Recorder (PWA)** | Aba/ação "Reunião presencial" em `MeetingsPage` **e** no detalhe do lead; grava no navegador do celular; timer + pausar/retomar + long-form; vincular lead/atividade + idioma; tela de consentimento; upload | `AudioRecorder.tsx`, `useMeetings`, FormData | Melhorar AudioRecorder p/ gravações longas + chunked upload |
| **P3 — Upload de arquivo avulso** | `<input type=file accept="audio/*">` (qualquer gravador, inclusive Plaud) → mesma pipeline | Tudo do P0 | Trivial (entra junto do P2) |
| **P4 — Diarização (quem falou)** | Serviço **pyannote** self-host; speaker labels nos segmentos; opcional cadastro de voz do dono do seat | Formato `transcriptSegments` | Container pyannote + wiring |
| **P5 — Robustez mobile / offline** | Gravação em background, cache offline (estilo Otter), resumable upload, PWA instalável; avaliar app nativo | PWA base | Manifest + service worker + fila de upload offline |
| **P6 — Diferenciais** | Notas ao vivo (estilo Granola), clipes de **áudio** recortados do arquivo, resumo automático no WhatsApp do dono ao encerrar, integração hardware (Plaud) por pasta/upload | Delivery, clips | Recorte de áudio + captura de notas |

**MVP presencial usável = P0 + P1 + P2 + P3** (majoritariamente reúso). P4 (diarização) é o investimento novo real.

## 10. Riscos e mitigações

- **Qualidade de áudio de sala** (distância do mic, eco, ruído) → guia de boas práticas + ganho/normalização no upload; recomendar celular no centro da mesa.
- **Diarização imperfeita de mic único** → setar expectativa na UI; nominal só para o dono (voz cadastrada).
- **Gravações longas + upload** → chunked/resumable + limite de tamanho configurável.
- **Navegador mobile mata gravação em background** → PWA tem limite; resolver de vez só com app nativo (P5+).
- **LGPD** presencial é mais sensível → portão forte + aviso/QR + retenção + PII (P1).

## 11. Decisões (TRAVADAS pelo Adson — 2026-07-06)

1. **Captura do MVP:** ✅ **Web Recorder (PWA)** — reusa `AudioRecorder.tsx`, grava no navegador do celular. App nativo fica para P5.
2. **Diarização:** ✅ **Transcrição corrida agora, pyannote depois (P4)** — não segura o MVP pelo item mais difícil.
3. **Rollout:** ✅ **Beyond primeiro (validar ao vivo), depois replicar nos 6** — padrão do módulo.

## 12. P0 — escopo concreto (o que muda no código)

- `backend/prisma/schema.prisma` → `MeetingRecording`: campos `source String @default("online")`, `consentAt DateTime?`, `consentBy Int?` (`db push` aditivo, nunca `--force-reset`).
- `backend/src/routes/meetings.ts` → novo `POST /api/admin/meetings/upload` (multipart, padrão `leadAttachments.ts:103-122`): gate seat (`isUserBotEnabled`) + gate consentimento (body obrigatório) → salva áudio em `uploads/meeting-recordings/` → cria `MeetingRecording{source:'presencial', status:'requested', audioPath, consentAt/By}`.
- Novo `backend/src/services/meetingUploadTranscribe.ts` (ou fila `wf-meeting-transcribe`): pega `presencial`+`requested` → `POST :8083/v1/audio/transcriptions` (fallback `scripts/transcribe.py`) → preenche `transcriptText` (formato `consolidate()`) + `transcriptSegments` + `status:'completed'` → o poller já cuida de polish/analyze/deliver.
- `backend/src/lib/meetingsConfig.ts` → chaves `meetings.presencial.enabled` + reuso de `notice_text`.
- `moduleRegistry.ts` → atualizar descrição do módulo (não é mais "só online").
- Frontend (P2, logo em seguida): aba/ação "Reunião presencial" em `MeetingsPage.tsx` + no lead, reusando `AudioRecorder.tsx` + tela de consentimento + `<input type=file accept="audio/*">`.
