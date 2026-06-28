# 03 — Spec do Adapter Mentor Web (Anti-Corruption Layer)

> **Para o Claude Code:** especificação do componente que integra o ByChat ao **Mentor Web ServicoExterno** (API REST). Tudo isolado em `apps/api/src/integrations/mentor-web/`. Nenhuma regra do Mentor vaza para o domínio do ByChat — o Adapter traduz e normaliza.

---

## 1. Contrato de autenticação (vale para todos os serviços)

Fluxo de **dois passos** por serviço:

```
PASSO 1 — obter token
GET  {MENTOR_BASE_URL}/rest/servicoexterno/token/{nomeServico}
Headers: usuário e senha do serviço externo
→ retorna: token

PASSO 2 — executar
POST {MENTOR_BASE_URL}/rest/servicoexterno/execute/{nomeServico}
Headers: token (do passo 1)
Body:   JSON com os parâmetros do serviço
→ retorna: JSON ( ver cada serviço )
```

- `MENTOR_BASE_URL` = `protocolo://endereco/{nomeAplicacaoG5}`.
- **Cachear o token** por serviço (TTL conservador; renovar em 401/expiração).
- **Credenciais por tenant**, cifradas AES-256-GCM. Decifrar em memória só na hora da chamada.

### Status / formato de retorno
- `HTTP 200` → sucesso. Corpo contém `"resultado": "SUCESSO"`.
- `HTTP 509` (e outros não-200) → erro. Corpo:
```json
{
  "resultado": "ERRO",
  "erro": { "operacao": "...", "valores": "...", "motivo": "..." }
}
```
O Adapter **normaliza** isso para um erro tipado do ByChat (ver §6).

---

## 2. Serviço: `matriculaAlunoConformeFiltros`

Realiza a matrícula do aluno e cria o contrato financeiro.

### Request (TypeScript)
```ts
interface MatriculaRequest {
  // Identificação da pessoa — informar PELO MENOS UM
  pessoaCpf?: string | null;
  pessoaEmail?: string | null;
  pessoaId?: number | null;

  // Identificação da turma — ver regras abaixo
  turmaId?: number | null;
  turmaCodTel?: string | null;
  turmaUnidadeId?: number | null;   // "Unidade"
  cursoId?: number | null;
  cursoCodTel?: string | null;
  periodoLetivoId?: number | null;
  anoLetivo?: number | null;
  semestreLetivo?: number | null;
  turno?: 'M' | 'V' | 'N' | null;   // M=Matutino, N=Noturno...
  dataInicioTurma?: string | null;  // data
  fase?: number | null;

  // Ingresso
  statusMatriculaIngresso: 'ATIVO' | 'PREMAT' | 'CANCEL'; // OBRIGATÓRIO
  dataMatricula?: string | null;     // se null, usa data atual
  formaIngressoId?: number | null;   // se null, usa padrão da regra de matrícula

  // Financeiro
  realizaAcaoFinanceira: 0 | 1;      // OBRIGATÓRIO (ação ao cancelar)
}
```

**Regras de turma (validar ANTES de chamar):**
1. Informar pelo menos `turmaUnidadeId` **ou** `turmaId`.
2. Se `turmaId` ausente → informar `anoLetivo` **ou** `periodoLetivoId`.
3. Demais campos refinam o filtro.
4. Se mais de uma turma casar, o Mentor matricula na **primeira**.

**Regra PREMAT:** se há documentos obrigatórios, enviar `statusMatriculaIngresso = "PREMAT"`; efetivar via secretaria depois. Enviar `ATIVO` com pendência → Mentor retorna erro "Matrícula Bloqueada".

### Response sucesso (200)
```ts
interface MatriculaResponse {
  mestreAlunoId: number;
  contratoFinanceiroId: number;   // ← chave para geraParcelaTitulo
  ingressoId: number;
  pessoaId: number;
  periodoLetivoId: number;
  turmaId: number;
  cursoId: number;
  resultado: 'SUCESSO';
}
```

### Idempotência (responsabilidade do ByChat)
A API **não** tem chave de idempotência. Antes de chamar:
1. Gerar `eventoExternoId` determinístico, ex.: `matricula:{tenantId}:{pessoaId}:{mentorTurmaId}:{periodoLetivoId}`.
2. Tentar criar `IntegracaoEvento` com `@@unique([origem, eventoExternoId])`. Se já existe com `SUCESSO`, **não chamar de novo** — retornar o resultado guardado.
3. Respeitar também o `@@unique` em `Matricula`.

---

## 3. Serviço: `geraParcelaTitulo`

Gera parcelas e os títulos bancários (boletos).

### Request
```ts
interface GeraParcelaTituloRequest {
  contratoFinId: number;            // OBRIGATÓRIO (vem da matrícula)
  planoPagamentoId?: number | null; // recomendado informar (senão escolhe aleatório!)
  parcelaInicial?: number | null;
  parcelaFinal?: number | null;
  parcelaInicialTitulo?: number | null; // 0 = não gerar título
  parcelaFinalTitulo?: number | null;
}
```
> ⚠️ Se `planoPagamentoId` não for informado e houver mais de um plano, o Mentor escolhe **aleatoriamente**. **Sempre informar o plano.**
> Para gerar parcela **sem** boleto: `parcelaInicialTitulo = parcelaFinalTitulo = 0`.

### Response sucesso (200)
```ts
interface GeraParcelaTituloResponse {
  valor: {
    logs: string[];
    parcelas: Array<{
      id: number;                 // mentorParcelaId
      nroParcela: number;
      valorBruto: number;         // decimal → converter para centavos Int!
      dataVencimento: string;     // "DD/MM/YYYY HH:mm:ss"
      isParcelaTotalmentePaga: boolean;
      titulo: {
        id: number;               // mentorTituloId
        valorTitulo: number;
        linhaDigitavel: string;   // boleto
      };
    }>;
  };
  resultado: 'SUCESSO';
}
```
**Persistência:** mapear cada item para `Parcela` (valor → `valorBrutoCentavos`, parse de data DD/MM/YYYY, `linhaDigitavel`, `isPaga = isParcelaTotalmentePaga`).

---

## 4. Serviço: `recuperaParcelaParaIntegracaoSistemaExterno`

Consulta parcelas (status/pagamento) para sincronizar com o ByChat.

```ts
// Confirmar payload exato na doc (a página estava com bot-detection ao gerar este spec).
// Uso esperado: consultar por contratoFinId / parcelaId e atualizar situacao/isPaga local.
interface ConsultaParcelaRequest {
  contratoFinId?: number | null;
  parcelaId?: number | null;
}
```
> **TODO Claude Code:** abrir a doc oficial e completar o contrato exato deste serviço antes de implementar B7 (consulta). Tratar como leitura de sincronização (job periódico BullMQ).

---

## 5. Serviço: `cancelaParcelaETitulo`

Cancela parcelas e/ou títulos bancários.

### Request
```ts
interface CancelaParcelaRequest {
  cancelaSomenteTit: 0 | 1;          // SEMPRE OBRIGATÓRIO (1 = só título, mantém parcela)
  // informar UM destes caminhos:
  parcelaId?: number | null;
  contratoFinId?: number | null;     // se usar este, parcelaInicial e parcelaFinal são obrigatórios
  parcelaInicial?: number | null;
  parcelaFinal?: number | null;
  motivoCancParcId?: number | null;  // se null, usa motivo padrão configurado no Mentor
}
```

### Response sucesso (200)
```ts
interface CancelaParcelaResponse {
  valor: {
    totalCanceladas: number;
    ocorrencias: Array<{
      nivelOcorrencia: 'SUCESSO' | string;
      descricao: string[];
    }>;
  };
  resultado: 'SUCESSO';
}
```
**Erros conhecidos (mapear):** `FIN_00140` (parcela sem título), `FIN_00141`/`ISE_00011` (parâmetros obrigatórios ausentes), `FIN_00139` (nenhuma parcela apta).

---

## 6. Design do Adapter

### Estrutura
```
apps/api/src/integrations/mentor-web/
  client.ts          # auth (token→execute), fetch, timeout, parse 200/509
  credentials.ts     # decrypt AES-256-GCM por tenant
  errors.ts          # MentorError normalizado + catálogo de códigos (FIN_*, ISE_*)
  idempotency.ts     # geração de eventoExternoId + checagem IntegracaoEvento
  services/
    matricula.ts     # matriculaAlunoConformeFiltros
    financeiro.ts    # geraParcelaTitulo, cancelaParcelaETitulo
    consulta.ts      # recuperaParcela...
  queue/
    mentor.worker.ts # BullMQ worker (retry/backoff)
    jobs.ts          # enqueue helpers
  mappers.ts         # decimal→centavos, data DD/MM/YYYY→Date, response→entidade
  types.ts           # interfaces acima
```

### Regras do Adapter
1. **Toda chamada roda em job BullMQ** (nunca síncrono no request do usuário). O request HTTP do front enfileira e responde 202/optimistic; o resultado chega via Socket.io.
2. **Retry com backoff exponencial** (ex.: 3 tentativas, base 2s). Erros de validação do Mentor (4xx-lógico, ex. parâmetro obrigatório) **não** devem dar retry — são determinísticos. Só dar retry em falha de rede/timeout/5xx infra.
3. **Idempotência:** antes do `execute`, gravar/consultar `IntegracaoEvento` (`@@unique([origem, eventoExternoId])`). Atualizar `status`, `responseJson`, `tentativas`.
4. **Mapeamento:** `valorBruto` decimal → `valorBrutoCentavos` (Int). Data `"DD/MM/YYYY HH:mm:ss"` → `Date`.
5. **Token cache** por `{tenantId, servico}`; renovar em falha de auth.
6. **Log sem segredos:** nunca logar usuário/senha/token. Logar `operacao` + `motivo` em erro.
7. **Validação Zod** do request antes de enviar e do response ao receber (a API pode mudar shape).

### Pseudo-fluxo de matrícula (orquestração)
```ts
// 1. valida regras de turma + dedup
const eventoId = `matricula:${tenantId}:${pessoaId}:${mentorTurmaId}:${periodoLetivoId}`;
await idempotency.ensureNew(OrigemIntegracao.MENTOR_MATRICULA, eventoId);

// 2. enfileira
await queue.add('matricula', { tenantId, payload });

// worker:
const token = await client.getToken(tenantId, 'matriculaAlunoConformeFiltros');
const res = await client.execute(token, 'matriculaAlunoConformeFiltros', payload); // 200 | 509
if (res.resultado === 'SUCESSO') {
  await db.matricula.update({ ... mentorContratoFinanceiroId: res.contratoFinanceiroId, status });
  await idempotency.markSuccess(eventoId, res);
  // 3. encadeia geração de boleto
  await queue.add('geraTitulo', { tenantId, contratoFinId: res.contratoFinanceiroId, planoPagamentoId });
  socket.emit(tenantId, 'matricula:ok', { ... });
} else {
  await idempotency.markError(eventoId, res.erro);
  socket.emit(tenantId, 'matricula:erro', { motivo: res.erro.motivo });
}
```

---

## 7. Checklist de pronto (B4)
- [ ] Auth token→execute funcionando com credencial cifrada por tenant.
- [ ] Os 4 serviços tipados (Zod) com request/response.
- [ ] Worker BullMQ com retry/backoff e distinção entre erro lógico (sem retry) e infra (com retry).
- [ ] Idempotência via `IntegracaoEvento` + guard de `Matricula`.
- [ ] Mappers (centavos, data) testados.
- [ ] Catálogo de erros (FIN_*, ISE_*, "Matrícula Bloqueada") mapeado para mensagens do ByChat.
- [ ] Nenhum segredo em log.
- [ ] Doc do `recuperaParcela...` confirmada e contrato completado.

---

## 8. Arquivos relacionados
- `01_schema_prisma_erp_academico.md` — entidades `Matricula`, `Parcela`, `IntegracaoEvento`, `MapeamentoMentor`.
- `02_CLAUDE.md` — contexto, convenções e ordem de build.
