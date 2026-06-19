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

## Onda 3 · F9 — Financeiro Bancário — ✅ ENTREGUE (2026-06-18)

Novo módulo `aca_financeiro_bancario` (`dependsOn: ['aca_financeiro']`). Schema: enums
AcaContaFinanceiraTipo/AcaRecorrenciaPeriodo + models AcaContaFinanceira (plano de contas),
AcaContaBancaria (convênio/CNAB), AcaIndexador+AcaIndexadorValor, AcaFeriado,
AcaCobrancaRecorrente, AcaRemessa; AcaParcela ganhou remessaId/nossoNumero/contaFinanceiraId.

`services/acaFinBanco.ts`: `ajustarDiaUtil` (pula fim de semana + feriados), `gerarRemessaCNAB400`
(layout-base FEBRABAN, registros 0/1/9, linhas de 400 col — calibrável por banco),
`gerarRecorrencias` (cria AcaParcela das recorrências vencidas e avança proximaGeracao),
`processarRetornoCNAB400` (baixa por nosso número, tolerante). `routes/acaFinBanco.ts`
(`/api/admin/aca/fin-banco`): CRUD plano de contas/contas bancárias/indexadores(+valores)/
feriados/recorrentes; cobrança avulsa; geração+download de remessa; processamento de retorno.

Frontend: página **Financeiro Bancário** (sidebar, ícone CreditCard) com abas Contas & bancos ·
Cobranças recorrentes (gerar) · Remessas CNAB (selecionar títulos → gerar → baixar .REM →
processar retorno) · Indexadores & feriados. Smoke 18/18 com cleanup total.

**Pendência F9:** CNAB precisa calibração por banco na homologação (nosso número/carteira/posições);
recorrente/avulsa pedem o **contrato ID** numérico (falta picker aluno→contrato); rateio de contas,
estorno, agrupamento e prorrogação em lote ficaram fora; CNAB 240 ainda usa o gerador 400.

---

## Onda 3 · F10 — Cobrança Judicial & Fiscal — ✅ ENTREGUE (2026-06-18)

Novo módulo `aca_cobranca_fiscal` (`dependsOn: ['aca_financeiro_bancario']`). Schema: enum
AcaCDAStatus + models AcaCDA, AcaRegraContabil, AcaLancamentoContabil, AcaNfseConfig;
AcaParcela ganhou cdaId. `services/acaCobrancaFiscal.ts`:
- **Dívida ativa** — `inscreverDividaAtiva(diasMin)`: agrupa parcelas VENCIDAS há > N dias por
  aluno e cria uma CDA (CDA-AAAA-NNNN), marcando as parcelas; quitar/cancelar solta as parcelas.
- **Contábil** — `contabilizar`: gera lançamentos (partida dobrada) das parcelas PAGAS sem
  lançamento, usando a regra ativa (evento PARCELA_PAGA) e renderizando o histórico
  ({aluno}{parcela}{valor}{data}); desfazer marca `desfeito`. Export CSV.
- **NFS-e** — `gerarLoteNfse`: cria AcaNotaFiscal (reusa Fin-5) em PENDENTE para parcelas pagas
  sem nota. Config (provedor/ambiente/alíquota). **Transmissão real = ponto de integração**
  (webservice da prefeitura varia por município).

`routes/acaCobrancaFiscal.ts` (`/api/admin/aca/cobranca-fiscal`): CDA (livro + inscrever + status),
regras (CRUD), contabilizar, lançamentos (+CSV +desfazer), nfse-config + gerar-lote.
Frontend: página **Cobrança Judicial & Fiscal** (sidebar, ícone Gavel) com abas Dívida ativa ·
Contábil · NFS-e. Smoke 15/15 com cleanup total.

**Pendência F10:** transmissão NFS-e ao provedor municipal (integração final); contábil é
partida-dobrada simplificada (1 regra por evento; sem rateio/centro de custo); livro de dívida
ativa sem geração do PDF/petição; acordo judicial liga via campo mas sem fluxo dedicado.

---

## Onda 4 · F11 — Processo Seletivo (camada admin) — ✅ ENTREGUE (2026-06-18)

Novo módulo `aca_vestibular` (`dependsOn: ['educacional']`). **Reusa** `ProcessRegistration`
(status/notaClassificacao/posicaoClassificacao/convocadoEm) do módulo educacional — o lado
candidato (inscrição, redação/prova online, prova presencial) já existe em `candidatePortal.ts`,
não foi reconstruído. Schema novo só para o que faltava: AcaProcessoComponente (peso),
AcaProcessoNota (nota por candidato×componente), AcaProcessoSala, AcaProcessoEnsalamento.

`services/acaVestibular.ts`: `classificar` (nota final = média ponderada dos componentes,
ordena desc com critério de desempate [ordem de inscrição | maior nota em componente], aplica
`SelectionProcess.notaCorte` → classificado/reprovado, grava posição), `convocar` (marca as
próximas N posições como convocado), `ensalar` (distribui por capacidade nas salas).
`routes/acaVestibular.ts` (`/api/admin/aca/vestibular`): processos, candidatos, componentes CRUD,
digitação de notas (bulk), classificar, convocar, salas CRUD, ensalar. Frontend: página
**Processo Seletivo** (sidebar grupo Cadastros, ícone ClipboardList) com seletor de processo +
abas Candidatos & notas (grade editável) · Classificação (classificar + convocar + ranking) ·
Ensalamento (salas + alocação). Smoke 13/13 com cleanup total.

**Pendência F11:** prova objetiva online com gabarito/autocorreção (hoje a nota objetiva é
digitada pelo admin — a redação/presencial já vêm do portal do candidato); remanejamento de
chamadas e bolsa social; geração de PDF do mapa de sala/lista de classificados.

---

## Onda 4 · F13 — Avaliação Institucional / CPA — ✅ ENTREGUE (2026-06-18)

Novo módulo `aca_avaliacao_institucional` (`dependsOn: ['educacional']`). Schema: enums
AcaAvalPublico/AcaAvalStatus/AcaPerguntaTipo + models **AcaAvaliacaoInst** (renomeado p/ não
colidir com a AcaAvaliacao de notas do P6), AcaAvalDimensao, AcaAvalPergunta, AcaAvalResposta.
`routes/acaAvaliacaoInst.ts` (`/api/admin/aca/avaliacao-inst`): CRUD avaliações + dimensões +
perguntas (escala/NPS/texto/sim-não); abrir/encerrar; geração de **link público** (magic-link
kind `aca-aval`); **resultado** (média por pergunta/dimensão, **NPS** = %promotores[9-10] −
%detratores[0-6], %sim, respostas de texto, participação = sessões distintas). Aplicação por
**formulário SSR público** (`GET /aval?t=` + `POST /api/public/aca/aval/responder`), anônimo,
1 sessaoId por envio. Frontend: página **Avaliação Institucional (CPA)** (sidebar grupo
Relatórios, ícone BarChart3): lista → builder de dimensões/perguntas + abrir/encerrar/link +
dashboard de resultados. Smoke 15/15 com cleanup (NPS/médias/participação conferidos).

**Pendência F13:** responder direto pelas centrais (aluno/professor) além do link público;
agendamento de cálculo de resultado; segmentação de participação por turma/curso; exportação
do relatório CPA em PDF; indicadores/metas por dimensão.

---

## Onda 5 · F14 — Docente / RH Acadêmico — ✅ ENTREGUE (2026-06-18)

Novo módulo `aca_docente` (`dependsOn: ['aca_pedagogico']`). O professor é um `User`
(professorUserId nos diários); `AcaDocente.userId` é scalar. Schema: enums AcaDocenteRegime/
AcaAtividadeDocenteStatus/AcaDocenteAceiteStatus + models AcaDocente (titulação/regime/valor-hora),
AcaTipoAtividadeDocente (fator), AcaAtividadeDocente (valor = horas × valor-hora × fator),
AcaDocenteAceite (por diário). `services/acaDocente.ts`: `calcValorAtividade`, `gerarAceitesPendentes`
(cria PENDENTE para os diários do professor sem aceite), `resumoCompetencia` (total horas/valor por
docente no mês). `routes/acaDocente.ts` (`/api/admin/aca/docente`): usuários (picker), docentes CRUD,
tipos CRUD, atividades CRUD + calcular, aceites (gerar/decidir). Frontend: página **Docente / RH**
(sidebar grupo Educacional, ícone School) com abas Docentes · Atividades & valores (tipos + lançar +
calcular mês) · Aceite de disciplinas. Smoke 8/8 com cleanup. ⚠️AcaDiario não tem relação `turma`
(só turmaId) — enriquecer turma por busca separada.

**Pendência F14:** processo de seleção/recrutamento de docente (não feito); aceite pelo próprio
professor via portal; folha/exportação de pagamento de atividades; vínculo automático
diário→atividade (hoje as horas são lançadas manualmente).

---

## Ordem e checkpoints da Onda 1
1. **F5** ✅ (entregue; validar UI com a secretaria e commit).
2. **F8** (próximo — alto reuso, baixo risco; tira trabalho manual da secretaria).
3. **F6** (maior, toca histórico — rodar com 1 aluno real antes de confiar).

> Cada fase é um checkpoint: smoke verde + validação humana da tela antes da próxima
> (regra `feedback_bychat_migration_per_screen`).
