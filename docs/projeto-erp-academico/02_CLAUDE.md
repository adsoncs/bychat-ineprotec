# CLAUDE.md — Módulo ERP Acadêmico (ByChat)

> Arquivo de contexto para o **Claude Code**. Leia este arquivo inteiro antes de escrever qualquer código. Ele define o objetivo, a stack, as convenções inegociáveis, o escopo da Fase Baixa e a ordem de construção.

---

## 1. Objetivo do projeto

Construir um **ERP acadêmico** como módulo dentro do **ByChat** (SaaS omnichannel multi-tenant da BeyondHub), para **substituir o Mentor Web** no INEPROTEC (curso técnico / EAD).

**Estratégia:** strangler-fig com bridge de API.
- **Fase Baixa (este escopo):** o ByChat vira o front operacional. Matrícula e financeiro continuam sendo processados pelo Mentor Web **via API REST** (Adapter/ACL). Objetivo: a secretaria para de abrir o Mentor no dia a dia, em semanas.
- **Fase Média / Alta:** ByChat assume cadastros, financeiro próprio (Asaas, padrão Venda360) e o núcleo acadêmico (diário/notas/certificação/histórico). Núcleo acadêmico **não tem API no Mentor** → reconstrução + migração + operação paralela. **Não está neste escopo.**

> ⚠️ "Substituir urgente" se aplica ao **front via bridge**, não ao desligamento do Mentor. Não tentar reconstruir o núcleo acadêmico nesta fase.

---

## 2. Stack (idêntica ao restante do ByChat)

- **Monorepo:** pnpm + Turborepo.
- **Backend:** Fastify (Node/TypeScript).
- **Frontend:** Next.js 14 (App Router).
- **ORM/DB:** Prisma 6 / **MySQL 8**.
- **Filas/cache:** BullMQ + Redis.
- **Realtime:** Socket.io.
- **WhatsApp:** Evolution API (instância já existente do ByChat).
- **Validação:** Zod em todas as bordas (request, JSON de banco, retorno de API externa).
- **Pagamentos (Fase Média):** Asaas (reusar arquitetura Venda360).

---

## 3. Convenções inegociáveis (MySQL 8 + Prisma)

Estas regras já são padrão nos projetos do ByChat. **Não violar.**

1. **Multi-tenant:** `tenantId @db.VarChar(191)` em toda tabela de negócio, sempre indexado.
2. **Campos indexados:** `@db.VarChar(191)` (limite de índice utf8mb4). Texto longo não indexado: `@db.Text`.
3. **Dinheiro:** **centavos em `Int`**, nunca `Float`. Campo sempre `*Centavos`.
4. **Arrays:** proibido array escalar → usar tabela-junção.
5. **JSON esparso:** `@db.Json` em tabela `*Complementar`, validado com Zod na aplicação.
6. **Idempotência de integração:** `@@unique([origem, eventoExternoId])` (padrão webhook Venda360).
7. **`createMany` + `skipDuplicates`:** **não usar**. Inserir em loop/transação.
8. **Soft state:** `ativo Boolean @default(true)` em vez de deletar pessoas/cadastros.
9. **Timestamps:** `criadoEm` / `atualizadoEm` em tudo.
10. **Segredos:** credenciais de integração cifradas **AES-256-GCM por tenant**. Nunca em código nem em log.

---

## 4. Estrutura de pastas sugerida (dentro do monorepo)

```
apps/
  api/                         # Fastify
    src/modules/erp/
      pessoa/                  # CRUD Pessoa (7 abas)
      pessoa-juridica/
      ocorrencia/
      cadastros/               # curso, disciplina, turma, periodo (espelho)
      matricula/               # workflow + chamada ao adapter
      financeiro/              # parcelas/boletos (via adapter na Baixa)
      mapeamento/              # MapeamentoMentor
    src/integrations/mentor-web/   # ADAPTER (ver 03_adapter_mentor_web_spec.md)
  web/                         # Next.js 14
    app/(erp)/...
packages/
  db/                          # schema.prisma (ver 01_schema_prisma_erp_academico.md)
  shared/                      # tipos Zod compartilhados
```

---

## 5. Escopo da Fase Baixa — ordem de construção

Construir **nesta ordem**. Cada item deve ter teste e estar funcional antes do próximo.

| # | Tarefa | Depende de | Pronto quando |
|---|---|---|---|
| **B1** | Schema Prisma + migration | — | Migration aplicada e revisada (ver arquivo 01). |
| **B4** | **Adapter Mentor Web (ACL)** | B1 | Os 4 serviços chamáveis com auth token→execute, retry BullMQ, idempotência e mapeamento de erro. (ver arquivo 03). **Construir cedo — destrava B6/B7.** |
| **B2** | CRUD Pessoa Física (7 abas) | B1 | Cadastro/edição/busca; ligado ao Contato do CRM (sem silo). |
| **B3** | CRUD Pessoa Jurídica | B1 | Cadastro/edição/busca. |
| **B5** | Sync/mapeamento de cursos, turmas, períodos (read-only do Mentor) | B4 | `MapeamentoMentor` populado; ByChat conhece os IDs do Mentor. |
| **B6** | Matrícula via API | B4, B5, B2 | Front → `matriculaAlunoConformeFiltros`; trata PREMAT/ATIVO; guarda de duplicidade. |
| **B7** | Cobrança via API | B6 | `geraParcelaTitulo` → parcelas/boleto salvos; consulta e cancelamento. |
| **B8** | Envio de Documentos (fluxo PREMAT→ATIVO) | B6 | Coleta por WhatsApp; secretaria efetiva matrícula. |
| **B9** | Registro de Ocorrências | B1, B2 | CRUD + anexo. |
| **B10** | Caixa de Mensagens → omnichannel | — | Mensageria interna apontando para o motor WhatsApp/Socket.io do ByChat. |
| **B11** | Boleto/linha digitável no WhatsApp | B7 | Envio automático via Evolution API após geração. |

**Definição de pronto da fase:** uma matrícula nasce no WhatsApp, é processada no Mentor via API, gera boleto e é enviada ao aluno — tudo pelo ByChat, sem a secretaria abrir a interface do Mentor.

---

## 6. Regras de negócio críticas (não esquecer)

### 6.1 Matrícula
- Status segue o Mentor: `PREMAT` (documentos pendentes), `ATIVO`, `CANCEL`.
- Se a instituição exige documentos obrigatórios, **enviar `statusMatriculaIngresso = "PREMAT"`** e efetivar via secretaria após entrega. Enviar `ATIVO` com documentos pendentes faz o Mentor **rejeitar** com erro.
- A API **não tem idempotência** → **deduplicar antes de chamar** (guarda `@@unique([tenantId, pessoaId, mentorTurmaId, mentorPeriodoLetivoId])` + registro em `IntegracaoEvento`). Matricular 2× gera contrato/boleto duplicado.
- Retorno de sucesso traz `contratoFinanceiroId` → guardar; é a chave para gerar boleto.

### 6.2 Financeiro
- `geraParcelaTitulo` usa `contratoFinanceiroId` (vindo da matrícula). Retorna parcelas com `titulo.linhaDigitavel` (boleto).
- Valores do Mentor vêm como decimal (ex.: `10.00`) → **converter para centavos `Int`** ao persistir.
- Cancelamento exige `cancelaSomenteTit` sempre; e (`contratoFinId` + `parcelaInicial` + `parcelaFinal`) **ou** `parcelaId`.

### 6.3 Pessoa
- `Pessoa` é o mesmo registro do Contato/Lead do CRM. Um candidato que matricula **não vira outro registro** — ganha o papel `ALUNO`. Isso fecha o gap conversão-vs-matrícula do INEPROTEC.
- 7 abas com fidelidade ao Mentor, **exceto**: conselho tutelar, "aluno pode sair sozinho", filiação detalhada → **roadmap** (campos em `dadosRoadmapJson`, não construir UI agora).

---

## 7. Variáveis de ambiente (Fase Baixa)

```
DATABASE_URL=mysql://...
REDIS_URL=redis://...

# Mentor Web ServicoExterno
MENTOR_BASE_URL=                 # protocolo://endereco/nomeAplicacaoG5
MENTOR_SERVICO_USUARIO=          # usuário do serviço externo (por tenant → cofre)
MENTOR_SERVICO_SENHA=            # senha do serviço externo (por tenant → cofre)

# Cripto de credenciais por tenant
CRED_ENCRYPTION_KEY=             # chave AES-256-GCM (32 bytes, base64)

# Evolution API (já existe no ByChat)
EVOLUTION_API_URL=
EVOLUTION_INSTANCE=
```

> Credenciais do Mentor são **por tenant** → armazenar cifradas (AES-256-GCM) no banco, não só em env. Env serve para dev/single-tenant.

---

## 8. O que NÃO fazer nesta fase

- ❌ Não reconstruir diário, notas, frequência, grade, validação de disciplinas, certificação ou histórico (Fase Alta).
- ❌ Não copiar a UI do Mentor (teclas F7/F9/F10, iframe Flutter, 7 abas densas). UI moderna, *progressive disclosure*.
- ❌ Não criar tabela de pessoa separada do Contato/CRM.
- ❌ Não usar `Float` para dinheiro nem array escalar.
- ❌ Não chamar APIs do Mentor de forma síncrona no request — sempre via BullMQ.
- ❌ Não migrar dados do Mentor agora (Fase Alta).

---

## 9. Arquivos relacionados
- `01_schema_prisma_erp_academico.md` — schema Prisma completo.
- `03_adapter_mentor_web_spec.md` — contrato das 4 APIs do Mentor + design do Adapter.
