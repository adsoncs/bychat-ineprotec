# 10 — Validação de paridade com o MentorWeb (telas e campos)

> Investigação 2026-06-19. Objetivo: validar, tela a tela, todos os campos que o
> MentorWeb tem vs. o nosso ERP, e gerar plano de atualização. (A senha usada na
> investigação deve ser TROCADA pelo cliente.)

## Achados técnicos (o que descobri acessando o sistema)

- **App acessado:** `https://modular2.mentorweb.ws/modular2MWFlutterWeb/` — é um
  **Flutter Web** (interface desenhada em canvas; sem HTML de campos → não raspável).
- **API por trás:** `https://modular2.mentorweb.ws/apiModular2` (REST `/v1/...`, backend
  Java/Spring). Login: `POST /v1/login/usuario` `{username, password, plataforma:"WEB"}`
  → retorna `jwttoken`. Auth nas chamadas: `Authorization: Bearer <jwttoken>`.
  **171 endpoints** mapeados (operacionais: diário, rotinas, controle de acesso,
  financeiro/boleto, contrato, processo de matrícula, eventos, material, enquete…).
- **Módulos da conta (8):** Escola, Especialização, Técnico, Tesouraria, Processo
  seletivo, Comum, Portal do Aluno, Portal do Professor.
- **Onde vivem os cadastros pesados:** no app **legado `/modular2/`** — Java **Struts
  (`*.do`), renderizado no servidor** (esse SIM seria raspável). Ex.: a tela de Pessoa
  Física é `…/modular2/com/pessoafisicaman.do?evento=Editar`.
- **Bloqueio:** o `/modular2/` é protegido pelo gateway SSO **`modular2SecurityG5`**
  (token `pcaes` criptografado). O JWT/cookie `ETL` da API **não** satisfaz o gateway →
  não dá para abrir/raspar os `.do` por fora. Conclusão: **automatizo o inventário, não
  o conteúdo dos cadastros admin.**

## Inventário de telas obtido via API (`/v1/menu/opcaoF2` — menu contextual de pessoa)

### Aluno (19 telas)
- **Cadastros:** Cadastro (Pessoa Física), Pesquisa de familiares, Formação acadêmica, Ficha de saúde, Nova senha
- **Matrículas:** Última matrícula, Ingressos do aluno, Períodos de matrícula, Nova matrícula, Processo de matrícula, Trabalho de conclusão de curso (TCC)
- **Notas/faltas/validações:** Notas e faltas, Validação de disciplinas, Ocorrências
- **Outros:** Requerimentos solicitados, Entrega de documentos, Pendências
- **Financeiro:** Consulta de parcelas, Contratos financeiros

### Professor (9 telas)
- **Cadastros:** Cadastro, Formação acadêmica, Ficha de saúde, Nova senha
- **Outros:** Entrega de documentos, Pendências, Cronograma de aula, Prorrogar período de digitação, Ocorrências

> O menu lateral COMPLETO de cada módulo (Escola/Técnico/Tesouraria/Processo seletivo)
> é renderizado dentro do app legado e não foi enumerável pela API — depende de o
> cliente colar o menu/telas de cada módulo.

## Como vamos validar (método híbrido — confiável)

1. **Inventário** (este doc) = lista de telas conhecidas. O cliente complementa colando o
   **menu lateral** de cada módulo que faltar.
2. Para cada tela, o cliente abre "Novo/Editar" no MentorWeb (já logado) e **cola o
   conteúdo** — método que funcionou 100% na Pessoa Física.
3. Eu preencho a **matriz de paridade** abaixo (campo MentorWeb → nosso campo → status) e
   **implemento** o que faltar, tela a tela.

## Matriz de paridade (preencher por tela)

Legenda: ✅ temos · ⚠️ parcial · ❌ falta

### Pessoa Física — `pessoafisicaman.do` (✅ já reformada na F23+)
Coberta: identidade, documentos (RG/CPF/CNH/PIS/título/certidão/militar), dados
complementares (raça/naturalidade/nacionalidade/estado civil/filiação), ENEM/GDAE/INEP,
sócio-econômico, endereço/contatos, responsáveis multi-papel, saída/autorizados.
Revalidar contra a tela real para fechar 100%.

| Campo MentorWeb | Nosso campo | Status |
|---|---|---|
| _(colar tela para fechar pendências)_ | | |

### Formação acadêmica — `(a mapear)`
| Campo MentorWeb | Nosso campo | Status |
|---|---|---|
| _(colar tela)_ | | |

### Ficha de saúde — `rotinasDiarias/fichaSaude`
| Campo MentorWeb | Nosso campo | Status |
|---|---|---|
| _(colar tela)_ | | |

### Matrícula / Nova matrícula — `(a mapear)`
| Campo MentorWeb | Nosso campo | Status |
|---|---|---|
| _(colar tela)_ | | |

### Contrato financeiro — `/v1/contratofinanceiro`
| Campo MentorWeb | Nosso campo | Status |
|---|---|---|
| _(colar tela)_ | | |

> Acrescentar uma seção por tela conforme formos cobrindo (Requerimentos, Ocorrências,
> TCC, Processo de matrícula, Curso, Currículo, etc.).
