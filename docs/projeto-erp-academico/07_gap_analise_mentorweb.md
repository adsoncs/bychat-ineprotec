# 07 — Análise de Lacunas vs. MentorWeb + Plano de Implementação por Fases

> **Base da análise:** crawl completo da documentação oficial do MentorWeb
> (`help.edusoft.inf.br/doku.php?id=help:mentorweb:start`) — **21 módulos / ~470 telas** —
> comparado contra o ERP Acadêmico nativo já entregue no `bychat-ineprotec`
> (35 models `Aca*`, 21 rotas, 9 services, 14 telas, 9 sub-módulos no `moduleRegistry`).
> Data: 2026-06-18.

---

## 0. Sumário executivo

O que já temos cobre o **fluxo operacional vertical** de uma instituição: Aluno → Estrutura →
Matrícula → Financeiro (Asaas) → Diário/Notas/Frequência → Fechamento/Conselho → Secretaria/Documentos
→ Portais → BI. Isso equivale, grosso modo, a **~35–40% da superfície do MentorWeb**, mas
concentrado no que mais gera valor diário.

As lacunas se concentram em **5 frentes**:

1. **Movimentações acadêmicas** (trancamento, transferência, aproveitamento, equivalência, dependência) — o MentorWeb tem dezenas de telas; nós só temos os *status* da matrícula.
2. **Centrais/Portais por perfil** (Responsável, Ex-aluno, Candidato, Empresa, Coordenador) — temos só Aluno e Professor, e ainda incompletos.
3. **Financeiro bancário/contábil** (CNAB/boleto registrado, dívida ativa, cobrança recorrente, plano de contas, integração contábil) — temos Asaas, falta o "back-office" financeiro.
4. **Conformidade regulatória** (Diploma Digital ICP-Brasil, Histórico Digital, Censo INEP, ENADE) — temos só documentos PDF numerados.
5. **Módulos transversais** (Avaliação Institucional/CPA, Docente/RH acadêmico, Alocação de recursos/salas, Controle de acesso físico/catraca, Processo Seletivo completo com provas/redação/ensalamento).

**Princípio do plano:** cada lacuna vira um **novo sub-módulo togglável no `moduleRegistry`**,
com dependência em cascata e grupo próprio na sidebar — exatamente o padrão dos 9 sub-módulos atuais.
Nada quebra quando desativado; quem depende some junto.

---

## 1. Cobertura atual por módulo MentorWeb

Legenda: ✅ coberto · 🟡 parcial · ❌ ausente

| # | Módulo MentorWeb | Telas | Status | O que temos / o que falta |
|---|---|---:|:---:|---|
| 1 | **Acadêmico** | 138 | 🟡 | Núcleo (estrutura, matrícula, diário, notas, freq., fechamento, conselho, calendário, horário, material, ocorrência, estágio) ✅. Faltam: trancamento/transferência/remanejamento/reclassificação, aproveitamento/equivalência/dependência/adaptação, prova de suficiência, diploma digital, EAD/LMS, biblioteca, chat setores, atualiza-situações em lote, TCC, enquetes. |
| 2 | **Censo** | 4 | 🟡 | SISTEC parcial. Falta Censo Escolar INEP (ano-base, validação, exportação). |
| 3 | **Alocação de recursos** | 11 | ❌ | Ambientes físicos, salas, equipamentos, reservas, regras de alocação. |
| 4 | **Atividades complementares** | 3 | 🟡 | Model `AcaAtividadeComplementar` existe. Falta controle de CH parcial, obrigatórias, parâmetros, aproveitamento. |
| 5 | **Avaliação (institucional/CPA)** | 30 | ❌ | Questionários, NPS, dimensões/indicadores, enquetes, responder nas centrais, cálculo de resultado. (≠ notas do aluno) |
| 6 | **Central da empresa** | 1 | ❌ | Portal de empresa concedente (estágio/convênio). |
| 7 | **Central do aluno** | 30 | 🟡 | Portal SSR básico (boletim, financeiro, documentos) ✅. Faltam: rematrícula online, requerimentos, responder avaliação/enquete, ocorrências, material de apoio, simulação de renegociação, dados cadastrais/troca de senha, agenda. |
| 8 | **Central do professor** | 7 | 🟡 | Diário/notas/materiais ✅. Faltam: conteúdo ministrado, requerimentos, enquetes, frequência diária. |
| 9 | **Central ex-aluno** | 1 | ❌ | Portal do egresso (histórico, diploma, 2ª via). |
| 10 | **Central do Responsável** | 6 | ❌ | Portal dos pais (notas/faltas, rematrícula, mensagens, troca de aluno). |
| 11 | **Central do Candidato** | 11 | 🟡 | Inscrição via Forms ✅. Falta portal: boletim de desempenho, prova online, questionário socioeconômico, reinscrição, cancelar inscrição. |
| 12 | **Comum** | 37 | 🟡 | Vários cadastros existem no CRM. Faltam auxiliares acadêmicos: áreas de conhecimento/atuação, formações, documentos pessoais, planos de saúde, raça/religião/país, atendimentos especiais, grupos de pessoas, config. assinatura eletrônica/LGPD. |
| 13 | **Contábil** | 9 | ❌ | Lançamentos, regras, layout, expressão de histórico, contabilizações. |
| 14 | **Coordenador** | 3 | ❌ | Central do coordenador (conteúdo ministrado, requerimentos, aprovação de planos). |
| 15 | **Docente (RH acadêmico)** | 12 | ❌ | Processo de seleção docente, disponibilidade/aceite de disciplinas, atividades docentes, cálculo de valores. |
| 16 | **Financeiro** | 59 | 🟡 | Contrato, parcelas, Asaas (boleto/PIX), baixa, encargos, renegociação, NFS-e, bloqueio, fluxo de caixa ✅. Faltam: plano de contas, contas bancárias, CNAB remessa/retorno, boleto registrado, cobrança recorrente/avulsa, indexadores, feriados, rateio, estorno, prorrogação/envio em lote, cupons/descontos/acréscimos cadastrados, dívida ativa/CDA, prestador/PJ, lotes NFS-e automáticos. |
| 17 | **Inscrição** | 8 | 🟡 | EnrollmentPortal/Forms ✅. Falta grupos de inscrição, validação SQL, inscrição por empresa, config. |
| 18 | **Processo Seletivo** | 27 | 🟡 | SelectionProcess/EntryMode ✅. Faltam: provas/gabaritos, redação online, digitação de notas por componente, ensalamento, chamada de candidatos, classificação/desempate, remanejamento, bolsa social. |
| 19 | **Prospect** | 11 | ✅ | Coberto pelo CRM/Leads/Campanhas/Landing Pages do ByChat (reuso forte). |
| 20 | **Requerimento** | 23 | 🟡 | Requerimento básico + Helpdesk ✅. Faltam: categorias, fluxo/trâmites configuráveis, deferimento automático, geração de custo, processos automáticos (SQL/sistema), modelos. |
| 21 | **Controle de frequência** | 6 | ❌ | Catracas, QR code, controle de acesso/saída, aviso de chegada (portaria). |
| — | **Transversais (start)** | — | 🟡 | Diploma Digital ❌, Plataforma de assinatura ❌, GED ❌, Gerador de Interface ❌, App mobile aluno ❌, Mentor Agendador (cron WhatsApp) 🟡 (temos régua/cron), Mentor Integrador (ETL) ❌. |

---

## 2. Plano de implementação por fases

> Continuação da numeração do `06_plano_implementacao.md` (que foi até P10/F4).
> Cada fase = **1 sub-módulo no `moduleRegistry`** (id, `dependsOn`, grupo de sidebar, presets de permissão)
> + schema aditivo (`bychat_aca_*`) + rotas Fastify + telas Preact + `npx vite build`.
> Ordenado por **valor operacional × esforço × dependências**.

### Bloco A — Completar o que já existe (alto valor, baixo risco)

#### **F5 · Movimentações Acadêmicas** — módulo `aca_movimentacoes` (depende: `aca_matriculas`)
Telas/funções: Trancamento, Afastamento, Transferência (interna entre turmas/cursos e externa de saída),
Remanejamento, Reclassificação, Cancelamento de matrícula (individual + pré-matrículas não confirmadas),
Abandono por falta de rematrícula / alunos sem rematrícula, **Rematrícula em lote** (já há `acaRematricula.ts`),
Ajustes de matrícula, Agendamento de matrícula, "Atualiza situações acadêmicas" (processo em lote).
**Menu:** grupo Acadêmico › Movimentações. **Esforço:** M.

#### **F6 · Currículo Avançado** — estende `aca_estrutura`
Equivalência de disciplinas, Aproveitamento de estudos, Dependência/Adaptação, Validação por fase/por
disciplina/por processo de matrícula, Prova de suficiência, Grades curriculares (visualização/impressão),
Departamentos/Centros de curso/Tipos de curso, Subturmas/Subnível/Sequências de turma, Clonagem de turma/polo,
Carga horária por curso-fase / hora-relógio, Objetivos de aprendizagem, Plano de ensino por turma×disciplina,
Cronograma de aula por data, Replicar planos de aula. **Menu:** Acadêmico › Currículo. **Esforço:** G.

#### **F7 · Portais & Centrais por perfil** — módulo `aca_portais_plus` (depende: `aca_portais`)
- **Central do Responsável** (novo): notas/faltas dos dependentes, rematrícula, caixa de mensagens, troca de aluno.
- **Central do Ex-aluno** (novo): histórico, diploma digital, 2ª via, dados.
- **Central do Candidato** (enriquecer): boletim de desempenho, prova online, questionário socioeconômico, reinscrição, cancelar.
- **Central do Coordenador** (novo): conteúdo ministrado por turma, requerimentos, aprovação de plano de aula.
- **Enriquecer Central do Aluno**: rematrícula online, requerimentos, responder enquete/avaliação, ocorrências, simulação de renegociação, troca de senha, agenda.
- **Enriquecer Central do Professor**: conteúdo ministrado, requerimentos, frequência diária.

Reuso: portal SSR magic-link `acaPortal.ts` (mesmo padrão `/suporte`). **Menu:** próprio (links públicos). **Esforço:** G.

#### **F8 · Requerimento & Secretaria Avançada** — estende `aca_secretaria`
Categorias de requerimento, Fluxo/trâmites configuráveis (estados, tramitar ao professor/coordenador),
Deferimento automático, Geração de custo no deferimento (gera parcela), Processos automáticos (SQL/sistema),
Modelos padrões, Motivo de indeferimento, Entrega/conferência de documentos.
Reuso forte do **Helpdesk** (máquina de estados, SLA, trâmites). **Menu:** Acadêmico › Secretaria. **Esforço:** M.

---

### Bloco B — Financeiro robusto (back-office)

#### **F9 · Financeiro Bancário** — módulo `aca_financeiro_bancario` (depende: `aca_financeiro`)
Plano de contas financeiras, Bancos/Contas bancárias, **CNAB remessa/retorno** (boleto registrado próprio,
além do Asaas), Cobranças recorrentes e avulsas, Indexadores, Feriados financeiros, Rateio de contas,
Estorno de lançamentos, Prorrogação/Envio de boletos em lote, Cadastros de descontos/acréscimos/cupons/tipos de baixa,
Agrupamento de parcelas, Geração de parcelas por contrato (carga horária / valor fixo / crédito / disciplina),
Prestador de serviços / Pessoa jurídica. **Menu:** Financeiro › Bancário. **Esforço:** G.

#### **F10 · Cobrança Judicial & Fiscal** — módulo `aca_cobranca_fiscal` (depende: `aca_financeiro_bancario`)
Manutenção de CDA / Livro de Dívida Ativa, Acordo com bloqueio judicial, **Lotes NFS-e automáticos**
(provedor da prefeitura — já mapeado como pendência), Integração contábil (lançamentos, regras, layout,
expressão de histórico, contabilizações/desfazer). **Menu:** Financeiro › Jurídico/Fiscal + Contábil. **Esforço:** G.

---

### Bloco C — Captação ponta a ponta

#### **F11 · Processo Seletivo Completo** — módulo `aca_vestibular` (depende: `educacional`)
Provas/Gabaritos, Componentes de avaliação/Agrupadores, Redação online + temas, Digitação de notas por
componente, Critério de desempate, Classificação, **Ensalamento**, Chamada/Convocação de candidatos,
Remanejamento de chamadas, Agendamento, Processo seletivo de bolsa social, Questionário socioeconômico,
Erros de inscrição. **Menu:** Captação › Processo Seletivo. **Esforço:** G.

#### **F12 · Inscrição Avançada** — estende `aca_vestibular`
Grupos de inscrição, Configurações de inscrição, Validação SQL, Inscrição por empresa, "Como conheceu",
Motivos de cancelamento. **Esforço:** P.

---

### Bloco D — Módulos transversais

#### **F13 · Avaliação Institucional / CPA** — módulo `aca_avaliacao_institucional` (depende: `educacional`)
Questionários, Perguntas/Grupos/Respostas, Dimensões/Indicadores, NPS, Enquetes, Aplicar avaliação,
Calcular resultado (processo agendado), Liberar/responder nas centrais (aluno/professor/responsável),
Visualização de participação. **Menu:** próprio grupo "Avaliação". **Esforço:** M.

#### **F14 · Docente / RH Acadêmico** — módulo `aca_docente` (depende: `aca_pedagogico`)
Processo de seleção de docente, Registro de disponibilidade e aceite de disciplinas, Consulta de
pendências de aceite, Atividades docentes/mensais, Valores e cálculo de atividades docentes,
Dados cadastrais do professor. **Menu:** próprio grupo "Docente". **Esforço:** M.

#### **F15 · Alocação de Recursos** — módulo `aca_alocacao` (depende: `aca_estrutura`)
Ambientes físicos (salas/laboratórios) e tipos, Equipamentos e tipos, Regras de alocação,
Reserva/Locação, Pesquisas. Integra com Horários (F-existente). **Menu:** próprio. **Esforço:** M.

#### **F16 · Controle de Acesso / Frequência Física** — módulo `aca_acesso` (depende: `aca_matriculas`)
Catracas (config.), Controle de acesso via QR code, Controle de saída, Aviso de chegada e liberação de
alunos (portaria/responsável), Registro de acesso. **Menu:** próprio. **Esforço:** M (depende de hardware).

---

### Bloco E — Conformidade regulatória (peso alto, prazo próprio)

#### **F17 · Diploma Digital & Histórico Digital** — módulo `aca_diploma_digital` (depende: `aca_secretaria`)
Diploma Digital (XML MEC + assinatura ICP-Brasil/A1-A3), Histórico Escolar Digital, Currículo Digital,
Expede/Registra diploma, Livros de certificação, Anulação de diplomas, Fiscalização, URL pública do diploma,
Certificado de pós-graduação, Conversão PDF→PDF/A. Requer **Plataforma de Assinatura** (ICP-Brasil).
**Menu:** Secretaria › Diplomas. **Esforço:** XG (regulatório).

#### **F18 · Censo INEP & ENADE** — estende `aca_relatorios`
Censo Escolar (ano-base, validação de consistência, exportação), Exportar para o MEC, Exportação ENADE,
Justifica aluno censo. **Menu:** Relatórios › Censo. **Esforço:** G (anual/regulatório).

#### **F19 · EAD / Integração LMS** — módulo `aca_ead` (depende: `aca_pedagogico`)
Integração Moodle/LMS (sincronizar categorias/turmas), Configurar carga horária EAD, Recebimento de médias
EAD, Registro de acesso em aulas externas, Integração com biblioteca. **Menu:** próprio. **Esforço:** G.

---

### Bloco F — Plataforma & cadastros base (habilitadores)

#### **F20 · Comum / Cadastros Auxiliares** — estende núcleo (sem toggle próprio; cadastros de apoio)
Áreas de conhecimento/atuação, Formações acadêmicas, Documentos pessoais, Planos de saúde, Raça/Religião/País/UF,
Atendimentos especiais (acessibilidade), Grupos de pessoas, Modelos de e-mail, Ocorrências fixas,
Config. assinatura eletrônica, Config. LGPD acadêmica. **Menu:** Configurações › Acadêmico. **Esforço:** P–M.

#### **F21 · GED & Plataforma de Assinatura** — módulo `aca_ged` (depende: `aca_secretaria`)
GED (gestão eletrônica de documentos do aluno), Envio de documentos em lote para assinatura,
Config. de assinatura eletrônica de documentos, Entrega/conferência. **Menu:** próprio. **Esforço:** M.

#### **F22 · Atividades Complementares & Extensão** — estende `aca_secretaria`
Controle parcial de CH, disciplinas obrigatórias, parâmetros, aproveitamento, curricularização da extensão,
TCC (registro), replicar registros em lote. **Esforço:** M.

---

## 3. Mapa de dependências (cascata de toggles)

```
educacional
├── aca_estrutura ──────────► aca_alocacao (F15)
│   └── aca_matriculas
│       ├── aca_financeiro
│       │   └── aca_financeiro_bancario (F9)
│       │       └── aca_cobranca_fiscal (F10)
│       ├── aca_movimentacoes (F5)
│       ├── aca_pedagogico
│       │   ├── aca_docente (F14)
│       │   └── aca_ead (F19)
│       ├── aca_secretaria
│       │   ├── aca_diploma_digital (F17)
│       │   ├── aca_ged (F21)
│       │   └── (requerimento avançado F8, ativ. compl. F22)
│       ├── aca_acesso (F16)
│       ├── aca_comunicacao
│       ├── aca_portais
│       │   └── aca_portais_plus (F7: responsável/ex-aluno/candidato/coordenador)
│       └── aca_relatorios ──► Censo INEP/ENADE (F18)
├── aca_vestibular (F11) ──► inscrição avançada (F12)
└── aca_avaliacao_institucional (F13)   [CPA — independente]
```

Regra: desativar um pai **oculta e desabilita** os filhos (mesmo `modulePermissionHook` já em uso).
Cada novo módulo entra no `MODULE_REGISTRY` com `dependsOn`, presets de permissão e grupo de sidebar.

---

## 4. Roadmap macro sugerido (ordem de execução)

| Onda | Fases | Tema | Justificativa |
|---|---|---|---|
| **Onda 1** | F5, F6, F8 | Completar o acadêmico operacional | Maior uso diário da secretaria; baixo risco; reusa o que existe |
| **Onda 2** | F7 | Portais por perfil | Reduz atendimento manual (pais/alunos/candidatos se autoatendem) |
| **Onda 3** | F9, F10 | Financeiro back-office + jurídico/fiscal | Autonomia bancária (CNAB) e conformidade fiscal (NFS-e/dívida ativa) |
| **Onda 4** | F11, F12, F13 | Captação completa + CPA | Vestibular ponta a ponta e avaliação institucional (exigência MEC) |
| **Onda 5** | F14, F15, F16 | Docente, recursos, acesso físico | Operação do campus |
| **Onda 6** | F17, F18, F19 | Conformidade MEC + EAD | Diploma digital, Censo, EAD (peso regulatório, prazo próprio) |
| **Onda 7** | F20, F21, F22 | Cadastros base, GED, extensão | Habilitadores e finezas |

> **Recomendação:** começar pela **Onda 1 (F5+F6+F8)** — é onde a secretaria do piloto (Téc. Agrimensura)
> mais sente falta hoje, e tudo reusa schema/telas já existentes. Conformidade (F17/F18) só quando o
> curso técnico exigir diploma digital/Censo (decisão em aberto no `06_`).

---

## 5. Itens que NÃO precisam ser construídos (já cobertos por reuso)

- **Prospect / Captação / Landing pages** → CRM + Forms + Landing Pages do ByChat.
- **Comunicação / Notificações WhatsApp** → Evolution + Cloud API + Broadcast + régua (Venda360).
- **Mentor Agendador (cron WhatsApp)** → já temos cron de avisos (`acaComunicacao` 6h).
- **Requerimento (motor de estados/SLA)** → Helpdesk nativo (só falta a fiação acadêmica em F8).
- **Gerador de Interface / Personalização de telas** → não aplicável (UI nativa Preact).
```
