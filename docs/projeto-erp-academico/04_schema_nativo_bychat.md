# 04 — Schema Prisma NATIVO (ByChat 100%, sem Mentor Web)

> **Reescrita** do `01_schema...` para a estratégia **100% nativa**: o ByChat é dono de todos os dados acadêmicos. **Não há bridge, Adapter, nem `mentor*`.** O único sistema externo é o **Asaas**, e apenas como *braço bancário* (emite boleto/PIX e confirma pagamento) — nenhuma regra acadêmica/financeira vive nele.
>
> Os arquivos `01_…`, `02_…`, `03_…` (versão Mentor) ficam preservados como referência histórica. **Use estes (`04`/`05`).**

---

## Correções estruturais sobre os docs antigos (importante)

1. ❌ **Remover o model `Tenant`.** No ByChat **cada cliente é uma instalação isolada** (DB próprio — ex.: `bychat-ineprotec`). **Não existe `tenantId` em nenhum model** do schema atual. → **Nenhuma coluna `tenantId`** no módulo acadêmico.
2. 🔑 **IDs = `Int @id @default(autoincrement())`** (padrão real do ByChat: `Lead`, `Course`, etc.). O `01_` usava `cuid()` String — **inconsistente**. Padronizar em `Int`.
3. 🧱 **Prefixo de tabela `bychat_aca_…`** (segue `bychat_edu_`, `bychat_helpdesk_`).
4. 👤 **`Aluno` = extensão 1:1 do `Lead`** (FK `leadId Int @unique`). **Não** criar tabela de pessoa paralela. Nome/e-mail/WhatsApp/`phoneKey`/dedup vêm do Lead.
5. ♻️ **Reusar a camada educacional que já existe**, não duplicar: `EducationalUnit`, `EducationalLevel`, `Modality`, `Course`, `CourseOffering` (já tem `valorMensalidade`, `valorMatricula`, vagas, turno, datas), `EntryMode`, `SelectionProcess`, `EnrollmentPortal` (já com `paymentProvider`), `EnrollmentDraft`.
6. 🗑️ **Remover** `MapeamentoMentor`, status `PREMAT/ATIVO/CANCEL` (eram do Mentor), e o `IntegracaoEvento` com origens `MENTOR_*` → vira **idempotência de Asaas**.

---

## O que já existe (REUSAR — não recriar)

| Camada | Models existentes no ByChat | Papel no ERP acadêmico |
|---|---|---|
| Pessoa/CRM | `Lead` (+ `phoneKey`, dedup, omnichannel, Kanban) | Base do **Aluno/Responsável** |
| Catálogo comercial | `EducationalUnit`, `EducationalLevel`, `Modality`, `Course`, `CourseOffering` | Unidade, nível, curso e **oferta** (turno, mensalidade, vagas, datas) |
| Admissão | `EntryMode`, `SelectionProcess`, `EnrollmentPortal`, `EnrollmentDraft`, requisitos de documento | Processo seletivo + **matrícula online** + coleta de docs |
| Pagamentos | `EnrollmentPortal.paymentProvider = asaas` + padrão Venda360 (régua, reconciliação, webhook) | Base do **M5 Financeiro** |
| Atendimento | Helpdesk, Omnichannel, Broadcast, Forms, Notificações, Agendamentos, Dashboards | Secretaria, comunicação, portais, BI |

---

## O que FALTA (construir nativo)

- **M1** `Aluno` (sobre Lead) + `ResponsavelAluno` + papéis.
- **M2** `PeriodoLetivo`, `Disciplina`, `MatrizCurricular` + `ComponenteCurricular`, `Turma` (a turma **acadêmica**, abaixo da oferta).
- **M4** `Matricula` (fato acadêmico com ciclo de vida próprio).
- **M5** `PlanoPagamento`, `ContratoFinanceiro`, `Parcela`, `Bolsa`, `IntegracaoEvento` (Asaas).
- **M6** Núcleo acadêmico (`Diario`, `AulaRegistro`, `Frequencia`, `Avaliacao`, `Nota`, `ResultadoComponente`, `HistoricoEscolar`, `ConselhoClasse`) → **detalhado no doc `06` (M6)**, é o maior esforço.

---

## schema.prisma (Fase Fundação: M1, M2, M4, M5)

```prisma
// =====================================================================
// ByChat · Módulo Acadêmico — NATIVO (sem Mentor). MySQL 8 · Prisma.
// Convenções: Int autoincrement; sem tenantId (multi-tenant por install);
// dinheiro em centavos Int; sem array escalar (junção); JSON p/ esparso;
// idempotência @@unique([origem, eventoExternoId]); soft-state com `ativo`;
// timestamps; segredos (Asaas) AES-256-GCM; jobs pesados no BullMQ.
// FKs para models existentes do ByChat: Lead, Course, CourseOffering,
// EducationalUnit, EnrollmentDraft (todos Int).
// =====================================================================

// ───────────────────────── ENUMS ─────────────────────────
enum PapelAcademico { ALUNO PROFESSOR RESPONSAVEL COORDENADOR SECRETARIA }
enum TipoResponsavel { FINANCEIRO PEDAGOGICO LEGAL }
enum Turno { MATUTINO VESPERTINO NOTURNO INTEGRAL EAD }

// Ciclo de vida PRÓPRIO (não mais o do Mentor)
enum MatriculaStatus {
  INSCRITO        // veio do processo seletivo / portal
  PRE_MATRICULA   // documentos/financeiro pendentes
  MATRICULADO     // efetivada
  TRANCADO
  TRANSFERIDO
  CONCLUIDO
  EVADIDO
  CANCELADO
}

enum ParcelaTipo { MATRICULA MENSALIDADE MATERIAL TAXA OUTRO }
enum ParcelaSituacao { ABERTA PAGA VENCIDA CANCELADA RENEGOCIADA }
enum ContratoStatus { ATIVO QUITADO CANCELADO RENEGOCIADO }
enum BolsaTipo { PERCENTUAL VALOR INTEGRAL }
enum IntegracaoStatus { PENDENTE SUCESSO ERRO }

// ───────────────────── M1 · PESSOAS ─────────────────────

/// Aluno = MESMO registro do Lead/Contato do CRM (sem silo).
model Aluno {
  id          Int      @id @default(autoincrement())
  leadId      Int      @unique               // ← É o Contato/Lead do CRM
  ra          String?  @unique @db.VarChar(30) // Registro Acadêmico (gerado pelo ByChat)
  cpf         String?  @db.VarChar(20)
  dataNascimento DateTime?
  sexo        String?  @db.VarChar(12)
  nomeSocial  String?  @db.VarChar(191)
  fotoUrl     String?  @db.Text
  ativo       Boolean  @default(true)
  // Abas raras (documentos, sócio-econômico, dados de menor) → JSON validado por Zod
  documentosJson     Json? @db.Json
  socioEconomicoJson Json? @db.Json
  roadmapJson        Json? @db.Json  // conselho tutelar, "sair sozinho", filiação detalhada (não modelar UI agora)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  // lead      Lead @relation(fields: [leadId], references: [id], onDelete: Cascade)  // adicionar back-relation no Lead
  responsaveis ResponsavelAluno[]
  matriculas   Matricula[]
  ocorrencias  OcorrenciaAcademica[]

  @@index([cpf])
  @@index([ra])
  @@map("bychat_aca_alunos")
}

model ResponsavelAluno {
  id        Int     @id @default(autoincrement())
  alunoId   Int
  leadId    Int?                              // responsável também pode ser um Contato
  nome      String  @db.VarChar(191)
  cpf       String? @db.VarChar(20)
  parentesco String? @db.VarChar(40)
  tipo      TipoResponsavel @default(FINANCEIRO)
  telefone  String? @db.VarChar(30)
  email     String? @db.VarChar(191)
  ativo     Boolean @default(true)

  aluno     Aluno   @relation(fields: [alunoId], references: [id], onDelete: Cascade)
  @@index([alunoId])
  @@map("bychat_aca_responsaveis")
}

// ──────────────── M2 · ESTRUTURA ACADÊMICA ────────────────

model PeriodoLetivo {
  id         Int      @id @default(autoincrement())
  codigo     String   @unique @db.VarChar(20) // "2026/1"
  descricao  String   @db.VarChar(191)
  anoLetivo  Int?
  dataInicio DateTime?
  dataFim    DateTime?
  ativo      Boolean  @default(true)

  turmas     Turma[]
  @@map("bychat_aca_periodos_letivos")
}

/// Disciplina pertence a um Course existente (bychat_edu_courses).
model Disciplina {
  id            Int     @id @default(autoincrement())
  courseId      Int     // FK → Course (existente)
  nome          String  @db.VarChar(191)
  codigo        String? @db.VarChar(50)
  cargaHoraria  Int     @default(0)
  ementa        String? @db.Text
  ativo         Boolean @default(true)
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  componentes   ComponenteCurricular[]
  @@index([courseId])
  @@map("bychat_aca_disciplinas")
}

/// Versão da grade de um curso (permite reformulação sem quebrar históricos).
model MatrizCurricular {
  id        Int     @id @default(autoincrement())
  courseId  Int     // FK → Course
  versao    String  @db.VarChar(40) // "2026"
  vigenteDe DateTime?
  ativo     Boolean @default(true)

  componentes ComponenteCurricular[]
  @@index([courseId])
  @@map("bychat_aca_matrizes")
}

/// Disciplina posicionada na matriz (fase/módulo) + carga. Pré-requisitos via junção.
model ComponenteCurricular {
  id           Int @id @default(autoincrement())
  matrizId     Int
  disciplinaId Int
  fase         Int      @default(1) // semestre/módulo
  obrigatoria  Boolean  @default(true)

  matriz       MatrizCurricular @relation(fields: [matrizId], references: [id], onDelete: Cascade)
  disciplina   Disciplina       @relation(fields: [disciplinaId], references: [id])
  preRequisitos PreRequisito[]  @relation("ComponenteAlvo")

  @@unique([matrizId, disciplinaId])
  @@index([matrizId, fase])
  @@map("bychat_aca_componentes")
}

/// Pré-requisito (junção — proibido array escalar).
model PreRequisito {
  id                  Int @id @default(autoincrement())
  componenteId        Int // o que exige
  componenteRequeridoId Int // o que precisa ter sido cursado

  componente          ComponenteCurricular @relation("ComponenteAlvo", fields: [componenteId], references: [id], onDelete: Cascade)
  @@unique([componenteId, componenteRequeridoId])
  @@map("bychat_aca_prerequisitos")
}

/// Turma ACADÊMICA (grupo de alunos de um período). Liga-se à oferta comercial existente.
model Turma {
  id               Int     @id @default(autoincrement())
  courseOfferingId Int?    // FK → CourseOffering (oferta comercial existente)
  periodoLetivoId  Int
  matrizId         Int?    // grade vigente
  nome             String  @db.VarChar(191) // "Téc. Enfermagem — Noturno — 2026/1"
  faseAtual        Int?    // módulo/semestre corrente
  turno            Turno?
  capacidade       Int?
  ativo            Boolean @default(true)
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt

  periodoLetivo    PeriodoLetivo @relation(fields: [periodoLetivoId], references: [id])
  matriculas       Matricula[]
  // diarios       Diario[]   // M6 (doc 06)

  @@index([periodoLetivoId])
  @@index([courseOfferingId])
  @@map("bychat_aca_turmas")
}

// ──────────────── M4 · MATRÍCULA (fato acadêmico) ────────────────

model Matricula {
  id                Int      @id @default(autoincrement())
  alunoId           Int
  turmaId           Int
  courseOfferingId  Int?     // herda da turma; redundância útil p/ relatório
  status            MatriculaStatus @default(INSCRITO)
  origem            String?  @db.VarChar(40) // portal | secretaria | transferencia | rematricula
  enrollmentDraftId Int?     // se nasceu no funil online (EnrollmentDraft existente)
  dataMatricula     DateTime @default(now())
  dataConclusao     DateTime?
  motivoSaida       String?  @db.Text
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt

  aluno             Aluno    @relation(fields: [alunoId], references: [id])
  turma             Turma    @relation(fields: [turmaId], references: [id])
  contrato          ContratoFinanceiro?
  eventos           MatriculaEvento[]

  // Dedup NATIVO: 1 matrícula ativa por aluno×turma
  @@unique([alunoId, turmaId])
  @@index([status])
  @@map("bychat_aca_matriculas")
}

/// Trilha de status (auditoria do ciclo de vida).
model MatriculaEvento {
  id          Int      @id @default(autoincrement())
  matriculaId Int
  de          String?  @db.VarChar(20)
  para        String   @db.VarChar(20)
  obs         String?  @db.Text
  userId      Int?     // quem mudou (User do ByChat)
  createdAt   DateTime @default(now())

  matricula   Matricula @relation(fields: [matriculaId], references: [id], onDelete: Cascade)
  @@index([matriculaId])
  @@map("bychat_aca_matricula_eventos")
}

// ──────────────── M5 · FINANCEIRO (Asaas como braço bancário) ────────────────

/// Plano de pagamento por oferta (anuidade/12, taxa de matrícula, etc.).
model PlanoPagamento {
  id                    Int     @id @default(autoincrement())
  courseOfferingId      Int     // FK → CourseOffering
  nome                  String  @db.VarChar(191)
  numParcelas           Int
  valorParcelaCentavos  Int
  taxaMatriculaCentavos Int     @default(0)
  diaVencimento         Int     @default(10)
  ativo                 Boolean @default(true)
  createdAt             DateTime @default(now())
  updatedAt             DateTime @updatedAt

  @@index([courseOfferingId])
  @@map("bychat_aca_planos_pagamento")
}

model Bolsa {
  id             Int       @id @default(autoincrement())
  alunoId        Int
  tipo           BolsaTipo
  valor          Int       // % (0–100) quando PERCENTUAL; centavos quando VALOR
  motivo         String?   @db.Text
  validadeInicio DateTime?
  validadeFim    DateTime?
  ativo          Boolean   @default(true)
  createdAt      DateTime  @default(now())

  @@index([alunoId])
  @@map("bychat_aca_bolsas")
}

/// Contrato financeiro da matrícula. A "verdade financeira" vive AQUI.
model ContratoFinanceiro {
  id                 Int      @id @default(autoincrement())
  matriculaId        Int      @unique
  planoPagamentoId   Int?
  valorTotalCentavos Int
  descontoCentavos   Int      @default(0)
  bolsaId            Int?
  asaasCustomerId    String?  @db.VarChar(191) // id do cliente no Asaas (referência)
  status             ContratoStatus @default(ATIVO)
  createdAt          DateTime @default(now())
  updatedAt          DateTime @updatedAt

  matricula          Matricula @relation(fields: [matriculaId], references: [id], onDelete: Cascade)
  parcelas           Parcela[]
  @@map("bychat_aca_contratos")
}

model Parcela {
  id                 Int      @id @default(autoincrement())
  contratoId         Int
  nroParcela         Int
  tipo               ParcelaTipo @default(MENSALIDADE)
  valorBrutoCentavos Int
  valorPagoCentavos  Int      @default(0)
  dataVencimento     DateTime
  situacao           ParcelaSituacao @default(ABERTA)
  pagoEm             DateTime?
  // Espelho do Asaas (gateway — referência, não regra)
  asaasChargeId      String?  @db.VarChar(191)
  linhaDigitavel     String?  @db.Text
  pixCopiaCola       String?  @db.Text
  createdAt          DateTime @default(now())
  updatedAt          DateTime @updatedAt

  contrato           ContratoFinanceiro @relation(fields: [contratoId], references: [id], onDelete: Cascade)
  @@index([contratoId])
  @@index([situacao, dataVencimento])
  @@index([asaasChargeId])
  @@map("bychat_aca_parcelas")
}

/// Idempotência + auditoria das chamadas/recebimentos do Asaas (padrão Venda360).
model IntegracaoEvento {
  id              Int      @id @default(autoincrement())
  origem          String   @db.VarChar(40) // ASAAS_WEBHOOK | ASAAS_COBRANCA | ASAAS_CUSTOMER
  eventoExternoId String   @db.VarChar(191) // paymentId/chargeId do Asaas
  status          IntegracaoStatus @default(PENDENTE)
  requestJson     Json?    @db.Json
  responseJson    Json?    @db.Json
  erroMotivo      String?  @db.Text
  tentativas      Int      @default(0)
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@unique([origem, eventoExternoId]) // impede processar o mesmo pagamento 2x
  @@index([status])
  @@map("bychat_aca_integracao_eventos")
}

// ──────────────── OCORRÊNCIAS (registro pedagógico/secretaria) ────────────────

model OcorrenciaAcademica {
  id            Int      @id @default(autoincrement())
  alunoId       Int?
  turmaId       Int?
  tipo          String   @db.VarChar(60) // advertencia | elogio | atendimento | secretaria...
  descricao     String   @db.Text
  anexosJson    Json?    @db.Json
  userId        Int?     // autor (User)
  createdAt     DateTime @default(now())

  aluno         Aluno?   @relation(fields: [alunoId], references: [id])
  @@index([alunoId])
  @@map("bychat_aca_ocorrencias")
}

// =====================================================================
// M6 · NÚCLEO ACADÊMICO — detalhar no doc 06 (NÃO modelar aqui):
//   Diario, AulaRegistro, Frequencia, Avaliacao, Nota,
//   ResultadoComponente, ConselhoClasse, HistoricoEscolar, Certificacao.
// É o maior esforço e tem peso regulatório (histórico/diploma).
// =====================================================================
```

---

## Notas de implementação

- **Back-relation no `Lead`:** adicionar `aluno Aluno?` no model `Lead` existente (1:1). Migração aditiva (`db push`), sem tocar dados do CRM.
- **`Aluno` não duplica contato:** nome/e-mail/WhatsApp/`phoneKey`/dedup vêm do `Lead`. O `Aluno` guarda só o que é acadêmico.
- **Catálogo:** **não** criar `Curso`/`Modalidade`/`Unidade` — usar `Course`/`Modality`/`EducationalUnit` existentes. `Disciplina/Matriz/Turma` são o que falta abaixo do curso.
- **Matrícula:** o `EnrollmentDraft` (funil online) **alimenta** `Matricula` quando a secretaria efetiva — não substitui.
- **Financeiro:** centavos `Int` em tudo; geração de parcelas é **interna e instantânea**; criação de cobrança/customer no Asaas e baixa por webhook são **jobs BullMQ idempotentes**; reusar régua de cobrança e reconciliação do **Venda360**.
- **Migração:** ids do Mentor entram **só** no importador único (mapa temporário em CSV/staging), **não** viram coluna do schema. (Ver doc de migração.)
- **Segredos Asaas:** `apiKey`/`webhook secret` **AES-256-GCM**, nunca em log.

## Arquivos relacionados
- `05_CLAUDE_nativo.md` — contexto, convenções e ordem de build (módulos).
- `06_…` (a criar) — M6 Núcleo Acadêmico.
- `01/02/03_…` — versão Mentor (referência histórica, **não usar**).
