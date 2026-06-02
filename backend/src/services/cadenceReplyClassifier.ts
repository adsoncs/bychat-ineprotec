// src/services/cadenceReplyClassifier.ts
//
// Sales Engagement C3: classifica resposta do lead em 1 das 5 classes:
//   positiva | objecao | desinteresse | duvida | fora_fit
//
// O resultado alimenta C4 (reações por classe — substitui o pause cego de B5).
// Padrão IA: Anthropic primeiro, fallback OpenAI; sem keys → throw.
// As keys são lidas via `lib/aiKeys.ts` que tenta `Setting` (UI Configurações
// > APIs / Tokens) primeiro e cai no `process.env` se não houver nada salvo.

import {
  getAnthropicKey,
  getOpenAiKey,
  getAnthropicModel,
  getOpenAiModel,
  getPrimaryProvider,
} from '../lib/aiKeys.js'

const VALID_CLASSES = ['positiva', 'objecao', 'desinteresse', 'duvida', 'fora_fit'] as const
export type ReplyClass = (typeof VALID_CLASSES)[number]

const SYSTEM_PROMPT = `Você é um classificador de respostas de leads em cadências de vendas (B2B/B2C).
Receberá a última mensagem que o lead enviou após receber um contato outbound.

Classes (escolha exatamente UMA):
- positiva: lead demonstra interesse, quer continuar/conversar/agendar/comprar
- objecao: lead tem dúvida ou oposição que pode ser tratada (preço, timing, autoridade, necessidade)
- desinteresse: lead pede pra parar de receber, diz que não quer, ou comunica desistência clara
- duvida: lead faz pergunta neutra/informativa sem sinal forte de compra ou recusa
- fora_fit: lead deixa claro que não é o perfil (cargo errado, segmento errado, B2C vs B2B etc)

Responda APENAS com o nome da classe, em uma única palavra, sem pontuação.`.trim()

// Modelos e ordem de provider são lidos em runtime de `lib/aiKeys.ts` (Setting → env → default).

/** Classifica a resposta do lead. Retorna a classe ou `null` se a IA respondeu
 * algo fora do enum (defensivo — não derruba o caller). */
export async function classifyReply(messageText: string): Promise<ReplyClass | null> {
  const text = (messageText || '').trim()
  if (!text) return null

  const userPrompt = `Mensagem do lead:\n"""\n${text.slice(0, 2000)}\n"""\n\nClasse:`
  const raw = await callAI(SYSTEM_PROMPT, userPrompt)
  return parseClass(raw)
}

function parseClass(raw: string): ReplyClass | null {
  const cleaned = raw
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z_]/g, '')
    .trim()
  return (VALID_CLASSES as readonly string[]).includes(cleaned) ? (cleaned as ReplyClass) : null
}

async function callAI(systemPrompt: string, userPrompt: string): Promise<string> {
  const [primary, anthropicKey, openaiKey] = await Promise.all([
    getPrimaryProvider(),
    getAnthropicKey(),
    getOpenAiKey(),
  ])

  // Provider preferencial primeiro; se não tiver key, cai pro outro.
  const order = primary === 'openai' ? ['openai', 'anthropic'] : ['anthropic', 'openai']

  for (const provider of order) {
    if (provider === 'anthropic' && anthropicKey) {
      return callAnthropic(systemPrompt, userPrompt, anthropicKey)
    }
    if (provider === 'openai' && openaiKey) {
      return callOpenAi(systemPrompt, userPrompt, openaiKey)
    }
  }

  throw new Error(
    'Nenhuma API key de IA configurada. Vá em Configurações → APIs / Tokens e cadastre Anthropic ou OpenAI.',
  )
}

async function callAnthropic(system: string, user: string, apiKey: string): Promise<string> {
  const model = await getAnthropicModel()
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 20,
      system,
      messages: [{ role: 'user', content: user }],
    }),
  })
  if (!response.ok) throw new Error(`Anthropic ${response.status}`)
  const data = (await response.json()) as any
  return data.content?.[0]?.text || ''
}

async function callOpenAi(system: string, user: string, apiKey: string): Promise<string> {
  const model = await getOpenAiModel()
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      max_tokens: 20,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  })
  if (!response.ok) throw new Error(`OpenAI ${response.status}`)
  const data = (await response.json()) as any
  return data.choices?.[0]?.message?.content || ''
}
