# 01 — Schema Prisma · Módulo ERP Acadêmico (ByChat)

> **Para o Claude Code:** este arquivo contém o schema Prisma completo do módulo ERP Acadêmico, **escopo da Fase Baixa** (cadastros + bridge de matrícula/financeiro com o Mentor Web). O núcleo acadêmico (diário, notas, grade, certificação, histórico) é **Fase Alta** e está marcado como deferido no final — **não implementar agora**.
>
> Copie o bloco `schema.prisma` para `prisma/schema.prisma` (ou para o `schema/` do monorepo, conforme convenção do ByChat). Não rode `prisma migrate` antes de revisar com o time.

---

## Convenções obrigatórias (NÃO violar)

Estas regras valem para **todo** o módulo e já são padrão nos projetos do ByChat:

1. **Multi-tenant:** `tenantId String @db.VarChar(191)` em **toda** tabela de negócio, sempre indexado. O INEPROTEC é o primeiro tenant.
2. **Campos indexados:** todo campo que entra em índice/unique/FK usa `@db.VarChar(191)` (limite de índice utf8mb4 no MySQL 8). Texto longo não-indexado usa `@db.Text`.
3. **Dinheiro:** **centavos em `Int`** (convenção Venda360). Nunca `Float`. Nome do campo sempre `*Centavos`.
4. **Arrays:** proibido array escalar — usar **tabela-junção**.
5. **JSON:** dados esparsos/raros vão em `@db.Json` numa tabela `*Complementar`, não em dezenas de colunas nulas.
6. **Idempotência:** integrações usam `@@unique([origem, eventoExternoId])` (padrão webhook Venda360).
7. **`createMany` + `skipDuplicates`:** **não usar** (MySQL não suporta no Prisma como esperado). Inserir em loop/transação.
8. **Soft state:** usar `ativo Boolean @default(true)` em vez de deletar registros de pessoa/cadastro.
9. **Timestamps:** `criadoEm`/`atualizadoEm` em todas as tabelas.

---

## schema.prisma

```prisma
// =====================================================================
// ByChat · Módulo ERP Acadêmico — Fase Baixa
// MySQL 8 · Prisma 6
// =====================================================================

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "mysql"
  url      = env("DATABASE_URL")
}

// ---------------------------------------------------------------------
// ENUMS
// ---------------------------------------------------------------------

enum PapelTipo {
  ALUNO
  COLABORADOR
  PROFESSOR
  ORIENTADOR
  COORDENADOR
  CANDIDATO
}

enum ZonaResidencia {
  URBANA
  RURAL
}

enum Sexo {
  MASCULINO
  FEMININO
  OUTROS
}

enum TurnoTipo {
  MATUTINO
  VESPERTINO
  NOTURNO
  INTEGRAL
}

enum FormaRealizacaoAula {
  PRESENCIAL
  EAD
  HIBRIDO
}

// Status da matrícula — alinhado ao Mentor Web (statusMatriculaIngresso)
enum StatusMatricula {
  PREMAT // pré-matrícula (documentos pendentes)
  ATIVO
  CANCEL
}

enum SituacaoParcela {
  ABERTA
  PAGA
  CANCELADA
  VENCIDA
}

// Tipo de entidade no mapeamento com o Mentor Web
enum EntidadeMentor {
  PESSOA
  CURSO
  DISCIPLINA
  TURMA
  PERIODO_LETIVO
  UNIDADE
  CONTRATO_FINANCEIRO
}

enum OrigemIntegracao {
  MENTOR_MATRICULA
  MENTOR_GERA_TITULO
  MENTOR_CONSULTA_PARCELA
  MENTOR_CANCELA_PARCELA
}

enum StatusIntegracao {
  PENDENTE
  SUCESSO
  ERRO
}

// ---------------------------------------------------------------------
// TENANT / UNIDADE
// ---------------------------------------------------------------------

model Tenant {
  id          String   @id @default(cuid()) @db.VarChar(191)
  nome        String   @db.VarChar(191)
  slug        String   @unique @db.VarChar(191)
  ativo       Boolean  @default(true)
  criadoEm    DateTime @default(now())
  atualizadoEm DateTime @updatedAt

  unidades    Unidade[]
  pessoas     Pessoa[]
  @@map("tenant")
}

model Unidade {
  id          String   @id @default(cuid()) @db.VarChar(191)
  tenantId    String   @db.VarChar(191)
  nome        String   @db.VarChar(191)
  ativo       Boolean  @default(true)
  criadoEm    DateTime @default(now())
  atualizadoEm DateTime @updatedAt

  tenant      Tenant   @relation(fields: [tenantId], references: [id])

  @@index([tenantId])
  @@map("unidade")
}

// ---------------------------------------------------------------------
// PESSOA (unificada — É o Contato/Lead do CRM ByChat)
// ---------------------------------------------------------------------

model Pessoa {
  id              String   @id @default(cuid()) @db.VarChar(191)
  tenantId        String   @db.VarChar(191)
  unidadeAtualId  String?  @db.VarChar(191)

  // Cabeçalho (campos fixos do Mentor)
  codigoInterno   Int?     // "Código" auto do Mentor (mapeado)
  ativo           Boolean  @default(true)
  nome            String   @db.VarChar(191)
  utilizaNomeSocial Boolean @default(false)
  nomeSocial      String?  @db.VarChar(191)
  nomePesquisa    String?  @db.VarChar(191)
  fotoUrl         String?  @db.Text
  cpf             String?  @db.VarChar(191) // CPF/passaporte
  dataFalecimento DateTime?

  criadoEm        DateTime @default(now())
  atualizadoEm    DateTime @updatedAt

  // Relations (abas)
  tenant          Tenant                       @relation(fields: [tenantId], references: [id])
  papeis          PessoaPapel[]
  endereco        PessoaEndereco?
  contato         PessoaContato?
  documentos      PessoaDocumentos?
  dadosCompl      PessoaDadosComplementares?
  dadosAluno      PessoaDadosAluno?
  dadosColab      PessoaDadosColaborador?
  infoProfissional PessoaInfoProfissional?
  socioEconomico  PessoaDadosSocioEconomico?
  contasBancarias ContaBancaria[]
  ocorrencias     Ocorrencia[]                 @relation("OcorrenciaPessoa")
  matriculas      Matricula[]

  @@index([tenantId])
  @@index([tenantId, cpf])
  @@index([tenantId, nome])
  @@map("pessoa")
}

model PessoaPapel {
  id        String    @id @default(cuid()) @db.VarChar(191)
  tenantId  String    @db.VarChar(191)
  pessoaId  String    @db.VarChar(191)
  papel     PapelTipo

  pessoa    Pessoa    @relation(fields: [pessoaId], references: [id], onDelete: Cascade)

  @@unique([pessoaId, papel])
  @@index([tenantId, papel])
  @@map("pessoa_papel")
}

// ABA 1 — ENDEREÇO
model PessoaEndereco {
  id              String   @id @default(cuid()) @db.VarChar(191)
  pessoaId        String   @unique @db.VarChar(191)
  cep             String?  @db.VarChar(191)
  municipioIbge   String?  @db.VarChar(191)
  municipioNome   String?  @db.VarChar(191)
  logradouro      String?  @db.Text
  numero          String?  @db.VarChar(191)
  bairro          String?  @db.VarChar(191)
  complemento     String?  @db.Text
  zonaResidencia  ZonaResidencia?
  localizacaoDiferenciada String? @db.VarChar(191)
  tipoCorrespondencia String? @db.VarChar(191)
  usaEnderecoCobranca Boolean @default(false)

  pessoa          Pessoa   @relation(fields: [pessoaId], references: [id], onDelete: Cascade)
  @@map("pessoa_endereco")
}

// ABA 1 — CONTATOS
model PessoaContato {
  id                  String  @id @default(cuid()) @db.VarChar(191)
  pessoaId            String  @unique @db.VarChar(191)
  foneResidencial     String? @db.VarChar(191)
  foneCelular         String? @db.VarChar(191)
  foneComercial       String? @db.VarChar(191)
  ramal               String? @db.VarChar(191)
  foneInternacional   String? @db.VarChar(191)
  email               String? @db.VarChar(191)
  emailAlternativo    String? @db.VarChar(191)
  emailInstitucional  String? @db.VarChar(191)
  homePage            String? @db.Text
  outrosContatos      String? @db.Text

  pessoa              Pessoa  @relation(fields: [pessoaId], references: [id], onDelete: Cascade)
  @@index([email])
  @@map("pessoa_contato")
}

// ABA 2 — DOCUMENTOS (campos raros vão em dadosJson)
model PessoaDocumentos {
  id                String  @id @default(cuid()) @db.VarChar(191)
  pessoaId          String  @unique @db.VarChar(191)
  rgRnm             String? @db.Text
  tipoDocEstrangeiro String? @db.VarChar(191)
  dataEmissaoRg     DateTime?
  orgaoEmissorRg    String? @db.VarChar(191)
  ufOrgaoEmissor    String? @db.VarChar(191)
  cnh               String? @db.VarChar(191)
  categoriaCnh      String? @db.VarChar(191)
  pis               String? @db.VarChar(191)
  curriculumLattes  String? @db.Text
  // Título de eleitor + Certidão civil (esparsos) → JSON
  dadosJson         Json?   @db.Json

  pessoa            Pessoa  @relation(fields: [pessoaId], references: [id], onDelete: Cascade)
  @@map("pessoa_documentos")
}

// ABA 3 — DADOS COMPLEMENTARES
model PessoaDadosComplementares {
  id                String  @id @default(cuid()) @db.VarChar(191)
  pessoaId          String  @unique @db.VarChar(191)
  tipoNacionalidade String? @db.VarChar(191)
  municipioNascIbge String? @db.VarChar(191)
  municipioNascNome String? @db.VarChar(191)
  nacionalidade     String? @db.VarChar(191)
  sexo              Sexo?
  dataNascimento    DateTime?
  estadoCivil       String? @db.VarChar(191)
  religiao          String? @db.VarChar(191)
  corRacaEtnia      String? @db.VarChar(191)
  autodeclarado     Boolean @default(false)
  // Responsáveis (contrato/financeiro/pedagógico/familiar) + cônjuge → JSON
  // FILIAÇÃO DETALHADA = ROADMAP (não modelar agora)
  responsaveisJson  Json?   @db.Json
  contatoEmergencia String? @db.VarChar(191)
  localEmergencia   String? @db.Text

  pessoa            Pessoa  @relation(fields: [pessoaId], references: [id], onDelete: Cascade)
  @@map("pessoa_dados_complementares")
}

// ABA 4 — ALUNO
// OBS: "aluno pode sair sozinho", conselho tutelar, encaminhamento = ROADMAP.
model PessoaDadosAluno {
  id              String  @id @default(cuid()) @db.VarChar(191)
  pessoaId        String  @unique @db.VarChar(191)
  estaEstudando   Boolean @default(false)
  // Campos de menor (sair sozinho, retirada, conselho tutelar) → JSON roadmap
  dadosRoadmapJson Json?  @db.Json

  pessoa          Pessoa  @relation(fields: [pessoaId], references: [id], onDelete: Cascade)
  @@map("pessoa_dados_aluno")
}

// ABA 5 — COLABORADOR / PROFESSOR
model PessoaDadosColaborador {
  id                  String  @id @default(cuid()) @db.VarChar(191)
  pessoaId            String  @unique @db.VarChar(191)
  tipoProfessor       String? @db.VarChar(191)
  credenciadoPos      Boolean @default(false)
  registroProfEstado  String? @db.VarChar(191)
  departamentoId      String? @db.VarChar(191)
  dataBloqueioBiblioteca DateTime?

  pessoa              Pessoa  @relation(fields: [pessoaId], references: [id], onDelete: Cascade)
  @@map("pessoa_dados_colaborador")
}

// Conta bancária (só após gravar a pessoa — regra do Mentor)
model ContaBancaria {
  id          String  @id @default(cuid()) @db.VarChar(191)
  pessoaId    String  @db.VarChar(191)
  banco       String? @db.VarChar(191)
  agencia     String? @db.VarChar(191)
  numeroConta String? @db.VarChar(191)

  pessoa      Pessoa  @relation(fields: [pessoaId], references: [id], onDelete: Cascade)
  @@index([pessoaId])
  @@map("conta_bancaria")
}

// ABA 6 — INFORMAÇÕES PROFISSIONAIS
model PessoaInfoProfissional {
  id                String  @id @default(cuid()) @db.VarChar(191)
  pessoaId          String  @unique @db.VarChar(191)
  empresaTrabalho   String? @db.VarChar(191)
  ocupacaoProfissional String? @db.VarChar(191)
  ocupacaoAtual     String? @db.VarChar(191)
  ctps              String? @db.VarChar(191)
  serieCtps         String? @db.VarChar(191)
  dataEmissaoCtps   DateTime?
  ufCtps            String? @db.VarChar(191)
  qualificacao      String? @db.Text

  pessoa            Pessoa  @relation(fields: [pessoaId], references: [id], onDelete: Cascade)
  @@map("pessoa_info_profissional")
}

// ABA 7 — DADOS SÓCIO-ECONÔMICOS (muitos campos esparsos → JSON)
model PessoaDadosSocioEconomico {
  id              String  @id @default(cuid()) @db.VarChar(191)
  pessoaId        String  @unique @db.VarChar(191)
  rendaCentavos   Int?    // dinheiro = centavos Int
  dadosJson       Json?   @db.Json // visita assistente social, passes, transporte, moradia, etc.

  pessoa          Pessoa  @relation(fields: [pessoaId], references: [id], onDelete: Cascade)
  @@map("pessoa_socio_economico")
}

// ---------------------------------------------------------------------
// PESSOA JURÍDICA
// ---------------------------------------------------------------------

model PessoaJuridica {
  id            String   @id @default(cuid()) @db.VarChar(191)
  tenantId      String   @db.VarChar(191)
  codigoInterno Int?
  ativo         Boolean  @default(true)
  razaoSocial   String   @db.VarChar(191)
  nomeFantasia  String?  @db.VarChar(191)
  cnpj          String?  @db.VarChar(191)
  logoUrl       String?  @db.Text

  // ABA Geral
  cep           String?  @db.VarChar(191)
  zonaEscola    ZonaResidencia?
  logradouro    String?  @db.Text
  numero        String?  @db.VarChar(191)
  bairro        String?  @db.VarChar(191)
  complemento   String?  @db.Text
  municipioIbge String?  @db.VarChar(191)
  municipioNome String?  @db.VarChar(191)
  dataFundacao  DateTime?
  inscricaoEstadual String? @db.VarChar(191)
  fone          String?  @db.VarChar(191)
  fax           String?  @db.VarChar(191)
  email         String?  @db.VarChar(191)
  emailAlternativo String? @db.VarChar(191)
  outrosContatos String? @db.Text
  homePage      String?  @db.Text

  // ABA Instituição de Ensino + Dados Complementares → JSON (esparso)
  flags         Json?    @db.Json // permiteEmail, permiteNotificacao, bloqueiaPorPendencia
  instituicaoJson Json?  @db.Json // mantenedora, IES, reitor, diretor, regime tributário...

  parceiro      Boolean  @default(false)
  instituicaoEnsino Boolean @default(false)

  criadoEm      DateTime @default(now())
  atualizadoEm  DateTime @updatedAt

  @@index([tenantId])
  @@index([tenantId, cnpj])
  @@index([tenantId, razaoSocial])
  @@map("pessoa_juridica")
}

// ---------------------------------------------------------------------
// OCORRÊNCIAS
// ---------------------------------------------------------------------

model Ocorrencia {
  id            String   @id @default(cuid()) @db.VarChar(191)
  tenantId      String   @db.VarChar(191)
  tipoPessoa    PapelTipo @default(ALUNO)
  tipoOcorrencia String  @db.VarChar(191)
  pessoaId      String?  @db.VarChar(191)
  cursoId       String?  @db.VarChar(191)
  turmaId       String?  @db.VarChar(191)
  disciplinaId  String?  @db.VarChar(191)
  periodoLetivoId String? @db.VarChar(191)
  dataOcorrencia DateTime @default(now())
  descricao     String   @db.Text
  criadoEm      DateTime @default(now())

  pessoa        Pessoa?  @relation("OcorrenciaPessoa", fields: [pessoaId], references: [id])
  anexos        OcorrenciaAnexo[]

  @@index([tenantId])
  @@index([pessoaId])
  @@map("ocorrencia")
}

model OcorrenciaAnexo {
  id           String   @id @default(cuid()) @db.VarChar(191)
  ocorrenciaId String   @db.VarChar(191)
  url          String   @db.Text
  nomeArquivo  String   @db.VarChar(191)
  criadoEm     DateTime @default(now())

  ocorrencia   Ocorrencia @relation(fields: [ocorrenciaId], references: [id], onDelete: Cascade)
  @@index([ocorrenciaId])
  @@map("ocorrencia_anexo")
}

// ---------------------------------------------------------------------
// CADASTROS ACADÊMICOS (Fase Baixa: ESPELHADOS do Mentor; donos na Média)
// ---------------------------------------------------------------------

model Curso {
  id        String   @id @default(cuid()) @db.VarChar(191)
  tenantId  String   @db.VarChar(191)
  nome      String   @db.VarChar(191)
  ativo     Boolean  @default(true)
  criadoEm  DateTime @default(now())
  atualizadoEm DateTime @updatedAt

  turmas    Turma[]
  @@index([tenantId])
  @@map("curso")
}

model Disciplina {
  id            String   @id @default(cuid()) @db.VarChar(191)
  tenantId      String   @db.VarChar(191)
  nome          String   @db.VarChar(191)
  nomeAbreviado String?  @db.VarChar(191)
  iconeUrl      String?  @db.Text
  departamentoId String? @db.VarChar(191)
  formaRealizacao FormaRealizacaoAula @default(PRESENCIAL)
  subareaConhecimento String? @db.VarChar(191)
  permiteFecharDiarioIncompleto Boolean @default(false)
  chTeoricaPresencial Int @default(0)
  chPraticaPresencial Int @default(0)
  chAdicional   Int @default(0)
  creditosTeorico Int @default(0)
  creditosPratico Int @default(0)
  creditosFinanceiro Int @default(0)
  observacoes   String?  @db.Text
  ativo         Boolean  @default(true)
  criadoEm      DateTime @default(now())
  atualizadoEm  DateTime @updatedAt

  equivalencias DisciplinaEquivalencia[] @relation("DisciplinaOrigem")
  @@index([tenantId])
  @@map("disciplina")
}

model DisciplinaEquivalencia {
  id              String   @id @default(cuid()) @db.VarChar(191)
  disciplinaId    String   @db.VarChar(191)
  disciplinaEquivId String @db.VarChar(191)
  tipoEquivalencia String  @default("SIMPLES") @db.VarChar(191)

  disciplina      Disciplina @relation("DisciplinaOrigem", fields: [disciplinaId], references: [id], onDelete: Cascade)
  @@unique([disciplinaId, disciplinaEquivId])
  @@map("disciplina_equivalencia")
}

model PeriodoLetivo {
  id        String   @id @default(cuid()) @db.VarChar(191)
  tenantId  String   @db.VarChar(191)
  descricao String   @db.VarChar(191) // ex.: "2026 (Técnico)"
  anoLetivo Int?
  ativo     Boolean  @default(true)

  turmas    Turma[]
  @@index([tenantId])
  @@map("periodo_letivo")
}

model Turma {
  id              String   @id @default(cuid()) @db.VarChar(191)
  tenantId        String   @db.VarChar(191)
  cursoId         String   @db.VarChar(191)
  periodoLetivoId String   @db.VarChar(191)
  unidadeId       String?  @db.VarChar(191)
  nome            String   @db.VarChar(191)
  turno           TurnoTipo?
  dataInicio      DateTime?
  ativo           Boolean  @default(true)

  curso           Curso         @relation(fields: [cursoId], references: [id])
  periodoLetivo   PeriodoLetivo @relation(fields: [periodoLetivoId], references: [id])
  matriculas      Matricula[]
  @@index([tenantId])
  @@index([cursoId])
  @@map("turma")
}

// ---------------------------------------------------------------------
// MATRÍCULA + FINANCEIRO (Bridge com Mentor Web)
// ---------------------------------------------------------------------

model Matricula {
  id              String   @id @default(cuid()) @db.VarChar(191)
  tenantId        String   @db.VarChar(191)
  pessoaId        String   @db.VarChar(191)
  turmaId         String   @db.VarChar(191)
  status          StatusMatricula @default(PREMAT)
  dataMatricula   DateTime @default(now())
  formaIngresso   String?  @db.VarChar(191)

  // IDs retornados pela API do Mentor (matriculaAlunoConformeFiltros)
  mentorMestreAlunoId      Int?
  mentorContratoFinanceiroId Int?
  mentorIngressoId         Int?
  mentorTurmaId            Int?
  mentorCursoId            Int?
  mentorPeriodoLetivoId    Int?

  criadoEm        DateTime @default(now())
  atualizadoEm    DateTime @updatedAt

  pessoa          Pessoa   @relation(fields: [pessoaId], references: [id])
  turma           Turma    @relation(fields: [turmaId], references: [id])
  parcelas        Parcela[]

  // Guarda de idempotência: impede matricular a mesma pessoa na mesma turma/período 2x
  @@unique([tenantId, pessoaId, mentorTurmaId, mentorPeriodoLetivoId])
  @@index([tenantId])
  @@index([status])
  @@map("matricula")
}

model Parcela {
  id              String   @id @default(cuid()) @db.VarChar(191)
  tenantId        String   @db.VarChar(191)
  matriculaId     String?  @db.VarChar(191)
  // Espelho do retorno de geraParcelaTitulo
  mentorParcelaId Int?
  mentorTituloId  Int?
  nroParcela      Int
  valorBrutoCentavos Int   // centavos
  dataVencimento  DateTime
  situacao        SituacaoParcela @default(ABERTA)
  linhaDigitavel  String?  @db.Text
  isPaga          Boolean  @default(false)

  criadoEm        DateTime @default(now())
  atualizadoEm    DateTime @updatedAt

  matricula       Matricula? @relation(fields: [matriculaId], references: [id])
  @@index([tenantId])
  @@index([matriculaId])
  @@index([mentorParcelaId])
  @@map("parcela")
}

// ---------------------------------------------------------------------
// MAPEAMENTO MENTOR WEB (entidade ByChat ↔ id/codTel do Mentor)
// ---------------------------------------------------------------------

model MapeamentoMentor {
  id            String   @id @default(cuid()) @db.VarChar(191)
  tenantId      String   @db.VarChar(191)
  entidade      EntidadeMentor
  localId       String   @db.VarChar(191) // id no ByChat
  mentorId      Int?     // id numérico no Mentor
  mentorCodTel  String?  @db.VarChar(191) // código texto (codTel) no Mentor
  criadoEm      DateTime @default(now())

  @@unique([tenantId, entidade, localId])
  @@index([tenantId, entidade, mentorId])
  @@map("mapeamento_mentor")
}

// ---------------------------------------------------------------------
// LOG DE INTEGRAÇÃO (idempotência + auditoria das chamadas ao Mentor)
// ---------------------------------------------------------------------

model IntegracaoEvento {
  id              String   @id @default(cuid()) @db.VarChar(191)
  tenantId        String   @db.VarChar(191)
  origem          OrigemIntegracao
  eventoExternoId String   @db.VarChar(191) // chave idempotência gerada pelo ByChat
  status          StatusIntegracao @default(PENDENTE)
  requestJson     Json?    @db.Json
  responseJson    Json?    @db.Json
  erroMotivo      String?  @db.Text
  tentativas      Int      @default(0)
  criadoEm        DateTime @default(now())
  atualizadoEm    DateTime @updatedAt

  // Padrão Venda360 — impede processar o mesmo evento 2x
  @@unique([origem, eventoExternoId])
  @@index([tenantId, status])
  @@map("integracao_evento")
}

// =====================================================================
// FASE ALTA — NÃO IMPLEMENTAR AGORA (apenas referência de roadmap)
// Diário Eletrônico, Frequência, Notas, Fechamento de diário,
// Grade Curricular + pré-requisitos, Validação de Disciplinas,
// Certificação, Histórico Escolar, Migração de dados do Mentor.
// Modelar somente quando a Fase Alta for iniciada.
// =====================================================================
```

---

## Notas de implementação para o Claude Code

- **Pessoa = Contato:** ao integrar com o ByChat existente, decidir se `Pessoa` estende a tabela de Contato/Lead atual ou se há FK 1:1. **Não criar silo duplicado** — esse é o objetivo central do projeto.
- **Centavos:** todo valor (`valorBrutoCentavos`, `rendaCentavos`) entra e sai como inteiro de centavos. Conversão para exibição só na camada de apresentação.
- **`@db.Json`:** usado para abas/campos esparsos (sócio-econômico, certidão civil, responsáveis). Validar shape com Zod na aplicação — o banco não valida JSON.
- **Migração:** gerar a migration, revisar o SQL (especialmente tamanho de índices), só então aplicar.
- **Próximo arquivo:** ver `02_CLAUDE.md` (ordem de build da Fase Baixa) e `03_adapter_mentor_web_spec.md` (contrato das APIs).
