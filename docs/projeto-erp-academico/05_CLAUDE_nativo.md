# 05 — CLAUDE.md NATIVO · Módulo ERP Acadêmico (ByChat 100%)

> Contexto para o Claude Code. **Substitui** o `02_CLAUDE.md` (versão Mentor). Estratégia: **ERP acadêmico nativo dentro do ByChat, dono de todos os dados.** Nenhum sistema acadêmico externo, nenhuma bridge. Único serviço externo: **Asaas** (apenas emite boleto/PIX e confirma pagamento — não contém regra de negócio).

---

## 1. Objetivo

Substituir o **Mentor Web** no INEPROTEC (curso técnico/EAD) por um **módulo acadêmico nativo do ByChat**. O ByChat passa a ser **o sistema** — não um front sobre um legado. Toda a verdade (cadastros, matrícula, financeiro, núcleo acadêmico, histórico) vive no banco do ByChat.

**Implicações da decisão (vs. docs antigos):**
- O **núcleo acadêmico** (diário, frequência, notas, fechamento, grade, histórico, certificação) — que o `02_` adiava para "Fase Alta" — **agora é escopo central**.
- O **Adapter/ACL do Mentor (`03_`) é descartado.**
- O **go-live depende de migração única** dos dados do Mentor (export → importador nativo), não de integração.

---

## 2. Stack (idêntica ao ByChat real)

Backend **Fastify + Prisma + MySQL** (tsx via pm2), Frontend **Preact + wouter + react-query + Tailwind** (build `npx vite build`), **BullMQ + Redis**, **Socket.io**, **Evolution API / Cloud API** (WhatsApp), **Zod** nas bordas, **Asaas** (pagamentos, padrão Venda360).

---

## 3. Convenções inegociáveis (corrigidas para o schema real)

1. **Multi-tenant por install** → **NÃO usar `tenantId`**. Cada cliente é um DB/instalação (`bychat-ineprotec`).
2. **IDs `Int @id @default(autoincrement())`** (padrão real do ByChat). **Não usar `cuid`.**
3. **Tabelas `bychat_aca_…`** (segue `bychat_edu_`, `bychat_helpdesk_`).
4. **`@db.VarChar(191)`** em campos indexados; `@db.Text` para texto longo.
5. **Dinheiro = centavos `Int`** (`*Centavos`). Nunca `Float`/`Decimal` para cálculo. *(Obs: `CourseOffering` existente usa `Decimal` — converter para centavos ao gerar parcela.)*
6. **Proibido array escalar** → tabela-junção (ex.: `PreRequisito`).
7. **JSON esparso** em `@db.Json`, validado por **Zod** na aplicação.
8. **Idempotência de pagamento:** `@@unique([origem, eventoExternoId])` com `paymentId` do Asaas.
9. **Soft-state** `ativo Boolean @default(true)`; **timestamps** em tudo.
10. **Segredos Asaas** cifrados **AES-256-GCM**, nunca em log.
11. **Nada pesado/externo síncrono no request** → **BullMQ**; resultado volta por **Socket.io** (gotcha Venda360: jobId **sem `:`**).

---

## 4. Princípio nº 1 — REUSAR, não recriar

O ByChat já resolve ~70% do problema. **Antes de criar qualquer model/tela, verificar se já existe:**

| Necessidade | Já existe (reusar) | Construir |
|---|---|---|
| Pessoa | `Lead` (dedup, `phoneKey`, omnichannel, Kanban) | `Aluno` 1:1 sobre `Lead` |
| Curso/Unidade/Modalidade/Oferta | `Course`, `EducationalUnit`, `Modality`, `CourseOffering` | nada (estender) |
| Processo seletivo / matrícula online | `EntryMode`, `SelectionProcess`, `EnrollmentPortal`, `EnrollmentDraft` | `Matricula` (fato acadêmico) |
| Cobrança/boleto/PIX | `EnrollmentPortal.paymentProvider=asaas` + régua/reconciliação **Venda360** | `Plano`, `Contrato`, `Parcela`, `Bolsa` |
| Secretaria/protocolos | **Helpdesk** | requerimentos/declarações |
| Comunicação | Omnichannel, **Broadcast**, Notificações, Forms, Agendamentos | gatilhos acadêmicos |
| Portais | Portal SSR (`/suporte`, `/ajuda`), magic-link | portal Aluno/Professor |
| BI | Dashboards/Widgets, reports/CSV | métricas acadêmicas |

> ❌ **Não** criar `Tenant`, `Curso`, `Modalidade`, `Unidade`, nem tabela de pessoa paralela. ❌ **Não** copiar a UX densa do Mentor (F7/F9, 7 abas) — UI moderna, *progressive disclosure*.

---

## 5. Módulos e ordem de build

| Módulo | Conteúdo | Reuso | Dependência |
|---|---|---|---|
| **M1 Pessoas** | `Aluno` (sobre Lead), `ResponsavelAluno`, papéis | CRM | — |
| **M2 Estrutura acadêmica** | `PeriodoLetivo`, `Disciplina`, `MatrizCurricular`+`Componente`, `Turma` | `Course`/`CourseOffering` | M1 |
| **M3 Captação & Seletivo** | inscrição, classificação, vagas | `EntryMode`/`SelectionProcess`/`EnrollmentPortal`/Forms | — |
| **M4 Matrícula** | `Matricula` + ciclo de vida, rematrícula | `EnrollmentDraft`, Helpdesk (docs) | M1, M2 |
| **M5 Financeiro** | `Plano`, `Contrato`, `Parcela`, `Bolsa`, Asaas | **Venda360** (régua/reconciliação/webhook) | M4 |
| **M6 Núcleo acadêmico** ⭐ | diário, frequência, notas, fechamento, conselho | Notificações/Socket.io | M2, M4 |
| **M7 Secretaria & Documentos** | histórico, declarações, **certificado/diploma** | Helpdesk, templates, uploads | M6 |
| **M8 Portais** | Aluno/Responsável + Professor | Portal SSR, magic-link, WhatsApp | M5, M6 |
| **M9 Comunicação** | avisos, cobrança amigável, lembretes | Broadcast/Omnichannel/Agendamentos | M5 |
| **M10 BI & Conformidade** | indicadores, exportações (Censo/INEP) | Dashboards/reports | todos |

### Roadmap por fases (valor + risco)
- **F0 Fundação:** schema `04_` (M1/M2/M4/M5 base) + `moduleRegistry` "Acadêmico" + permissões + importador de cadastro.
- **F1 Operação rápida (alto reuso):** M3 + M4 + M5 → *matrícula nasce no WhatsApp, gera mensalidade/boleto, cobra automático — tudo nativo.*
- **F2 Núcleo acadêmico (o esforço real):** M2 completo + **M6**. Rodar **1 período letivo em paralelo** com o Mentor (Mentor só como conferência) até confiar nos números.
- **F3 Secretaria/portais/fechamento:** M7 + M8 + M10 + **migração completa do histórico** → desligar o Mentor.
- **F4 Conformidade/refino:** diploma digital, Censo, automações (M9), bolsas/negociação.

**Definição de pronto da F1:** uma matrícula nasce no WhatsApp/portal, gera contrato e parcelas, emite boleto/PIX no Asaas e envia ao aluno — **100% pelo ByChat, sem nenhum sistema externo de ensino.**

---

## 6. Regras de negócio críticas

- **Pessoa = Lead.** Candidato que matricula **não vira outro registro** — ganha `Aluno` (1:1) e papel. Fecha o gap conversão↔matrícula.
- **Ciclo de matrícula próprio:** `INSCRITO → PRE_MATRICULA (doc/financeiro pendente) → MATRICULADO → TRANCADO/TRANSFERIDO → CONCLUIDO/EVADIDO/CANCELADO`. Cada transição grava `MatriculaEvento`.
- **Dedup nativo:** `@@unique([alunoId, turmaId])` — sem matricular 2×.
- **Financeiro:** plano por oferta gera parcelas internamente; Asaas só emite/confirma; baixa por **webhook idempotente**; **reconciliação periódica** (não confiar só no webhook); inadimplência pela **régua do Venda360**.
- **Histórico/Diploma (M7):** dado regulado (MEC/INEP) — fidelidade legal, numeração, assinatura. Tratar como item com tempo próprio, não "mais uma tela".

---

## 7. O que NÃO fazer

- ❌ `Tenant`/`tenantId`, `cuid`, `Float` para dinheiro, array escalar.
- ❌ Duplicar `Course`/`Modality`/`Unidade`/pessoa.
- ❌ Qualquer chamada Asaas síncrona no request (sempre BullMQ).
- ❌ Migrar dados do Mentor via API/bridge — **só importação única offline**.
- ❌ Copiar UI/atalhos do Mentor.
- ❌ Construir M6/M7 antes de M1/M2/M4 prontos e testados.

## 8. Arquivos
- `04_schema_nativo_bychat.md` — schema (M1/M2/M4/M5).
- `06_…` (a criar) — M6 Núcleo Acadêmico.
- `01/02/03_…` — versão Mentor (referência histórica, não usar).
