# ERP Acadêmico ByChat — Guia de Treinamento

Documento de treinamento e referência operacional. Cobre as **45 telas do menu
ERP** (mais 9 telas de detalhe e formulário abertas a partir delas): o que cada
uma resolve, a ordem em que devem ser usadas e as regras que o sistema aplica
sozinho.

Levantado sobre o sistema em produção em 29/07/2026: 109 modelos de dados, 308
endpoints administrativos e 12 migrações de banco na última rodada.

> **Como ler este guia.** Se você está implantando, siga a ordem da seção
> "Implantação: a ordem que funciona". Se está treinando uma pessoa por função,
> vá direto para "Roteiros por função". Se quer entender uma tela específica,
> use o índice por módulo.

---

## O que diferencia este ERP

Vale começar por aqui, porque explica decisões que aparecem em várias telas.

**O aluno é o mesmo contato do CRM.** `Aluno.leadId` é único: a pessoa que
chegou como interessado, foi atendida no WhatsApp e virou matrícula é **um
registro só**. Não existe "cadastro do lead" e "cadastro do aluno" para
conciliar depois. Isso é o oposto do que acontece quando se usa um CRM e um ERP
acadêmico separados.

**O que é obrigação legal, o sistema não deixa burlar.** Frequência mínima de
75% não é configurável para menos. Declaração de quitação não sai com parcela em
aberto. Aluno sem registro de ENADE é tratado como irregular. Eliminar documento
do acervo exige termo com comissão. Essas travas existem porque o custo de
errar nelas não é operacional — é jurídico.

**Nada é apagado; tudo é movimentado.** Trancamento, transferência e evasão são
movimentações registradas, não edição de status. Nota alterada guarda o valor
anterior, quem mudou e de qual IP. O acervo eliminado deixa o termo. Numa
auditoria, a pergunta nunca é "qual é o dado hoje" — é "como ele chegou aqui".

---

## Implantação: a ordem que funciona

Esta ordem não é sugestão de organização: cada passo depende do anterior. Pular
gera retrabalho.

### 1. Instituição (`ERP · Acadêmico → Instituição`)

**Por que existe:** Censo, e-MEC e diploma digital exigem saber quem é a
mantenedora, qual é a IES e sob qual ato autorizativo o curso funciona. Sem
isso, nenhum documento oficial sai correto.

**O que cadastrar:** mantenedora (razão social, CNPJ, representante legal) → IES
(nome, sigla, código e-MEC, categoria administrativa, dirigente, procurador
institucional) → atos autorizativos (credenciamento da IES, autorização e
reconhecimento de cada curso, com número da portaria e validade).

**O que a tela faz por você:** avisa quando um ato está a 180, 90 ou 30 dias do
vencimento. Renovação de reconhecimento perdida é curso que para de emitir
diploma válido.

### 2. Estrutura Acadêmica (`ERP · Estrutura → Estrutura Acadêmica`)

Períodos letivos, disciplinas e turmas. É a base de tudo que vem depois:
matrícula precisa de turma, turma precisa de período.

**Ordem interna:** período letivo → disciplinas → oferta do curso → turma.

### 3. Matrizes curriculares (`ERP · Acadêmico → Matrizes`)

**Por que existe:** o histórico do aluno é conferido contra a matriz que ele
cursou, não contra o curso genérico. Dois alunos do mesmo curso em matrizes
diferentes têm exigências diferentes — e é isso que a integralização precisa
saber.

**Como funciona o ciclo de vida:**

```
RASCUNHO ──ativar──▶ ATIVA ──suspender──▶ SUSPENSA ──▶ EXTINTA
   │                    │
   └── editável         └── IMUTÁVEL (tem aluno vinculado)
```

**Regra que surpreende quem vem de outro sistema:** matriz ATIVA não pode ser
editada. Para mudar a grade, você **clona** a matriz, edita a nova versão e
ativa. O aluno que entrou na versão antiga continua sendo avaliado por ela —
que é o correto, e o que a lei espera.

**Antes de ativar**, a tela valida: pré-requisitos sem ciclo (disciplina A exige
B que exige A trava o aluno para sempre), carga horária declarada no PPC contra
a soma real dos componentes, e componentes válidos.

**Na tela:** dentro de um período, arraste as disciplinas para reordenar. Só
funciona em RASCUNHO — lista que se move e não salva engana quem edita.

### 4. Esquemas de avaliação (`ERP · Acadêmico → Esquemas`)

**Por que existe — e esta é a tela mais importante da implantação.** Cada
instituição tem seu regimento: uma aprova com 6, outra com 7; uma tem exame
final, outra tem recuperação por bimestre; uma usa nota, outra usa conceito A–E.
Antes desta tela, cada cliente novo virava customização de código.

**O que você configura:**

| Campo | Para que serve |
|---|---|
| Componentes (N1, N2, TRAB…) | As notas que compõem a média, com peso |
| Fórmula da média | `(N1*4 + N2*6)/10` — vazio usa média ponderada pelos pesos |
| Escala | Numérica 0–10, 0–100 ou **conceito** (A–E com piso de cada um) |
| Nota mínima eliminatória | Abaixo dela reprova direto, independente da média |
| Exame final | Faixa que manda para exame + fórmula própria da nota final |
| Segunda chamada | Se o regimento admite reposição de avaliação perdida |
| Frequência mínima | Piso legal 75% — o sistema não aceita menos |
| Limite de dependências | Regime seriado: quantas reprovações o aluno carrega |

**Herança em cascata:** `DISCIPLINA → MATRIZ → CURSO → INSTITUCIONAL`. Você
cadastra a regra geral no nível institucional e abre exceção só onde precisa.
O sistema usa o primeiro que encontrar, do mais específico para o mais geral.

> ⚠️ **Cuidado real:** o esquema INSTITUCIONAL tem precedência sobre os
> parâmetros globais de configuração. Criar um com regra diferente muda a
> aprovação de quem já está cursando. Use o **simulador** ao lado do formulário
> antes de salvar: ele mostra a situação resultante com notas de exemplo.

### 5. Importação de dados (`ERP · Estrutura → Importação`)

**Por que existe:** ninguém começa do zero. Vem de outro sistema, de planilha,
ou dos dois.

**Como funciona — e por que o botão de importar começa desabilitado:** você
envia o CSV, o sistema **simula** (valida linha a linha sem gravar nada) e
mostra o relatório: quantas válidas, quantas inválidas e o erro de cada linha.
Só então "Importar" habilita. Trocar o arquivo invalida a simulação anterior.

**O que ele recusa:** CPF inválido, data inexistente (`31/02/2005` seria
convertida silenciosamente para 3 de março em JavaScript — aqui é rejeitada) e
referência a registro que não existe.

Tipos suportados: disciplinas, alunos, notas do histórico, títulos financeiros.
Baixe o modelo CSV na própria tela.

---

## Rotina do dia a dia

### Captação e ingresso

**Vestibular** (`ERP · Acadêmico → Vestibular`) — componentes de nota do
processo, digitação, classificação por média ponderada com critério de
desempate, convocação por posição e ensalamento por capacidade.

**Prova online** (`ERP · Acadêmico → Prova online`) — três abas:

1. **Banco de questões**: objetivas (com gabarito) e dissertativas. Na
   dissertativa você pode definir uma **rubrica** — critérios com pontuação
   própria ("Domínio da norma culta: 4 pontos", "Argumentação: 4"…). Sem
   rubrica, a correção é nota única, que serve para questão curta mas não para
   redação.
2. **Provas**: monte a partir do banco, defina duração e nota máxima, publique.
3. **Candidatos**: um link por pessoa, copiado ao gerar.

**Duas coisas que valem explicar no treinamento:**

- O relógio começa quando o **candidato inicia**, não quando a janela abre. Quem
  entra atrasado não perde o tempo que não usou; fechar o navegador não devolve
  tempo. O prazo é controlado no servidor.
- O gabarito **nunca** vai para o navegador do candidato, e a correção das
  objetivas roda no servidor na entrega. Não adianta abrir o inspetor.

Prova com dissertativa fica **entregue** (não corrigida) até a fila de correção
zerar. A nota final só fecha quando todas as dissertativas têm nota.

**Correção** (`Prova online → botão Corrigir`) — uma resposta por vez, texto
inteiro à vista. Com rubrica, você pontua cada critério e vê a nota se formar;
o parecer fica registrado e é o que responde a um recurso.

### Matrícula e vínculo

**Pessoas** (`ERP · Acadêmico → Pessoas`) — visão unificada por papel: aluno,
professor, coordenador, orientador, candidato. Serve para achar alguém sem saber
em que cadastro ele está.

**Alunos** (`ERP · Acadêmico → Alunos`) — ficha completa em abas: identidade,
dados complementares, documentos, sócio-econômico, endereço, responsáveis.

**Matrículas** (`ERP · Acadêmico → Matrículas`) — matrícula em **turma**. Ciclo:
`INSCRITO → PRE_MATRICULA → MATRICULADO → CONCLUIDO`, com trancamento,
transferência e cancelamento pelo módulo de movimentações.

**Vínculos acadêmicos** (`ERP · Acadêmico → Vínculos`) — o vínculo do aluno com
o **curso/matriz**, com RA próprio. Não confunda com matrícula:

| | Vínculo | Matrícula |
|---|---|---|
| Liga o aluno a | Curso + matriz | Turma (disciplina/período) |
| Quantidade | Um por curso | Uma por turma cursada |
| Serve para | Histórico, integralização, diploma | Diário, nota, frequência |

Cada vínculo tem **prontuário** (histórico de movimentações), botão **mover**
(transições permitidas por máquina de estados) e **integralização**.

**Integralização** (dentro do vínculo) — responde "o que falta para se formar".
Por componente: cumprido, aproveitado, em curso, reprovado, pendente ou
**bloqueado** (com o nome do pré-requisito que falta). Mostra carga horária por
tipo (obrigatória, eletiva, estágio, TCC, extensão) contra o exigido no PPC, e
avisa quando o aluno excede o limite de dependências para progredir de período.

A mesma engine alimenta o portal do aluno, o plano de estudos do coordenador, a
apuração de formandos e a trava da colação. Aluno e secretaria veem **o mesmo
número** — se cada tela calculasse do seu jeito, a divergência apareceria na
formatura.

### Rotina do professor

**Diário de Classe** (`ERP · Acadêmico → Diário`) — aulas, frequência,
avaliações e notas por turma/disciplina. Abas de plano de ensino e materiais.

Lançamento de nota aceita **conceito** quando o esquema usa escala conceitual, e
permite marcar a nota como **segunda chamada** (só se o regimento previr — o
sistema recusa marcar quando não).

> Alteração de nota já lançada é auditada: valor anterior, valor novo, quem
> mudou e de qual IP. Lançamento inicial não polui a trilha; só a mudança.

**Conselho de Classe** (`ERP · Acadêmico → Conselho`) — quadro consolidado aluno
× disciplina, ajuste de situação pelo conselho (também auditado) e ata da
reunião em PDF numerado.

**Docentes / RH** e **Produção docente** — cadastro, titulação, regime,
valor-hora, atividades (orientação, banca, substituição) e o **fechamento
mensal**: aulas do diário + atividades lançadas, com CSV para o RH. Sem essa
consolidação, alguém refaz a conta em planilha todo mês.

### Secretaria

**Secretaria** — histórico escolar consolidado e emissão de documentos oficiais,
todos numerados (AAAA/NNNN) com snapshot dos dados: atestado de matrícula,
atestado de frequência, histórico, carteirinha, quitação anual, informe para IR,
ata de resultados, certificado.

> **Quitação anual ≠ informe para IR.** A quitação (Lei 12.007/09) atesta que
> nada ficou em aberto e **não sai** com parcela pendente. O informe declara
> **quanto foi pago** no ano-calendário, para dedução de instrução — e o aluno
> inadimplente também tem direito ao seu, pelo que pagou. O informe usa a data
> do **pagamento** (regime de caixa): mensalidade de dezembro paga em janeiro
> pertence ao ano seguinte.

**Requerimentos** — fila da secretaria virtual, com tipos configuráveis, SLA,
taxa, trâmites e deferimento que pode gerar documento automaticamente.

**Regime especial** (`ERP · Secretaria → Regime especial`) — exercícios
domiciliares e tratamento excepcional. No ensino superior **não existe abono de
faltas**; o que existe é este amparo (Dec-Lei 1.044/69 para saúde, Lei 6.202/75
para gestante, Lei 4.375/64 para convocação militar).

Como funciona: enquanto **Solicitado**, nada muda. Ao **deferir**, as faltas
dentro do período saem da base de cálculo da frequência — as presenças continuam
contando, então o aluno que assistiu aula durante o afastamento não é
prejudicado. O amparo legal vem preenchido pelo tipo; é ele que sustenta a
decisão numa auditoria. O plano de atividades importa: o regime substitui a
presença, não o conteúdo.

**GED (Documentos)** — anexo de documentos por aluno, com conferência.

**Acervo acadêmico** (`ERP · Secretaria → Acervo`) — Portaria MEC 315/2018.
Quatro abas:

1. **Panorama** — quantos documentos existem, quantos sem classificação, quantos
   **fora de custódia** e quantos com prazo vencido.
2. **Tabela de temporalidade** — o que é permanente e o que tem prazo. Histórico,
   diploma e ata são permanentes; atestado e comprovante têm 5 anos;
   requerimento, 10.
3. **Eliminação** — seleção do que venceu + emissão do termo. **Exige comissão
   responsável.** Eliminar não é apagar arquivo: é ato formal, e o termo
   permanece com a lista do que saiu mesmo depois de os arquivos sumirem.
4. **Termos emitidos** — o histórico dos descartes.

> **"Trazer para custódia própria"** — se o documento existe só como link para
> outro servidor, isso não é acervo: link quebra, serviço de terceiro sai do ar,
> pasta é reorganizada, e o documento que a instituição é obrigada a guardar
> desaparece sem ninguém notar. O botão baixa o arquivo, calcula o hash SHA-256
> e passa a apontar para a cópia local, mantendo o endereço de origem
> registrado. Depois disso, "verificar integridade" prova que o arquivo não foi
> alterado.

**Diploma Digital** — ciclo `RASCUNHO → XML_GERADO → ASSINADO → REGISTRADO`, com
validação pública por código. **Trava do ENADE:** aluno irregular não cola grau.
Existe override, mas exige justificativa registrada.

**Centrais** — gera o link de acesso das centrais do responsável, ex-aluno,
candidato e coordenador.

### Financeiro

**Financeiro** — central de contas a receber: parcelas, aging, inadimplentes,
baixa e cobrança em lote, extrato do aluno, encargos (multa/juros/desconto de
pontualidade), renegociação e bloqueio acadêmico por inadimplência.

**Financeiro Bancário** — plano de contas, convênios, CNAB (remessa e retorno),
cobrança recorrente, indexadores e feriados.

> O layout CNAB entregue é o padrão FEBRABAN base. **Ele precisa ser calibrado
> com o banco na homologação** — cada banco tem particularidades de posição.

**Cobrança Judicial & Fiscal** — dívida ativa (CDA numerada), contabilização por
partida dobrada e controle de NFS-e.

> A NFS-e é **controle**, não transmissão: cada município tem webservice próprio.
> O ponto de integração está pronto; a emissão automática depende do provedor da
> prefeitura.

### Portal do aluno e do responsável

O portal é a tela que **reduz fila na secretaria** — cada coisa que o aluno
resolve sozinho é um atendimento que não acontece.

**Como o aluno entra** (duas formas, ambas válidas):

1. **CPF ou RA + senha** em `/portal/aca/login`. Cinco erros travam por 15
   minutos. O CPF é aceito com ou sem pontuação.
2. **Link enviado no WhatsApp** — é também o caminho do "esqueci a senha" e do
   primeiro acesso, onde ele cria a senha.

**O que ele faz sozinho:** boletim ao vivo, frequência, horário das aulas,
próximas datas, materiais de estudo, financeiro com 2ª via (boleto e PIX),
aceite de contrato, rematrícula, solicitações à secretaria, emissão de atestados
/histórico/carteirinha/quitação/informe de IR, **negociação de dívida**,
assinatura do calendário em `.ics` e notificações push.

**Negociação de dívida** — dois passos de propósito: escolher as parcelas e
**ver a proposta** (valor original, multa e juros, desconto, parcelamento),
depois confirmar. Ver o valor antes de aceitar é o mínimo para alguém assumir
uma dívida parcelada. Fica dentro da alçada que a instituição configurou (máximo
de parcelas, entrada mínima, desconto permitido — e o desconto só incide sobre
multa e juros, nunca sobre o principal, que é serviço já prestado).

> **Vem desligada por padrão.** Habilite em `Financeiro` quando a política
> estiver definida.

**Central do Responsável** — boletim e financeiro do dependente, 2ª via,
negociação, informe para IR e quitação anual. Quem paga a mensalidade é quem
declara a despesa no imposto de renda; por isso esses documentos estão aqui.

### Relatórios e gestão

**Painel de gestão** (`ERP · Relatórios → Painel de gestão`) — três abas, uma
por função:

- **Direção**: alunos ativos, em risco de evasão, inadimplência, formados,
  financeiro consolidado e prioridade de retenção.
- **Coordenação**: disciplinas ordenadas por reprovação, média e frequência da
  turma; alunos em risco do curso.
- **Secretaria**: requerimentos abertos e atrasados, diários pendentes,
  documentos a conferir, regimes aguardando análise.

**Risco de evasão** — score de 0 a 100 **explicável**: cada linha abre os
fatores que somaram pontos, com o número que os gerou.

| Fator | Peso | O que lê |
|---|---|---|
| Frequência | 30 | % de faltas contra o limite de 25% |
| Desempenho | 20 | disciplinas reprovadas |
| Financeiro | 20 | dias de atraso da parcela mais antiga |
| **Engajamento no WhatsApp** | 20 | aluno parou de responder |
| Acesso ao portal | 10 | dias sem entrar |

> O fator de engajamento é o que nenhum concorrente tem: silêncio prolongado de
> quem antes conversava costuma anteceder o abandono, e esse dado é nativo do
> ByChat. Ele não penaliza quem nunca foi contatado — sem tentativa da
> instituição, não há silêncio a interpretar.

Um score de caixa-preta não sustenta uma ligação de retenção. Por isso a tela
mostra o motivo e sugere a ação: falar de falta, oferecer monitoria, oferecer
negociação ou reabrir conversa.

**Regularidade ENADE** — painel com o que a trava da colação lê. Aluno **sem
registro é irregular**: não haver registro não significa que ele está em dia,
significa que a instituição não sabe. Tratar a ausência como irregularidade é o
que evita colar grau de alguém pendente e ter o diploma questionado depois.

**Censo INEP / SISTEC** — validação de inconsistências, justificativas e
exportação.

> O leiaute oficial do INEP é posicional e muda por edição. O que o sistema
> entrega é a extração consolidada e validada, mapeável ao layout vigente.

**Avaliação Institucional (CPA)** — instrumentos por público, dimensões,
perguntas (escala, NPS, texto, sim/não), link anônimo e dashboard de resultado.

**Indicadores (BI)** — visão acadêmica e financeira por período letivo.

---

## Segurança e auditoria

**Verificação em duas etapas** (`Configurações → Segurança`) — TOTP por
aplicativo autenticador. Quem altera nota, defere regime especial ou emite
diploma faz coisas que não se desfazem; senha sozinha, nesse contexto, é
credencial que circula em post-it.

O cadastro tem três passos: gerar o QR, **confirmar com um código real** e só
então ativar. Ao confirmar, aparecem **8 códigos de recuperação de uso único** —
eles aparecem **uma vez só** (o sistema guarda apenas o hash). Guarde-os: são
eles que devolvem a conta se o celular for perdido. Desativar exige a senha
atual, porque estar com a sessão aberta não deveria bastar.

**Trilha de auditoria** — registra alteração de nota, mudança de situação pelo
conselho, deferimento de regime especial, eliminação de acervo, importações,
mudança de política de acordo e uso de código de recuperação.

---

## Roteiros por função

### Secretaria acadêmica (meio dia de treinamento)

1. Painel de gestão → aba Secretaria: a fila do dia.
2. Requerimentos: receber, tramitar, deferir.
3. Secretaria: emitir documentos; entender numeração e snapshot.
4. Regime especial: registrar, analisar, deferir — e o efeito na frequência.
5. Movimentações: trancar, transferir, reingressar.
6. Acervo: classificar, conferir integridade, eliminar com termo.

### Coordenação de curso (meio dia)

1. Matrizes: ler a grade, entender por que ativa não se edita.
2. Vínculos → integralização: o que falta para cada aluno.
3. Diário e Conselho: acompanhamento e fechamento.
4. Painel de gestão → Coordenação: disciplinas com reprovação alta.
5. Risco de evasão: ler os fatores e agir sobre o principal.

### Financeiro (meio dia)

1. Financeiro: aging, inadimplentes, baixa e cobrança em lote.
2. Encargos: multa, juros, desconto de pontualidade.
3. Renegociação pela secretaria e política do portal.
4. Financeiro Bancário: remessa e retorno CNAB.
5. Cobrança Judicial & Fiscal: CDA e NFS-e.

### Professor (2 horas)

1. Portal do professor: como recebe o acesso.
2. Diário: registrar aula, chamada, avaliação e notas.
3. Conceito e segunda chamada, quando o regimento usa.
4. Plano de ensino e materiais.

### Direção (1 hora)

1. Painel de gestão → Direção.
2. Risco de evasão: da lista à ação.
3. Instituição: atos autorizativos e alertas de vencimento.
4. Regularidade ENADE e esteira de diplomação.

---

## Dados de demonstração

Para apresentar o sistema com as telas preenchidas:

```bash
cd backend
JWT_SECRET=x npx tsx scripts/demoAcaSeed.ts       # base: turma, alunos, diários, financeiro
JWT_SECRET=x npx tsx scripts/demoAcaSeedPlus.ts   # módulos F5–F22
JWT_SECRET=x npx tsx scripts/demoAcaSeedFases.ts  # fases 1–5 (instituição, esquema, ENADE, prova…)
```

Portal do aluno na demonstração: **RA `DEMO0001`, senha `Demo@2026`**.

Para remover tudo (deixa o sistema limpo, sem tocar em dado real):

```bash
JWT_SECRET=x npx tsx scripts/demoAcaTeardown.ts
```

---

## Próximos passos

### Antes de operar de verdade

1. **Cadastrar o regimento real** no esquema de avaliação. Hoje o sistema usa os
   parâmetros globais; o motor novo só entra quando existir esquema cadastrado.
   Use o simulador antes de salvar.
2. **Definir a política de acordo** e decidir se abre negociação no portal.
3. **Gerar as chaves de push** se quiser notificações no portal.
4. **Trazer o acervo para custódia própria** — os documentos existem como link.
5. **Calibrar o CNAB** com o banco na homologação.

### O que depende de terceiros

Cada um tem o ponto de integração pronto e funciona em modo simulado até a
credencial existir: assinatura ICP-Brasil do diploma, webservice de NFS-e da
prefeitura, catraca do controle de acesso, LMS próprio para o EAD, e o layout
posicional do Censo.

### O teste que ainda falta

O sistema foi verificado por API e pelos fluxos HTML, mas **as telas não foram
usadas por uma pessoa da secretaria em operação real**. Um ERP acadêmico só
prova que funciona no primeiro fechamento de semestre completo: diário lançado
por professor de verdade, nota conferida por coordenador, histórico batendo com
o que o aluno cursou.

A recomendação é um **semestre-piloto** com um curso: cadastrar o regimento,
lançar um diário do começo ao fim, fechar a turma e emitir um histórico. É o
teste que encontra o que nenhuma verificação automatizada encontra.
