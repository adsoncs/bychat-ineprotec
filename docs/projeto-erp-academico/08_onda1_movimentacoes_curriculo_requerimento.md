# 08 — Onda 1 (F5 + F6 + F8) · Playbook executável

> Detalha a **Onda 1** do plano `07_gap_analise_mentorweb.md`: completar o acadêmico
> operacional. Mesmo rito do `06_`: schema aditivo → backend (Fastify+Zod) → smoke
> (JWT forjado+curl) → frontend (Preact + `npx vite build`) → módulo/sidebar/gate → commit.
> Convenções: tabelas `bychat_aca_*`, ids `Int`, centavos `Int`, FKs cross-módulo SCALAR
> sem `@relation`, `prisma db push`. Backend porta 3102 (tsx via pm2). **Gate de módulo
> bloqueia com 404 quando o módulo está desativado** — ligar o sub-módulo no `bychat_modules`
> faz parte da entrega (via `setModuleEnabled`).

---

## F5 · Movimentações Acadêmicas — ✅ ENTREGUE (2026-06-18)

Módulo `aca_movimentacoes` (`dependsOn: ['aca_matriculas']`, sidebar grupo Educacional,
item **Movimentações** ícone `Repeat`).

**Schema** (`db push` aplicado): enum `AcaMovimentacaoTipo` (TRANCAMENTO/REINGRESSO/AFASTAMENTO/
TRANSFERENCIA_INTERNA/TRANSFERENCIA_EXTERNA/REMANEJAMENTO/RECLASSIFICACAO/CANCELAMENTO/EVASAO)
+ model `AcaMovimentacao` (`bychat_aca_movimentacoes`): matriculaId, alunoId, tipo, statusDe/Para,
turmaDestinoId, matriculaDestinoId, instituicaoDestino, motivo, dataEfeito, dataRetornoPrevista,
protocolo, anexoUrl, userId. FKs scalar (enriquecimento por busca na rota).

**Backend**: `services/acaMovimentacao.ts` (regras: valida transição + troca status + trilha
`AcaMatriculaEvento` + registro `AcaMovimentacao` em transação) e `routes/acaMovimentacao.ts`
(`/api/admin/aca/movimentacoes`):
- POST `/trancamento` `/reingresso` `/afastamento` `/cancelamento` `/evasao`
- POST `/transferencia-externa` (institução destino) e `/transferencia-interna` (fecha origem
  TRANSFERIDO + cria nova matrícula MATRICULADO na turma destino; flag `remanejamento`)
- GET `/` (histórico + counters por tipo, enriquecido com aluno/turma)
- GET `/sem-rematricula` (matriculados/trancados em período encerrado sem matrícula vigente)
- POST `/atualiza-situacoes` (`dryRun` lista; senão evade os candidatos)
- GET `/turmas-destino` (apoio aos modais)

**Frontend**: `hooks/useAcaMovimentacao.ts` + `pages/AcademicoMovimentacoesPage.tsx`
(seleciona matrícula → ações por status via modal; histórico com filtro por tipo; card
"Alunos sem rematrícula" com preview + evasão em lote). Router + sidebar + ícone `Repeat`.

**Smoke**: 14/14 OK (trancar→reingressar restaura, afastar mantém status, transição inválida
→409, transferência interna cria destino + fecha origem, listas/lote) com **cleanup total**
(piloto volta a 0 movimentações; matrícula alvo restaurada).

**Pendências F5**: gravar `protocolo` (sequencial MOV-AAAA-NNNN) e `anexoUrl`; expor ação de
movimentação também no detalhe da Matrícula; reclassificação (mudança de fase) ainda não tem UI.

---

## F6 · Currículo Avançado — ✅ ENTREGUE (2026-06-18) · estende `aca_estrutura`

Sem módulo novo (entra no `aca_estrutura` já existente; só telas/rotas aditivas).

**Entregue:** models `AcaEquivalencia`, `AcaAproveitamento` (origem INTERNO/EXTERNO/SUFICIENCIA,
status SOLICITADO/DEFERIDO/INDEFERIDO, CH/nota/parecer) e `AcaDependencia` (DEPENDENCIA/ADAPTACAO).
`services/acaCurriculo.ts` (`montarGrade` cruza matriz × resultados × aproveitamentos × dependências
→ status por componente: APROVADO/CURSANDO/APROVEITADO/DEPENDENCIA/REPROVADO/PENDENTE + resumo).
`routes/acaCurriculo.ts` (`/api/admin/aca/curriculo`): componentes, equivalências (CRUD), aproveitamentos
(solicitar/deferir/indeferir), dependências (CRUD), grade. **Integração com histórico**:
`montarHistorico` ganhou bloco "Aproveitamento" — aproveitamento DEFERIDO soma a CH ao `chTotal`
(reflete no histórico oficial e no certificado). Frontend: página **Currículo** (sidebar grupo
Cadastros, ícone GitFork) com abas Grade do aluno (tabela por componente + solicitar aproveitamento/
lançar DP) · Aproveitamentos (fila + deferir) · Equivalências (por matriz). Smoke 13/13 com cleanup
(histórico restaurado).

**Pendência F6:** equivalência ainda não é aplicada automaticamente na validação de matrícula
(hoje é cadastro/consulta); prova de suficiência registra como aproveitamento mas sem fluxo de prova;
cadastros auxiliares (departamentos/centros/tipos de curso/subturmas) ficaram fora (baixo valor).

### Plano original (referência):

**Schema (aditivo):**
- `AcaEquivalencia` (`bychat_aca_equivalencias`): componenteId, componenteEquivalenteId,
  bidirecional Bool, observacao — equivalência entre disciplinas/componentes.
- `AcaAproveitamento` (`bychat_aca_aproveitamentos`): matriculaId, componenteId, origem
  (INTERNO/EXTERNO/SUFICIENCIA), instituicaoOrigem, cargaHorariaAproveitada, nota, status
  (SOLICITADO/DEFERIDO/INDEFERIDO), documentoId — aproveitamento de estudos / dispensa.
- `AcaDependencia` (`bychat_aca_dependencias`): matriculaId, componenteId, tipo
  (DEPENDENCIA/ADAPTACAO), turmaId?, situacao — controle de DP/adaptação.
- Cadastros auxiliares: `AcaDepartamento`, `AcaCentroCurso`, `AcaTipoCurso` (cadastros leves
  sob `Course`); `AcaSubturma` (turmaId, nome, vagas) para desmembrar turma grande.

**Backend** (`routes/acaCurriculo.ts`, prefixo `/api/admin/aca/curriculo`):
- CRUD equivalências; CRUD/deferimento de aproveitamento (ao deferir, marca o componente como
  cumprido no histórico — integra `acaDocumentos.montarHistorico`); CRUD dependências.
- `GET /grade/:matriculaId` — grade do aluno com status por componente (cumprido/cursando/
  pendente/dependência/aproveitado), reusando matriz + resultados.
- Validação de matrícula por fase/pré-requisito (reusa `AcaPreRequisito`): `GET /validar/:matriculaId`.

**Frontend**: aba "Currículo" na `AcademicoEstruturaPage` (equivalências + departamentos/centros/
tipos) e painel "Aproveitamento & DP" no detalhe da matrícula (solicitar/deferir aproveitamento,
lançar DP). **Pronto quando:** secretaria registra um aproveitamento que dispensa um componente e
ele aparece como "aproveitado" no histórico; cria uma equivalência usada na validação de grade.

**Esforço:** G. **Risco:** médio (toca no cálculo de histórico — testar com 1 aluno real).

---

## F8 · Requerimento & Secretaria Avançada — ✅ ENTREGUE (2026-06-18) · estende `aca_secretaria`

Evolui o requerimento atual (`AcaRequerimento`/`AcaRequerimentoTipo`) para fluxo configurável,
reusando o motor de estados/SLA do **Helpdesk**.

**Entregue:** categorias (`AcaRequerimentoCategoria` CRUD); tipo estendido (categoriaId,
custoCentavos, deferimentoAutomatico, restricaoJson, camposJson); trâmites
(`AcaRequerimentoTramite` + `POST /requerimentos/:id/tramitar`, move ABERTO→EM_ANALISE);
**custo no deferimento** (`gerarCustoRequerimento` gera parcela TAXA no contrato ativo via
`contratoAtivoDoAluno`, idempotente por `custoParcelaId`); detalhe expõe tipo+trâmites.
Frontend: modal "Tipos & categorias" (CRUD + editor de tipo com custo/categoria/SLA/auto) +
timeline de trâmites + badge de taxa no detalhe. Smoke 12/12 com cleanup.

**Pendência F8:** enforcement de `restricaoJson`/`camposJson` no Portal do Aluno (UI de campos
personalizados na abertura); encaminhar a usuário/setor específico (paraUserId/paraTeamId já
no schema/rota, falta seletor na UI); `processoAuto` (disparo de processo de sistema).

### Plano original (referência):

**Schema (aditivo):**
- `AcaRequerimentoCategoria` (agrupa tipos) + campos novos em `AcaRequerimentoTipo`:
  `fluxoJson` (etapas/estados customizados), `deferimentoAutomatico` Bool, `custoCentavos`
  (gera parcela ao deferir), `processoAuto` (chave de processo de sistema), `restricaoJson`
  (quem pode solicitar), `camposJson` (campos personalizados do formulário).
- `AcaRequerimentoTramite` (`bychat_aca_requerimento_tramites`): requerimentoId, deUserId,
  paraUserId/paraTeamId, estado, comentario, createdAt — trâmites entre setores/professor.

**Backend** (estende `routes/acaRequerimento.ts`):
- CRUD de categorias; editor de tipo com fluxo/campos/custo/restrição.
- `POST /:id/tramitar` (encaminha a setor/professor, grava trâmite + notifica via ByChat).
- Deferimento: se `custoCentavos>0` gera `AcaParcela` (tipo TAXA) no contrato do aluno; se
  `deferimentoAutomatico`, resolve na criação; se `processoAuto`, dispara o processo mapeado.
- Restrições: valida elegibilidade do solicitante na abertura (no portal e no admin).

**Frontend**: editor de tipos de requerimento (categorias + fluxo + campos + custo) na
`AcademicoRequerimentosPage`; timeline de trâmites no detalhe; no Portal do Aluno, formulário
com campos personalizados + restrição. **Pronto quando:** um requerimento com custo gera a taxa
no financeiro ao deferir, e um requerimento tramita ao professor e volta para conclusão.

**Esforço:** M. **Reuso:** alto (Helpdesk: estados/SLA/timeline; financeiro: geração de parcela).

---

## Onda 2 · F7 — Portais por perfil — ✅ ENTREGUE (2026-06-18)

Novo módulo `aca_portais_plus` (`dependsOn: ['aca_portais']`) — **sem schema novo** (reusa
AcaResponsavel/Aluno/documentos). Reusa a infra SSR magic-link de `acaPortal.ts` (token HMAC
por `?t=`, helpers exportados: HEAD/esc/money/sitBadge/baseUrl/boletimAluno/financeiroAluno).
Token ganhou kinds `aca-responsavel` e `aca-exaluno`.

**Entregue:**
- **Central do Responsável** (`/portal/aca/responsavel`): boletim + financeiro (2ª via Asaas) +
  próximas datas do dependente (via AcaResponsavel→alunoId).
- **Central do Ex-aluno** (`/portal/aca/exaluno`, exige matrícula CONCLUÍDA): histórico escolar +
  documentos + emissão de 2ª via do histórico.
- `routes/acaPortalPlus.ts`: `GET /api/admin/aca/portal-plus/alunos?q=` (busca + responsáveis +
  flag concluído), `POST /api/admin/aca/portal-plus/link` (gera link responsavel|exaluno),
  ações públicas (2ª via, emitir-documento, download de doc).
- Frontend: página **Centrais (Resp./Ex-aluno)** (sidebar grupo Acadêmico, ícone Key) — busca
  aluno → gera link por responsável/egresso com copiar. Smoke 7/7.

**Central do Coordenador** (`/portal/aca/coordenador`, kind `aca-coord`, model novo `AcaCoordenador`
courseId+nome): mostra as turmas das ofertas do curso + conteúdo ministrado (últimas aulas por
diário) + nº de alunos. Admin: CRUD coordenadores + cursos (picker) + link.

**Central do Candidato**: NÃO reconstruída — já existe e é robusta no módulo educacional
(`candidatePortal.ts` + `/candidato/:code`: login, dados, documentos, **prova/redação online**,
prova presencial). F7 apenas faz o **wire-up**: `GET /portal-plus/candidatos` lista as inscrições
e a tela admin gera/copia o link `/candidato/:code`. Smoke coord+cand 8/8.

**Pendência F7:** "troca de aluno" do responsável com múltiplos dependentes (hoje 1 token = 1
dependente); caixa de mensagens; aprovação de plano de aula pelo coordenador (hoje só visualiza).

---

## Ordem e checkpoints da Onda 1
1. **F5** ✅ (entregue; validar UI com a secretaria e commit).
2. **F8** (próximo — alto reuso, baixo risco; tira trabalho manual da secretaria).
3. **F6** (maior, toca histórico — rodar com 1 aluno real antes de confiar).

> Cada fase é um checkpoint: smoke verde + validação humana da tela antes da próxima
> (regra `feedback_bychat_migration_per_screen`).
