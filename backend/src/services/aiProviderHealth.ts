// src/services/aiProviderHealth.ts
//
// Saúde do provedor de IA — separa "a IA está fora" de "deu um tropeço".
//
// Existe por um incidente do severiano (03→08/09/2026): a conta Anthropic ficou
// sem crédito e, a cada mensagem recebida, o motor da jornada respondia
// "Tive uma instabilidade aqui 😕 Pode repetir a sua última mensagem, por
// favor?". A frase PEDE que a pessoa repita — ela repetia, a chamada falhava de
// novo, e a mesma frase saía outra vez. Em cinco dias foram 66 mensagens dessas
// para famílias reais, nenhuma resposta de verdade, e ninguém da gestão soube:
// o erro só existia no log do servidor.
//
// A regra que ficou: **falha nossa não vira mensagem para o contato.** Se o que
// quebrou foi credencial, crédito ou cota, o problema é da casa — o bot cala, a
// conversa segue para o atendimento humano (a mensagem do cliente é gravada e
// aparece nas Conversas como qualquer outra) e a GESTÃO recebe um alerta. Só
// tropeço transitório (timeout, 500, rede) continua merecendo a frase de
// desculpa ao contato, porque aí a próxima tentativa provavelmente funciona.

import { raiseAlert, resolveAlert } from './alertService.js'

export type LlmFailureKind = 'credential' | 'transient'

/** Chave da condição no sino: uma por instalação, não uma por conversa. */
const DEDUPE_KEY = 'integration.ai_provider'

/**
 * O que a mensagem de erro do provedor diz sobre a natureza da falha.
 *
 * Reconhece as duas famílias de recusa que NÃO adianta retentar — crédito/cota
 * acabados e credencial inválida/sem permissão — em Anthropic e OpenAI. Na
 * dúvida devolve 'transient': errar para o lado de mandar a frase de desculpa é
 * menos grave do que calar o bot por um 500 passageiro.
 */
export function classifyLlmFailure(err: unknown): LlmFailureKind {
  const msg = String((err as any)?.message ?? err ?? '').toLowerCase()
  const semSaldo = /credit balance|insufficient[_ ]quota|billing|payment|quota exceeded|exceeded your current quota|plans & billing/
  const semCredencial = /invalid[_ ]api[_ ]key|invalid x-api-key|authentication[_ ]error|unauthorized|permission[_ ]error|\b401\b|\b403\b/
  if (semSaldo.test(msg) || semCredencial.test(msg)) return 'credential'
  return 'transient'
}

/**
 * Registra uma falha do LLM e devolve a classificação para quem chamou decidir
 * se responde ao contato. Só a falha estrutural abre alerta — e uma só, porque
 * `raiseAlert` deduplica pela chave da condição (o produtor pode ser burro e
 * chamar a cada mensagem; é o comportamento esperado, ver alertService.ts).
 */
export async function noteLlmFailure(err: unknown, provider?: string | null): Promise<LlmFailureKind> {
  const kind = classifyLlmFailure(err)
  if (kind !== 'credential') return kind

  const detalhe = String((err as any)?.message ?? err ?? '').slice(0, 400)
  await raiseAlert({
    dedupeKey: DEDUPE_KEY,
    kind: 'integration.error',
    severity: 'critical',
    audience: 'management',
    title: 'IA indisponível — o chatbot parou de responder',
    body: `O provedor de IA${provider ? ` (${provider})` : ''} está recusando as chamadas por crédito, cota ou credencial. `
      + 'Enquanto isso o chatbot NÃO responde: as mensagens que chegarem ficam nas Conversas para o time atender. '
      + `Resolva em Configurações › Inteligência Artificial (chave/crédito) — ou cadastre um provedor de reserva. Recusa: ${detalhe}`,
    metadata: { provider: provider ?? null, detalhe },
  }).catch(() => {})
  return kind
}

/** Uma chamada que deu certo fecha o alerta: a condição acabou. */
export async function noteLlmSuccess(): Promise<void> {
  await resolveAlert(DEDUPE_KEY).catch(() => {})
}
