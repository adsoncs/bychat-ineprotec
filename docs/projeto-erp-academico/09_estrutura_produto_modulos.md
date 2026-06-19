# 09 — Estrutura de Produto: Educacional vs. ERP Acadêmico

> Como os módulos e o menu estão organizados para suportar **dois produtos** sem que
> ligar/desligar um derrube o outro. Reorganização de 2026-06-19.

## Os dois produtos

| Produto | Módulos | Para quem |
|---|---|---|
| **Educacional + Portal de Matrículas** | `educacional` + `enrollment_portals` | Cliente que quer catálogo acadêmico, processos seletivos e inscrição online — **sem** gestão operacional |
| **+ ERP Acadêmico** (add-on) | todos os `aca_*` (21 sub-módulos) | Cliente que quer também matrícula/financeiro/pedagógico/secretaria/etc. |

## 3 níveis de separação

### 1. Categoria do módulo (Configurações › Módulos)
- Categoria **"Educacional"**: `educacional`, `enrollment_portals` (a base).
- Categoria **"ERP Acadêmico"**: os 21 `aca_*` (o add-on).

No gerenciador de módulos os dois blocos aparecem **separados** — dá pra filtrar por
"ERP Acadêmico" e ligar/desligar o ERP inteiro sem tocar na base.

### 2. Dependências (a garantia de segurança)
- `educacional` → `dependsOn: []` · `enrollment_portals` → `dependsOn: []`
  (a base **não depende de nada** do ERP).
- Todos os `aca_*` → dependem (transitivamente) de `educacional`.

**Consequências (verificadas):**
- **Desativar qualquer `aca_*` NUNCA derruba a base** — `educacional`/`enrollment_portals`
  não são dependentes de nenhum `aca_*`.
- `enrollment_portals` tem **zero dependentes** → liga/desliga livremente.
- **Ligar** qualquer `aca_*` puxa a base em cascata (ex.: `aca_diploma` → `aca_secretaria`
  → `aca_matriculas` → `aca_estrutura` → `educacional`).
- **Não dá** pra desativar `educacional` enquanto houver `aca_*` ativo (o toggle bloqueia) —
  protege o ERP de ficar sem a base.

→ Cliente B = liga `educacional` + `enrollment_portals`, deixa os `aca_*` desligados (default).
→ Cliente A = liga os `aca_*` (a base sobe junto via cascata).

### 3. Menu (sidebar)
- **Grupo "Educacional"** = a base + portal (Visão geral, Unidades, Campus, Níveis,
  Modalidades, Cursos, Ofertas, Modos de ingresso, Processos seletivos, Revisão de
  documentos, Avaliações, Portal de Matrículas). É **exatamente o que o Cliente B vê**.
- **Grupos "ERP · …"** (só aparecem quando os `aca_*` estão ativos):
  - **ERP · Estrutura & Cadastros** — Estrutura Acadêmica, Currículo, Cadastros auxiliares.
  - **ERP · Acadêmico** — Alunos, Matrículas, Movimentações, Diário, Conselho, Calendário,
    Controle de Acesso, Docentes/RH, EAD/LMS, Alocação, Vestibular (classificação).
  - **ERP · Secretaria** — Secretaria, Requerimentos, Estágio & Atividades, TCC, GED,
    Egressos, Diploma Digital, Centrais, Comunicação.
  - **ERP · Financeiro** — Financeiro, Financeiro Bancário, Cobrança Judicial & Fiscal.
  - **ERP · Relatórios** — Indicadores (BI), Avaliação Institucional (CPA), Censo/SISTEC,
    Censo INEP/ENADE.

Cada grupo só aparece se houver ao menos um item com permissão ativa — então para o
Cliente B só o grupo "Educacional" é exibido; para o Cliente A aparecem todos.

> A reorganização é **cosmética/organizacional**: não muda permissões nem dependências.
> Os 42 itens de menu foram preservados (nenhum item removido), apenas reagrupados.
