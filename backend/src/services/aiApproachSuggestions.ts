// src/services/aiApproachSuggestions.ts
//
// Sugestões de abordagem (ice-breakers) por IA para o vendedor.
//
// Substitui os templates hardcoded que existiam em enrichment/dossier.ts (com
// referências fixas a "BeyondHub" e LinkedIn) por uma geração contextual real,
// usando:
//   - Contexto do Negócio (Setting grp 'business' — nome, ramo, oferta, ICP)
//   - Persona padrão ativa (isDefault=true) — dores, objeções, tom de voz
//   - Funil + etapa atual do lead (descreve o momento na jornada)
//   - customFields preenchidos (respostas que o lead deu em formulários)
//   - Enrichment ativo (LinkedIn/Instagram, cidade, cargo, setor)
//
// SALVAGUARDA CONTRA ALUCINAÇÃO: se faltarem dados essenciais de contexto da
// empresa (nome + oferta), NÃO chama a IA e devolve `missingContext` listando
// o que precisa ser preenchido. A UI exibe esse painel e oferece o link pra
// Configurações; só libera o botão "Gerar" depois que o contexto estiver ok.
//
// Persiste em Lead.analysis.approachSuggestions (sem migration nova).

import { prisma } from '../lib/prisma.js'
import {
  getAnthropicKey, getOpenAiKey, getPrimaryProvider,
  getAnthropicModel, getOpenAiModel,
} from '../lib/aiKeys.js'
import { loadBusinessContext, BUSINESS_CONTEXT_FIELDS } from './businessContext.js'
import { logEvent } from './leadHistory.js'
import { captureException } from '../lib/observability.js'

export interface ApproachSuggestionsResult {
  suggestions: string[]
  missingContext: string[]      // labels do que falta (vazio = pronto pra gerar)
  generatedAt: string | null    // ISO da última geração (ou null)
  provider?: string
  model?: string
  inputTokens?: number
  outputTokens?: number
  costUsd?: number
  reason?: string               // ex: "company_context_missing", "no_api_key", "ok"
}

const MIN_REQUIRED_KEYS = [
  'business.company_name',
  'business.offer_description',
]

function tryParseJson(s: string): any | null {
  if (!s) return null
  try { return JSON.parse(s) } catch { /* tenta extrair bloco */ }
  const m = s.match(/\{[\s\S]*\}/)
  if (m) { try { return JSON.parse(m[0]) } catch { return null } }
  return null
}

function estimateAnthropicCost(i: number, o: number): number {
  return +(((i / 1e6) * 3) + ((o / 1e6) * 15)).toFixed(6)
}
function estimateOpenAiCost(i: number, o: number): number {
  return +(((i / 1e6) * 2.5) + ((o / 1e6) * 10)).toFixed(6)
}

async function callAnthropic(system: string, user: string, key: string, model: string) {
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 1200,
      system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: [{ type: 'text', text: user }] }],
    }),
  })
  if (!resp.ok) throw new Error(`Anthropic ${resp.status}: ${(await resp.text()).slice(0, 300)}`)
  const d: any = await resp.json()
  return {
    text: d.content?.[0]?.text ?? '',
    inputTokens: (d.usage?.input_tokens ?? 0) + (d.usage?.cache_read_input_tokens ?? 0),
    outputTokens: d.usage?.output_tokens ?? 0,
  }
}

async function callOpenAi(system: string, user: string, key: string, model: string) {
  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      max_tokens: 1200,
      temperature: 0.4,
    }),
  })
  if (!resp.ok) throw new Error(`OpenAI ${resp.status}: ${(await resp.text()).slice(0, 300)}`)
  const d: any = await resp.json()
  return {
    text: d.choices?.[0]?.message?.content ?? '',
    inputTokens: d.usage?.prompt_tokens ?? 0,
    outputTokens: d.usage?.completion_tokens ?? 0,
  }
}

// ── prompts ──────────────────────────────────────────────

const SYSTEM_BASE = `Você é um redator comercial especialista em primeiro contato com leads via WhatsApp no Brasil.

Sua tarefa é redigir até 3 mensagens curtas (ice-breakers) que um vendedor da empresa pode enviar pra abrir conversa com o lead. As mensagens devem:

- Falar SEMPRE em nome da empresa descrita no CONTEXTO DO NEGÓCIO (nunca invente outra marca, jamais cite empresas de exemplo).
- Soar humano, em português brasileiro, tom direto e respeitoso.
- Conectar a oferta da empresa ao momento/perfil real do lead (use SOMENTE fatos comprovados — nome, cidade, setor, cargo, respostas de formulário, etapa no funil).
- Variar a abordagem: 1ª mais consultiva (pergunta aberta), 2ª mais direta (oferta de ajuda), 3ª mais leve (curiosidade).
- NUNCA inventar dados que não estejam no input (não "vi seu LinkedIn" sem URL real comprovada, não "vi seu Instagram" sem perfil real).
- NUNCA citar redes sociais a menos que estejam explicitamente listadas em REDES SOCIAIS COMPROVADAS.
- Máximo 280 caracteres por mensagem. Pode ter emoji discreto (no máximo 1 por mensagem, opcional).
- Personalize com o primeiro nome quando disponível, sem ser invasivo.

REGRA DE OURO: se faltar contexto pra fazer uma boa mensagem (ex: a empresa não tem oferta descrita ou o lead não tem nenhum fato útil), prefira gerar UMA mensagem genérica honesta de boas-vindas em vez de inventar conexões falsas.

Responda SOMENTE com JSON válido neste formato exato:
{"suggestions": ["mensagem 1", "mensagem 2", "mensagem 3"], "notes": "explicação curta (até 240 chars) de como você usou o contexto"}`

async function buildSystemPrompt(bizCtx: Record<string, string>, persona: any | null): Promise<string> {
  const parts: string[] = [SYSTEM_BASE]

  const bizLines: string[] = []
  for (const f of BUSINESS_CONTEXT_FIELDS) {
    const v = bizCtx[f.key]
    if (v) bizLines.push(`- ${f.label}: ${v}`)
  }
  parts.push(`CONTEXTO DO NEGÓCIO (a empresa que você representa nas mensagens):\n${bizLines.join('\n')}`)

  if (persona) {
    const personaBlock: string[] = ['PERSONA / ICP (descrição do cliente ideal):']
    personaBlock.push(`- Nome: ${persona.name}`)
    if (persona.description) personaBlock.push(`- Descrição: ${persona.description}`)
    if (persona.occupation) personaBlock.push(`- Ocupação típica: ${persona.occupation}`)
    if (Array.isArray(persona.painPoints) && persona.painPoints.length)
      personaBlock.push(`- Dores: ${(persona.painPoints as string[]).slice(0, 6).join(' | ')}`)
    if (Array.isArray(persona.objections) && persona.objections.length)
      personaBlock.push(`- Objeções comuns: ${(persona.objections as string[]).slice(0, 6).join(' | ')}`)
    if (Array.isArray(persona.triggers) && persona.triggers.length)
      personaBlock.push(`- Gatilhos de compra: ${(persona.triggers as string[]).slice(0, 6).join(' | ')}`)
    if (persona.voiceTone) personaBlock.push(`- Tom de voz preferido: ${persona.voiceTone}`)
    if (Array.isArray(persona.examplePhrases) && persona.examplePhrases.length)
      personaBlock.push(`- Frases de exemplo: ${(persona.examplePhrases as string[]).slice(0, 4).join(' | ')}`)
    parts.push(personaBlock.join('\n'))
  }

  return parts.join('\n\n')
}

async function buildUserPrompt(leadId: number): Promise<string | null> {
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: {
      id: true, nome: true, empresa: true, segmento: true, cidade: true,
      email: true, whatsapp: true, source: true, status: true,
      solucaoNome: true, maturidade: true, customFields: true,
      funnelId: true, formData: true, scores: true,
    },
  })
  if (!lead) return null

  // Funil + etapa atual (status = key da Stage)
  let funnelBlock = 'sem funil definido'
  if (lead.funnelId) {
    const funnel = await prisma.funnel.findUnique({
      where: { id: lead.funnelId },
      select: {
        name: true, description: true,
        stages: { select: { key: true, name: true, position: true, terminalKind: true }, orderBy: { position: 'asc' } },
      },
    })
    if (funnel) {
      const currentStage = funnel.stages.find((s) => s.key === lead.status)
      const journey = funnel.stages.map((s) => s.name).join(' → ')
      funnelBlock = [
        `Funil: ${funnel.name}${funnel.description ? ` (${funnel.description})` : ''}`,
        `Jornada: ${journey}`,
        `Etapa atual: ${currentStage?.name ?? lead.status ?? '–'}`,
      ].join('\n')
    }
  }

  // Custom fields preenchidos (com labels reais)
  let customFieldsBlock = 'nenhuma resposta personalizada'
  const cf = (lead.customFields ?? {}) as Record<string, any>
  const cfKeys = Object.keys(cf).filter((k) => cf[k] !== null && cf[k] !== undefined && String(cf[k]).trim() !== '')
  if (cfKeys.length) {
    const defs = await prisma.customField.findMany({
      where: { key: { in: cfKeys }, active: true },
      select: { key: true, label: true, type: true },
    })
    const byKey = new Map(defs.map((d) => [d.key, d]))
    const lines: string[] = []
    for (const k of cfKeys) {
      const def = byKey.get(k)
      const v = cf[k]
      const valueStr = Array.isArray(v) ? v.join(', ') : String(v).slice(0, 200)
      lines.push(`- ${def?.label ?? k}: ${valueStr}`)
    }
    if (lines.length) customFieldsBlock = lines.join('\n')
  }

  // Enrichment ativo — só fatos com confidence alta entram
  const facts = await prisma.leadEnrichment.findMany({
    where: { leadId, status: 'active' },
    select: { field: true, value: true, confidence: true, source: true },
    orderBy: { confidence: 'desc' },
    take: 60,
  })
  const factsByField = new Map<string, { value: string; confidence: number }>()
  for (const f of facts) {
    const prev = factsByField.get(f.field)
    if (!prev || (f.confidence ?? 0) > prev.confidence) {
      factsByField.set(f.field, { value: f.value, confidence: f.confidence ?? 0 })
    }
  }
  const factBest = (field: string) => factsByField.get(field)?.value
  const factConf = (field: string) => factsByField.get(field)?.confidence ?? 0

  // Redes sociais COMPROVADAS (com URL real + confidence >= 0.6)
  const socialPlatforms = ['linkedin', 'instagram', 'facebook', 'twitter', 'youtube', 'tiktok']
  const verifiedSocials: string[] = []
  for (const p of socialPlatforms) {
    const url = factBest(`${p}_url`)
    const conf = factConf(`${p}_url`)
    if (url && conf >= 0.6) {
      const title = factBest(`${p}_profile_title`)
      const bio = factBest(`${p}_profile_bio`)
      verifiedSocials.push(`- ${p}: ${url}${title ? ` | título: ${title}` : ''}${bio ? ` | bio: ${String(bio).slice(0, 200)}` : ''}`)
    }
  }
  const socialsBlock = verifiedSocials.length
    ? verifiedSocials.join('\n')
    : 'nenhuma rede social validada (NÃO invente perfil de rede social)'

  const position = factBest('position') || factBest('job_title')
  const sector = factBest('company_sector') || lead.segmento
  const city = factBest('phone_city_guess') || factBest('company_city') || lead.cidade
  const companyName = factBest('company_name_verified') || factBest('company_name') || lead.empresa

  return [
    `LEAD #${lead.id}`,
    `- Primeiro nome: ${(lead.nome ?? '').split(' ')[0] || '–'}`,
    `- Nome completo: ${lead.nome ?? '–'}`,
    `- Empresa: ${companyName ?? '–'}`,
    `- Setor: ${sector ?? '–'}`,
    `- Cidade: ${city ?? '–'}`,
    `- Cargo (se descoberto): ${position ?? '–'}`,
    `- Canal de origem: ${lead.source ?? '–'}`,
    `- Solução/Produto de interesse: ${lead.solucaoNome ?? '–'}`,
    `- Maturidade declarada: ${lead.maturidade ?? '–'}`,
    `- Score do diagnóstico: ${(lead.scores as any)?.geral ?? '–'}`,
    '',
    'POSIÇÃO NO FUNIL:',
    funnelBlock,
    '',
    'RESPOSTAS EM CAMPOS PERSONALIZADOS:',
    customFieldsBlock,
    '',
    'REDES SOCIAIS COMPROVADAS:',
    socialsBlock,
  ].join('\n')
}

// ── núcleo ──────────────────────────────────────────────

function validateBusinessContext(bizCtx: Record<string, string>): string[] {
  const missing: string[] = []
  for (const f of BUSINESS_CONTEXT_FIELDS) {
    if (!MIN_REQUIRED_KEYS.includes(f.key)) continue
    if (!bizCtx[f.key] || !bizCtx[f.key].trim()) missing.push(f.label)
  }
  return missing
}

/**
 * Lê a última geração persistida (ou null). Não chama IA.
 * Usado pelo GET do dossier pra mostrar o estado atual sem custo.
 */
export async function readApproachSuggestions(leadId: number): Promise<ApproachSuggestionsResult | null> {
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: { analysis: true },
  })
  if (!lead) return null
  const stored = (lead.analysis as any)?.approachSuggestions
  if (!stored) return null
  return {
    suggestions: Array.isArray(stored.suggestions) ? stored.suggestions.map(String) : [],
    missingContext: Array.isArray(stored.missingContext) ? stored.missingContext.map(String) : [],
    generatedAt: stored.generatedAt ?? null,
    provider: stored.provider,
    model: stored.model,
    inputTokens: stored.inputTokens,
    outputTokens: stored.outputTokens,
    costUsd: stored.costUsd,
    reason: stored.reason,
  }
}

async function persist(leadId: number, result: ApproachSuggestionsResult) {
  const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { analysis: true } })
  const prev = (lead?.analysis ?? {}) as Record<string, unknown>
  await prisma.lead.update({
    where: { id: leadId },
    data: { analysis: { ...prev, approachSuggestions: result } as any },
  })
}

/**
 * Gera (ou regenera) as sugestões de abordagem para um lead.
 *
 * Fluxo:
 *  1. Carrega Contexto do Negócio. Se faltar (nome da empresa ou oferta),
 *     persiste { suggestions:[], missingContext:[...] } e retorna SEM chamar IA.
 *  2. Carrega persona padrão (opcional, melhora o tom).
 *  3. Monta prompts e chama IA (Anthropic preferred, fallback OpenAI).
 *  4. Persiste resultado em Lead.analysis.approachSuggestions.
 */
export async function generateApproachSuggestions(
  leadId: number,
  opts: { actorUserId?: number } = {},
): Promise<ApproachSuggestionsResult> {
  const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { id: true } })
  if (!lead) throw new Error('Lead não encontrado')

  // 1. Contexto do negócio
  const bizCtx = await loadBusinessContext()
  const missingContext = validateBusinessContext(bizCtx)
  if (missingContext.length) {
    const result: ApproachSuggestionsResult = {
      suggestions: [],
      missingContext,
      generatedAt: new Date().toISOString(),
      reason: 'company_context_missing',
    }
    await persist(leadId, result)
    return result
  }

  // 2. Persona padrão (opcional)
  const persona = await prisma.persona.findFirst({
    where: { active: true, isDefault: true },
  })

  // 3. Chamada à IA
  const anthropicKey = await getAnthropicKey()
  const openAiKey = await getOpenAiKey()
  if (!anthropicKey && !openAiKey) {
    const result: ApproachSuggestionsResult = {
      suggestions: [],
      missingContext: ['Chave de IA (Anthropic ou OpenAI) não configurada'],
      generatedAt: new Date().toISOString(),
      reason: 'no_api_key',
    }
    await persist(leadId, result)
    return result
  }

  const system = await buildSystemPrompt(bizCtx, persona)
  const user = await buildUserPrompt(leadId)
  if (!user) throw new Error('Lead não encontrado ao montar prompt')

  const preferred = await getPrimaryProvider()
  const tryAnthropic = async () => {
    if (!anthropicKey) return null
    const model = await getAnthropicModel()
    const r = await callAnthropic(system, user, anthropicKey, model)
    return { ...r, provider: 'anthropic' as const, model, costUsd: estimateAnthropicCost(r.inputTokens, r.outputTokens) }
  }
  const tryOpenAi = async () => {
    if (!openAiKey) return null
    const model = await getOpenAiModel()
    const r = await callOpenAi(system, user, openAiKey, model)
    return { ...r, provider: 'openai' as const, model, costUsd: estimateOpenAiCost(r.inputTokens, r.outputTokens) }
  }

  const order = preferred === 'openai' ? [tryOpenAi, tryAnthropic] : [tryAnthropic, tryOpenAi]
  let res: any = null
  let lastErr: unknown = null
  for (const attempt of order) {
    try { const x = await attempt(); if (x) { res = x; break } } catch (e) { lastErr = e }
  }
  if (!res) {
    if (lastErr) captureException(lastErr instanceof Error ? lastErr : new Error(String(lastErr)), { stage: 'ai_approach_suggestions', leadId })
    const result: ApproachSuggestionsResult = {
      suggestions: [],
      missingContext: ['Falha ao chamar IA — verifique a chave e o saldo do provider'],
      generatedAt: new Date().toISOString(),
      reason: 'ai_call_failed',
    }
    await persist(leadId, result)
    return result
  }

  const parsed = tryParseJson(res.text)
  const rawSuggestions: unknown = parsed?.suggestions
  if (!Array.isArray(rawSuggestions) || rawSuggestions.length === 0) {
    captureException(new Error('AI approach: resposta sem suggestions válidas'), { stage: 'ai_approach_parse', leadId })
    const result: ApproachSuggestionsResult = {
      suggestions: [],
      missingContext: ['A IA retornou resposta inválida — tente regenerar'],
      generatedAt: new Date().toISOString(),
      reason: 'ai_parse_failed',
    }
    await persist(leadId, result)
    return result
  }

  const suggestions = rawSuggestions
    .map((s) => String(s ?? '').trim())
    .filter((s) => s.length > 0 && s.length <= 600)
    .slice(0, 3)

  const result: ApproachSuggestionsResult = {
    suggestions,
    missingContext: [],
    generatedAt: new Date().toISOString(),
    provider: res.provider,
    model: res.model,
    inputTokens: res.inputTokens,
    outputTokens: res.outputTokens,
    costUsd: res.costUsd,
    reason: 'ok',
  }
  await persist(leadId, result)

  const description = parsed?.notes ? String(parsed.notes).slice(0, 240) : ''
  logEvent({
    leadId,
    type: 'ai_approach_generated',
    category: 'system',
    actorType: opts.actorUserId ? 'operator' : 'ai',
    ...(opts.actorUserId ? { userId: opts.actorUserId } : {}),
    source: 'ai_approach_suggestions',
    title: `Sugestões de abordagem geradas (${suggestions.length})`,
    ...(description ? { description } : {}),
    metadata: { provider: res.provider, model: res.model, costUsd: res.costUsd, inputTokens: res.inputTokens, outputTokens: res.outputTokens },
  })

  return result
}
