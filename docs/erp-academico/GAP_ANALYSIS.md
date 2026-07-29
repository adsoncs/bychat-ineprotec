# ERP Acadêmico ByChat — Análise de Lacunas

Comparação entre o **Documento Mestre de Requisitos v1.0 (jul/2026)** e o ERP implementado
no bychat-ineprotec. Levantado em 28/07/2026 sobre 91 modelos `Aca*`, 38 rotas e 32 telas.

## Retrato do que já existe

| Módulo do documento | Situação | Evidência |
|---|---|---|
| M01 Núcleo institucional | **Parcial** | `EducationalUnit`→`Course`, `AcaPeriodoLetivo`, `AcaDisciplina`, `AcaAmbiente`/`AcaEquipamento`, `AcaFeriado`, `AcaCadastroAux` |
| M02 Captação/seletivo | **Parcial** | `acaVestibular` (23 endpoints): processos, grupos, componentes, notas, classificação, convocação, ensalamento, salas |
| M03 Matrícula/contratos | **Bom** | `AcaMatricula`, `AcaContrato`(+template/gatilho), `AcaParcela`, `AcaAssinatura`/`AcaSignatario` (22 endpoints) |
| M04 Secretaria | **Bom** | `acaSecretaria`, `acaMovimentacao` (11), `AcaRequerimento`+tipos/categorias/trâmites, `AcaDocumento`, `AcaOcorrencia` |
| M05 Gestão curricular | **Fraco** | `AcaMatriz`/`AcaComponente`/`AcaPreRequisito`/`AcaEquivalencia`/`AcaAproveitamento` |
| M06 Portal do professor | **Bom** | `acaDiario` + `acaDocente` (16): `AcaDiario`, `AcaAula`, `AcaFrequencia`, `AcaAvaliacao`, `AcaNota`, `AcaPlanoEnsino`, `AcaDocenteAceite` |
| M07 Portal do aluno | **Parcial** | Páginas HTML server-side em `/portal/aca/*` (aluno, rematrícula, professor, coordenador, ex-aluno, responsável) por token |
| M08 Avaliação/apuração | **Fraco** | `acaFechamento` + `AcaResultado`, `AcaConselho` |
| M09 Financeiro | **Forte** | CNAB remessa/retorno, NFS-e, CDA, contabilização, `AcaAcordo`, renegociação com simulação, recorrentes, indexadores |
| M10 Estágio/TCC/AC | **Bom** | `AcaEstagio`, `AcaTcc`, `AcaAtividadeComplementar` |
| M11 Regulatório | **Parcial** | `acaCenso` (validação + export + `selecaoEnade`), `AcaDiploma` (XML/assinatura/registro), `AcaGedArquivo`, `acaSistec` |
| M12 BI | **Fraco** | `acaBi` (1 endpoint) |
| M13 Comunicação | **Forte** | `AcaComunicacao` + core ByChat (WhatsApp oficial, automações) |
| M14 Admin/LGPD | **Parcial** | Módulos/permissões, auditoria do core |

O diferencial arquitetural da tese está **implementado**: `Aluno.leadId` é único — a mesma
Pessoa que entrou como lead vira aluno (RN-001), sem duplicação.

---

## Lacunas por criticidade

### BLOQUEADORES — impedem operar uma IES qualquer sem customização

**G1. Esquema de avaliação não é configurável (M08 / RF-801)**
Hoje a apuração usa média ponderada com 5 parâmetros **globais** em `Setting`
(`aca.media_aprovacao`, `aca.frequencia_minima`, `aca.recuperacao_*`) — `acaFechamento.ts:11`.
Falta: fórmula por expressão, herança institucional→curso→disciplina, escala/conceito A-E,
arredondamento configurável, nota mínima eliminatória, faixa de exame final com fórmula
própria, 2ª chamada, dependência com limite para progressão.
*Impacto: cada IES tem regimento próprio; sem isso, cada cliente novo vira customização.*

**G2. Motor de integralização inexistente (M05 / RF-504)**
Nenhuma ocorrência no código. Sem ele não existe: "o que falta para o aluno se formar",
plano de estudos, prováveis formandos, trava de colação, planejamento de oferta por demanda.
O documento o define como serviço puro reutilizável por 5 consumidores diferentes.

**G3. Vínculo acadêmico ≠ matrícula em disciplina (§3.1, RN-004)**
`AcaMatricula` é `@@unique([alunoId, turmaId])` — matrícula em turma. Falta a entidade de
vínculo do aluno no **curso/matriz** com RA, situação e máquina de estados própria.
Consequência: histórico, integralização e requisitos de formatura não têm âncora.

**G4. Matriz curricular sem ciclo de vida (RN-003, RN-501)**
`AcaMatriz` tem apenas `versao`, `vigenteDe`, `ativo`. Falta: estados
rascunho→ativa→suspensa→extinta, imutabilidade após alunos vinculados, CH por tipo
(obrigatória/eletiva/estágio/TCC/extensão), agrupador de eletivas, validação de grafo
acíclico de pré-requisitos.

**G5. Hierarquia institucional incompleta (M01 / RF-101, RF-102)**
Não existem Mantenedora, IES (código e-MEC, credenciamento) nem atos autorizativos com
validade e alertas. Base obrigatória para Censo, e-MEC e diploma digital.

### ALTA — paridade competitiva

**G6. Portal do aluno é HTML por token, não PWA (M07 / RF-701, RN-702/703)**
Falta login CPF/RA + senha, 2FA, magic link WhatsApp, notificações, declaração de IR,
carteirinha digital com QR, .ics do calendário.

**~~G7. Portal do responsável financeiro inexistente~~ — CORREÇÃO (29/07)**
O levantamento inicial errou: o portal existe em `/portal/aca/responsavel`
(`acaPortalPlus.ts`), com parcelas do aluno e geração de 2ª via. O que falta
nele é **acordo/renegociação** e a **declaração de quitação anual**, não o
portal em si.

**G7b. Declaração de quitação anual e informe para IR (T-907)**
Obrigação legal anual (Lei 12.007/09) — nenhuma ocorrência no código. Os tipos
de documento emitíveis hoje são só `HISTORICO`, `DECLARACAO_MATRICULA`,
`DECLARACAO_FREQUENCIA` e `ATA_RESULTADOS`.

**G7c. Carteirinha digital com QR (RF-706)** — ausente, embora o sistema já
tenha numeração e validação pública de documentos para reaproveitar.

**G8. Prova online e banco de questões (M02 / RF-203)** — o vestibular classifica e ensala,
mas não aplica prova nem corrige redação com rubrica.

**G9. Equivalência só 1:1 (RF-502)** — `AcaEquivalencia` liga um componente a outro;
faltam N:1 e 1:N, exigidos em adaptação curricular real.

**G10. Acervo sem temporalidade (M11 / RF-1103)** — `AcaGedArquivo` guarda arquivos, mas
não há classificação documental, prazo de guarda, hash de integridade, carimbo de tempo
nem eliminação controlada (Port. 315/2018).

**G11. Regime domiciliar / tratamento especial de faltas** — exigência legal
(Dec-Lei 1.044/69, Lei 6.202/75); hoje não há estado especial, só falta/presença.

**G12. Trava ENADE na colação (RN-1104)** — existe `selecaoEnade` (seleção de habilitados),
falta controle de regularidade bloqueando a esteira de diplomação.

### MÉDIA — diferenciais e refinamentos

**G13. Score de risco de evasão (T-1203)** — "evasão" aparece só como situação em
`acaMovimentacao`; não há modelo preditivo com engajamento conversacional.

**G14. BI/dashboards por persona (M12)** — `acaBi` tem 1 endpoint.

**G15. Produção docente → folha (T-607)** — existe `AcaAtividadeDocente`; falta consolidação
mensal exportável.

**G16. 2FA e trilha de auditoria em nível de campo (M14 / RN-1401)**

**G17. Importadores com dry-run por linha (RN-105)** — crítico para migrar de Mentor Web.

---

## Plano em fases

### Fase 1 — Fundação acadêmica correta (bloqueadores estruturais)
G3 vínculo acadêmico + G4 ciclo de vida da matriz + G5 hierarquia institucional.
São mudanças de modelagem: quanto mais tarde, mais caro (o documento avisa que erros aqui
são "quase irreversíveis"). Fazer antes de qualquer cliente novo entrar.

### Fase 2 — Motor de regras (o que torna o ERP vendável a qualquer IES)
G1 esquema de avaliação configurável + G2 motor de integralização + G9 equivalências N:N.
Critério de pronto: cadastrar o regimento de uma IES pela interface, sem código.

### Fase 3 — Autoatendimento
G6 portal do aluno PWA + G7 portal do responsável + G11 regime domiciliar.
Cada item aqui reduz fila e ligação na secretaria — é o que o cliente sente.

### Fase 4 — Regulatório completo
G10 acervo com temporalidade + G12 trava ENADE + fechamento do Censo/diploma sobre a
hierarquia da Fase 1.

### Fase 5 — Captação e diferenciais
G8 prova online + G13 score de evasão + G14 BI por persona + G15 produção docente +
G16 segurança + G17 importadores.

## Situação em 29/07/2026

Fases 1 a 5 implementadas em `bychat-ineprotec` (backend + telas dedicadas, sem modal).

| Fase | Escopo | Situação |
|------|--------|----------|
| 1 | G3 vínculo, G4 matriz versionada, G5 hierarquia | concluída — migration 0104 |
| 2 | G1 esquema de avaliação, G2 integralização, G9 equivalências | concluída — 0105, 0106 |
| 3 | G6 portal PWA, G7 responsável, G11 regime domiciliar, acordo de dívida | concluída — 0107, 0108 |
| 4 | G10 acervo/temporalidade, G12 trava ENADE, diploma sobre a hierarquia | concluída — 0109 |
| 5 | G8 prova online, G13 evasão, G14 BI por persona, G15 produção docente, G17 importadores | concluída — 0110 |

### Revisão gap a gap (29/07, após auditoria do próprio trabalho)

Uma conferência campo a campo mostrou que "fase entregue" não era o mesmo que "gap
fechado". Três gaps estavam parciais e um não tinha começado. Corrigidos em seguida:

- **G1** — `mapaConceitos`, `segundaChamadaHabilitada` e `limiteDependencias` estavam no
  schema, a rota gravava, a tela oferecia e o motor IGNORAVA os três. Fechado (0111):
  escala conceitual traduz a média na apresentação, segunda chamada é recusada quando o
  regimento não prevê, e a integralização devolve `podeProgredir`.
- **G16** — 2FA por TOTP (implementação própria com `node:crypto`) + trilha de campo nas
  alterações de nota e de resultado, que não gravavam nada (0112).
- **G6** — login por CPF/RA + senha, link de acesso por WhatsApp, informe de pagamentos
  para o IR e agenda `.ics` (0113).
- **G8** — rubrica de correção (0114): critérios com teto próprio, nota = soma normalizada,
  pontos por critério gravados na resposta. Recusa nota direta em questão com rubrica.
- **G10** — hash de documento externo com guarda de SSRF + **custódia própria** (baixa o
  arquivo para /uploads/acervo). O acervo guardava só links: link quebra e o documento
  obrigatório some sem ninguém perceber.

Fechados na sequência seguinte:

- Acordo de dívida **ganhou tela** (era JSON num portal sem JavaScript — ninguém chegava).
- Central do Responsável ganhou negociação, informe de IR e quitação; informe de IR também
  no admin (só o portal emitia).
- Grade da matriz reordenável por arrastar, em RASCUNHO.
- Push no portal (0115): VAPID, assinatura por endpoint, desativação em 404/410.

Pendências conhecidas:

- **Replicação para os outros 8 tenants** — todo o ERP acadêmico existe apenas em
  `bychat-ineprotec`. O motor é genérico; a configuração (esquemas, matrizes, calendário)
  é por instituição e não deve ser replicada. Só faz sentido em tenant que seja instituição
  de ensino. **É decisão de negócio, não pendência técnica.**
- Push e negociação online vêm **desligados** por padrão: exigem que a instituição gere as
  chaves VAPID e habilite a política de acordo. Isso é intencional.

## Notas de risco

- Fases 1 e 2 são pré-requisito real das demais: integralização depende do vínculo e da
  matriz versionada; Censo e diploma dependem da hierarquia institucional.
- O financeiro (M09) e a comunicação (M13) já estão acima da régua do mercado — não
  precisam de trabalho estrutural nesta rodada.
- O acervo tem 10 documentos classificados e **nenhum com hash**. Sem hash não há como
  provar integridade numa fiscalização — vale gerar antes de o volume crescer.
