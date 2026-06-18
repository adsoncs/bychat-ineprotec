# 06 — Plano de Implementação (sem migração) · Módulo Acadêmico ByChat

> **Não há migração de dados.** Começo limpo: cadastra-se **uma turma-piloto à mão** e o sistema entra em operação incrementalmente. Este doc é o **playbook de execução** — ordem, entregáveis e critério de pronto por fase. Base: `04_schema_nativo_bychat.md` + `05_CLAUDE_nativo.md`.

---

## 0. Como cada fase é construída (o "rito")

Mesmo rito que já validamos no Helpdesk. **Cada fase é um PR independente, testado antes do próximo:**

1. **Schema aditivo** → `prisma migrate diff` (confirmar que é só `ADD TABLE/COLUMN`) → `prisma db push` no DB do ineprotec.
2. **Backend** → services + rotas (Fastify), Zod nas bordas, jobs no BullMQ quando pesado.
3. **Smoke** → token forjado + curl/tsx, valida endpoints ponta a ponta.
4. **Frontend** → telas Preact (página dedicada + item de menu), `npx vite build`.
5. **Permissões/menu** → `moduleRegistry` + sidebar + `modulePermissionHook`.
6. **Commit/push** (mensagem padronizada) + atualizar este doc.

**Regras transversais:** ids `Int`; sem `tenantId`; tabelas `bychat_aca_`; centavos `Int`; reusar antes de criar; nada do Asaas síncrono no request.

---

## Fase 0 — Fundação (1 sprint) · destrava tudo

| Passo | Entregável | Pronto quando |
|---|---|---|
| **0.1** | Models M1/M2/M4/M5 do `04_` no `schema.prisma` + `aluno Aluno?` no `Lead` | `db push` aplicado; diff só aditivo |
| **0.2** | Registrar módulo **`academico`** no `moduleRegistry` (routePrefixes `/api/aca`, `/api/admin/aca`) | Módulo aparece em Configurações › Módulos |
| **0.3** | Presets de permissão (SUPERADMIN/ADMIN/MANAGER/AGENT/secretaria) + grupo "Acadêmico" na sidebar | Gate funcionando, item no menu |
| **0.4** | Seed de **catálogo-piloto**: 1 `EducationalUnit` (já existe?), 1 `Course`, 1 `CourseOffering`, 1 `PeriodoLetivo`, 1 `MatrizCurricular` + disciplinas, 1 `Turma` | Turma-piloto navegável |

> 0.4 substitui a "migração": a operação começa por **1 curso/turma real** cadastrado pela secretaria.

---

## Sequência de módulos (cada um = uma fase entregável)

### P1 · M1 Pessoas — Aluno sobre o Lead
- **Backend:** CRUD `Aluno` (1:1 com `Lead`); ao promover um Lead a Aluno, **não cria registro novo** — anexa `Aluno` + papel. `ResponsavelAluno`.
- **Frontend:** aba "Acadêmico" no detalhe do Lead + lista de Alunos.
- **Pronto:** um Lead vira Aluno (com RA gerado) sem duplicar contato; busca por RA/CPF/nome.

### P2 · M2 Estrutura acadêmica
- **Backend:** CRUD `PeriodoLetivo`, `Disciplina` (sob `Course`), `MatrizCurricular`+`Componente`+`PreRequisito`, `Turma` (ligada a `CourseOffering`).
- **Frontend:** telas de Cursos→Disciplinas→Matriz e Turmas/Período.
- **Pronto:** montar a grade de um curso e abrir uma turma de um período.

### P3 · M3 Captação & Processo Seletivo (alto reuso)
- **Reuso:** `EnrollmentPortal`/`SelectionProcess`/`EntryMode`/Forms já fazem inscrição online. Aqui é **fiação**: vagas por turma, classificação, lista de espera.
- **Pronto:** inscrição online cai no funil e gera candidato vinculável a uma turma.

### P4 · M4 Matrícula (fato acadêmico)
- **Backend:** `Matricula` com ciclo `INSCRITO→PRE_MATRICULA→MATRICULADO→…`; cada transição grava `MatriculaEvento`; dedup `@@unique([alunoId,turmaId])`; efetivar a partir do `EnrollmentDraft`.
- **Frontend:** tela de matrícula/rematrícula + troca de status; coleta de documentos via Forms/Helpdesk.
- **Pronto:** secretaria efetiva uma matrícula numa turma; status muda com trilha.

### P5 · M5 Financeiro (Asaas, reuso Venda360)
- **Backend:** `PlanoPagamento` por oferta → ao matricular, gera `ContratoFinanceiro` + `Parcela`s **internamente**. Jobs BullMQ: `asaas.customer`, `asaas.cobranca` (boleto+PIX), **webhook idempotente** (`@@unique([origem,eventoExternoId])`) que baixa parcela; **reconciliação** periódica; **régua de cobrança** do Venda360.
- **Frontend:** financeiro do aluno (parcelas, 2ª via, baixa, bolsa/desconto, negociação).
- **Pronto (marco F1):** matrícula → contrato → parcelas → boleto/PIX no WhatsApp → baixa automática por webhook. **Tudo nativo.**

### P6 · M6 Núcleo Acadêmico ⭐ (maior esforço — sub-fases)
Detalhar no `07_`. Sub-fases sugeridas:
1. **Diário + Frequência** (registro de aula, presença).
2. **Avaliações + Notas** (instrumentos, lançamento, cálculo da média).
3. **Fechamento + Resultado** (aprovação/recuperação/reprovação por componente).
4. **Conselho de Classe** (decisões, ata).
- **Pronto:** professor lança aula/frequência/nota; sistema fecha o período de uma turma.

### P7 · M7 Secretaria & Documentos (reuso Helpdesk)
- **Histórico escolar**, **declarações**, **requerimentos** (protocolos via Helpdesk), **certificado/diploma** (peso regulatório — tempo próprio).
- **Pronto:** emitir histórico/declaração de um aluno concluído.

### P8 · M8 Portais (Aluno/Responsável + Professor)
- **Reuso:** portal SSR (igual `/suporte`), magic-link, WhatsApp.
- **Pronto:** aluno vê notas/financeiro/boleto; professor lança diário pelo portal.

### P9 · M9 Comunicação escolar
- **Reuso:** Broadcast/Omnichannel/Notificações/Agendamentos → avisos, lembrete de vencimento, comunicados de turma.

### P10 · M10 BI & Conformidade
- **Reuso:** Dashboards/Widgets (como fiz no Helpdesk) → ocupação de turma, evasão, inadimplência; exportações (Censo/INEP quando aplicável).

---

## Calendário macro (valor + risco)
- **F0 + P1 + P2** → fundação + cadastros (base operacional).
- **F1 = P3 + P4 + P5** → **matrícula viva com financeiro nativo** (entrega de maior impacto e alto reuso).
- **F2 = P6** → núcleo acadêmico (o coração; rodar 1 período-piloto antes de confiar 100%).
- **F3 = P7 + P8 + P10** → secretaria, portais e indicadores → operação completa.
- **F4 = P9 + conformidade** → automações + diploma/Censo.

> Sem migração, cada fase **entra em produção sozinha** com a turma-piloto — não há "big bang".

---

## Decisões/itens ainda em aberto (não bloqueiam F0)
1. **Curso/turma-piloto:** qual curso técnico começa? (define o seed 0.4).
2. **Regra de avaliação do INEPROTEC** (média, recuperação, frequência mínima) → necessária para P6.
3. **Conformidade:** o curso técnico exige **Diploma Digital/Censo**? Define o peso de P7/P10.
4. **Plano(s) de pagamento** reais (nº de parcelas, taxa de matrícula, dia de vencimento) → P5.

---

## Próximo doc
- `07_…` — **M6 Núcleo Acadêmico** detalhado (schema + regras de avaliação/fechamento).
