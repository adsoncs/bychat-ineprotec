// src/services/journey/abordagemIntent.ts
//
// Classificador de resposta a uma ABORDAGEM ATIVA — quando fomos NÓS que
// abrimos a conversa.
//
// O roteiro de atendimento pressupõe que o contato chegou querendo alguma coisa:
// saudação, menu de setores, qualificação. Isso é o oposto do que acontece
// quando o disparo parte daqui. Quem recebeu "posso te ligar por 2 minutos ou
// prefere conversar por aqui?" e respondeu "tô ocupado" respondeu *exatamente* a
// pergunta que fizemos — e ouviu de volta "não consegui identificar essa opção",
// seguido do menu, duas vezes. Do lado do cliente, quem puxou assunto foi embora
// e deixou um robô confuso no lugar.
//
// As intenções aqui são as respostas plausíveis à nossa pergunta, não as portas
// de um menu.
//
// PRINCÍPIO (o mesmo de supportIntent.ts): a IA só CLASSIFICA. Ela escolhe entre
// intenções fechadas e extrai, no máximo, o momento que o cliente citou. Não
// fala com o cliente, não move funil, não decide setor. Qualquer falha — modelo
// fora do ar, JSON inválido, intenção desconhecida — vira `indefinido`, que
// encaminha a um humano. Sempre há gente do outro lado: fomos nós que ligamos.

import { chatWithAI } from '../chatbotFlow.js'

export type AbordagemIntent =
  | 'quer_ligacao'    // aceita a ligação agora
  | 'agendar_depois'  // quer, mas em outro momento
  | 'prefere_texto'   // prefere seguir escrevendo
  | 'sem_interesse'   // não quer ser procurado
  | 'duvida'          // respondeu com uma pergunta
  | 'indefinido'      // qualquer outra coisa → humano assume

export interface AbordagemResult {
  intent: AbordagemIntent
  /** Momento citado pelo cliente, nas palavras dele ("depois das 16h"). */
  quando: string | null
}

const VAZIO: AbordagemResult = { intent: 'indefinido', quando: null }

const INTENCOES: AbordagemIntent[] = [
  'quer_ligacao', 'agendar_depois', 'prefere_texto', 'sem_interesse', 'duvida', 'indefinido',
]

function buildPrompt(abordagem: string, extra?: string | null): string {
  return [
    'Você interpreta a resposta de um cliente a uma mensagem que NÓS enviamos primeiro.',
    'Ele não procurou a empresa: nós o procuramos. A resposta dele é sobre a nossa pergunta.',
    extra?.trim() ? `\nSobre a empresa:\n${extra.trim()}` : '',
    `\nMensagem que enviamos a ele:\n"""${abordagem.slice(0, 800)}"""`,
    '\nIntenções possíveis:',
    '- quer_ligacao: aceita a ligação, agora ou sem especificar quando ("pode ligar", "sim", "me liga").',
    '- agendar_depois: topa o contato, mas em outro momento ("tô ocupado", "depois das 16h", "amanhã de manhã", "estou dirigindo"). Preencha "quando" com o momento nas palavras dele, se houver.',
    '- prefere_texto: prefere resolver por escrito, ali mesmo ("por aqui", "manda por mensagem", "prefiro escrever").',
    '- sem_interesse: não quer ser procurado, pede para não receber mais, diz que não tem interesse ou que foi engano.',
    '- duvida: respondeu com uma pergunta (sobre preço, serviço, quem somos, como conseguimos o contato).',
    '- indefinido: qualquer outro caso, ou se você não tiver segurança.',
    '\nRegras:',
    '- "Tô ocupado", "agora não", "estou em reunião" são agendar_depois, não sem_interesse: ele não recusou, só não é a hora.',
    '- Só use sem_interesse quando a recusa for clara. Na dúvida entre recusa e adiamento, use agendar_depois.',
    '- "quando" é o texto do cliente resumido, no máximo 40 caracteres. Sem inventar data que ele não disse.',
    '- Na dúvida entre duas intenções, responda indefinido. Um humano assume e lê a conversa.',
    '\nResponda APENAS com JSON válido, sem markdown:',
    '{"intent":"<uma das intenções>","quando":"<texto curto ou null>"}',
  ].filter(Boolean).join('\n')
}

function parse(raw: string): AbordagemResult {
  if (!raw) return VAZIO
  const m = /\{[\s\S]*\}/.exec(raw)
  if (!m) return VAZIO
  let obj: any
  try { obj = JSON.parse(m[0]) } catch { return VAZIO }
  const intent: AbordagemIntent = INTENCOES.includes(obj?.intent) ? obj.intent : 'indefinido'
  const q = typeof obj?.quando === 'string' ? obj.quando.trim() : ''
  return { intent, quando: q && q.length <= 40 ? q : null }
}

/**
 * Interpreta a resposta do cliente à nossa abordagem. Nunca lança: qualquer
 * erro vira `indefinido`.
 *
 * `historico` são os últimos turnos da conversa, do mais antigo ao mais novo —
 * sem eles a IA lê "pode ser depois das 16:00" como uma frase solta, que é
 * exatamente o erro que este módulo existe para não repetir.
 */
export async function interpretarRespostaAbordagem(
  abordagem: string,
  historico: Array<{ role: 'user' | 'assistant'; content: string }>,
  opts: { extra?: string | null } = {},
): Promise<AbordagemResult> {
  try {
    const msgs = historico.length ? historico : [{ role: 'user' as const, content: '(sem histórico)' }]
    const raw = await chatWithAI(buildPrompt(abordagem, opts.extra), msgs)
    return parse(raw)
  } catch (e: any) {
    console.warn('[abordagem] classificação falhou:', e?.message ?? e)
    return VAZIO
  }
}
