// src/services/aiEssayTopicGenerator.ts
// Geração de temas de redação dissertativo-argumentativa via Claude.
// Padrão de saída segue o formato ENEM: tema/título curto, enunciado completo
// e textos motivadores. Usado pela tela admin de Gerenciar Temas da Redação.

import { getAnthropicKey, getAnthropicModel } from '../lib/aiKeys.js'

const MAX_TOKENS = 2500

export interface GenerateEssayTopicInput {
  context?: string         // ex.: "vestibular de Direito", "tema sobre tecnologia"
  audience?: string        // ex.: "ensino médio", "graduação"
  area?: string            // ex.: "humanas", "ciências sociais"
  includeSupportTexts?: boolean // default true
}

export interface GeneratedEssayTopic {
  title: string
  prompt: string
  supportTexts: string
  inputTokens: number
  outputTokens: number
  costUsd: number
}

function buildSystemPrompt(): string {
  return `Você é um elaborador profissional de propostas de redação dissertativo-argumentativa no padrão de vestibulares e do ENEM brasileiro.

Sua tarefa é criar UMA proposta de redação completa, com:
1. Título curto (até 100 caracteres): a temática principal, em forma de afirmação ou desafio.
2. Enunciado da proposta: parágrafo formal seguindo o padrão "A partir da leitura dos textos motivadores e com base nos conhecimentos construídos ao longo de sua formação, redija texto dissertativo-argumentativo em modalidade escrita formal da língua portuguesa sobre o tema [TEMA], apresentando proposta de intervenção que respeite os direitos humanos."
3. Textos motivadores: 3 a 4 textos curtos numerados (TEXTO I, TEXTO II, TEXTO III, TEXTO IV), variando entre dado estatístico (com fonte plausível: IBGE, OMS, ANCINE, etc.), citação de lei brasileira, citação de pensador/autor brasileiro e/ou trecho de notícia. Cada texto deve ter de 2 a 4 linhas. Os dados podem ser plausíveis (não precisam ser exatos), mas devem ser realistas e apresentados como evidências para o tema.

Diretrizes:
- Tema deve ser socialmente relevante, atual, no recorte brasileiro.
- Evite temas controversos do ponto de vista de direitos humanos (o ENEM exige proposta de intervenção que respeite direitos humanos).
- Use português formal, em registro de prova oficial.
- Os textos motivadores devem oferecer ângulos COMPLEMENTARES (não repetir o mesmo argumento).

Responda EXCLUSIVAMENTE em JSON válido (sem markdown, sem fences), no formato:
{
  "title": "...",
  "prompt": "...",
  "supportTexts": "TEXTO I — ...\\n\\nTEXTO II — ...\\n\\nTEXTO III — ...\\n\\nTEXTO IV — ..."
}`
}

function buildUserPrompt(input: GenerateEssayTopicInput): string {
  const parts: string[] = []
  parts.push('Gere uma proposta de redação dissertativo-argumentativa.')
  if (input.context) parts.push(`Contexto/orientação: ${input.context}`)
  if (input.audience) parts.push(`Público-alvo: ${input.audience}`)
  if (input.area) parts.push(`Área de conhecimento sugerida: ${input.area}`)
  if (input.includeSupportTexts === false) {
    parts.push('NÃO inclua textos motivadores — devolva supportTexts como string vazia.')
  } else {
    parts.push('Inclua 3 a 4 textos motivadores variados.')
  }
  parts.push('Responda apenas com o JSON.')
  return parts.join('\n')
}

function tryParseJson(s: string): any | null {
  const cleaned = s.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim()
  try { return JSON.parse(cleaned) } catch {}
  const m = cleaned.match(/\{[\s\S]*\}/)
  if (m) { try { return JSON.parse(m[0]) } catch {} }
  return null
}

// Custo aproximado em USD para Claude Sonnet 4.6:
// input ~$3 / 1M tokens, output ~$15 / 1M tokens.
function estimateCost(inputTokens: number, outputTokens: number): number {
  return (inputTokens / 1_000_000) * 3 + (outputTokens / 1_000_000) * 15
}

export async function generateEssayTopic(input: GenerateEssayTopicInput): Promise<GeneratedEssayTopic> {
  // Resolve key/model via lib/aiKeys (DB → env). Sem isso, key salva pelo admin
  // em Configurações > APIs era ignorada e o serviço falhava com "key não
  // configurada" mesmo com configuração válida no banco.
  const apiKey = await getAnthropicKey()
  if (!apiKey) {
    throw new Error('Configure a chave Anthropic em Configurações > APIs antes de gerar temas com IA.')
  }
  const model = await getAnthropicModel()

  const systemPrompt = buildSystemPrompt()
  const userPrompt = buildUserPrompt(input)

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: MAX_TOKENS,
      system: systemPrompt,
      messages: [{ role: 'user', content: [{ type: 'text', text: userPrompt }] }],
    }),
  })
  if (!resp.ok) {
    const errText = await resp.text()
    throw new Error(`Anthropic ${resp.status}: ${errText.substring(0, 300)}`)
  }
  const data: any = await resp.json()
  const text = data.content?.[0]?.text || ''
  const inputTokens = data.usage?.input_tokens || 0
  const outputTokens = data.usage?.output_tokens || 0

  const parsed = tryParseJson(text)
  if (!parsed || typeof parsed !== 'object' || !parsed.prompt) {
    throw new Error('IA devolveu resposta inválida — tente novamente.')
  }

  return {
    title: String(parsed.title || '').slice(0, 150),
    prompt: String(parsed.prompt || '').trim(),
    supportTexts: String(parsed.supportTexts || '').trim(),
    inputTokens,
    outputTokens,
    costUsd: estimateCost(inputTokens, outputTokens),
  }
}
