// src/services/aiLeadScoreService.ts
//
// Lead Score preditivo por IA (0-100): probabilidade de o lead fechar negócio.
//
// Fluxo (decisão do produto):
//  - lead.created        → score PROVISÓRIO (dados imediatos + canal)
//  - enrichment.completed → score DEFINITIVO (inclui dossiê de enriquecimento)
//  - manual              → recálculo sob demanda (botão no detalhe do lead)
//
// A IA recebe o "Contexto do Negócio" (Setting grp 'business') como bloco de
// sistema estável (prompt caching) — assim entende se o lead tem fit com o
// que a empresa vende (ex.: beyond = agência de marketing; vantari = cursos
// de pós). Calibração (Fase 4): few-shot de leads ganhos/perdidos recentes.
//
// Espelha o padrão do priorityScoreService (fila BullMQ + hooks de evento,
// fire-and-forget). Salvaguardas: toggle, só pontua lead qualificado/LGPD,
// debounce e não deixa o provisório sobrescrever um score definitivo.

import { Worker, type Job } from 'bullmq'
import { prisma } from '../lib/prisma.js'
import { queues, redisConnection } from '../lib/queues.js'
import { eventBus, type DomainEvent } from '../lib/eventBus.js'
import {
  getAnthropicKey, getOpenAiKey, getPrimaryProvider,
  getAnthropicModel, getOpenAiModel,
} from '../lib/aiKeys.js'
import { buildBusinessContextBlock } from './businessContext.js'
import { logEvent } from './leadHistory.js'
import { captureException } from '../lib/observability.js'

const QUEUE_NAME = 'wf-ai-lead-score'
const SCORE_JOB = 'score-lead'
const DEBOUNCE_MS = 2 * 60 * 1000 // não re-pontua o mesmo lead em < 2min (exceto manual)

type Phase = 'provisional' | 'definitive' | 'manual'

export interface AiScoreReason {
  phase: Phase
  probability: number          // 0-1 (chance estimada de fechar)
  positives: string[]          // sinais a favor
  risks: string[]              // sinais contra
  confidence: number           // 0-1 (confiança da IA na análise)
  summary: string              // resumo curto (rationale da nota)
  resumoRespostas: string      // resumo em linguagem natural das RESPOSTAS dos campos personalizados (card "Resumo do Lead")
  provider: string
  model: string
  inputTokens: number
  outputTokens: number
  costUsd: number
  at: string                   // ISO
}

// ── helpers de IA ─────────────────────────────────────────

function tryParseJson(s: string): any | null {
  if (!s) return null
  try { return JSON.parse(s) } catch { /* tenta extrair bloco */ }
  const m = s.match(/\{[\s\S]*\}/)
  if (m) { try { return JSON.parse(m[0]) } catch { return null } }
  return null
}

// Preços aproximados (USD por 1M tokens) — só para registro/telemetria.
function estimateAnthropicCost(i: number, o: number): number {
  return +(((i / 1e6) * 3) + ((o / 1e6) * 15)).toFixed(6)
}
function estimateOpenAiCost(i: number, o: number): number {
  return +(((i / 1e6) * 2.5) + ((o / 1e6) * 10)).toFixed(6)
}

function clampScore(n: unknown): number {
  const v = Math.round(Number(n))
  if (!Number.isFinite(v)) return 0
  return Math.max(0, Math.min(100, v))
}

function labelFor(score: number): 'hot' | 'warm' | 'cold' {
  if (score >= 70) return 'hot'
  if (score >= 40) return 'warm'
  return 'cold'
}

// Anthropic com prompt caching no bloco de sistema (contexto estável).
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
      temperature: 0.2,
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

// ── toggle ────────────────────────────────────────────────

async function isEnabled(): Promise<boolean> {
  const row = await prisma.setting.findUnique({ where: { key: 'ai.lead_score_enabled' } }).catch(() => null)
  if (row && row.value != null) {
    const v = typeof row.value === 'string' ? row.value.replace(/^"|"$/g, '') : row.value
    return v === true || v === 'true' || v === 1 || v === '1'
  }
  // Default: ligado se houver alguma chave de IA configurada.
  return !!((await getAnthropicKey()) || (await getOpenAiKey()))
}

// ── compilação dos inputs ─────────────────────────────────

const SYSTEM_BASE = `Você é um analista de vendas sênior. Sua tarefa é estimar, de 0 a 100, a PROBABILIDADE de um lead recém-chegado fechar negócio com a empresa, com base no perfil do lead, no canal de origem, na quantidade/qualidade de informação disponível e no fit com o negócio.

Regras:
- 0-39 (cold): baixa chance / fora do perfil / pouca informação ou intenção.
- 40-69 (warm): chance média / fit parcial / faltam sinais fortes.
- 70-100 (hot): alta chance / forte fit e intenção / decisor engajado.
- Penalize falta de dados, canais frios e sinais de "lead ruim" do contexto.
- Premie aderência ao cliente ideal (ICP), urgência, orçamento e dados ricos vindos do enriquecimento.
- As respostas aos CAMPOS PERSONALIZADOS são sinais PRIMÁRIOS de qualificação (foram definidas pelo cliente): pondere-as fortemente, tanto a favor quanto contra.
- Seja realista: a maioria dos leads é warm/cold. Não infle notas.

Gere TAMBÉM "resumoRespostas": um resumo em português, de 2 a 4 frases, em linguagem comercial natural (fluida, não em tópicos), do que ESTE lead respondeu nos CAMPOS PERSONALIZADOS — interpretado no contexto do NEGÓCIO e do FUNIL/ETAPA. Regras do resumoRespostas:
- Baseie-se SOMENTE nas respostas realmente fornecidas. NÃO invente, NÃO suponha e NÃO cite campos sem resposta.
- Destaque o que ajuda o time comercial a definir a ABORDAGEM (perfil, necessidade, urgência, porte, fit com a oferta).
- Não repita a nota nem fale de "score"; foque no conteúdo das respostas.
- Se NÃO houver nenhuma resposta de campo personalizado, retorne "" (string vazia).

Responda SOMENTE com JSON válido neste formato exato:
{"score": <int 0-100>, "probability": <float 0-1>, "confidence": <float 0-1>, "positives": ["..."], "risks": ["..."], "summary": "<=240 chars>", "resumoRespostas": "<texto natural ou string vazia>"}`

async function buildSystemPrompt(): Promise<string> {
  const parts: string[] = [SYSTEM_BASE]
  const biz = await buildBusinessContextBlock()
  if (biz) parts.push(biz)
  else parts.push('CONTEXTO DO NEGÓCIO: não configurado (peça ao cliente para preencher em Configurações > Inteligência > Contexto do Negócio para análises mais precisas).')

  // Fase 4 — calibração: poucos exemplos reais ganhos/perdidos deste tenant.
  const examples = await buildCalibrationExamples().catch(() => '')
  if (examples) parts.push(examples)
  return parts.join('\n\n')
}

async function buildCalibrationExamples(): Promise<string> {
  const [won, lost] = await Promise.all([
    prisma.lead.findMany({
      where: { outcome: 'won' },
      orderBy: { outcomeAt: 'desc' }, take: 3,
      select: { empresa: true, segmento: true, source: true, scores: true, aiScore: true },
    }),
    prisma.lead.findMany({
      where: { outcome: 'lost' },
      orderBy: { outcomeAt: 'desc' }, take: 3,
      select: { empresa: true, segmento: true, source: true, scores: true, aiScore: true },
    }),
  ])
  if (won.length === 0 && lost.length === 0) return ''
  const fmt = (l: any, r: string) =>
    `- [${r}] empresa=${l.empresa ?? '–'} segmento=${l.segmento ?? '–'} canal=${l.source ?? '–'} scoreDiag=${(l.scores as any)?.geral ?? '–'}`
  return [
    'EXEMPLOS HISTÓRICOS DESTA EMPRESA (calibre sua nota por estes desfechos reais):',
    ...won.map((l) => fmt(l, 'GANHOU')),
    ...lost.map((l) => fmt(l, 'PERDEU')),
  ].join('\n')
}

// ── Camada de campos personalizados (pesquisa + refinamento) ──────────────────
// Lê TODO o catálogo do módulo "Campos Personalizados" (CustomField ativos) e
// EXTRAI a resposta do lead para cada um — pesquisando em lead.customFields e,
// como rede de segurança, no formData (chave direta ou prefixo cf_). Refina os
// valores de select/multiselect traduzindo o `value` armazenado para o `label`
// legível (ex.: "300_499" → "De 300 a 499 ha"), para a IA ler a resposta real.
async function buildCustomFieldsBlock(lead: { customFields: any; formData: any }): Promise<string> {
  const defs = await prisma.customField
    .findMany({
      where: { active: true },
      orderBy: [{ position: 'asc' }, { id: 'asc' }],
      select: { key: true, label: true, type: true, options: true, group: true },
    })
    .catch(() => [] as any[])
  if (!defs.length) return 'CAMPOS PERSONALIZADOS: nenhum campo cadastrado neste tenant.'

  const cf = lead.customFields && typeof lead.customFields === 'object' ? (lead.customFields as Record<string, any>) : {}
  const fd = lead.formData && typeof lead.formData === 'object' ? (lead.formData as Record<string, any>) : {}

  const labelize = (def: any, raw: any): string => {
    const opts: Array<{ label: string; value: any }> = Array.isArray(def.options) ? def.options : []
    const one = (v: any) => {
      const hit = opts.find((o) => String(o.value) === String(v))
      return hit ? hit.label : String(v)
    }
    return Array.isArray(raw) ? raw.map(one).join(', ') : one(raw)
  }
  const isEmpty = (v: any) => v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0)

  const lines: string[] = []
  let answered = 0
  for (const def of defs) {
    // pesquisa a resposta: customFields[key] → formData[key] → formData[cf_key]
    let raw = cf[def.key]
    if (isEmpty(raw)) raw = fd[def.key]
    if (isEmpty(raw)) raw = fd[`cf_${def.key}`]
    if (isEmpty(raw)) continue
    answered++
    const grp = def.group ? ` [${def.group}]` : ''
    lines.push(`- ${def.label}${grp}: ${labelize(def, raw).slice(0, 200)}`)
  }
  const header = `CAMPOS PERSONALIZADOS (respostas do lead — ${answered}/${defs.length} preenchidos):`
  if (!answered) return `${header}\n- (nenhum campo personalizado preenchido por este lead)`
  return [header, ...lines].join('\n')
}

async function buildUserPrompt(leadId: number, phase: Phase): Promise<string | null> {
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: {
      id: true, nome: true, empresa: true, segmento: true, cidade: true,
      email: true, whatsapp: true, source: true, sourceId: true,
      completed: true, qualifiedAt: true, qualificationSource: true,
      lgpdConsent: true, scores: true, formData: true, customFields: true,
      enrichmentScore: true, enrichmentStatus: true,
      priorityScore: true, createdAt: true, funnelId: true,
      funnel: { select: { name: true } },
    },
  })
  if (!lead) return null

  // Contexto do funil/etapa: nome do funil + etapa atual (última movimentação).
  let funilCtx = lead.funnel?.name ? `Funil: ${lead.funnel.name}` : 'Funil: –'
  if (lead.funnelId) {
    const mov = await prisma.leadStageMovement.findFirst({
      where: { leadId, toFunnelId: lead.funnelId, toStageKey: { not: null } },
      orderBy: { movedAt: 'desc' }, select: { toStageKey: true },
    }).catch(() => null)
    if (mov?.toStageKey) {
      const st = await prisma.stage.findFirst({
        where: { funnelId: lead.funnelId, key: mov.toStageKey }, select: { name: true },
      }).catch(() => null)
      if (st?.name) funilCtx += ` · Etapa atual: ${st.name}`
    }
  }

  const filled = ['nome', 'empresa', 'email', 'whatsapp', 'cidade', 'segmento']
    .filter((k) => (lead as any)[k]).length

  // Dossiê de enriquecimento (fatos ativos) — a "quantidade de informação
  // fornecida pela inteligência".
  let dossier = 'sem dados de enriquecimento'
  if (phase !== 'provisional') {
    const facts = await prisma.leadEnrichment.findMany({
      where: { leadId, status: 'active' },
      select: { source: true, field: true, value: true, confidence: true },
      orderBy: { confidence: 'desc' }, take: 40,
    })
    if (facts.length) {
      dossier = facts
        .map((f) => `${f.field}=${String(f.value).slice(0, 120)} (${f.source}, conf ${f.confidence ?? '?'})`)
        .join('; ')
    }
  }

  const fd = (() => {
    try { return JSON.stringify(lead.formData ?? {}).slice(0, 1500) } catch { return '{}' }
  })()

  const customFieldsBlock = await buildCustomFieldsBlock(lead)

  return [
    `FASE DA ANÁLISE: ${phase}`,
    `LEAD #${lead.id}`,
    `- Nome: ${lead.nome ?? '–'}`,
    `- Empresa: ${lead.empresa ?? '–'}`,
    `- Segmento: ${lead.segmento ?? '–'}`,
    `- Cidade: ${lead.cidade ?? '–'}`,
    `- Canal de origem: ${lead.source ?? '–'}${lead.sourceId ? ` (${lead.sourceId})` : ''}`,
    `- ${funilCtx}`,
    `- Qualificado: ${lead.qualifiedAt ? `sim (${lead.qualificationSource ?? '?'})` : 'não'}`,
    `- Consentimento LGPD: ${lead.lgpdConsent ? 'sim' : 'não'}`,
    `- Fluxo/diagnóstico completo: ${lead.completed ? 'sim' : 'não'}`,
    `- Campos de contato preenchidos: ${filled}/6`,
    `- Score do diagnóstico (chatbot): ${(lead.scores as any)?.geral ?? '–'}`,
    `- Priority score (urgência operacional): ${lead.priorityScore ?? '–'}`,
    `- Enrichment score (0-100): ${lead.enrichmentScore ?? '–'} (status ${lead.enrichmentStatus ?? '–'})`,
    `- Dossiê de enriquecimento: ${dossier}`,
    '',
    customFieldsBlock,
    '',
    `- Dados do formulário/origem (JSON): ${fd}`,
  ].join('\n')
}

// ── núcleo: pontuar 1 lead ────────────────────────────────

export async function scoreLead(
  leadId: number,
  phase: Phase = 'provisional',
  opts: { force?: boolean } = {},
): Promise<number | null> {
  if (!(await isEnabled())) return null

  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: { id: true, aiScore: true, aiScoredAt: true, aiScoreReason: true, lgpdConsent: true, qualifiedAt: true, completed: true, isGroup: true },
  })
  if (!lead) return null
  // Grupo de WhatsApp não é pessoa: pontuar "intenção de compra" de um grupo não
  // significa nada e gastaria IA por mensagem de dezenas de participantes.
  if (lead.isGroup) return null

  // Salvaguarda de custo: só pontua leads com algum sinal de intenção real.
  if (!opts.force && phase !== 'manual') {
    if (!lead.qualifiedAt && !lead.lgpdConsent && !lead.completed) return null
  }

  // Não deixa o provisório sobrescrever um definitivo já calculado.
  const prevPhase = (lead.aiScoreReason as any)?.phase as Phase | undefined
  if (phase === 'provisional' && prevPhase && prevPhase !== 'provisional') return lead.aiScore ?? null

  // Debounce (exceto manual/force).
  if (!opts.force && phase !== 'manual' && lead.aiScoredAt) {
    if (Date.now() - new Date(lead.aiScoredAt).getTime() < DEBOUNCE_MS) return lead.aiScore ?? null
  }

  const system = await buildSystemPrompt()
  const user = await buildUserPrompt(leadId, phase)
  if (!user) return null

  const preferred = await getPrimaryProvider()
  const anthropicKey = await getAnthropicKey()
  const openAiKey = await getOpenAiKey()

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
    if (lastErr) captureException(lastErr instanceof Error ? lastErr : new Error(String(lastErr)), { stage: 'ai_lead_score', leadId })
    return null
  }

  const parsed = tryParseJson(res.text)
  if (!parsed || typeof parsed.score === 'undefined') {
    captureException(new Error('AI lead score: resposta sem JSON válido'), { stage: 'ai_lead_score_parse', leadId })
    return null
  }

  const score = clampScore(parsed.score)
  const label = labelFor(score)
  const reason: AiScoreReason = {
    phase,
    probability: Math.max(0, Math.min(1, Number(parsed.probability) || score / 100)),
    positives: Array.isArray(parsed.positives) ? parsed.positives.slice(0, 6).map(String) : [],
    risks: Array.isArray(parsed.risks) ? parsed.risks.slice(0, 6).map(String) : [],
    confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || 0.5)),
    summary: String(parsed.summary ?? '').slice(0, 240),
    resumoRespostas: String(parsed.resumoRespostas ?? '').slice(0, 1000),
    provider: res.provider,
    model: res.model,
    inputTokens: res.inputTokens,
    outputTokens: res.outputTokens,
    costUsd: res.costUsd,
    at: new Date().toISOString(),
  }

  await prisma.lead.update({
    where: { id: leadId },
    data: { aiScore: score, aiScoreLabel: label, aiScoreReason: reason as any, aiScoredAt: new Date() },
  })

  logEvent({
    leadId,
    type: 'ai_lead_scored',
    category: 'system',
    actorType: 'ai',
    source: `ai_lead_score:${phase}`,
    title: `Lead Score por IA: ${score} (${label})`,
    description: reason.summary,
    newValue: String(score),
    oldValue: lead.aiScore != null ? String(lead.aiScore) : undefined,
    metadata: { provider: reason.provider, model: reason.model, costUsd: reason.costUsd, phase },
  })

  return score
}

// ── fila + hooks de evento ────────────────────────────────

let worker: Worker | null = null

function enqueue(leadId: number, phase: Phase) {
  queues.aiLeadScore
    .add(SCORE_JOB, { leadId, phase }, { attempts: 2, backoff: { type: 'exponential', delay: 5000 }, removeOnComplete: 100, removeOnFail: 50 })
    .catch((err) => console.error('[aiLeadScore] enqueue falhou:', err?.message || err))
}

function onLeadCreated(ev: DomainEvent) {
  if (ev.leadId) enqueue(ev.leadId, 'provisional')
}
function onEnrichmentCompleted(ev: DomainEvent) {
  if (ev.leadId) enqueue(ev.leadId, 'definitive')
}

/** Inicia o worker + assina os hooks. Idempotente. */
export async function startAiLeadScoreScheduler(): Promise<void> {
  if (worker) return
  worker = new Worker(
    QUEUE_NAME,
    async (job: Job) => {
      if (job.name !== SCORE_JOB) return
      const { leadId, phase } = job.data as { leadId: number; phase: Phase }
      await scoreLead(leadId, phase)
    },
    { connection: redisConnection, concurrency: 2 },
  )
  worker.on('failed', (job, err) => {
    console.error('[aiLeadScore] job falhou:', err?.message)
    captureException(err, { queue: QUEUE_NAME, jobId: job?.id })
  })

  eventBus.on('lead.created', onLeadCreated)
  eventBus.on('enrichment.completed', onEnrichmentCompleted)
  console.log('[aiLeadScore] scheduler iniciado — hooks lead.created (provisório) + enrichment.completed (definitivo)')
}

export async function stopAiLeadScoreScheduler(): Promise<void> {
  eventBus.off('lead.created', onLeadCreated)
  eventBus.off('enrichment.completed', onEnrichmentCompleted)
  if (!worker) return
  await worker.close()
  worker = null
}

// ── Fase 4: relatório de calibração (previsto × real) ─────

export interface CalibrationBucket {
  bucket: string          // ex.: '70-100 (hot)'
  total: number
  won: number
  lost: number
  open: number
  winRate: number | null  // won / (won+lost)
}

/** Compara faixas de aiScore com o desfecho real (won/lost) para medir
 * acurácia da previsão. Usado no painel/relatório. */
export async function getAiScoreCalibration(): Promise<{ buckets: CalibrationBucket[]; scored: number }> {
  const leads = await prisma.lead.findMany({
    where: { aiScore: { not: null } },
    select: { aiScore: true, outcome: true },
  })
  const defs: { name: string; min: number; max: number }[] = [
    { name: '0-39 (cold)', min: 0, max: 39 },
    { name: '40-69 (warm)', min: 40, max: 69 },
    { name: '70-100 (hot)', min: 70, max: 100 },
  ]
  const buckets: CalibrationBucket[] = defs.map((d) => {
    const inB = leads.filter((l) => (l.aiScore ?? -1) >= d.min && (l.aiScore ?? -1) <= d.max)
    const won = inB.filter((l) => l.outcome === 'won').length
    const lost = inB.filter((l) => l.outcome === 'lost').length
    const open = inB.length - won - lost
    return {
      bucket: d.name,
      total: inB.length,
      won, lost, open,
      winRate: won + lost > 0 ? +(won / (won + lost)).toFixed(3) : null,
    }
  })
  return { buckets, scored: leads.length }
}
