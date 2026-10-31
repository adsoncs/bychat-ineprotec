// src/services/journey/supportIntent.ts
//
// Classificador de INTENÇÃO do fluxo de atendimento (scriptedConfig.supportFlow).
//
// O roteiro é uma árvore: saudação → menu de setores → qualificação → humano. Ele
// funciona bem para quem responde "2", e mal para todo o resto — e "todo o resto"
// é a maioria. Quem chega dizendo "vi um anúncio de vaga e quero mandar meu
// currículo" está dizendo RH com todas as letras; o roteiro respondia "não
// consegui identificar essa opção". Quem escolheu o setor errado não tinha como
// voltar sem digitar exatamente a palavra "menu". Quem foi cumprimentado com o
// apelido do WhatsApp não tinha como corrigir.
//
// Este módulo cobre isso com UMA chamada de IA por turno ambíguo, devolvendo
// intenção + setor + nome de uma vez (em vez de um classificador por assunto).
//
// PRINCÍPIO (o mesmo de interpret.ts): a IA só CLASSIFICA. Ela escolhe entre
// intenções fechadas e entre `value`s de opções que já existem no formulário —
// nunca inventa setor, nunca move funil, nunca fala com o cliente. Todo o
// roteamento continua determinístico sobre o que ela devolveu, e qualquer falha
// (IA fora do ar, JSON inválido, value alucinado) vira `indefinido`, que é
// exatamente o comportamento antigo. A IA só pode melhorar o resultado.

import { chatWithAI } from '../chatbotFlow.js'

export type SupportIntent =
  | 'escolher_setor'   // disse, em texto livre, com quem quer falar
  | 'voltar_menu'      // errou o setor / quer ver as opções de novo
  | 'falar_atendente'  // quer humano agora
  | 'corrigir_nome'    // o nome que usamos está errado
  | 'duvida'           // pergunta genérica sobre a empresa/serviço
  | 'indefinido'       // não deu para decidir → fluxo determinístico assume

export interface SupportTurnResult {
  intent: SupportIntent
  setor: string | null // value EXATO de uma opção existente (só em escolher_setor)
  nome: string | null  // nome informado junto (só em corrigir_nome)
}

const VAZIO: SupportTurnResult = { intent: 'indefinido', setor: null, nome: null }

const INTENCOES: SupportIntent[] = [
  'escolher_setor', 'voltar_menu', 'falar_atendente', 'corrigir_nome', 'duvida', 'indefinido',
]

function stripHtml(s: any): string {
  return String(s ?? '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()
}

function buildPrompt(
  options: Array<{ value: string; label: string }>,
  contexto: { faseLabel: string; perguntaAtual?: string | null; nomeAtual?: string | null; extra?: string | null },
): string {
  const list = options.length
    ? options.map((o, i) => `${i + 1}. value="${o.value}" — ${o.label}`).join('\n')
    : '(nenhuma — o cliente já escolheu o setor)'
  return [
    'Você interpreta a mensagem de um cliente em um atendimento por WhatsApp e devolve a INTENÇÃO dele.',
    'Seu objetivo é entender o cliente e encaminhá-lo para quem resolve o problema dele, mesmo que ele não siga o roteiro.',
    contexto.extra?.trim() ? `\nSobre a empresa e o atendimento:\n${contexto.extra.trim()}` : '',
    `\nMomento da conversa: ${contexto.faseLabel}`,
    contexto.perguntaAtual ? `Última pergunta feita a ele: "${stripHtml(contexto.perguntaAtual)}"` : '',
    contexto.nomeAtual ? `Nome pelo qual estamos chamando o cliente: "${contexto.nomeAtual}"` : '',
    `\nSetores disponíveis (use EXATAMENTE o value):\n${list}`,
    '\nIntenções possíveis:',
    '- escolher_setor: ele indicou, em palavras, com qual área quer falar (ex.: "quero mandar meu currículo" → o setor de RH; "preciso da segunda via do boleto" → financeiro). Preencha "setor".',
    '- voltar_menu: quer ver as opções de novo, escolheu errado, quer trocar de área.',
    '- falar_atendente: quer falar com uma pessoa/humano agora, ou está claramente irritado com o robô.',
    '- corrigir_nome: diz que o nome que usamos está errado, ou informa como quer ser chamado. Se ele disser o nome, preencha "nome" (apenas o primeiro nome, sem saudação).',
    '- duvida: fez uma pergunta sobre a empresa, produto ou serviço, sem indicar setor.',
    '- indefinido: qualquer outro caso, ou se você não tiver segurança.',
    '\nRegras:',
    '- Na dúvida entre duas intenções, responda indefinido. É melhor o roteiro assumir do que encaminhar errado.',
    '- NUNCA invente um value de setor fora da lista.',
    '- Se a mensagem for a resposta esperada para a última pergunta (ex.: contou o problema dele quando perguntamos isso), responda indefinido.',
    '\nResponda APENAS com JSON válido, sem markdown:',
    '{"intent":"<uma das intenções>","setor":"<value ou null>","nome":"<primeiro nome ou null>"}',
  ].filter(Boolean).join('\n')
}

function parseResult(raw: string, valueSet: Set<string>): SupportTurnResult {
  if (!raw) return VAZIO
  const m = /\{[\s\S]*\}/.exec(raw)
  if (!m) return VAZIO
  let obj: any
  try { obj = JSON.parse(m[0]) } catch { return VAZIO }

  const intent: SupportIntent = INTENCOES.includes(obj?.intent) ? obj.intent : 'indefinido'
  // Setor alucinado invalida a escolha, não a resposta inteira: sem um value real
  // não há para onde encaminhar, então cai no menu.
  const setor = typeof obj?.setor === 'string' && valueSet.has(obj.setor) ? obj.setor : null
  if (intent === 'escolher_setor' && !setor) return { intent: 'voltar_menu', setor: null, nome: null }

  const nomeRaw = typeof obj?.nome === 'string' ? obj.nome.trim() : ''
  const nome = nomeRaw && nomeRaw.length <= 40 ? nomeRaw : null
  return { intent, setor, nome }
}

/**
 * Interpreta um turno ambíguo do atendimento. Só deve ser chamado quando o
 * caminho determinístico (número da opção, botão, comando exato) já falhou.
 *
 * Nunca lança: qualquer erro vira `indefinido`.
 */
export async function interpretSupportTurn(
  text: string,
  options: Array<{ value: string; label: string }>,
  contexto: { faseLabel: string; perguntaAtual?: string | null; nomeAtual?: string | null; extra?: string | null },
): Promise<SupportTurnResult> {
  const msg = String(text || '').trim()
  if (!msg) return VAZIO
  try {
    const valueSet = new Set(options.map((o) => o.value))
    const raw = await chatWithAI(buildPrompt(options, contexto), [{ role: 'user', content: msg }])
    return parseResult(raw, valueSet)
  } catch {
    return VAZIO // IA fora do ar → roteiro determinístico assume, como antes
  }
}
