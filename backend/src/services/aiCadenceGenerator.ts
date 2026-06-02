// Geração de cadências de Sales Engagement via IA (Anthropic preferred,
// fallback OpenAI). Pega objetivo + público + tom + canais e devolve uma
// cadência completa: nome, descrição, política (pauseOnReply/exitOn…),
// sequência de steps com offsets sensatos (touch frequency por canal),
// templates de mensagem por step com variáveis padrão e rationale por step.
//
// O retorno é apenas o preview — quem decide salvar é o frontend, depois do
// operador revisar/ajustar (endpoint /commit cria templates + cadência + steps).

import { getAnthropicKey, getOpenAiKey, getPrimaryProvider, getAnthropicModel, getOpenAiModel } from '../lib/aiKeys.js'

export type CadenceGoal =
  | 'prospect'           // outbound frio — abrir conversa
  | 'follow_up_warm'     // lead morno (visitou site, baixou material)
  | 'reactivate_dormant' // ressuscitar lead antigo sem resposta
  | 'qualify_inbound'    // inbound chegou, qualificar e marcar reunião
  | 'book_meeting'       // foco único: agendar
  | 'post_demo'          // pós-demo / reunião sem fechamento
  | 'reengage_no_show'   // não compareceu a reunião agendada
  | 'event_invite'       // convidar para evento/webinar
  | 'breakup'            // última cartada antes de descartar
  | 'custom'

export type CadenceTone = 'consultative' | 'direct' | 'friendly' | 'formal' | 'urgent'
export type CadenceDuration = 'short' | 'medium' | 'long'         // 5-7d / 10-14d / 21-30d
export type CadenceIntensity = 'light' | 'moderate' | 'aggressive' // touches/semana
export type CadenceChannel = 'whatsapp' | 'email' | 'sms' | 'call' | 'linkedin' | 'manual'

export interface GenerateCadenceInput {
  goal: CadenceGoal
  customGoalDescription?: string
  audience: {
    industry?: string
    targetRole?: string
    painPoints?: string
  }
  offer: {
    productName?: string
    valueProp?: string
  }
  tone: CadenceTone
  channels: CadenceChannel[]
  duration: CadenceDuration
  intensity: CadenceIntensity
  language?: 'pt-BR' | 'en'
  includeBreakup?: boolean
  // Quando o usuário clica "Refinar com IA" depois de uma 1ª geração,
  // mandamos a cadência anterior + a instrução de refinamento.
  refineFrom?: GeneratedCadence
  refineInstruction?: string
}

export interface GeneratedStep {
  order: number
  channel: CadenceChannel
  isManual: boolean
  isBreakUp: boolean
  dayOffset: number
  hourOffset: number
  template: {
    name: string
    subject?: string | null
    body: string
    variables: Array<{ key: string; label: string; default?: string }>
  }
  rationale: string
}

export interface GeneratedCadence {
  cadence: {
    name: string
    description: string
    pauseOnReply: boolean
    exitOnConversion: boolean
    exitOnStatuses: string[]
  }
  steps: GeneratedStep[]
  reasoning: {
    summary: string
    bestPractices: string[]
    recommendedNext: string
  }
}

export interface GenerateCadenceResult extends GeneratedCadence {
  inputTokens: number
  outputTokens: number
  costUsd: number
  provider: 'anthropic' | 'openai'
  model: string
}

const VALID_CHANNELS: CadenceChannel[] = ['whatsapp', 'email', 'sms', 'call', 'linkedin', 'manual']

const GOAL_LABEL: Record<CadenceGoal, string> = {
  prospect:           'Prospecção fria (outbound) — abrir conversa com lead novo',
  follow_up_warm:     'Follow-up de lead morno (visitou site, baixou material)',
  reactivate_dormant: 'Reativar lead antigo sem resposta há semanas/meses',
  qualify_inbound:    'Qualificar inbound recém-chegado e marcar reunião',
  book_meeting:       'Foco único: agendar reunião / call de descoberta',
  post_demo:          'Pós-demo / reunião sem fechamento — manter momentum',
  reengage_no_show:   'Lead não compareceu à reunião — re-engajar com cuidado',
  event_invite:       'Convidar para evento, webinar ou conteúdo exclusivo',
  breakup:            'Break-up — última tentativa antes de descartar/arquivar',
  custom:             'Objetivo customizado',
}

const TONE_LABEL: Record<CadenceTone, string> = {
  consultative: 'Consultivo — perguntas abertas, foco em diagnóstico, sem pressão',
  direct:       'Direto e objetivo — vai ao ponto, evita rodeios',
  friendly:     'Amigável e próximo — linguagem informal, humano',
  formal:       'Formal e corporativo — postura executiva, B2B sênior',
  urgent:       'Urgente — cria escassez, deadline, FOMO',
}

const DURATION_TO_DAYS: Record<CadenceDuration, [number, number]> = {
  short:  [5, 7],
  medium: [10, 14],
  long:   [21, 30],
}

const INTENSITY_LABEL: Record<CadenceIntensity, string> = {
  light:      'Suave — 2 a 3 touches por semana',
  moderate:   'Moderado — 4 a 5 touches por semana',
  aggressive: 'Agressivo — 6 a 8 touches por semana, distribuídos em vários canais',
}

function buildSystemPrompt(): string {
  return `Você é um especialista sênior em Sales Engagement (Outreach.io / Salesloft / Apollo level) e copywriter B2B brasileiro. Sua tarefa é desenhar UMA cadência completa de prospecção/follow-up, no padrão das melhores playbooks do mercado.

PRINCÍPIOS DE CADÊNCIAS DE ALTA PERFORMANCE QUE VOCÊ DEVE SEGUIR:

1. **Multi-channel é obrigatório**: nunca use só um canal. Combine WhatsApp, e-mail, ligação, LinkedIn e SMS quando o usuário permitir. WhatsApp e ligação têm taxa de resposta 3-5x maior que e-mail puro no Brasil.

2. **Touch frequency**:
   - Curta (5-7d): 5-7 touches no total
   - Média (10-14d): 8-12 touches
   - Longa (21-30d): 12-18 touches
   - Não amontoe touches no mesmo dia (max 2 por dia, em canais diferentes)
   - Espaço crescente entre touches (ex: dia 0, dia 1, dia 3, dia 6, dia 10, dia 15)

3. **Mensagens curtas vencem**:
   - WhatsApp/SMS: 1-3 frases, no máximo 250 caracteres. Pessoal, direto.
   - E-mail: 50-100 palavras. Subject curto e específico (max 50 chars). PS irresistível.
   - Ligação: roteiro de 10-20s para abrir + perguntas-chave (campo body do template)
   - LinkedIn: nota de conexão com 200 chars + InMail follow-up
   - Manual: tarefa pra operador (ex: pesquisar empresa, regravar voicemail)

4. **Estrutura clássica de cadência B2B**:
   - Touch 1 (dia 0): apresentação curta + valor — pergunta aberta
   - Touch 2 (+1-2 dias): bump no canal contrário (se 1 foi e-mail, agora WhatsApp)
   - Touch 3 (+3-4 dias): conteúdo de valor (case, número, insight da indústria)
   - Touch 4-5: perguntas qualificadoras / proof points
   - Touch 6+ (semana 2): CTAs mais diretos, escassez branda
   - Último touch: break-up educado ("vou parar de incomodar")

5. **Variáveis disponíveis** (use SEMPRE no body do template, em formato {{nome}}):
   - {{nome}}, {{empresa}}, {{whatsapp}}, {{email}}, {{operador}}, {{data_hoje}}, {{segmento}}, {{cidade}}
   - Não invente outras variáveis — se precisar de algo, peça em variables com default.

6. **Tom & registro brasileiro**:
   - Português brasileiro natural (sem "europeísmos" tipo "vossa pessoa", "tive cá")
   - Se tom = consultivo, faça perguntas abertas. Se direct, vai ao ponto. Se urgent, escassez/deadline real.
   - Evite jargão de IA ("aproveitando o ensejo…", "espero encontrá-lo bem")
   - Personalize com {{empresa}}/{{nome}}/{{segmento}} sempre que possível.

7. **Política da cadência**:
   - pauseOnReply = true (quase sempre — operador retoma manualmente)
   - exitOnConversion = true (sai automaticamente se virou venda)
   - exitOnStatuses: lista de status que desligam (ex: ["GANHO", "PERDIDO", "QUALIFICADO_REUNIAO"])

8. **isManual=true** apenas para steps que exigem operador humano (ligação real, pesquisa, ação manual no LinkedIn). Mensagens de WhatsApp/email/sms são automáticas (isManual=false). Ligação geralmente isManual=true (cria atividade pra operador discar).

9. **isBreakUp=true** apenas no último step se includeBreakup=true. Esse step encerra a cadência após envio. Mensagem de break-up é gentil ("imagino que não seja prioridade agora — vou parar de incomodar"), abre porta pro futuro.

10. **Variables no template**: para cada variável {{xxx}} usada no body/subject, inclua um item em variables com { key, label, default }. Use defaults plausíveis ("Cliente", "sua empresa") pra não quebrar quando o lead estiver com campo vazio.

FORMATO DE SAÍDA — RESPONDA EXCLUSIVAMENTE COM ESTE JSON (sem markdown, sem fences, sem explicação fora do JSON):

{
  "cadence": {
    "name": "string curto e descritivo (max 80 chars)",
    "description": "1-2 frases explicando objetivo + público + duração",
    "pauseOnReply": true,
    "exitOnConversion": true,
    "exitOnStatuses": ["GANHO", "PERDIDO"]
  },
  "steps": [
    {
      "order": 0,
      "channel": "whatsapp" | "email" | "sms" | "call" | "linkedin" | "manual",
      "isManual": false,
      "isBreakUp": false,
      "dayOffset": 0,
      "hourOffset": 0,
      "template": {
        "name": "Nome curto interno do template (ex: 'Outbound — Touch 1 WhatsApp')",
        "subject": "Apenas se channel=email, senão null",
        "body": "Texto da mensagem com variáveis {{nome}}, {{empresa}}, etc.",
        "variables": [
          { "key": "nome", "label": "Nome do lead", "default": "Cliente" }
        ]
      },
      "rationale": "1 frase explicando o papel deste step (ex: 'Apresentação inicial — gancho específico do segmento')"
    }
  ],
  "reasoning": {
    "summary": "Parágrafo curto (3-4 frases) explicando a estratégia da cadência: por que esses canais nessa ordem, intensidade, expectativa de resposta",
    "bestPractices": [
      "Bullet 1 — dica de Sales Engagement aplicada nesta cadência",
      "Bullet 2 — outra prática usada",
      "Bullet 3 — métrica esperada ou cuidado importante"
    ],
    "recommendedNext": "1 frase com sugestão de próxima ação depois de criar a cadência (ex: 'Inscreva 10 leads e acompanhe reply rate em 7 dias antes de inscrever em massa')"
  }
}

Valide mentalmente antes de devolver:
- Todos os channels listados estão entre os permitidos pelo usuário?
- Order é 0..N-1, sequencial?
- Steps de email têm subject; outros têm subject=null?
- Body usa variáveis no formato {{xxx}}?
- variables[] cobre TODAS as variáveis usadas no body+subject?
- Para canal=call, isManual=true (operador disca, não automatizamos áudio)?
- O último step, se includeBreakup=true, tem isBreakUp=true e usa tom gentil?
- Total de steps respeita a duração pedida (5-7 / 8-12 / 12-18)?`
}

function buildUserPrompt(input: GenerateCadenceInput): string {
  const lines: string[] = []
  const lang = input.language ?? 'pt-BR'

  if (input.refineFrom && input.refineInstruction) {
    lines.push('VOCÊ JÁ GEROU UMA CADÊNCIA, mas o operador pediu um refinamento.')
    lines.push('')
    lines.push(`Instrução do operador: ${input.refineInstruction}`)
    lines.push('')
    lines.push('CADÊNCIA ATUAL (a ser ajustada conforme a instrução acima):')
    lines.push('```json')
    lines.push(JSON.stringify(input.refineFrom, null, 2))
    lines.push('```')
    lines.push('')
    lines.push('Refaça a cadência aplicando o pedido. Mantenha o mesmo formato JSON de saída.')
    return lines.join('\n')
  }

  lines.push(`Idioma: ${lang}`)
  lines.push(`Objetivo: ${GOAL_LABEL[input.goal]}`)
  if (input.goal === 'custom' && input.customGoalDescription) {
    lines.push(`Descrição customizada do objetivo: ${input.customGoalDescription}`)
  }
  lines.push('')

  lines.push('PÚBLICO:')
  if (input.audience.industry)    lines.push(`- Indústria/segmento: ${input.audience.industry}`)
  if (input.audience.targetRole)  lines.push(`- Cargo/papel-alvo: ${input.audience.targetRole}`)
  if (input.audience.painPoints)  lines.push(`- Dores conhecidas: ${input.audience.painPoints}`)
  if (!input.audience.industry && !input.audience.targetRole && !input.audience.painPoints) {
    lines.push('- (não especificado — assuma B2B genérico)')
  }
  lines.push('')

  lines.push('OFERTA:')
  if (input.offer.productName) lines.push(`- Produto/serviço: ${input.offer.productName}`)
  if (input.offer.valueProp)   lines.push(`- Proposta de valor: ${input.offer.valueProp}`)
  if (!input.offer.productName && !input.offer.valueProp) {
    lines.push('- (não especificado — use linguagem genérica de descoberta)')
  }
  lines.push('')

  lines.push(`Tom: ${TONE_LABEL[input.tone]}`)
  const [minD, maxD] = DURATION_TO_DAYS[input.duration]
  lines.push(`Duração total: ${minD}-${maxD} dias (último dayOffset deve estar nessa faixa)`)
  lines.push(`Intensidade: ${INTENSITY_LABEL[input.intensity]}`)
  lines.push(`Canais permitidos (use APENAS estes): ${input.channels.join(', ')}`)
  lines.push(`Incluir step de break-up no final? ${input.includeBreakup === false ? 'Não' : 'Sim (último step com isBreakUp=true)'}`)
  lines.push('')
  lines.push('Devolva apenas o JSON pedido no system prompt.')

  return lines.join('\n')
}

function tryParseJson(s: string): any | null {
  const cleaned = s.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim()
  try { return JSON.parse(cleaned) } catch {}
  const m = cleaned.match(/\{[\s\S]*\}/)
  if (m) { try { return JSON.parse(m[0]) } catch {} }
  return null
}

function estimateAnthropicCost(inputTokens: number, outputTokens: number): number {
  // Sonnet 4.6 — input ~$3 / 1M, output ~$15 / 1M
  return (inputTokens / 1_000_000) * 3 + (outputTokens / 1_000_000) * 15
}

function estimateOpenAiCost(inputTokens: number, outputTokens: number): number {
  // GPT-4o aproximado — input $5 / 1M, output $15 / 1M
  return (inputTokens / 1_000_000) * 5 + (outputTokens / 1_000_000) * 15
}

function sanitizeCadence(parsed: any, allowedChannels: CadenceChannel[]): GeneratedCadence {
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('IA devolveu resposta inválida — tente novamente.')
  }
  const c = parsed.cadence
  if (!c || !c.name) throw new Error('IA devolveu cadência sem nome — tente novamente.')

  const stepsRaw: any[] = Array.isArray(parsed.steps) ? parsed.steps : []
  if (stepsRaw.length === 0) throw new Error('IA devolveu cadência sem steps — tente novamente.')

  const steps: GeneratedStep[] = stepsRaw.map((s: any, idx: number) => {
    const channel = String(s.channel ?? '').toLowerCase() as CadenceChannel
    if (!VALID_CHANNELS.includes(channel)) {
      throw new Error(`IA devolveu step com canal inválido: ${s.channel}`)
    }
    if (!allowedChannels.includes(channel)) {
      throw new Error(`IA usou canal "${channel}" que não foi permitido. Tente novamente.`)
    }
    const dayOffset  = Math.max(0, Number.isFinite(s.dayOffset)  ? Number(s.dayOffset)  : idx)
    const hourOffset = Math.max(0, Number.isFinite(s.hourOffset) ? Number(s.hourOffset) : 0)
    const isManual   = !!s.isManual || channel === 'call' || channel === 'manual'
    const isBreakUp  = !!s.isBreakUp
    const tpl = s.template ?? {}
    const body = String(tpl.body ?? '').trim()
    if (!body) throw new Error(`IA devolveu step ${idx} sem body do template — tente novamente.`)
    const variables: GeneratedStep['template']['variables'] = Array.isArray(tpl.variables)
      ? tpl.variables.filter((v: any) => v && typeof v.key === 'string').map((v: any) => ({
          key: String(v.key),
          label: String(v.label ?? v.key),
          default: v.default !== undefined ? String(v.default) : undefined,
        }))
      : []
    return {
      order: idx,
      channel,
      isManual,
      isBreakUp,
      dayOffset,
      hourOffset,
      template: {
        name: String(tpl.name ?? `Step ${idx + 1} — ${channel}`).slice(0, 100),
        subject: channel === 'email' ? (tpl.subject ? String(tpl.subject).slice(0, 200) : null) : null,
        body,
        variables,
      },
      rationale: String(s.rationale ?? '').trim().slice(0, 300),
    }
  })

  const reasoning = parsed.reasoning ?? {}

  return {
    cadence: {
      name: String(c.name).slice(0, 80),
      description: String(c.description ?? '').slice(0, 500),
      pauseOnReply:     c.pauseOnReply !== false,    // default true
      exitOnConversion: c.exitOnConversion !== false, // default true
      exitOnStatuses: Array.isArray(c.exitOnStatuses)
        ? c.exitOnStatuses.map((x: unknown) => String(x).toUpperCase()).slice(0, 10)
        : [],
    },
    steps,
    reasoning: {
      summary:        String(reasoning.summary ?? '').trim(),
      bestPractices:  Array.isArray(reasoning.bestPractices)
        ? reasoning.bestPractices.map((x: unknown) => String(x).trim()).filter(Boolean).slice(0, 8)
        : [],
      recommendedNext: String(reasoning.recommendedNext ?? '').trim(),
    },
  }
}

async function callAnthropic(systemPrompt: string, userPrompt: string, apiKey: string, model: string) {
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: [{ type: 'text', text: userPrompt }] }],
    }),
  })
  if (!resp.ok) {
    const err = await resp.text()
    throw new Error(`Anthropic ${resp.status}: ${err.substring(0, 300)}`)
  }
  const data: any = await resp.json()
  return {
    text: data.content?.[0]?.text ?? '',
    inputTokens:  data.usage?.input_tokens  ?? 0,
    outputTokens: data.usage?.output_tokens ?? 0,
  }
}

async function callOpenAi(systemPrompt: string, userPrompt: string, apiKey: string, model: string) {
  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: userPrompt   },
      ],
      max_tokens: 4000,
      temperature: 0.7,
    }),
  })
  if (!resp.ok) {
    const err = await resp.text()
    throw new Error(`OpenAI ${resp.status}: ${err.substring(0, 300)}`)
  }
  const data: any = await resp.json()
  return {
    text: data.choices?.[0]?.message?.content ?? '',
    inputTokens:  data.usage?.prompt_tokens     ?? 0,
    outputTokens: data.usage?.completion_tokens ?? 0,
  }
}

export async function generateCadence(input: GenerateCadenceInput): Promise<GenerateCadenceResult> {
  if (!input.channels || input.channels.length === 0) {
    throw new Error('Selecione ao menos um canal.')
  }
  for (const ch of input.channels) {
    if (!VALID_CHANNELS.includes(ch)) throw new Error(`Canal inválido: ${ch}`)
  }

  const systemPrompt = buildSystemPrompt()
  const userPrompt = buildUserPrompt(input)

  const preferred = await getPrimaryProvider()
  const anthropicKey = await getAnthropicKey()
  const openAiKey    = await getOpenAiKey()

  const tryAnthropic = async () => {
    if (!anthropicKey) return null
    const model = await getAnthropicModel()
    const r = await callAnthropic(systemPrompt, userPrompt, anthropicKey, model)
    const parsed = tryParseJson(r.text)
    const sanitized = sanitizeCadence(parsed, input.channels)
    return {
      ...sanitized,
      inputTokens:  r.inputTokens,
      outputTokens: r.outputTokens,
      costUsd:      estimateAnthropicCost(r.inputTokens, r.outputTokens),
      provider:     'anthropic' as const,
      model,
    }
  }

  const tryOpenAi = async () => {
    if (!openAiKey) return null
    const model = await getOpenAiModel()
    const r = await callOpenAi(systemPrompt, userPrompt, openAiKey, model)
    const parsed = tryParseJson(r.text)
    const sanitized = sanitizeCadence(parsed, input.channels)
    return {
      ...sanitized,
      inputTokens:  r.inputTokens,
      outputTokens: r.outputTokens,
      costUsd:      estimateOpenAiCost(r.inputTokens, r.outputTokens),
      provider:     'openai' as const,
      model,
    }
  }

  const order = preferred === 'openai' ? [tryOpenAi, tryAnthropic] : [tryAnthropic, tryOpenAi]
  let lastErr: unknown = null
  for (const attempt of order) {
    try {
      const res = await attempt()
      if (res) return res
    } catch (err) { lastErr = err }
  }
  if (lastErr) throw lastErr instanceof Error ? lastErr : new Error(String(lastErr))
  throw new Error('Nenhuma chave de IA configurada. Vá em Configurações > APIs e cadastre Anthropic ou OpenAI.')
}
